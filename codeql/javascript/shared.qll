// File: MyDefinitions.ql
/**
 * @name MyPredicate
 * @description My predicate description.
 */

import javascript

/** Function predicates **/
string getLocationOrFileRoot(Function f) {
    exists(f.getLocation()) and
    result =
        f.getLocation().getFile() + "#" + f.getLocation().getStartLine() + ":" +
        f.getLocation().getStartColumn() + ":" + f.getLocation().getEndLine() + ":" +
        f.getLocation().getEndColumn()
    or
    not exists(f.getLocation()) and result = f.getFile() + "#1"
}

string getLocationBodyOrFileRoot(Function f) {
    // get location of body
    exists(f.getBody().getLocation()) and result = f.getBody().getLocation().getFile() + "#" + f.getBody().getLocation().getStartLine() + ":" + f.getBody().getLocation().getStartColumn()
    or
    // return file scope if body location does not exist
    not exists(f.getBody().getLocation()) and result = f.getFile() + "#1"
}

string getNameOrEmpty(Function f) {
    exists(f.getName()) and result = f.getName()
    or
    not exists(f.getName()) and result = f.toString()
}
