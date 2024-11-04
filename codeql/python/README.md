



# Run queries + convert

```bash
# Create Database
codeql database create --language=python vyper-codeql-db -s ./vyper

### Functions
base="/home/ubuntu/Desktop/vscode-codeql-starter"
database="$base/vyper-codeql-db"
querys_folder="$base/codeql-custom-queries-python"
script_folder="$base/genaric/codeql"

## functions
codeql query run --database=$database --output="functions.bqrs" "$querys_folder/functions.ql"
# convert to codeql
codeql bqrs decode --output="codeql-functions.json" --format=json functions.bqrs


# Callstacks
codeql query run --database=$database --output="callstacks.bqrs" "$querys_folder/callstacks.ql"
# convert to codeql
codeql bqrs decode --output="codeql-callstacks.json" --format=json callstacks.bqrs
# // run 

# ## State Vars
# codeql query run --database=$database --output="state-vars.bqrs" "$querys_folder/state-vars.ql"
# # convert to codeql
# codeql bqrs decode --output="codeql-state-vars.json" --format=json state-vars.bqrs

## Tainted paths


# process codeql .json 
python3 "$script_folder/_dump-codeql-functions.py"
python3 "$script_folder/_dump-codeql-callstacks.py"
# python3 "$script_folder/_dump-codeql-state-vars.py"

# compile processed data to VS Code expected data
python3 "$script_folder/_compile_functions_summary.py"
python3 "$script_folder/_compile_html.py"

# add scope decorators
python3 "$script_folder/_add-scope-decorators.py" -i "(/vyper)" -e "(/test|/mock)"

```




# Known Issues
- function literals (functions declared in functions) are not followed
- state variables not fully tracking (e.x.: balance)


