



# Run queries + convert

```bash
# Create Database
codeql database create --language=javascript storefront-node_modules-codeql-db -s ./src

### Functions
database="/home/ubuntu/Desktop/code4rena/vscode-codeql-starter/storefront-codeql-db"
querys_folder="/home/ubuntu/Desktop/code4rena/vscode-codeql-starter/codeql-custom-queries-javascript"

## functions
codeql query run --database=$database --output="functions.bqrs" "$querys_folder/functions.ql"
# convert to codeql
codeql bqrs decode --output="codeql-functions.json" --format=json functions.bqrs


## Callstacks
codeql query run --database=$database --output="callstacks.bqrs" "$querys_folder/callstacks.ql"
# convert to codeql
codeql bqrs decode --output="codeql-callstacks.json" --format=json callstacks.bqrs
# // run 

## State Vars
codeql query run --database=$database --output="state-vars.bqrs" "$querys_folder/state-vars.ql"
# convert to codeql
codeql bqrs decode --output="codeql-state-vars.json" --format=json state-vars.bqrs

## Tainted paths


# process codeql .json 
python3 _dump-codeql-functions.py
python3 _dump-codeql-callstacks.py
python3 _dump-codeql-state-vars.py

# compile processed data to VS Code expected data
python3 _compile_functions_summary.py
python3 _compile_html.py

```




# Known Issues
- function literals (functions declared in functions) are not followed
- state variables not fully tracking (e.x.: balance)


