



# Run queries + convert

```bash
# Create Database
codeql database create --language=cpp lightway-core-codeql-db -s ./lightway-core

### Functions
database="/home/ubuntu/Desktop/code4rena/vscode-codeql-starter/lightway-core-codeql-db"
querys_folder="/home/ubuntu/Desktop/code4rena/vscode-codeql-starter/codeql-custom-queries-cpp"

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


```




# Known Issues
- function literals (functions declared in functions) are not followed
- state variables not fully tracking (e.x.: balance)


