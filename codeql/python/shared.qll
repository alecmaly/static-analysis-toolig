// File: MyDefinitions.ql
/**
 * @name MyPredicate
 * @description My predicate description.
 */

 import python

 /** Function predicates **/
 string getLocationOrFileRoot(Function f) {
     exists(f.getLocation()) and
     result =
         f.getLocation().getFile() + "#" + f.getLocation().getStartLine() + ":" + f.getLocation().getStartColumn() + ":" + f.getLocation().getEndLine() + ":" + f.getLocation().getEndColumn()
     or
     not exists(f.getLocation()) and result = f.getDefinition().getLocation().getFile() + "#1" 
 }
 
 string getLocationBodyOrFileRoot(Function f) {
     // get location of body (getting definition for python here, does this break anything? - will break if other codeql queries get body)
     exists(f.getDefinition().getLocation()) and result = f.getDefinition().getLocation().getFile() + "#" + f.getDefinition().getLocation().getStartLine() + ":" + f.getDefinition().getLocation().getStartColumn()
     or
     // return file scope if body location does not exist
     not exists(f.getDefinition().getLocation()) and result = f.getLocation().getFile() + "#1"
 }
 
 string getNameOrEmpty(Function f) {
     exists(f.getName()) and result = f.getName()
     or
     not exists(f.getName()) and result = f.toString()
 }
 