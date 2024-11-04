
import json

functions = json.loads(open('functions.json', 'r').read())
callstacks = json.loads(open('./.vscode/callstacks.json', 'r').read())
state_var_assign_use_mappings = json.loads(open('state-vars.json', 'r').read())


print(f"[+] Loaded {len(functions)} functions")
print(f"[+] Loaded {len(callstacks)} callstacks")
print(f"[+] Loaded {len(state_var_assign_use_mappings)} state_vars")


# util functions
def getFunc(id):
    try:
        return functions_map[id]
    except:
        # print(id)
        try: 
            return functions_body_map[id]
        except:
            return {} # FIX LATER
    



# cache maps
functions_map = {}
functions_body_map = {}

for f in functions:
    # {functionName,filepath} is unique for each function as it includes line number
    key = f"{f['functionName']},{f['filepath']}"
    functions_map[key] = f
    key = f"{f['functionName']},{f['filepath_body']}"
    functions_body_map[key] = f
    f['decorator'] = ""


# cache + collect vars
# collect written + read locations of vars
vars = {}
for v in state_var_assign_use_mappings:
    key = f"{v['varName']},{v['definition_filepath']}"
    # create var object if it doesn't exist
    if key not in vars:
        vars[key] = {}
        vars[key]['name'] = key
    x = getFunc(v['readInFunc'])
    #
    written_obj = {
        "writtenAt": v['writtenAt_file'] + "#" + v['writtenAt_line'] + ":" + v['writtenAt_col'],
        "writtenInFunc": v['writtenInFunc']
    }
    if written_obj not in vars[key].get('writtenAt', []):
        vars[key].setdefault("writtenAt", []).append(written_obj)
    #
    # add var to function definition
    getFunc(written_obj['writtenInFunc']).setdefault('state_vars_written', set()).add(key)
    #
    readAt_obj = {
        "readAt": v['readAt_file'] + "#" + v['readAt_line'] + ":" + v['readAt_col'],
        "readInFunc": v["readInFunc"]    
    }
    if readAt_obj not in vars[key].get('readAt', []):
        vars[key].setdefault("readAt", []).append(readAt_obj)
    #
    # add var to function definition
    getFunc(readAt_obj['readInFunc']).setdefault('state_vars_read', set()).add(key)
        

# convert sets to lists so we can output as JSON
for f in functions:
    if f.get('state_vars_written', None):
        f['state_vars_written'] = list(f['state_vars_written'])
    if f.get('state_vars_read', None):
        f['state_vars_read'] = list(f['state_vars_read'])



# state var detailed
for f in functions:
    for v in f.get('state_vars_written', []):
        f.setdefault('state_vars_written_detailed', []).append(vars[v])
    for v in f.get('state_vars_read', []):
        f.setdefault('state_vars_read_detailed', []).append(vars[v])

    # mark decorator for functions that write to state vars
    if f.get('state_vars_written', None):
        f["decorator"] += "🔴"



# # state var summary
# for f in functions:
#     state_var_summary_str = "State Variables Written\n"
#     for v in f.get('state_vars_written', []):
#         state_var_summary_str += f"{v}\n"
#         var_info = vars[v]
#         state_var_summary_str += f"\tWritten At\n"
#         for writtenAt_info in var_info['writtenAt']:
#             state_var_summary_str += f"\t\t{writtenAt_info['writtenInFunc']} @ {writtenAt_info['writtenAt']}\n"
#         state_var_summary_str += f"\n\tRead At\n"
#         for readAt_info in var_info['readAt']:
#             state_var_summary_str += f"\t\t{readAt_info['readInFunc']} @ {readAt_info['readAt']}\n"
#     # read vars
#     state_var_summary_str += "State Variables Read\n"
#     for v in f.get('state_vars_read', []):
#         state_var_summary_str += f"{v}\n"
#         var_info = vars[v]
#         state_var_summary_str += f"\tWritten At\n"
#         for writtenAt_info in var_info['writtenAt']:
#             state_var_summary_str += f"\t\t{writtenAt_info['writtenInFunc']} @ {writtenAt_info['writtenAt']}\n"
#         state_var_summary_str += f"\n\tRead At\n"
#         for readAt_info in var_info['readAt']:
#             state_var_summary_str += f"\t\t{readAt_info['readInFunc']} @ {readAt_info['readAt']}\n"
#     f['state_var_summary'] = state_var_summary_str




# collect callstacks (preserve indices)
callstacks_map = {}
for index, callstack in enumerate(callstacks):
    callstacks_map[json.dumps(callstack)] = index

## chaging to output callstack IDs (based on JSON of callstack)
callstacks = [cs for cs in callstacks if len(cs) > 1]
for callstack in callstacks:
    entrypoint_calledInFunc, entrypoint_usedAt = callstack[0]
    # getFunc(entrypoint_calledInFunc).setdefault('entrypoint_callstacks', []).append(callstack)
    getFunc(entrypoint_calledInFunc).setdefault('entrypoint_callstacks', []).append(callstacks_map[json.dumps(callstack)])
    exit_calledInFunc, exit_usedAt = callstack[-1]
    getFunc(exit_calledInFunc).setdefault('exit_callstacks', []).append(callstacks_map[json.dumps(callstack)])
    for calledInFunc, usedAt in callstack[1:-1]:
        getFunc(calledInFunc).setdefault('other_callstacks', []).append(callstacks_map[json.dumps(callstack)])





print("Writing to file...")
f = open('./.vscode/functions_summary.json', 'w')
f.write(json.dumps(functions))





