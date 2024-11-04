import json
import argparse
import re

# python3 "$script_folder/_add-scope-decorators.py"

def main():
    # Create the parser
    parser = argparse.ArgumentParser(description="A simple argument parser example")

    # Add arguments
    parser.add_argument("--include-regex", "-i", type=str, help="File paths to mark as in scope: (/vyper)")
    parser.add_argument("--exclude-regex", "-e", type=str, help="File paths to exclude from scope: (/test|/mock|/interface)")

    # Parse the arguments
    args = parser.parse_args()

    if not args.include_regex and not args.exclude_regex:
        parser.error("At least one of --include-regex or --exclude-regex is required")

    # Use the arguments
    print(f"Hello, {args.include_regex}!")
    if args.include_regex:
        print(f"You are {args.include_regex} years old.")
    print(f"Hello, {args.exclude_regex}!")

    if args.exclude_regex:
        print(f"You are {args.exclude_regex} years old.")


    with open('./.vscode/functions_html.json', 'r') as f:
        functions = json.loads(f.read())

        count = 0
        for func in functions:
            filepath = func['filepath']
            if  args.exclude_regex and re.search(args.exclude_regex, filepath):
                func['decorator'] = func['decorator'].replace('🎯', '') # remove decorator, if exists
                continue
            
            if args.include_regex and not re.search(args.include_regex, filepath):
                func['decorator'] = func['decorator'].replace('🎯', '') # remove decorator, if exists
                continue
            
            # add scope decorator if not already added
            func['decorator'] = func['decorator'] + '🎯' if '🎯' not in func['decorator'] else func['decorator']
            print(f"🎯 '{filepath}' matches the include regex and does not match the exclude regex.")
            count += 1
    
    with open('./.vscode/functions_html.json', 'w') as f:
        f.write(json.dumps(functions))
    
    # f.write(json.dumps(functions))
    print(f"functions in scope: {count}")


if __name__ == "__main__":
    main()
