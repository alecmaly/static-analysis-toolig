import concurrent.futures
import threading
import datetime
import argparse
import subprocess
import json
import uuid
import math
import os
import time
import re
import select
import colored
import debugpy
import threading
import zlib
from typing import List, Dict
import copy

## START arg parsing
class StoreWithDefaultCheck(argparse.Action):
    """Custom action to track if an argument was explicitly provided."""
    def __call__(self, parser, namespace, values, option_string=None):
        # Set the value normally
        setattr(namespace, self.dest, values)
        # Track that the user explicitly provided this argument
        if not hasattr(namespace, "_explicit_args"):
            namespace._explicit_args = set()
        namespace._explicit_args.add(self.dest)

class ArgumentParserWithTracking(argparse.ArgumentParser):
    """Custom ArgumentParser that automatically adds StoreWithDefaultCheck."""
    def add_argument(self, *args, **kwargs):
        # If action is not already specified, use StoreWithDefaultCheck
        if 'action' not in kwargs:
            kwargs['action'] = StoreWithDefaultCheck
        return super().add_argument(*args, **kwargs)

def was_explicitly_passed(arg_name, args):
    """Check if the argument was explicitly provided by the user."""
    return arg_name in getattr(args, "_explicit_args", set())

## END arg parsing


NUM_THREADS = 6
print_lock = threading.Lock()

def print_thread_safe(*args, **kwargs):
    with print_lock:
        print(*args, **kwargs)


def in_scope(path):
    global EXCLUDE_FUNC_CALL_FILEPATHS
    global INCLUDE_FILEPATHS
    return (len(INCLUDE_FILEPATHS) == 0 or any([re.search(p, path, re.IGNORECASE) for p in INCLUDE_FILEPATHS])) and not any([re.search(p, path, re.IGNORECASE) for p in EXCLUDE_FUNC_CALL_FILEPATHS])

def dict_to_frozenset(d):
    """Convert a dictionary to a frozenset of key-value pairs."""
    return frozenset(
        (k, dict_to_frozenset(v) if isinstance(v, dict) else v)
        for k, v in d.items()
    )

def join_and_dedupe(lists):
    """Joins multiple lists of dictionaries and removes duplicates efficiently."""
    seen = set()
    result = []

    # Prepare the data by converting dictionaries to frozensets
    all_items = [item for sublist in lists for item in sublist]

    for item in all_items:
        item_frozenset = dict_to_frozenset(item)
        if item_frozenset not in seen:
            seen.add(item_frozenset)
            result.append(item)

    return result


def lists_are_equivalent(list1: List[Dict], list2: List[Dict]) -> bool:
    """Check if two lists of dictionaries are equivalent, regardless of the order."""
    if len(list1) != len(list2):
        return False

    # Convert each dictionary to a frozenset of key-value pairs
    set1 = {dict_to_frozenset(d) for d in list1}
    set2 = {dict_to_frozenset(d) for d in list2}

    return set1 == set2




def input_with_timeout(prompt, timeout, default_val=None):
    # Placeholder to store user input
    result = [None]

    # Define a function to capture input
    def get_input():
        result[0] = input(prompt)

    # Create a thread to run the input() function
    input_thread = threading.Thread(target=get_input)
    input_thread.daemon = True
    input_thread.start()

    # Wait for the specified timeout
    input_thread.join(timeout)

    if input_thread.is_alive():
        print("\nInput timed out!")
        return default_val
    return result[0]

# from python_jsonrpc_server import dispatchers

# ISSUES: 
# - line / char returned from symbols is not consistant
#   - sometimes need to incremenet line by 1
#   - increment char by 5 or some offset
# - name is not consistant
#   - e.g.: var test = func() => LSP will return `func()` as the name of the function

import bisect
from urllib.parse import unquote



# TODO: Auto install LSP servers based on file extension / code
# mason packages (metadata for install?): https://github.com/mason-org/mason-registry/tree/main/packages
# 

# seconds to periodically pause to let LSP catch up in processing
PAUSE_TIME = .33



global errors
global errors_counter_map
errors = []
errors_counter_map = {}

FUNC_NAME_OFFSET = 0 # 5 (for go)

global EXCLUDE_FUNC_CALL_FILEPATHS
global INCLUDE_FILEPATHS
# EXCLUDE_FUNC_CALL_FILEPATHS = ['/usr/local/go/src', 'mock', 'test', '/accounts', '/appveyor.yml', '/AUTHORS', '/beacon', '/build', '/circle.yml', '/cmd', '/common', '/consensus', '/console', '/COPYING', '/COPYING.LESSER', '/crypto', '/Dockerfile', '/Dockerfile.alltools', '/docs', '/ethclient', '/ethdb', '/ethstats', '/event', '/go.mod', '/go.sum', '/graphql', '/interfaces.go', '/internal', '/log', '/Makefile', '/metrics', '/miner', '/node', '/oss-fuzz.sh', '/p2p', '/params', '/README.md', '/rlp', '/SECURITY.md', '/signer', '/swarm', '/tests', '/trie', '/triedb']
EXCLUDE_FUNC_CALL_FILEPATHS = ['/go/pkg', '/usr/lib/', '/usr/local/go/src', '/venv/', '/python\\d+\\.\\d+/site-packages/', 'node_modules', 'mock', 'test', 'cache', 'rustlib', '.cargo']
INCLUDE_FILEPATHS = []


def contains_more_than_search_str(s, search_str):
    # Tokenize the string by identifying words and ignoring punctuation
    tokens = re.findall(r'\b\w+\b', s)
    
    # Check if search_str appears as a standalone word using regex
    search_str_occurrences = len(re.findall(rf'\b{re.escape(search_str)}\b', s))
    
    # Return True if there are more words than just the search_str
    return len(tokens) > search_str_occurrences

file_content_map = {}
def get_file_content(filepath, startline=None, endline=None, startchar=None, endchar=None):
    try:
        filepath = unquote(filepath)
        if not startline:
            return ""
        if not endline:
            endline = startline

        if not file_content_map.get(filepath, None):
            content = []
            try:
                content = open(filepath, 'r').read().split("\n")
            except:
                pass

            file_content_map[filepath] = content
        
        if startline == endline:
            return file_content_map[filepath][startline][startchar:endchar]
        return "\n".join(file_content_map[filepath][startline:endline])
    except IndexError:
        return ""


def parse_func_objects(functions, include_top_level_func=False):
    seen_scopes = set()
    scope_objs = []


    if include_top_level_func:
        for f_id in functions.copy():
            top_level_filepath = f_id.split(",")[-1].split("#")[0]
            top_level_id = f"__TOP_LEVEL__,{top_level_filepath}#0"
            functions.add(top_level_id)
                
        # TODO: ?? should also get top level of scopes?

    function_objs = []
    for f_id in functions:
        # get real function
        f_id = client.def_to_func_map.get(f_id, f_id)

        functionName = ",".join(f_id.split(",")[:-1])
        if not functionName:
            continue

        path = f_id.split(",")[-1]
        filename = path.split("/")[-1]

        scope_name = path.split("#")[0].split("/")[-1]
        scope_id = f"{scope_name},{path.split('#')[0]}"

        startLine = client.function_details.get(f_id, {}).get('start_line', 0)
        startChar = client.function_details.get(f_id, {}).get('start_char', 0)
        endLine = client.function_details.get(f_id, {}).get('end_line', 0)
        endChar = client.function_details.get(f_id, {}).get('end_char', 0)

        f = {}
        f['id'] = f_id
        f['functionName'] = functionName
        f['scope_id'] = scope_id
        f['scopeName'] = scope_name
        f['functionParameters'] = ""
        f['functionReturns'] = ""
        f['startLine'] = startLine
        f['endLine'] = endLine
        f['startCol'] = startChar
        f['filepath'] = path
        f['filepath_body'] = path
        f['qualifiedName_full'] = f"{filename}.{functionName}"
        f['qualifiedName'] = ""
        f['filename'] = path.split("/")[-1].split("#")[0]
        f['decorator'] = ""
        f['function_notes'] = ""
        f['modifiers'] = []
        f['entrypoint_callstacks'] = []
        f['exit_callstacks'] = []
        f['other_callstacks'] = []
        f['state_vars_summary_html'] = ""
        f['function_summary_html'] = ""
        f['tainted_locations_count'] = 0
        f['tainted_locations_html'] = ""
        f['checkbox_ids_to_check'] = []
        f['is_inherited'] = False
        f['is_shadowed'] = False
        f['additional_info_html'] = ""
        f['called_at'] = list(client.function_references.get(f_id, []))

        function_objs.append(f)




        if scope_id not in seen_scopes:
            seen_scopes.add(scope_id)
            s = {
                "id": scope_id,
                "name": scope_name,
                "type": "file",
                "state_vars_html": "",
                "inherits": [],
                "inherits_recursive": [],
                "backgroundColor": "",
                "storage_slots_html": "",
                "fuzz_testing_html": "",
                "modifiers_html": "",
                "functions_html": "",
                "scope_summary_html": "",
                "inherits_from": [],
                "inherits_from_recursive": []
            }
            scope_objs.append(s)


    return function_objs, list(scope_objs)

def get_range(item):
    location_base = item['location'] if 'location' in item else item
    # java, range: start line 2 -> 4. selectionRange: line start = 17, end = 4 ??????
    range = item['selectionRange'] if 'selectionRange' in location_base and not client.disable_selectionRange else location_base['range']
    return range

def build_func_id_params(uri, line, char):
    obj = {
        "name": "",
        "kind": 6, # method
        "location": {
            "uri": uri,
            "range": {
                "start": {
                    "line": line,
                    "character": char
                },
                "end": {
                    "line": line,
                    "character": char
                }
            }
        }
    }
    return obj



class LSPClient:
    def __init__(self, 
                language_id, 
                file_extensions, 
                server_cmd,
                force_callHierarchy=False,
                max_ref_tracking_count=50,
                disable_get_id_from_ref=False,
                disable_selectionRange=False,
                disable_incoming_calls=False,
                disable_outgoing_calls=False, 
                disable_inheritance=False,
                pause_for_verification=False, 
                guess_ref_read_write=True, 
                append_output_file=False,
                resp_pause=0,
                resp_timeout=180,
                init_timeout=30,
                init_pause=2,
                verbose=False,
                stderr_to_file=False):
        self.server_cmd = server_cmd

        self.process = subprocess.Popen(
            self.server_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=open('error_log.txt', 'w') if verbose or stderr_to_file else open('/dev/null', 'w'),  # clangd doesn't work unless piping stderr to file, seems to hang when sending to subprocess.PIPE (memory issue, not flushing buffer?). error file will get clobbered upon language server reboot, change if needed
            bufsize=0,
            # shell=True  # TODO: remove if this breaks stuf? What did this fix? c?
        )

        
        
        # https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocumentItem
        self.language_id = language_id
        self.file_extensions = file_extensions
        self.max_ref_tracking_count = max_ref_tracking_count
        self.force_callHierarchy = force_callHierarchy
        self.get_id_from_ref = not disable_get_id_from_ref
        self.disable_selectionRange = disable_selectionRange
        self.disable_incoming_calls = disable_incoming_calls
        self.disable_outgoing_calls = disable_outgoing_calls
        self.disable_inheritance = disable_inheritance
        self.pause_for_verification = pause_for_verification
        self.guess_ref_read_write = guess_ref_read_write
        self.append_output_file = append_output_file
        self.resp_timeout = resp_timeout
        self.resp_pause = resp_pause
        self.init_timeout = init_timeout
        self.init_pause = init_pause
        self.verbose = verbose

        self.opened_docs = set()
        self.had_error = False
        self.completed_function_ids = set()
        self.completed_w_err_function_ids = set()
        self.seen_classes = set()
        self.seen_functions = set()
        self.seen_functions_from_files_ids = set()  
        self.function_calls = {}
        self.class_inheritance = {}
        self.var_ref_map = {}
        self.capabilities = {}
        self.function_call_refs = {} # to be converted to function_calls later
        # self.dispatcher = dispatchers.MethodDispatcher()
        # self.def_to_func_map = {} # map of function definitions to functions
        self.definition_cache = {}
        self.def_to_func_map = {}
        self.function_references = {}
        self.function_details = {}

        # cache
        self.seen_strings = set()
        self.doc_symbols_map = {}
        self.evaled_files = set()
        self.last_opened_doc = None

    def symbol_to_loc(self, symbol, include_name=False, include_start_char=True):
        name = f"{symbol.get('name', "")}," if include_name else ""
        base_location = symbol['location'] if 'location' in symbol else symbol
        start_char = f":{get_range(symbol)['start']['character']}" if include_start_char else ""
        return f"{name}{base_location['uri'].replace('file://', '')}#{get_range(symbol)['start']['line']}{start_char}"
        

    def get_id(self, item, from_def=None): # True fixes Java, False fixes clangd?
        from_def = from_def if from_def is not None else self.get_id_from_ref

        # ISSUE: calling self.get_id() twice will result in bad offset for line number
        location_base = item['location'] if 'location' in item else item
        real_symbol = item

        # if item.get('kind', None) in [6, 9, 12] and not any([p for p in EXCLUDE_FUNC_CALL_FILEPATHS if p.lower() in location_base['uri'].lower()]):
        if item.get('kind', None) in [6, 9, 12] and not any([re.search(p, location_base['uri'], re.IGNORECASE) for p in EXCLUDE_FUNC_CALL_FILEPATHS]):
            # do lookups for functions that are not in excluded paths (downside is we will not get code start/end lines for these functions)
            symbols = client.get_symbols_in_file(location_base['uri'])

            for symbol in symbols:
                symbol_location_base = symbol['location'] if 'location' in symbol else symbol
                if item['name'] in symbol['name'] and get_range(location_base)['start']['line'] == get_range(symbol_location_base)['start']['line'] and symbol['kind'] in [6, 9, 12]: # method | function | constructor
                    # get_range(symbol_location_base)['start']['line'] = get_range(location_base)['start']['line'] + 1
                    # get_range(symbol_location_base)['end']['line'] = get_range(location_base)['end']['line'] + 1
                    real_symbol = symbol
                    break
            # cache doc symbols
            # return func with same name,uri#lineStart
            if not real_symbol:
                # (Go) could be anonymous func?
                # TODO: param `type` if function and no found symbol, return line 0? (maybe not?)
                print("COULD NOT FIND REAL SYMBOL - USING ITEM (source mapping will fail)")
                

        # content = get_file_content(real_symbol_location_base['uri'].replace("file://", ""), get_range(real_symbol_location_base)['start']['line'])
        # line_offset = 0
        # if not content.index(f"{real_symbol.get('name', '').split('.')[-1].split('(')[0]}("):
        #     line_offset = 1
        ret_symbol = real_symbol.copy()
        if from_def:
            # should be for functions, thus we parse func name (for Java Language Server)
            ret_symbol = self.get_func_definition(real_symbol)[0]
            ret_symbol['name'] = self.parse_func_name(real_symbol.get('name', "__NO_NAME__"))

        real_symbol_location_base = real_symbol['location'] if 'location' in real_symbol else real_symbol
        ret_symbol_location_base = ret_symbol['location'] if 'location' in ret_symbol else ret_symbol

        range_end_line = real_symbol_location_base['range']['end']['line'] if real_symbol_location_base['range']['end']['line'] > ret_symbol_location_base['range']['end']['line'] else ret_symbol_location_base['range']['end']['line']

        ret_normalized_range = get_range(ret_symbol_location_base)
        real_normalized_range = get_range(real_symbol_location_base)
        # TODO: validate line number, do we need to add by 1?
        # return f"{real_symbol.get('name', '')},{real_symbol_location_base['uri'].replace('file://', '')}#{get_range(real_symbol_location_base)['start']['line'] + line_offset}:{get_range(real_symbol_location_base)['start']['character']}:{get_range(real_symbol_location_base)['end']['line'] + line_offset}:{get_range(real_symbol_location_base)['end']['character']}"

        # start_line = ret_normalized_range['start']['line']
        start_line = ret_normalized_range['start']['line'] if ret_normalized_range['start']['line'] > real_normalized_range['start']['line'] else real_normalized_range['start']['line'] # start_line at latest line to skip comments
        end_line = ret_normalized_range['end']['line'] if ret_normalized_range['end']['line'] > real_normalized_range['end']['line'] else real_normalized_range['end']['line']
        end_line = end_line if end_line > range_end_line else range_end_line
        # TODO: get real start_char (for accurate jump to)
        start_char = ret_normalized_range['start']['character']
        start_char = ret_normalized_range['start']['character'] if ret_normalized_range['start']['character'] > real_normalized_range['start']['character'] else real_normalized_range['start']['character']
        end_char = ret_normalized_range['end']['character']
        # end_char = end_char if end_char > real_normalized_range['end']['character'] else real_normalized_range['end']['character']

        # TODO: fix self.parse_func_name breaks stuff here for java and maybe other languages, works for powershell
        # id = f"{self.parse_func_name(ret_symbol.get('name', ''))},{location_base['uri'].replace('file://', '')}#{start_line}"
        id = f"{self.parse_func_name(ret_symbol.get('name', ''))},{ret_symbol_location_base['uri'].replace('file://', '')}#{start_line}"

        if not self.function_details.get(id, None) or end_line > self.function_details.get(id, {}).get('end_line', 0):
            self.function_details[id] = {
                "start_line": start_line,
                "end_line": end_line,
                "start_char": start_char,
                "end_char": end_char
            }

        return id
    


    def parse_func_name(self, s):
        # (typescipt?)  s = "deprecate('The multipleResolves event has been deprecated.', 'DEP0160') callback"
        # (go)          s = "(*authTest).Run"
        # NOTE: should be ok if this is ran on a reference name as they should not contain these characters in their name??
        new_func_name = s.split("(")[0].split(".")[-1].split("::")[-1]
        if new_func_name == "":
            # handle go
            new_func_name = s.split(")")[-1].split(".")[-1].split("::")[-1]
        

        if s not in self.seen_strings and self.verbose:
            print(f"Parsed func names: {s} -> {new_func_name}")
        self.seen_strings.add(s)

        return new_func_name.replace("function ", "").strip()

        # return s.split(".")[-1].split("(")[0]   # works for go?
        # return s.split(".")[-1].split("(")[0]   # works for go?


    def print_requried_capabilities(self):
        REQUIRED_CAPABILITIIS = ["documentSymbolProvider", "definitionProvider", "referencesProvider", "callHierarchyProvider", "typeHierarchyProvider"]
        # print colored text based on capability
        for cap in REQUIRED_CAPABILITIIS:
            if self.capabilities.get(cap, False):
                print(f"{cap}: {colored.fg('green')}{self.capabilities.get(cap, False)}{colored.attr('reset')}")
            else:
                print(f"{cap}: {colored.fg('red')}{self.capabilities.get(cap, False)}{colored.attr('reset')}")
            
    def poll_and_reboot_LSP(self):
        self.process.poll()
        if self.process.returncode is not None:
            print("Process has terminated, rebooting")
            self.process = subprocess.Popen(
                self.server_cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0
            )
            response = self.send_request("initialize", self.init_params)
            print("Initialize response:", response)

            self.send_notification("initialized", {})

            self.wait_for_initialization()

            # for doc in self.opened_docs:
            #     did_open_params = {
            #         "textDocument": {
            #             "uri": doc
            #         }
            #     }
            #     self.send_notification("textDocument/didOpen", did_open_params)
            return True
        return False
    
    def send_request(self, method, params):
        global errors

        id = str(uuid.uuid4())
        message = {
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        }

        # skip if more than X errors in page w/ same method
        ERROR_LIMIT = 3
        error_key = f"{message['params']['item']['uri'] if 'item' in message['params'] else ''};{message['method']}"
        if errors_counter_map.get(error_key, 0) > ERROR_LIMIT: # seen same error in file > X times 
            response = {'result': "", 'error': {'message': 'skipped - too many errors'}}
            return response
        
        self._send_message(message)
        # time.sleep(.1)
        response = self._receive_response(id)

        if method == "initialize" and not 'error' in response and response['result'].get('capabilities', None):
            self.capabilities = response['result']['capabilities']
            self.print_requried_capabilities()

            if self.pause_for_verification:
                input("Press Enter to continue...")


        if response.get('error'):
            errors.append(message)
            # print last 10 errors, adding newline for each 
            if self.verbose:
                x = 10
                print(f"Last {x} Errors: ", "\n\t".join([e['method'] for e in errors[-x:]]))
            is_content_modified_error = response.get('error', {}).get('message') == "content modified"
            if response['error'].get('message', "") in ["no views", "reboot", "timeout"] or is_content_modified_error:
                errors_counter_map[error_key] = errors_counter_map[error_key] + 1 if error_key in errors_counter_map else 0
                # had_error state variable to retry, removing because retrying a request that crashes LSP will result in infinite loop
                # self.had_error = True
                
                # get uri and handle errors and non existant key
                # uri = ""
                # if 'textDocument' in params:
                #     uri = params['textDocument']['uri']
                # elif 'item' in params:
                #     uri = params['item']['uri']

                # did_open_params = {
                #     "textDocument": {
                #         "uri": uri,
                #         "languageId": self.language_id,
                #         "version": 1,
                #         "text": open(uri.replace("file://", ""), 'r').read()
                #     }
                # }
                # print("ERR: resending didOpen")
                # self.send_notification("textDocument/didOpen", did_open_params)
                id = str(uuid.uuid4())
                message['id'] = id
                self._send_message(message)
                response = self._receive_response(id)

        if self.verbose or response.get('error'):
            print("response: ", response, "\n")

        # if method == "textDocument/documentSymbol":
        #     for loc in response.get('result', []):
        #         loc['location']['range']['start']['line'] += 1
        #         loc['location']['range']['end']['line'] += 1

        return response

    def send_notification(self, method, params):
        if method == "textDocument/didOpen":
            # close last doc if new doc is opened
            if self.last_opened_doc:
                # close last opened doc
                did_close_params = {
                    "textDocument": {
                        "uri": self.last_opened_doc
                    }
                }

                self.send_notification("textDocument/didClose", did_close_params)
            self.last_opened_doc = params['textDocument']['uri']             


        message = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }
        self._send_message(message)

        if method == "textDocument/didOpen" and params['textDocument']['uri'] not in self.opened_docs:
            print("opened doc: ", params['textDocument']['uri'])
            self.opened_docs.add(params['textDocument']['uri'])
            time.sleep(PAUSE_TIME) # wait for server to settle (process opening new doc), was receiving empty results when querying too fast after opening a new doc
            

    def _send_message(self, message):
        if message['method'] != "textDocument/didOpen" and message['method'] != "textDocument/didClose":
            # if file is not opened, open it
            req_filepath = message.get('params', {}).get('textDocument', {}).get('uri', self.last_opened_doc)
            if req_filepath != self.last_opened_doc:
                content = ""
                try:
                    content = open(unquote(req_filepath.replace("file://", "")), 'r', encoding='utf-8').read()
                except:
                    pass

                # Send didOpen notification
                did_open_params = {
                    "textDocument": {
                        "uri": req_filepath,
                        "languageId": self.language_id,
                        "version": 1,
                        "text": content
                    }
                }
                self.send_notification("textDocument/didOpen", did_open_params)

        
        if self.verbose:
            print("\nLast opened doc: ", self.last_opened_doc)
            print("request: ", message)

        message_str = json.dumps(message)
        message_bytes = message_str.encode('utf-8')
        header = f"Content-Length: {len(message_bytes)}\r\n\r\n"
        self.process.stdin.write(header.encode('utf-8') + message_bytes)
        self.process.stdin.flush()

    def _receive_response(self, id=None, timeout=None):
        # if did not reboot, keep waiting for response (may result in infinite loop if server never responds)
        while True:
            # check if process is running or defunct
            headers = self._read_headers(timeout=timeout)

            if 'Content-Length' not in headers:
                # log failures?
                print("Error: no content length in headers")
                time.sleep(2) # wait for server to settle
                did_reboot = self.poll_and_reboot_LSP()
                if did_reboot:
                    response = {'result': "", 'error': {'message': 'reboot'}}
                else:
                    response = {'result': "", 'error': {'message': 'timeout'}}

                # break, will retry again
                break


            content_length = int(headers.get('Content-Length', 0))

            # if content_length == 0:
            #     # WARNING: will loop forever if server crashes 
            #     continue

            body = b''
            while True:
                body += self.process.stdout.read(content_length - len(body))
                if len(body) == content_length:
                    break
            if self.verbose:
                print("b: ", body)

            try:
                response = json.loads(body)
            except:
                print("Error parsing response, defulting to null: ", body)
                did_reboot = self.poll_and_reboot_LSP()
                response = {'result': ""}
                break

            if id:
                if response.get('id') == id:
                    if self.verbose:
                        print("matched request/response") 
                    break
            else:
                # loop until not publishing diagnostics
                if response.get('method') not in ["textDocument/publishDiagnostics"]:
                    break
            
        
        time.sleep(self.resp_pause)
        return response

    def _read_headers(self, timeout = None):
        # def read_with_timeout(process, timeout):
        #     poll = select.poll()
        #     poll.register(process.stdout, select.POLLIN)
        #     events = poll.poll(timeout * 1000)  # timeout in milliseconds

        #     if events:
        #         return process.stdout.readline().decode('utf-8').strip()
        #     else:
        #         # raise TimeoutError("Read operation timed out")
        #         print("Read operation timed out")
        #         return ""

        def read_with_timeout(process, timeout):
            poll = select.poll()
            poll.register(process.stdout, select.POLLIN)
            start_time = time.time()

            while (time.time() - start_time) < timeout:
                events = poll.poll(5000)

                if events:
                    s = process.stdout.readline().decode('utf-8').strip()
                    if self.verbose:
                        print("s: ", s)
                    return s
                
                did_reboot = process.returncode is not None
                if did_reboot:
                    print("server rebooted, retrying")
                    # force exit if server rebooted, no longer neeed to wait for response. Check if return value should be changed to retry (returning "" for now)
                    return ""
            
            print("Read operation timed out")
            return ""





        headers = {}
        lines = []
        while True:
            # rust-analyzer (rust) took 2.25min to return results for callHierarchy/incomingCalls
            line = read_with_timeout(self.process, timeout if timeout else self.resp_timeout)  
            if line == "":
                break
            lines.append(line)
            try: 
                key, value = line.split(": ", 1)
                # hacky solution for gopls issue
                # joining messages without newline: e.x., 
                # '{"jsonrpc":"2.0","method":"window/logMessage","params":{"type":3,"message":"2024/06/21 17:00:30 go/packages.Load #46\\n\\tsnapshot=162\\n\\tdirectory=file://~/Desktop/slither-custom-tooling/genaric/lsp/go/go-ethereum\\n\\tpackage=\\"github.com/ethereum/go-ethereum/core/forkid\\"\\n\\tfiles=[~/Desktop/slither-custom-tooling/genaric/lsp/go/go-ethereum/core/forkid/forkid.go]\\n"}}Content-Length: 665'
                # am I not flushing the buffer correctly to accomodate log messages?
                headers[key] = value
            except Exception as e:
                print("Error reading headers: ", e, line)
        return headers
    
    
    def wait_for_initialization(self):
        # timeout = self.init_timeout
        print(f"waiting for init.. timeout is set to {self.init_timeout} seconds but may take longer.")
        # while True:
        #     response = self._receive_response()
        #     # assume showing a message means initialization is done (may need to update for other LSPs)
        #     if response.get("method") == "window/showMessage" and "finished" in response["params"]["message"].lower():
        #         break
        #     time.sleep(1)
        
        # wait for initialization but continue if no response in timeout seconds
        start_time = time.time()
        while True:
            response = self._receive_response(timeout=self.init_timeout)
            if response.get('error', {}).get('message', 'timeout') != 'timeout':
                start_time = time.time()
            if response.get("method") == "window/showMessage" and "finished" in response["params"]["message"].lower():
                break

            time_waiting_sec = time.time() - start_time
            if time_waiting_sec > self.init_timeout:
                break
        
            print("waiting for init (response)...: ", round(time_waiting_sec, 0), self.init_timeout)
            print("(received response while waiting for init) response: ", response)
            time.sleep(1)


    def get_symbols_in_file(self, uri):
        symbols = self.doc_symbols_map.get(uri, None)
        if not symbols:
            doc_symbol_params = {
                "textDocument": {
                    "uri": uri
                }
            }
            symbol_response = self.send_request("textDocument/documentSymbol", doc_symbol_params)
            symbols = symbol_response.get('result', []) or []
            self.doc_symbols_map[uri] = symbols


            # unroll children, particularly for children in a class
            for symbol in symbols:
                if 'children' in symbol:
                    for child in symbol['children']:
                        symbols.append(child)

            # NOTE | TODO: preventing looking up functions in dependency files as it can take forever, this may affect output for some cases, investigate deeper
            # add to seen functions
            for symbol in [s for s in symbols if s['kind'] in [6, 9, 12]]:
                if 'uri' not in symbol:
                    symbol['uri'] = uri
                self.seen_functions_from_files_ids.add(self.get_id(symbol))

                # map to function from definition to get start/end lines when outputting function
                # NOTE: No longer used, would need to get definition first
                # self.def_to_func_map[self.get_id(symbol)] = self.get_id(symbol, False)

            # add classes to seen classes
            for symbol in [c for c in symbols if c['kind'] in [5]]:
                if 'uri' not in symbol:
                    symbol['uri'] = uri

                if self.capabilities.get("typeHierarchyProvider", False) and not self.disable_inheritance:
                    self.get_inhheritance_of_symbol(symbol)


                self.seen_classes.add(self.get_id(symbol))

        return symbols
        

    def get_function_in_file(self, file_path, name, line):
        functions = self.get_functions_in_file(file_path)
        return [f for f in functions if f['name'] == name and get_range(f)['start']['line'] == line]

    def get_functions_in_file(self, file_path):
        functions = []

        uri = f"file://{file_path}"

        # self.wait_for_initialization()


        # Request document symbols
        symbols = self.get_symbols_in_file(uri)

        for symbol in symbols:
            # kinds: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#documentSymbolParams
            if symbol['kind'] in [6, 9, 12]:  # Method / Function kind
                functions.append(symbol)
                
                ## NEEDED?? map definitions to function for future lookups
                # f_defs = self.get_func_definition(symbol)
                # for f_def in f_defs:
                #     self.def_to_func_map.append(f_def)

        return functions

    def get_references_of_symbol(self, uri, line, char):
        references = []

        # Prepare references params
        prepare_references_params = {
            "textDocument": {
                "uri": uri
            },
            "position": {
                "line": line,
                "character": char
            },
            "context": {
                "includeDeclaration": True
            }
        }

        prepare_references_response = self.send_request("textDocument/references", prepare_references_params)
        references = prepare_references_response.get('result', []) or []

        return references

    def get_func_definition(self, item):
        json_item = json.dumps(item)
        if self.definition_cache.get(json_item, None):
            return self.definition_cache[json_item]

        location_base = item['location'] if 'location' in item else item

        if 'name' in item:
            # rust LSP considers start of comments to be the start of the function
            # does not return selectionRange like spec indicates.
            # loop through lines to find start of function (janky)
            MAX_LINES_TO_SEARCH = 20

            lines = 0
            while lines < MAX_LINES_TO_SEARCH:
                try:
                    # get offset to function name
                    content = get_file_content(location_base['uri'].replace("file://", ""), get_range(item)['start']['line'] + lines)
                    func_name = self.parse_func_name(item['name'])
                    # match = re.search(rf"{func_name}\s*\(", content)
                    match = re.search(rf"{func_name}", content)
                    get_range(item)['start']['character'] = match.start() if match else get_range(item)['start']['character']  # update char to real position, if it can be found

                    if match:
                        break
                    lines += 1
                except:
                    # break, may fail on regex on bad var_name
                    break

            # update if found 
            if lines != MAX_LINES_TO_SEARCH:
                get_range(item)['start']['line'] += lines


        # # open doc
        # text = ""
        # try:
        #     text = open(unquote(location_base['uri'].replace("file://", "")), 'r', encoding='utf-8').read()
        # except:
        #     pass

        # did_open_params = {
        #     "textDocument": {
        #         "uri": location_base['uri'],
        #         "languageId": self.language_id,
        #         "version": 1,
        #         "text": text
        #     }
        # }
        # self.send_notification("textDocument/didOpen", did_open_params)

        params = {
            "textDocument": {
                "uri": location_base['uri']
            },
            "position": {
                "line": get_range(location_base)['start']['line'],
                "character": get_range(location_base)['start']['character'] # + (get_range(location_base)['end']['character'] - get_range(location_base)['start']['character'])
            }
        }
        response = self.send_request("textDocument/definition", params)
        # for resp in result:
        #     self.get_functions_in_file(resp['uri'].replace("file://", ""))

        ret = response['result'] if response.get('result', []) else [item]
        if type(ret) is not list:
            ret = [ret]
        self.definition_cache[json.dumps(item)] = ret
        return ret


    def get_func_calls(self, name, uri, line, char):
        # get char offset
        # content = get_file_content(uri.replace("file://", ""), line)
        # index_of_func = content.index(f"{name.split('.')[-1]}(")  # NOTE: language specific?
        # offset = index_of_func - char
        # char += offset
        
        if f"{uri}#{line}:{char}" in self.completed_function_ids:
            return


        f_item = {
            "name": name,
            "kind": 6, # method
            "location": {
                "uri": uri,
                "range": {
                    "start": {
                        "line": line,
                        "character": char
                    },
                    "end": {
                        "line": line,
                        "character": char
                    }
                }
            }
        }
        func_id = self.get_id(f_item)

        if any([re.search(p, uri, re.IGNORECASE) for p in EXCLUDE_FUNC_CALL_FILEPATHS]):
            self.completed_function_ids.add(func_id)
            return


        # rust LSP considers start of comments to be the start of the function
        # does not return selectionRange like spec indicates.
        # loop through lines to find start of function (janky)
        MAX_LINES_TO_SEARCH = 20

        ix = 0
        add_lines = 0
        while ix < MAX_LINES_TO_SEARCH:
            # get offset to function name
            content = get_file_content(uri.replace("file://", ""), line + ix)
            func_name = self.parse_func_name(name)
            try:
                # match = re.search(rf"{func_name}\s*\(", content)
                # NOTE: commenting out since languages like Ruby do not have parentheses
                match = re.search(rf"{func_name}", content)
            except Exception as e:
                # error in regexx such as (unbalanced parenthases) due to 'content', keep searching
                continue

            if match:
                char = match.start() if match else char  # update char to real position, if it can be found
                add_lines = ix
                break
            ix += 1
        line += add_lines


        if self.capabilities.get("callHierarchyProvider", False) or self.force_callHierarchy:
            # Prepare call hierarchy
            prepare_call_hierarchy_params = {
                "textDocument": {
                    "uri": uri
                },
                # "position": function_range['start']
                "position": {
                    "line": line,
                    "character": char
                }
            }

            prepare_response = self.send_request("textDocument/prepareCallHierarchy", prepare_call_hierarchy_params)
            call_hierarchy_items = prepare_response.get('result', []) or []


            for item in call_hierarchy_items:
                if item['kind'] not in [6, 9, 12]:  # method | constructor | Function kind
                    continue

                item_id = self.get_id(item)

                
                # self.seen_functions.add(item_id)
                self.seen_functions_from_files_ids.add(item_id)
                func_id = f"{self.get_id(item)}"
                # self.seen_functions.add(func_id)
                self.seen_functions_from_files_ids.add(func_id)

                call_hierarchy_params = {
                    "item": item
                }

                ## Incoming calls
                if not self.disable_incoming_calls:
                    call_hierarchy_response = self.send_request("callHierarchy/incomingCalls", call_hierarchy_params)
                    incoming_calls = call_hierarchy_response.get('result', []) or []
                    
                    # callee_func_id = item_id
                    callee_func_id = self.get_id(f_item)

                    
                    for call in incoming_calls:
                        caller_func_id = f"{self.get_id(call['from'])}"
                        self.function_calls.setdefault(caller_func_id, set()).add(callee_func_id)

                        self.seen_functions_from_files_ids.add(caller_func_id)


                        ### TODO: NEEDED?? BREAKS JAVA (REMOVE LINES ABOVE)
                        # f_defs = self.get_func_definition(call['from'])
                        # for f_def in f_defs:
                        #     f_def['name'] = self.parse_func_name(call['from']['name'])
                        #     caller_func_id = f"{self.get_id(f_def)}"
                        #     self.function_calls.setdefault(caller_func_id, set()).add(callee_func_id)
                        #     self.seen_functions_from_files_ids.add(caller_func_id)
                

                ## Outgoing calls
                if not self.disable_outgoing_calls:
                    call_hierarchy_response = self.send_request("callHierarchy/outgoingCalls", call_hierarchy_params)
                    outgoing_calls = call_hierarchy_response.get('result', []) or []

                    # caller_func_id = item_id
                    caller_func_id = self.get_id(f_item)

                    for call in outgoing_calls:
                        callee_func_id = f"{self.get_id(call['to'])}"
                        self.function_calls.setdefault(caller_func_id, set()).add(callee_func_id)
                        #self.seen_functions_from_files_ids.add(self.get_id(f_def))
                        self.seen_functions_from_files_ids.add(callee_func_id)
                        

                        ### TODO: NEEDED?? BREAKS JAVA (REMOVE LINES ABOVE)
                        # f_defs = self.get_func_definition(call['to'])
                        # for f_def in f_defs:
                        #     f_def['name'] = self.parse_func_name(call['to']['name'])
                        #     callee_func_id = f"{self.get_id(f_def)}"
                        #     self.function_calls.setdefault(caller_func_id, set()).add(callee_func_id)
                        #     self.seen_functions_from_files_ids.add(self.get_id(f_def))
        
        # find references of function
        references = self.get_references_of_symbol(uri, line, char)
        for ref in references:
            ref_loc = self.symbol_to_loc(ref)
            self.function_references.setdefault(func_id, set()).add(ref_loc)

            if not self.capabilities.get("callHierarchyProvider", False) and not self.force_callHierarchy:
                # TODO: fix this to resolve normalized (definition) ids
                self.function_call_refs.setdefault(func_id, []).append(ref)
                # does not append seen_functions because we don't know if the calling function has been seen


        if not self.had_error:
            self.completed_function_ids.add(func_id)
        else:
            self.completed_w_err_function_ids.add(func_id)
            
        if self.had_error:
            self.poll_and_reboot_LSP()
            self.had_error = False

    def eval_file(self, file_path):
            if file_path in self.evaled_files:
                print("Already evaluated file: ", file_path)
                return
            self.evaled_files.add(file_path)

            uri = f"file://{file_path}"

            # # Send didOpen notification
            # did_open_params = {
            #     "textDocument": {
            #         "uri": uri,
            #         "languageId": self.language_id,
            #         "version": 1,
            #         "text": open(file_path, 'r', encoding='utf-8').read()
            #     }
            # }
            # self.send_notification("textDocument/didOpen", did_open_params)

            # Request document symbols
            symbols = self.get_symbols_in_file(uri)


            time.sleep(PAUSE_TIME)

            # Get function calls
            for symbol in symbols:
                if symbol['kind'] in [6, 9, 12]:  # Method | Constructor | Function kind
                    base_location = symbol['location'] if 'location' in symbol else symbol
                    self.get_func_calls(symbol['name'], uri, get_range(base_location)['start']['line'], get_range(base_location)['start']['character'])
                    # self.get_func_calls(symbol['name'], uri, symbol['location']['range']['start']['line'], symbol['location']['range']['start']['character'] + FUNC_NAME_OFFSET)


            # loop while seen != completed
            while True:
                completed_before = len(self.completed_function_ids)
                seen_functions_copy = self.seen_functions.copy()
                for func in seen_functions_copy:
                    # NOTE: line - 1 to accomodate for adding 1 before
                    name, uri = f'{",".join(func.split(",")[0:-1])}', f'file://{func.split("#")[0].split(",")[-1]}'
                    line = int(self.function_details[func]['start_line'])
                    char = int(self.function_details[func]['start_char'])
                    self.get_func_calls(name, uri, line, char) # add offset?... TODO: Fix line number off by 1
                if len(self.completed_function_ids) == completed_before:
                    break

    def get_inhheritance_of_symbol(self, symbol):
        base_location = symbol['location'] if 'location' in symbol else symbol
        prepare_type_hierarchy_params = {
            "textDocument": {
                "uri": base_location['uri']
            },
            # "position": function_range['start']
            "position": {
                "line": get_range(base_location)['start']['line'],
                "character": get_range(base_location)['start']['character']
            }
        }

        prepare_response = self.send_request("textDocument/prepareTypeHierarchy", prepare_type_hierarchy_params)
        type_hierarchy_items = prepare_response.get('result', []) or []

        for item in type_hierarchy_items:
            item_id = self.get_id(item)
            # typeHierarchy/subtypes
            subtypes_supertypes_params = {
                "item": item
            }

            ## Incoming calls
            subtypes_response = self.send_request("typeHierarchy/subtypes", subtypes_supertypes_params)
            subtypes = subtypes_response.get('result', []) or []

            for subtype in subtypes:
                subtype_id = self.get_id(subtype, from_def=False)
                self.class_inheritance.setdefault(item_id, set()).add(subtype_id)


            # supertypes
            supertypes_response = self.send_request("typeHierarchy/supertypes", subtypes_supertypes_params)
            supertypes = supertypes_response.get('result', []) or []

            for supertype in supertypes:
                supertype_id = self.get_id(supertype, from_def=False)
                self.class_inheritance.setdefault(supertype_id, set()).add(item_id)
            # class_inheritance[item_id] = subtypes
            


    def get_call_stacks_in_files(self, project_dir):
        if any([project_dir.endswith(ext) for ext in self.file_extensions]): # and file.endswith("exec_linux.go"):
            self.eval_file(project_dir)


        total_files = sum([len(files) for _ , _, files in os.walk(project_dir)])
        counter = 0
        # flatten array of arrays

        for root, _, files in os.walk(project_dir):
            # if any([path in root.lower() for path in EXCLUDE_FUNC_CALL_FILEPATHS])
            # if not in_scope(root):
            #     counter += len(files)
            #     continue
            
            for file in files:
                counter += 1
                file_path = os.path.join(root, file)

                if any([file.endswith(ext) for ext in self.file_extensions]) and in_scope(file_path): # and file.endswith("exec_linux.go"):
                    self.eval_file(file_path)
                    
            
            # if counter % 10 == 0:
            print(f"(get callstacks in files) done with file (original): {counter} / {total_files}\n")

        print(f"(get callstacks in files) done with file (original): {counter} / {total_files}\n")



        ## LOOP REFERENCES + CALLSTACKS, GET FUNC CALLSTACKS
        completed_ref_files = set()
        loop = 0
        lookedup_files = set()
        while True:
            len_completed_before = len(self.completed_function_ids)
            len_seen_functions_before = len(self.seen_functions)


            # get references of each var
            seen_function_files = [f.split(",")[1].split("#")[0] for f in self.completed_function_ids]
            self.doc_symbols_map_copy = self.doc_symbols_map.copy()
            for i, filepath in enumerate(self.doc_symbols_map_copy):
                # if filepath in completed_ref_files or any([re.search(p, filepath, re.IGNORECASE) for p in EXCLUDE_FUNC_CALL_FILEPATHS]):
                if filepath in completed_ref_files or any([re.search(p, filepath, re.IGNORECASE) for p in EXCLUDE_FUNC_CALL_FILEPATHS]):
                    continue
                for symbol in self.doc_symbols_map[filepath]:
                    if symbol['kind'] in [7, 8, 13, 14]:  # Property | Field | variable | constant (showing constants because `mut` vars in rust are considered Constants even though they can change)
                        base_location = symbol['location'] if 'location' in symbol else symbol



                        references = self.get_references_of_symbol(filepath, get_range(base_location)['start']['line'], get_range(base_location)['start']['character'])
                        
                        # if reference not found (due to line mismatch / comments), try searching next lines for reference
                        if not references and 'name' in symbol:
                            # rust LSP considers start of comments to be the start of the function
                            # does not return selectionRange like spec indicates.
                            # loop through lines to find start of function (janky)
                            MAX_LINES_TO_SEARCH = 20

                            ix = 0
                            add_lines = 0
                            while ix < MAX_LINES_TO_SEARCH:
                                try:
                                    # get offset to function name
                                    content = get_file_content(base_location['uri'].replace("file://", ""), get_range(symbol)['start']['line'] + ix)
                                    var_name = symbol['name'].split(".")[-1]
                                    match = re.search(rf"{var_name}", content)
                                    get_range(symbol)['start']['character'] = match.start() if match else get_range(symbol)['start']['character']  # update char to real position, if it can be found

                                    if match:
                                        add_lines = ix
                                        break
                                    ix += 1
                                except:
                                    # break, may fail on regex on bad var_name
                                    break
                                
                            get_range(symbol)['start']['line'] += add_lines

                            references = self.get_references_of_symbol(filepath, get_range(base_location)['start']['line'], get_range(base_location)['start']['character'])
                        
                        
                        if "uri" not in base_location: # add for .php LSP 
                            base_location['uri'] = filepath


                        ## Is False needed? Need to find real location of symbol/var
                        self.var_ref_map[self.symbol_to_loc(symbol, include_name=True)] = references

                        for ref in references:
                            ref_filepath = ref['uri'].replace("file://", "")
                            if ref_filepath not in seen_function_files and ref_filepath not in lookedup_files:
                                if any([re.search(p, ref_filepath, re.IGNORECASE) for p in EXCLUDE_FUNC_CALL_FILEPATHS]):
                                    continue

                                print(f"NOT IN SEEN FUNCTION FILES: {ref_filepath}")
                                fs = self.get_functions_in_file(ref_filepath)
                                for f in fs:
                                    f_id = self.get_id(f)
                                    if f_id not in self.seen_functions:
                                        # self.seen_functions.add(f_def_id)
                                        self.seen_functions_from_files_ids.add(f_id)


                                lookedup_files.add(ref_filepath)
                    completed_ref_files.add(filepath)
                print(f"(get callstacks in files) done with file (secondary): {(i + 1) } / {len(self.doc_symbols_map_copy)}\n")
        
            # get callstacks for all functions that have been seen but not completed
            seen_functions_copy = self.seen_functions.copy()
            for func in seen_functions_copy:
                name, uri = f'{",".join(func.split(",")[0:-1])}', f'file://{func.split("#")[0].split(",")[-1]}'
                line = int(self.function_details[func]['start_line'])
                char = int(self.function_details[func]['start_char'])

                self.get_func_calls(name, uri, line, char)

            
            
            if len_completed_before == len(self.completed_function_ids) and len_seen_functions_before == len(self.seen_functions):
                break
            else:
                loop += 1
                print(f"LOOPING {loop} : {len(self.completed_function_ids.union(self.completed_w_err_function_ids))} != {len(self.seen_functions)}")
                time.sleep(3)
                


    def close(self):
        self.process.terminate()

    def analyze(self, project_dir, output_file_prefix = ""):


        print("[+] Starting LSP Client w/ arguments:")
        print(f"\tProject Directory: {project_dir}")
        print(f"\tLanguage: {self.language_id}")
        print(f"\tExtensions: {self.file_extensions}")
        print(f"\tCommand Override: {self.server_cmd}")
        print(f"\tDisable Selection Range: {self.disable_selectionRange}")


        start = datetime.datetime.now()
    
        # php
        self.init_params = {
            "processId": None,
            "rootUri": f"file://{project_dir}",
            "workspaceFolders": [{
                "name": "project",
                "uri": f"file://{project_dir}"
            }],
            "capabilities": {
                "textDocument": {
                    "formatting": {
                        "dynamicRegistration": True
                    },
                    "typeHierarchy": {
                        "dynamicRegistration": True
                    },
                    "callHierarchy": {
                        "dynamicRegistration": True
                    },
                    "references": {
                        "dynamicRegistration": True
                    },
                    "definition": {
                        "dynamicRegistration": True
                    },
                    "documentSymbol": {
                        "dynamicRegistration": True
                    }
                }
            }
        }

        time.sleep(self.init_pause)
        print("sending init")
        
        response = self.send_request("initialize", self.init_params)
        print("Initialize response:", response)

        self.send_notification("initialized", {})

        self.wait_for_initialization()
        
        self.get_call_stacks_in_files(project_dir)

        # all_functions = self.completed_function_ids + self.seen_functions_from_files_ids
        all_seen_functions = self.completed_function_ids.union(self.completed_w_err_function_ids).union(self.seen_functions_from_files_ids)
        functions, scopes = parse_func_objects(all_seen_functions, True)
        functions_map = {}
        for f in functions:
            functions_map[f['id']] = f
        scopes_map = {}
        for s in scopes:
            scopes_map[s['id']] = s

        # for symbol in self.var_ref_map:
        #     for ref in self.var_ref_map[symbol]:
        #         print(f"symbol: {symbol} ref: {ref}")


        # prepare function objects for quick lookup (could be done in a more efficiently @ time of lookup)
        function_objs = {}
        for f in self.completed_function_ids.union(self.completed_w_err_function_ids).union(self.seen_functions_from_files_ids):
        # for f in self.completed_function_ids:
            f = self.def_to_func_map.get(f, f)
            filepath = f.split(",")[-1].split("#")[0]
            
            obj = {
                'id': f,
                'name': f.split(",")[0],
                "startLine": int(self.function_details.get(f, {}).get('start_line', 0)),
                "endLine": int(self.function_details.get(f, {}).get('end_line', 0))
            }
            function_objs.setdefault(filepath, []).append(obj)

        start_lines = {}
        for filepath in function_objs:
            function_objs[filepath] = sorted(function_objs[filepath], key=lambda f: f['startLine'])
            start_lines[filepath] = list(map(lambda f: f['startLine'], function_objs[filepath]))



        def find_function(filepath, line):
            if filepath not in start_lines:
                # TODO, QUERY FILE? Double check if this breaks finding valid functions. Ideally, this only resolves references that are not in a function
                return f"__TOP_LEVEL__,{filepath}#0"

            # Find the insertion point for the line number
            idx = bisect.bisect_right(start_lines[filepath], line) - 1
            # startline and endline may be equal based on language server response
            if idx >= 0 and (function_objs[filepath][idx]['startLine'] == function_objs[filepath][idx]['endLine'] or function_objs[filepath][idx]['startLine'] <= line <= function_objs[filepath][idx]['endLine']):
                return function_objs[filepath][idx]['id']
            return f"__TOP_LEVEL__,{filepath}#0"



        # find what function each ref was in and append to self.function_calls (came from /references not /incomingCalls|/outgoingCalls)
        for f in self.function_call_refs:
            for ref in self.function_call_refs[f]:
                caller_func = find_function(ref['uri'].replace("file://", ""), get_range(ref)['start']['line'])
                if caller_func.split(":")[0] != f.split(":")[0]:
                    self.function_calls.setdefault(caller_func, set()).add(f)



        ####################
        ##### START #####
        ####################
        # consolidate references (typscript shinanigans) - may break other languages?
        # this may botch ref accuracy!??!
                

        def process_var(var_id, refs, refs_w_valid_refs):
            new_refs = set()
            for ref in refs:
                sub_refs = refs_w_valid_refs.get(ref, set())
                for sub_r in sub_refs:
                    if sub_r not in refs:
                        new_refs.add(sub_r)
            return var_id, new_refs




        refs_w_valid_refs = {
            var_id: set(
                f"{','.join(var_id.split(',')[:-1])},{self.symbol_to_loc(ref)}"
                for ref in refs if self.var_ref_map.get(f"{','.join(var_id.split(',')[:-1])},{self.symbol_to_loc(ref)}", [])
            )
            for var_id, refs in self.var_ref_map.items()
        }  

        # Main loop to consolidate references
        print_thread_safe('Consolidating references...')
        j = 0

        while True:
            refs_to_add = {}
            with concurrent.futures.ThreadPoolExecutor(max_workers=NUM_THREADS) as executor:
                futures = {
                    executor.submit(process_var, var_id, refs, refs_w_valid_refs): var_id
                    for var_id, refs in refs_w_valid_refs.items()
                }
                i = 0
                for future in concurrent.futures.as_completed(futures):
                    var_id, new_refs = future.result()
                    if new_refs:
                        refs_to_add.setdefault(var_id, set()).update(new_refs)

                    # Increment iteration counter and print periodic progress
                    i += 1
                    if i % 5000 == 0:
                        print_thread_safe(
                            f"Consolidating references (vars complete): {i} / {len(refs_w_valid_refs)}"
                        )

            if not refs_to_add:
                break

            print_thread_safe('Had refs to add (update)')
            for var_id in refs_to_add:
                refs_w_valid_refs[var_id] = refs_w_valid_refs[var_id].union(refs_to_add[var_id])

            j += 1
            print_thread_safe(f"Consolidating references (iterations): {j}")



        # sort refs in each node
        print_thread_safe("Sorting references...")
        def sort_refs(var_id, refs):
            return var_id, sorted(refs)
        new_refs_w_valid_refs = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=NUM_THREADS) as executor:
            futures = {
                executor.submit(sort_refs, var_id, refs): var_id
                for var_id, refs in refs_w_valid_refs.items()
            }

            # Collect results as they complete
            for future in concurrent.futures.as_completed(futures):
                var_id, new_refs = future.result()
                new_refs_w_valid_refs[var_id] = new_refs
        refs_w_valid_refs = new_refs_w_valid_refs


        # remove vars that only point to self
        print_thread_safe("Removing self-references and empty-references...")
        new_refs_w_valid_refs = {}
        for var_id, refs in refs_w_valid_refs.items():
            if refs != [var_id] and len(refs) > 1:
                new_refs_w_valid_refs[var_id] = refs
        refs_w_valid_refs = new_refs_w_valid_refs



        # track groups of vars that have the same refs
        print_thread_safe("Grouping variables with the same references...")
        group_hash_map = {}
        for var_id, refs in refs_w_valid_refs.items():
            group_hash = hash(frozenset(refs))
            group_hash_map.setdefault(group_hash, set()).add(var_id)


        print("Joining references (by group)...")
        # join references using group_hash_map as cache to not repeat work
        i = 0
        for group_hash, group_vars in group_hash_map.items():
            lists = [self.var_ref_map[var_id] for var_id in group_vars]
            joined_refs = join_and_dedupe(lists)
            for var_id in group_vars:
                self.var_ref_map[var_id] = joined_refs
            i += 1
            if i % 100 == 0:
                print_thread_safe(f"Joining references: {i} / {len(group_hash_map)}")



        ####################
        ##### END #####
        ####################
        

        
        # for each reference, find the function it is in
        for var_id in self.var_ref_map:
            for ref in self.var_ref_map[var_id]:
                # filepath = ref['uri'].replace("file://", "")
                # line = get_range(ref)['start']['line']
                func = find_function(ref['uri'].replace("file://", ""), get_range(ref)['start']['line'])
                ref['func_id'] = func  # "func" should be in "functions", if not, add it
        
        
        # keep only references that are in multiple functions/files
        for var_id in self.var_ref_map.copy():
            line = 0
            try: 
                line = int(var_id.split('#')[1].split(':')[0])
            except:
                pass
            var_func = find_function(var_id.split(',')[-1].split('#')[0], line)
            if len(set(r['func_id'] for r in self.var_ref_map[var_id]) | {var_func}) < 2:
                del self.var_ref_map[var_id]

        # add state vars to functions
        for var_id in self.var_ref_map:
            for ref in self.var_ref_map[var_id]:
                # add func if doesnt exist?
                if ref['func_id'] not in functions_map:
                    funcs, f_scopes = parse_func_objects([ref['func_id']])
                    for f in funcs:
                        functions_map[f['id']] = f
                        functions.append(f)
                    for s in f_scopes:
                        if s['id'] not in scopes_map:
                            scopes_map[s['id']] = s
                            scopes.append(s)

                functions_map.get(ref['func_id'], {}).setdefault('vars', set()).add(var_id)




        def increment_lines_in_id(f_id):
            ret = ""
            # f_name_and_filepath 
            ret += "#".join(f_id.split("#")[0:-1])

            start_line, start_col, end_line, end_col = None, None, None, None
            try:
                start_line = f_id.split("#")[-1].split(":")[0]
                start_col = f_id.split("#")[-1].split(":")[1]
                end_line = f_id.split("#")[-1].split(":")[2]
                end_col = f_id.split("#")[-1].split(":")[3]
            except: 
                pass
            
            if start_line:
                ret += f"#{int(start_line) + 1}"
            if start_col:
                ret += f":{int(start_col) + 1}"
            if end_line:
                ret += f":{int(end_line) + 1}"
            if end_col:
                ret += f":{int(end_col) + 1}"
            
            return ret

        def increment_lines_in_symbol(symbol):
            get_range(symbol)['start']['line'] += 1
            get_range(symbol)['start']['character'] += 1
            get_range(symbol)['end']['line'] += 1
            get_range(symbol)['end']['character'] += 1
            # symbol['func_id'] = increment_lines_in_id(symbol['func_id'])
            return symbol

        # add lines to each function / state var references
        for f in functions:
            f['id'] = increment_lines_in_id(f['id'])
            f['filepath'] = increment_lines_in_id(f['filepath'])
            f['filepath_body'] = increment_lines_in_id(f['filepath_body'])
            f['startLine'] = int(f['startLine']) + 1
            f['endLine'] = int(f['endLine']) + 1
            f['vars'] = set([increment_lines_in_id(v) for v in f.get('vars', [])])


        # swap function definitions in callstacks to real funcs 
        new_function_calls = {}
        for caller in self.function_calls:
            real_caller = client.def_to_func_map.get(caller, caller)
            if any([re.search(p, real_caller, re.IGNORECASE) for p in EXCLUDE_FUNC_CALL_FILEPATHS]):
                continue

            
            callees = set()
            for callee in self.function_calls[caller]:
                real_callee = client.def_to_func_map.get(callee, callee)
                if not any([re.search(p, real_callee, re.IGNORECASE) for p in EXCLUDE_FUNC_CALL_FILEPATHS]):
                    callees.add(real_callee)

            new_function_calls.setdefault(real_caller, set()).update(callees)
        self.function_calls = new_function_calls



        # incremenet lines for vscode to have accurate line numbers
        new_client_func_calls = {}
        for caller in self.function_calls:
            new_client_func_calls[increment_lines_in_id(caller)] = set([increment_lines_in_id(callee) for callee in copy.deepcopy(self.function_calls[caller])])
        self.function_calls = new_client_func_calls

        new_client_var_ref_map = {}
        for var_id in self.var_ref_map:
            # new_client_var_ref_map[increment_lines_in_id(var_id)] = self.var_ref_map[var_id]
            new_client_var_ref_map[increment_lines_in_id(var_id)] = [increment_lines_in_symbol(ref_symbol) for ref_symbol in copy.deepcopy(self.var_ref_map[var_id])]
        self.var_ref_map = new_client_var_ref_map
        # update vars


        # for each function, add vars w/ references to scope (combile w/ above)
        for f in functions:
            scope = scopes_map.get(f['scope_id'], None)
            if not scope:
                continue
            for var_id in f.get('vars', []):
                scope.setdefault('vars', set()).add(var_id)
        
        # sort vars in each scope
        for s in scopes:
            if 'vars' in s:
                s['vars'] = sorted(s['vars'], key=lambda v_id: f"{','.join(v_id.split(',')[0:-1])}#{v_id.split('#')[1].split(':')[0].zfill(5)}")


        # cleanup vars for each scope
        vars_group = {}
        for s in scopes:
            for var_id in s.get('vars', []):
                # sort var_ids by func_id (may need to pad startline with zeros to sort correctly)
                self.var_ref_map[var_id] = sorted(self.var_ref_map.get(var_id, []), key=lambda r: f"{','.join(r['func_id'].split(',')[0:-1])}#{r['func_id'].split('#')[1].split(':')[0].zfill(5)}")

                # group vars if all have same references
                # accounts for lsp servers that return all instances of a symbol in document/symbols instead of just declarations
                ref_locations = tuple([self.symbol_to_loc(r) for r in self.var_ref_map[var_id]])
                
                vars_group.setdefault(ref_locations, set()).add(var_id)




        # generate HTML
        for s in scopes:
            s['scope_summary_html'] = s.get('scope_summary_html', "")
            scope_filepath = s['id'].split(",")[-1].split("#")[0]
            state_vars_html = ""
            for var_id in s.get('vars', []):
                ref_locations = tuple([self.symbol_to_loc(r) for r in self.var_ref_map[var_id]])
                grouped_vars = vars_group.get(ref_locations, [var_id])
                grouped_vars_locs = [v.split(',')[-1] for v in grouped_vars]

                # continue if already seen this set of vars
                if len(grouped_vars) > 1 and var_id != next(iter(grouped_vars)):
                    continue

                
                # print grouped vars or var_id if no group is found
                # NOTE: consider deleting from ref if found in grouped var_id
                for grouped_var_id in grouped_vars:
                    var_name = grouped_var_id.split(",")[0]
                    var_func = functions_map.get(grouped_var_id, {})
                    var_filepath = grouped_var_id.split(",")[-1]
                    var_filename = var_filepath.split("/")[-1]

                    init_filepath, lines = var_filepath.split("#")
                    init_line = lines.split(":")[0]
                    content = get_file_content(init_filepath, int(init_line) - 1).strip()
                    
                    state_vars_html += f"<div><a value='{var_id}' href='file://{var_filepath}'>{var_filename} | {var_name}</a> | {content}</div>"

                state_var_html_arr = []
                for i, ref in enumerate(self.var_ref_map[var_id]):
                    ref_id = self.symbol_to_loc(ref)
                    if ref_id in grouped_vars_locs:
                        continue

                    ref_filepath = ref_id.split(",")[-1]
                    ref_filename = ref_filepath.split("/")[-1]
                    if ref_filepath in var_filepath:
                        # skip reference to declaration based on location
                        continue

                    if i > self.max_ref_tracking_count:
                        state_var_html_arr.append(f"<div class='collapsable'>...max references reached ({len(self.var_ref_map[var_id])})...<br></div>")
                        break

                    # get content
                    ref_func = functions_map.get(ref['func_id'], {})
                    ref_content = get_file_content(ref['uri'].replace("file://", ""), get_range(ref)['start']['line'] - 1)

                    # skip if content does not contain more than var_name... may be a declaration that was not grouped (this may break stuff)
                    # if not contains_more_than_search_str(ref_content, var_name):
                    #     continue


                    # guess if node is read/write
                    read_write_guess = ""
                    if self.guess_ref_read_write and ref_content:
                        # NOTE: THIS WILL NOT WORK FOR ALL LANGUAGES 
                        trimmed_content = ref_content.split("'")[0].split('"')[0].split("`")[0].split("==")[0].split(">=")[0].split(">=")[0].split("!=")[0]  # look before quotes and equalities
                        trimmed_var_name = var_name.split(".")[-1].split("$")[-1]  # accomodate for how LSP's may disable root name vs. how it's referenced
                        read_write_guess = "(w)" if "=" in trimmed_content and trimmed_var_name in trimmed_content.split("=")[0] else "(r)" # guess (w) if var is left of assignment operator
                        # look to the left of a single =. accomodate languages where no spaces are required. Don't include equalities such as >= <=. 

                        # if regex (.*trimmed_var_name.*) 
                        if read_write_guess == "(r)" and re.search(rf"[a-zA-Z0-9_$]+\(.*{trimmed_var_name}.*\)", ref_content):
                            read_write_guess = "(r*)"

                    # id='{v.name}~{get_contract_or_function_id(loc.function)}'
                    func_link_html = f"<input type='checkbox' id='{var_name}~{ref_func.get('id', '')}' style='vertical-align: middle'> <a href='#{ref_func['id']}' data-scope='{ref_func['id']}'>🔗<a> " if ref_func else ""
                    state_var_html_arr.append(f"<div class='collapsable'>&emsp;{read_write_guess}{func_link_html}<a href='file://{ref_id.split(',')[-1]}' value='{ref_func.get('id', '')}'>{ref_func.get('qualifiedName_full', f'{ref_filename}.__TOP_LEVEL__')}#{get_range(ref)['start']['line']}</a> | {ref_content}</div>") # ref html
                    # <a value='scooby,~/Desktop/slither-custom-tooling/solidity/solidity_test_files/test.sol#659:5' href='file://~/Desktop/slither-custom-tooling/solidity/solidity_test_files/test.sol#669:9'>test_contract.scooby | \ud83c\udfaf\ud83d\udfe2#L669</a>
                
                state_var_html_arr = list(dict.fromkeys(state_var_html_arr))  # remove duplicates
                state_var_html_arr = sorted(state_var_html_arr, reverse=True)
                state_var_html_to_add = "".join(state_var_html_arr)
                # do not add if trimmed references does not contain current scope filepath
                if scope_filepath in state_var_html_to_add:
                    state_vars_html += state_var_html_to_add

                if state_vars_html != "":
                    state_vars_html += "<br>"
            
            if state_vars_html:
                print("state vars in scope: ", s['id'])
                # compress to reduce change of out of memory exceptions
                s['scope_summary_html'] += f"<h2>State Vars</h2>{state_vars_html}"

            ## add functions to scope
            func_html = ""
            for f in [f2 for f2 in functions if f2['scope_id'] == s['id']]:
                func_link_html = f"<input type='checkbox' id='function-{f.get('id', '')}' style='vertical-align: middle'> <a href='#{f['id']}' data-scope='{f['id']}'>🔗</a>"
                func_html += f"<div>{func_link_html} <a href='file://{f['filepath']}:{f['startCol']}' value='{f['id']}'>{f['qualifiedName_full']}</a></div>"
            
            if func_html:
                s['scope_summary_html'] += f"<h2>Functions</h2>{func_html}"

            # compress to reduce change of out of memory exceptions
            s['scope_summary_html'] = zlib.compress(s.get('scope_summary_html', '').encode()).hex() 


            





        
        # convert to list (to allow JSON serialization for output)
        for caller in self.function_calls:
            self.function_calls[caller] = list(self.function_calls[caller])

        for parent in self.class_inheritance:
            self.class_inheritance[parent] = list(self.class_inheritance[parent])


        for f in functions:
            if 'vars' in f:
                f['vars'] = list(f['vars'])
        for s in scopes:
            if 'vars' in s:
                s['vars'] = list(s['vars'])



        if self.append_output_file:
            def try_open_file(filepath):
                try:
                    return json.loads(open(filepath, "r").read())
                except:
                    return None
                
            current_functions_html = try_open_file(f"{output_file_prefix}functions_html.json") or []
            current_scope_summaries_html = try_open_file(f"{output_file_prefix}scope_summaries_html.json") or []
            current_function_calls = try_open_file(f"{output_file_prefix}function_calls.json") or {}
            current_class_inheritance = try_open_file(f"{output_file_prefix}class_inheritance.json") or {}


        functions = current_functions_html + functions if self.append_output_file else functions
        scopes = current_scope_summaries_html + scopes if self.append_output_file else scopes
        self.function_calls = {**current_function_calls, **self.function_calls} if self.append_output_file else self.function_calls
        self.class_inheritance = {**current_class_inheritance, **self.class_inheritance} if self.append_output_file else self.class_inheritance

        open(f"{output_file_prefix}functions_html.json", "w").write(json.dumps(list(functions)))
        open(f"{output_file_prefix}scope_summaries_html.json", "w").write(json.dumps(list(scopes)))
        open(f"{output_file_prefix}function_calls.json", "w").write(json.dumps(self.function_calls))
        open(f"{output_file_prefix}class_inheritance.json", "w").write(json.dumps(self.class_inheritance))

        open(f"{output_file_prefix}errors.json", "w").write(json.dumps(errors))



        print("done.")
        end = datetime.datetime.now()
        minutes = (end - start).total_seconds() / 60
        print(f"Time taken: {math.floor(minutes / 60)} hours ({minutes % 60} minutes) to complete. ({minutes} total minutes)")




# Usage example
if __name__ == "__main__":
    secondary_init_timeout_default = 30

    lanaguage_defaults_map = {
        "bash": {
            "exts": [".sh"],
            "cmd": ["bash-language-server", "start"]
        },
        "powershell": {
            "exts": [".ps1"],
            "cmd": ["pwsh", "-NoLogo", "-NoProfile", "-Command", "/app/powershell-ls/PowerShellEditorServices/Start-EditorServices.ps1", "-Stdio", "-BundledModulesPath", "/app/powershell-ls"]
        },
        "lua": {
            "exts": [".lua"],
            "cmd": ["lua-language-server"]
        },
        "php": {
            "exts": [".php"],
            "cmd": ["intelephense", "--stdio"],
            "forced_args": [("init_timeout", secondary_init_timeout_default)]
        },
        "go": {
            "exts": [".go"],
            "cmd": ["gopls", "serve"]
        },
        "ruby": {
            "exts": [".rb"], 
            "cmd": ["solargraph", "stdio"]
            # "cmd": ["ruby-lsp"] # ["cd", args.project_dir, "&&", "ruby-lsp"] 
        },
        "asm": {
            "exts": [".asm"],
            "cmd": ["asm-lsp"]
        },
        "c": {
            "exts": [".c", ".cc", ".cpp", ".m"],
            "cmd": ["clangd"], # ccls
            "forced_args": [("disable_outgoing_calls", True), ("disable_inheritance", True), ("disable_get_id_from_ref", True)]  # clangd default params
        },
        "c#": {
            "exts": [".cs"],  
            "cmd": ["OmniSharp"]
        },
        "typescript": {
            "exts": [".js", ".ts", ".tsx"],
            "cmd": ["typescript-language-server", "--stdio"]
        },
        "rust": {
            "exts": [".rs"],
            "cmd": ["rust-analyzer"],
            "forced_args": [
                ("disable_outgoing_calls", True),
                ("resp_timeout", 180) # call hierarchy in rust may take multiple minutes to respond
            ]
        },
        "python": {
            "exts": [".py"],
            "cmd": ["pyright-langserver", "--stdio"]
        },
        "kotlin": {
            "exts": [".kt"],
            "cmd": ["kotlin-language-server"],
            "forced_args": [("init_timeout", secondary_init_timeout_default)]
        },
        "java": {
            "exts": [".java"],
            "cmd": [
                "java",
                "-Declipse.application=org.eclipse.jdt.ls.core.id1",
                "-Dosgi.bundles.defaultStartLevel=4",
                "-Declipse.product=org.eclipse.jdt.ls.core.product",
                "-Dlog.level=ALL",
                "-Xmx1G",
                "--add-modules=ALL-SYSTEM",
                "--add-opens", "java.base/java.util=ALL-UNNAMED",
                "--add-opens", "java.base/java.lang=ALL-UNNAMED",
                "-jar", "/app/java-ls/plugins/org.eclipse.equinox.launcher_1.6.900.v20240613-2009.jar",  # change this
                "-configuration", "/app/java-ls/config_linux",  # change this
                "-data", "/tmp/java-ls-data"   # change this
            ],
            "forced_args": [("disable_selectionRange", True)]
        },
        "solidity": {
            "exts": [".sol"],
            # "cmd": ["wake", "lsp", "--port", "1234"]  # wake is installed but only supports tcp connections, this script must be modified to communicate over TCP instead of stdin/stdout
            "cmd": ["nomicfoundation-solidity-language-server", "--stdio"],
            "forced_args": [("init_timeout", secondary_init_timeout_default)]
        }
    }

    # take input args for project_dir using argparse
    arg_parser = ArgumentParserWithTracking()
    arg_parser.add_argument("--project_dir", "-d", required=True, type=str, help="Project directory to analyze")
    arg_parser.add_argument("--include-paths", "-in", type=str, default="", help="Paths to include in analysis <regex>")
    arg_parser.add_argument("--exclude-paths", "-ex", type=str, default="", help="Paths to exclude from analysis <regex>")
    arg_parser.add_argument("--languages", "-l", type=str, help=f"Language of project, comma delimited. {{{(','.join(['all'] + list(lanaguage_defaults_map.keys())))}}}")
    arg_parser.add_argument("--exclude-languages", "-el", type=str, default="", help=f"Exclude language when using 'all'. Comma delimited {{{','.join(lanaguage_defaults_map.keys())}}}")
    arg_parser.add_argument("--extensions", "-e", type=str, help="Extensions, comma separated (e.g, '.js,.ts,.tsx)")
    arg_parser.add_argument("--cmd-override", "-c", type=str, help="Override command")
    arg_parser.add_argument("--disable-get-id-from-ref", action="store_true", default=False, help="Disable getting id from reference (e.x. clangd will get tripped up on func definitions)")
    arg_parser.add_argument("--max-ref-tracking-count", "-m", type=int, default=50, help="Max number of references to track for a variable")
    arg_parser.add_argument("--force-callHierarchy", "-fch", action="store_true", default=False, help="Force using callHierarchy instead of references (if LSP does not state they support callHierarchy capability in init response)")
    arg_parser.add_argument("--disable-default-excludes", "-dde", action="store_true", default=False, help="Disable default excludes (e.g. node_modules, .git, etc.)")
    arg_parser.add_argument("--disable-selectionRange", "-ds", action="store_true", default=False, help="Disable selectionRange (if 'selectionRange' is not accurate for LSP, will use 'range' instead)")
    arg_parser.add_argument("--disable-incoming-calls", "-di", action="store_true", default=False, help="Disable searching incoming calls")
    arg_parser.add_argument("--disable-outgoing-calls", "-do", action="store_true", default=False, help="Disable searching teamsoutgoing calls")
    arg_parser.add_argument("--disable-inheritance", "-dih", action="store_true", default=False, help="Disable searching inheritance")
    arg_parser.add_argument("--pause-for-verification", "-p", action="store_true", default=False, help="Pause for capabilities output, show what a lanaguage server supports (may not be accurate, some servers support more than they output as capabilities).")
    arg_parser.add_argument("--guess-ref-read-write", "-g", action="store_false", default=True, help="Guess if a reference is a read or write based on content (may not be accurate).")
    arg_parser.add_argument("--resp-timeout", "-rt", type=float, default=20, help="Response timeout. Amount of time to wait for a response from the language server. Too small timeout will not allow language servers to process requests. Default: 3min")
    arg_parser.add_argument("--resp-pause", "-rp", type=float, default=0, help="Time to wait before sending next request to language server")
    arg_parser.add_argument("--init-timeout", "-it", type=float, default=8, help="Initialization timeout")
    arg_parser.add_argument("--init-pause", "-ip", type=float, default=2, help="Time to wait before sending init message after starting server")
    arg_parser.add_argument("--output-file-prefix", "-o", type=str, default="", help="Output file prefix")
    arg_parser.add_argument("--append_output_file", "-a", action="store_true", default=False, help="Append to output file")
    arg_parser.add_argument("--prescript", "-ps", type=str, help="Prescript to run before starting language server")
    arg_parser.add_argument("--postscript", "-po", type=str, help="Postscript to run after starting language server")
    arg_parser.add_argument("--verbose", "-v", action="store_true", default=False, help="Print all requests / responses to & from language server")
    arg_parser.add_argument("--stderr-to-file", "-stf", action="store_true", default=False, help="Redirect stderr to file")
    arg_parser.add_argument("--debug", action="store_true", default=False)
    
    args = arg_parser.parse_args()

    if args.debug:
        print("Waiting for debugger to attach...")
        debugpy.listen(("0.0.0.0", 5678))
        debugpy.wait_for_client()

    # if language is not defined, extensions and cmd_override must be defined

    if not args.languages and not args.extensions and not args.cmd_override:
        print(f"Must define language (-l <{'|'.join((['all'] + list(lanaguage_defaults_map.keys())))}>)   |OR|   extensions (-e '.js') AND cmd_override (-c '<lsp_server>')")
        exit(1)

    if args.languages == "all" and any([args.cmd_override, args.extensions]):
        print("All languages will try to run all default languages and their languaage servers, cannot override command or extensions for all languages")
        exit(1)


    # run prescript wait for completion
    if args.prescript:
        print(f"Running prescript: {args.prescript}")
        subprocess.run(args.prescript, shell=True)

    INCLUDE_FILEPATHS = [p for p in args.include_paths.split(",") if p != ""]

    EXCLUDE_FUNC_CALL_FILEPATHS = args.exclude_paths.split(",") if args.disable_default_excludes else (EXCLUDE_FUNC_CALL_FILEPATHS + args.exclude_paths.split(","))
    EXCLUDE_FUNC_CALL_FILEPATHS = [p for p in EXCLUDE_FUNC_CALL_FILEPATHS if p != ""]
    
    languages = [l for l in lanaguage_defaults_map.keys() if l not in args.exclude_languages.split(',')] if args.languages == "all" else args.languages.split(",")
    
    # if args.project_dir is relative, make it absolute
    args.project_dir = os.path.expanduser(args.project_dir)
    args.project_dir = os.path.abspath(args.project_dir)


    # process languages to scan
    if args.languages == "all":
        found_languages = []
        for language in languages:
            default_extensions = lanaguage_defaults_map[language].get('exts', []) if language in lanaguage_defaults_map else []
            extra_extensions = [ext.strip() for ext in args.extensions.split(",") if ext.strip() != "" and ext.strip().startswith(".")] if args.extensions else []
            extensions = list(set(default_extensions + extra_extensions))
            # check files in project_dir match extension and not in EXCLUDE_FUNC_CALL_FILEPATHS, include root of filepath
            
            running_for_language = False
            for root, _, files in os.walk(args.project_dir):
                if running_for_language == True:
                    break
                for file in files:
                    filepath = os.path.join(root, file)
                    if any([filepath.endswith(ext) for ext in extensions]) and in_scope(filepath):
                        running_for_language = True
                        break

            if running_for_language:
                print(f"Running LSP Client for language: {colored.fg('yellow')}{language}{colored.attr('reset')}")
                found_languages.append(language)
            
        while True:
            timeout = 8
            r = input_with_timeout(f"Are you sure you want to run for all languages (auto 'y' in {timeout}sec)? (y/n): ", timeout, 'y')
            if r.lower() != "y":
                exit(1)
            break

        languages = found_languages


    first_run = True
    for language in languages:
        # if not overriding language server, use defaults 
        if not args.cmd_override:
            for forced_args in lanaguage_defaults_map[language].get('forced_args', []):
                forced_arg, val = forced_args
                # if currently set to default value, override w/ forced value
                if not was_explicitly_passed(forced_arg, args):
                    setattr(args, forced_arg, val)

        default_extensions = lanaguage_defaults_map[language].get('exts', []) if language in lanaguage_defaults_map else []
        extra_extensions = [ext.strip() for ext in args.extensions.split(",") if ext.strip() != "" and ext.strip().startswith(".")] if args.extensions else []
        extensions = list(set(default_extensions + extra_extensions))


        print("[+] Running LSP Client for language: ", language)

        cmd = args.cmd_override.split(" ") if args.cmd_override else lanaguage_defaults_map[language]['cmd']

        print(args)

        client = LSPClient(
            language,
            extensions,
            cmd,
            force_callHierarchy=args.force_callHierarchy,
            max_ref_tracking_count=args.max_ref_tracking_count,
            disable_get_id_from_ref=args.disable_get_id_from_ref,
            disable_selectionRange=args.disable_selectionRange,
            disable_incoming_calls=args.disable_incoming_calls,
            disable_outgoing_calls=args.disable_outgoing_calls,
            disable_inheritance=args.disable_inheritance,
            pause_for_verification=args.pause_for_verification,
            guess_ref_read_write=args.guess_ref_read_write,
            append_output_file=args.append_output_file if first_run else True,
            resp_timeout=args.resp_timeout,
            resp_pause=args.resp_pause,
            init_timeout=args.init_timeout,
            init_pause=args.init_pause,
            verbose=args.verbose,
            stderr_to_file=args.stderr_to_file
        )

        
        client.analyze(args.project_dir, args.output_file_prefix)
        client.close()

        first_run = False


    # run prescript wait for completion
    if args.postscript:
        print(f"Running postscript: {args.postscript}")
        subprocess.run(args.postscript, shell=True)
        

    print(args)
    