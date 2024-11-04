import json

functions = json.loads(open('./.vscode/functions_summary.json', 'r').read())


def getFuncDescription(func): # funcName,filepath#loc
    # REVIEW WHY THIS FAILS, MISSING FUNCTIONS THAT DON'T HAVE PROPEPR SCOPE?
    # if not func:
    #     return None
    funcName = func['qualifiedName'] if func['qualifiedName'] else func['functionName']
    filename = func['filepath'].split("#")[0].split("/")[-1]
    return f"{filename}{func['decorator']}|{funcName}"


def getFunc(id):
    try:
        return functions_map[id]
    except:
        # REVIEW WHY THIS FAILS, MISSING FUNCTIONS THAT DON'T HAVE PROPEPR SCOPE?
        try:
            return functions_body_map[id]
        except: 
            ""


# cache maps
functions_map = {}
functions_body_map = {}

for f in functions:
    # {functionName,filepath} is unique for each function as it includes line number
    key = f"{f['functionName']},{f['filepath']}"
    functions_map[key] = f
    key = f"{f['functionName']},{f['filepath_body']}"
    functions_body_map[key] = f

tab = "&emsp;"

def get_line_from_file(filename, n, col = 1):
    col = col - 1
    # Ensure that n is a positive integer
    if not isinstance(n, int) or n <= 0:
        return None
    
    # Open the file
    with open(filename, 'r') as file:
        # Iterate over the file line by line
        for current_line_number, line in enumerate(file, 1):
            # If the current line number matches n, return the line
            if current_line_number == n:
                # Mark variable usage in HTML
                line = ''.join([line[:col], "<mark>", line[col], "</mark>", line[col+1:]])
                
                return line.strip()
        
    # Return None if the line number n does not exist in the file
    return ""

def getStateVarInfoHTML(inFunc, at):
    func_name = inFunc.split(",")[0]
    filename = at.split("/")[-1].split("#")[0]
    code_at_line_row = at.split("#")[1].split(":")[0]
    code_at_line_col = at.split("#")[1].split(":")[1]
    code_at_line_str = get_line_from_file(at.split("#")[0], int(code_at_line_row), int(code_at_line_col))
    
    html = f"<a href='#{inFunc}'>🔗</a><a href='file://{at}'>{filename}|{func_name}#{code_at_line_row}</a> | {code_at_line_str}"
    return html

# collect state var summary (text for now -> TODO convert to HTML)
for f in functions:
    state_var_summary_str = "<h3>State Variables Written</h3><br>"
    for v in f.get('state_vars_written_detailed', []):
        var_name = v['name'].split(",")[0]
        var_filepath = v['name'].split(",")[1]
        state_var_summary_str += f"<br>var: <a href='file://{var_filepath}'>{var_name}</a><br>"
        state_var_summary_str += f"{tab}Written At<br>"
        for writtenAt_info in v['writtenAt']:
            state_var_summary_str += f"{tab*2}{getStateVarInfoHTML(writtenAt_info['writtenInFunc'], writtenAt_info['writtenAt'])}<br>"
        state_var_summary_str += f"<br>\tRead At<br>"
        for readAt_info in v['readAt']:
            state_var_summary_str += f"{tab*2}{getStateVarInfoHTML(readAt_info['readInFunc'], readAt_info['readAt'])}<br>"
    # read vars
    state_var_summary_str += "<h3>State Variables Read</h3><br>"
    for v in f.get('state_vars_read_detailed', []):
        var_name = v['name'].split(",")[0]
        var_filepath = v['name'].split(",")[1]
        state_var_summary_str += f"<br>var: <a href='file://{var_filepath}'>{var_name}</a><br>"
        state_var_summary_str += f"{tab}Written At<br>"
        for writtenAt_info in v['writtenAt']:
            state_var_summary_str += f"{tab*2}{getStateVarInfoHTML(writtenAt_info['writtenInFunc'], writtenAt_info['writtenAt'])}<br>"
        state_var_summary_str += f"<br>{tab}Read At<br>"
        for readAt_info in v['readAt']:
            state_var_summary_str += f"{tab*2}{getStateVarInfoHTML(readAt_info['readInFunc'], readAt_info['readAt'])}<br>"
    f['state_vars_summary_html'] = state_var_summary_str


# tainted variables


# callstack HTML
## DOING CALLSTACKS IN EXTENSION BASED ON INDEXES
# def getCallstacksHTML(callstacks):
#     callstacks_html = "<ul>"
#     for callstack in callstacks:
#         callstack_html_arr = []
#         for inFunc, calledAt in callstack:
#             inFunc_lookup = getFunc(inFunc)     # have to lookup because inFunc may point to either body or definition of func (CodeQL issue)
#             func_name = getFuncDescription(inFunc)
#             func_link = f"<a href='#{inFunc_lookup['functionName']},{inFunc_lookup['filepath']}'>🔗</a>"
#             callstack_html_arr.append(f"{func_link}<a href='file://{calledAt}'>{func_name}</a>")
#         if len(callstack_html_arr) > 0:
#             callstacks_html += "<li class='callstack'>" + f"{' > '.join(callstack_html_arr)}" + "</li>"
#     callstacks_html += "</ul>"
#     return callstacks_html

# # get callstacks
# for f in functions:
#     f['entrypoint_callstacks_html'] = getCallstacksHTML(f.get('entrypoint_callstacks', []))
#     f['exit_callstacks_html'] = getCallstacksHTML(f.get('exit_callstacks', []))
#     f['other_callstacks_html'] = getCallstacksHTML(f.get('other_callstacks', []))


# build function HTML summary
for f in functions:
    func_id = f"{f['functionName']},{f['filepath']}"
    # function description
    html = f"<div id='{func_id}' class='function-summary'>"
    func = getFunc(func_id)
    funcDesc = getFuncDescription(func)
    html += f"<h2><a href='file://{f['filepath']}'>{funcDesc}</a></h2><br>"
    # callstacks
    # html += "<h3>Entrypoint Callstacks</h3><br>" + f['entrypoint_callstacks_html'] + "<br>"
    # html += "<h3>Exit Callstacks</h3><br>" + f['exit_callstacks_html'] + "<br>"
    # html += "<h3>Other Callstacks</h3><br>" + f['other_callstacks_html'] + "<br>"
    # state vars
    html += "<h3>State Var Summary</h3><br>" + f['state_vars_summary_html'] + "<br>"
    html += "</div>"
    f['function_summary_html'] = f['function_summary_html'] # + html


# # clear unused fields to reduce output JSON size
# def clearUnusedFields(f):
#     f['entrypoint_callstacks'] = None
#     f['exit_callstacks'] = None
#     f['other_callstacks'] = None

# for f in functions:
#     clearUnusedFields(f)


## too big to output, could create a DB table of functions and reference them
# try building in Extension from functions.json
with open("./.vscode/functions_html.json", 'w') as file:
    # Write the opening bracket of the list
    null = file.write('[')
    
    # Iterate through each dictionary in the list
    for index, function in enumerate(functions):
        # Serialize the current dictionary to JSON and write it to the file
        json.dump(function, file)
        
        # If this is not the last element, add a comma to separate the elements
        if index < len(functions) - 1:
            null = file.write(',')
    
    # Write the closing bracket of the list
    null = file.write(']')





## output callstacks as HTML (indices preserved)
def getCallstacksHTML(callstacks):
    callstacks_html = ""
    for callstack in callstacks:
        callstack_html_arr = []
        for inFunc, calledAt in callstack:
            inFunc_lookup = getFunc(inFunc)     # have to lookup because inFunc may point to either body or definition of func (CodeQL issue)
        
            if inFunc_lookup:
                func_name = getFuncDescription(inFunc_lookup)
                func_link = f"<a href='#{inFunc_lookup['functionName']},{inFunc_lookup['filepath']}'>🔗</a>"
            else:
                # could not lookup func (not in functions.json)
                func_name = inFunc.split(',')[0]
                func_link = f""

            ## UPDATE HERE
            callstack_html_arr.append(f"{func_link}<a href='file://{calledAt}'>{func_name}</a>")
        if len(callstack_html_arr) > 0:
            callstacks_html += "<li class='callstack'>" + f"{' > '.join(callstack_html_arr)}" + "</li>\n"
    return callstacks_html


callstacks = json.loads(open('./.vscode/callstacks.json', 'r').read())
html = getCallstacksHTML(callstacks)
open('./.vscode/callstacks.html', 'w').write(html)


## print all callstacks
# callstacks = json.loads(open('callstacks.json', 'r').read())
# html = "<input id='searchbox' onkeyup='filterCallstacks()' />"
# html += """
# <script>
#     function filterCallstacks(e) {
#         filter_text = document.querySelector('#searchbox').text
#         console.log(filter_text)

#     }
# </script>
# """
# html += getCallstacksHTML(callstacks[1:50])
# open('callstacks.html', 'w').write(html)



# for f in functions:
#     for v in f.get('state_var_summary', []):
#         break


# collect callchain html
# entrypoint | exit | other



# output to .html
# write all callchains
# write function specific 
# - callchain
# - variables
# link between callchains + specific functions
