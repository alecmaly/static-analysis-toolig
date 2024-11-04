import json
import time
data = json.loads(open('codeql-state-vars.json', 'r').read())

start_time = time.time()
headers = data['#select']['columns']

def getRowData(row, index):
    if headers[index]['kind'] == "Entity":
        return row[index]['label'].replace("@", "#")
    else:
        return row[index]





# called all called from map
state_vars = []
for row in data['#select']['tuples']:
    # function being called
    var_name = getRowData(row, 0)
    var_qualified_name = getRowData(row, 1)
    definition_filepath_loc = getRowData(row, 2).replace("@", "#").split(":")[0]
    writtenAt = getRowData(row, 4)
    writtenInFunc = getRowData(row, 5).replace("@", "#")
    readAt = getRowData(row, 7).replace("@", "#")
    readInFunc = getRowData(row, 8)

    
    state_vars.append({
        "varName": var_name,
        "definition_filepath": definition_filepath_loc,  # effectively unique ID of var
        "writtenInFunc": writtenInFunc,
        "writtenAt_file": writtenAt.split("#")[0],
        "writtenAt_line": writtenAt.split("#")[1].split(":")[0],
        "writtenAt_col": writtenAt.split("#")[1].split(":")[1],
        "readInFunc": readInFunc,
        "readAt_file": readAt.split("#")[0],
        "readAt_line": readAt.split("#")[1].split(":")[0],
        "readAt_col": readAt.split("#")[1].split(":")[1],

    })

f = open('state-vars.json', 'w')
f.write(json.dumps(state_vars))

end_time = time.time()

# Calculate elapsed time
elapsed_time = end_time - start_time

# Output the elapsed time
print(f"Elapsed time: {elapsed_time / 60} minutes")


