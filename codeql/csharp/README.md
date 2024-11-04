



# Run queries + convert

```bash
# Create Database
codeql database create --language=cpp bitwarden-codeql-db -s ./bitwarden

### Functions
database="/home/ubuntu/Desktop/code4rena/vscode-codeql-starter/bitwarden-codeql-db"
querys_folder="/home/ubuntu/Desktop/code4rena/vscode-codeql-starter/codeql-custom-queries-csharp"

codeql query run --database=$database --output="functions.bqrs" "$querys_folder/functions.ql"
# convert to codeql
codeql bqrs decode --output="codeql-functions.json" --format=json functions.bqrs
# // run functions-dump.py


## Callstacks
codeql query run --database=$database --output="callstacks.bqrs" "$querys_folder/callstacks.ql"
# convert to codeql
codeql bqrs decode --output="codeql-callstacks.json" --format=json callstacks.bqrs


## State Vars
codeql query run --database=$database --output="state-vars.bqrs" "$querys_folder/state-vars.ql"
# convert to codeql
codeql bqrs decode --output="codeql-state-vars.json" --format=json state-vars.bqrs
# // run functions-dump.py




# process codeql .json 
python3 _dump-codeql-functions.py
python3 _dump-codeql-callstacks.py
python3 _dump-codeql-state-vars.py

# compile processed data to VS Code expected data
python3 _compile_functions_summary.py
python3 _compile_html.py

cp callstacks.json ./.vscode/callstacks.json
# cp functions_summary.json ./.vscode/functions_summary.json
# cp functions_html.json ./.vscode/functions_html.json
# cp callstacks.json ./.vscode/callstacks.json
# cp callstacks.html ./.vscode/callstacks.html


```




# Known Issues
- function literals (functions declared in functions) are not followed
- state variables not fully tracking (e.x.: balance)


