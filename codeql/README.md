
# Bugs
- functions + state vars declared @ top level
    - possible fix: count top level files as functions?
- [Go] function literals
    - Anonymous functions
    - Did JavaScript updates to display callstacks without declared functions w/ names help?



```bash
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