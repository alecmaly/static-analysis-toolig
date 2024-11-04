import json
import time

data = json.loads(open('codeql-functions.json', 'r').read())

start_time = time.time()
headers = data['#select']['columns']

def getRowData(row, index):
    if headers[index]['kind'] == "Entity":
        return row[index]['label'].replace("@", "#")
    else:
        return row[index].replace("@", "#")


# called all called from map
functions = []
for row in data['#select']['tuples']:
    # function being called
    function_name = getRowData(row, 0)
    filepath_decl = getRowData(row, 1)
    filepath_body = getRowData(row, 2)
    qualified_name = getRowData(row, 3)

    start_line = filepath_decl.split("#")[1].split(':')[0]
    end_line = filepath_decl.split("#")[1].split(':')[2]

    filename = filepath_decl.split("#")[0].split("/")[-1].split(".")[0]
    f_path_cleaned = filepath_decl.split(":")[0].replace('@', '#')

    functions.append({
        "id": f"{function_name},{f_path_cleaned}",  # or use qualified name?
        "functionName": function_name,
        "startLine": start_line,
        "endLine": end_line,
        "filepath": f_path_cleaned,
        "filepath_body": filepath_body.split(":")[0],
        "qualifiedName_full": qualified_name,
        "qualifiedName": qualified_name.split("/")[-1],
        "filename": filename
    })

f = open('functions.json', 'w')
f.write(json.dumps(functions))

end_time = time.time()

# Calculate elapsed time
elapsed_time = end_time - start_time

# Output the elapsed time
print(f"Elapsed time: {elapsed_time / 60} minutes")


