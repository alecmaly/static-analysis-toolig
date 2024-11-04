import json
import time
data = json.loads(open('codeql-callstacks.json', 'r').read())

start_time = time.time()
headers = data['#select']['columns']




def getRowData(row, index):
    if headers[index]['kind'] == "Entity":
        return row[index]['label'].replace("@", "#")
    else:
        return row[index]



qualified_names = {}

# called all called from map
functions_calledFrom_map = {}
for row in data['#select']['tuples']:
    # function being called
    f = getRowData(row, 0)
    qualified_name = getRowData(row, 1)
    f_path = getRowData(row, 2).split(":")[0].replace('@', '#')

    # called @
    f_calledIn = f"{getRowData(row, 5)},{getRowData(row, 6).split(':')[0]}"
    f_calledAt = f"{getRowData(row, 4)}"
    
        
    if "function literal" not in f_calledIn and f_path != "":
        qualified_names[f"{f},{f_path}"] = qualified_name
        # f_calledAt to get precise called at location, however, callstacks with multiple calls to the same
        # functions will create duplicate looking callstacks
        # functions_calledFrom_map.setdefault(f"{f},{f_path}", set()).add((f_calledIn, f_calledAt))
        functions_calledFrom_map.setdefault(f"{f},{f_path}", set()).add((f_calledIn, f_calledIn.split(",")[1]))  






callstacks = []
for f_unique in functions_calledFrom_map:
    # if "/test" not in f_unique:           # include interesting start nodes (start node = exit nodes)
    callstacks.append([(f_unique, f_unique.split(',')[1])])

MAX_DEPTH = 25



def is_subsequence(arr, other_arr):
    len_arr = len(arr)
    len_other_arr = len(other_arr)

    # If first list is larger, it can't be a subsequence
    if len_arr > len_other_arr:
        return False

    # Use a sliding window to check if arr is a subsequence of other_arr
    for i in range(len_other_arr - len_arr + 1):
        if other_arr[i:i+len_arr] == arr:
            return True

    return False



def remove_sublists(new_callstacks):
    # Convert input to list if it's a set
    if isinstance(new_callstacks, set):
        new_callstacks = list(new_callstacks)
    
    # Convert lists to sets and keep track of their original indices
    sublists = [(set(arr), index) for index, arr in enumerate(new_callstacks)]
    # Sort sublists based on their length
    sublists.sort(key=lambda x: len(x[0]))

    result_indices = set(range(len(new_callstacks)))
    # Maintain a combined set for quick subset checking
    combined_set = set()

    for i in range(len(sublists)):
        current_set, original_index = sublists[i]
        # If the current set is a subset of the combined set, it means
        # it's a subset of one of the larger sets
        # if current_set.issubset(combined_set):
        if is_subsequence(current_set, combined_set):
            result_indices.remove(original_index)
        else:
            # If it's not a subset, add elements to the combined set
            combined_set.update(current_set)

    return [new_callstacks[index] for index in result_indices]



finalized_callstacks = []
depth = 0
while True:
    depth += 1
    if depth > MAX_DEPTH:
        break

    len_before = len(callstacks)
    
    new_callstacks = []
    for callstack in callstacks:

        entry_node = callstack[0][0]   # functionName,filepath
        new_entry_nodes = functions_calledFrom_map.get(entry_node, [])

        if "onClose" in entry_node:
            ""
        if new_entry_nodes:
            for f_calledIn, f_calledAt in new_entry_nodes:
                if (f_calledIn, f_calledAt) not in callstack:
                    new_callstack = [(f_calledIn, f_calledAt)] + callstack.copy()
                    if new_callstack not in callstacks:       # blacklist not interesting node paths... e.x. /test, /mock, etc...  move this up?
                        new_callstacks.append(new_callstack)
                else:
                    # appending will result in cycle, just add to finalized_callstacks
                    finalized_callstacks.append(callstack)

        else:
            finalized_callstacks.append(callstack)

    # callchains_from_exitNode = [arr for arr in callchains_from_exitNode if not any(set(arr).issubset(set(other_arr)) for other_arr in callchains_from_exitNode if other_arr != arr)]

    new_callstacks = remove_sublists(new_callstacks)
    # new_callstacks = [arr for arr in new_callstacks if not any(set(arr).issubset(set(other_arr)) for other_arr in new_callstacks if other_arr != arr)]
    
    callstacks = new_callstacks
    len_after = len(callstacks)

    # if len_before == len_after:
    #     break


    # Output the elapsed time
    end_time = time.time()
    elapsed_time = end_time - start_time
    print(f"Elapsed time {depth}: {elapsed_time / 60} minutes")


# sort finalized_callstacks
print("sorting")
finalized_callstacks.sort(key=lambda inner_array: ''.join(x[0] for x in inner_array))

print("outputting")
seen = []
f = open('callstacks.md', 'w')
for callstack in finalized_callstacks:
    scope = qualified_names[f_calledIn].split("/")[0] if f_calledIn in qualified_names else f"(f){f_calledIn.split('/')[-1].split('.')[0]}"
    output = " > ".join([f"{scope}.{f_calledIn.split(',')[0]}" for f_calledIn, f_calledAt in callstack]) + "<br>\n"
    if output not in seen:
        f.write(output)
        seen.append(output)


f = open('callstacks-filepaths.md', 'w')
for callstack in finalized_callstacks:
    scope = qualified_names[f_calledIn].split("/")[0] if f_calledIn in qualified_names else f"(f){f_calledIn.split('/')[-1].split('.')[0]}"
    f.write(" > ".join([f"[{f_calledIn.split('/')[-1].split('.')[0]}.{f_calledIn.split(',')[0]}]({f_calledAt})" for f_calledIn, f_calledAt in callstack]))
    f.write("<br>\n")

f = open('./.vscode/callstacks.json', 'w')
f.write(json.dumps(finalized_callstacks))



end_time = time.time()

# Calculate elapsed time
elapsed_time = end_time - start_time

# Output the elapsed time
print(f"Elapsed time: {elapsed_time / 60} minutes")


