/**
 * @name Empty block
 * @kind problem
 * @problem.severity warning
 * @id go/example/empty-block
 */



// run 
// codeql query run --database=~/Desktop/code4rena/vscode-codeql-starter/geth-codeql-database --output=file.bqrs ~/Desktop/code4rena/vscode-codeql-starter/codeql-custom-queries-go/all-paths.ql



import python
import shared


string getCalledAtLoc(CallNode cn) {
    exists(cn.getLocation().getStartLine()) and result = cn.getLocation().getFile() + "#" + cn.getLocation().getStartLine() + ":" + cn.getLocation().getStartColumn()
    or
    not exists(cn.getLocation()) and result = ""
}


string getFunctionLocationOrEmpty(Function n) {
    exists(n.getLocation().getStartLine()) and result = n.getLocation().getFile() + "#" + n.getLocation().getStartLine() + ":" + n.getLocation().getStartColumn()
    or
    not exists(n.getLocation()) and result = ""
}

string getQualifiedNameOrEmpty(FunctionObject f) {
    exists(f.getQualifiedName()) and result = f.getQualifiedName()
    or
    not exists(f.getQualifiedName()) and result = ""
}

string getNameOrEmpty(FunctionObject f) {
    exists(f.getName()) and result = f.getName()
    or
    not exists(f.getName()) and result = ""
}



// from FunctionObject f_called, CallNode cn, FunctionObject f_calledIn
// // enclosingFunction() does not handle function calls starting in top level script
// // TO DO: account for this and get call chains originating from top level script 
// where f_called.getAFunctionCall() = cn and enclosingFunction(cn, f_calledIn)
// select  getNameOrEmpty(f_called), // , // 0. called func name
//         getQualifiedNameOrEmpty(f_called), // 1. called func qualified name"
//         getFunctionLocationOrEmpty(f_called.getFunction()), // 2. called func loc
//         cn, // 3. -- NOT USED --
//         getCalledAtLoc(cn), // 4.  called at loc
//         f_calledIn.getName(),  // 5. called in func name
//         getFunctionLocationOrEmpty(f_calledIn.getFunction()), // 6. called in func loc
//         ""


string getScopeLocationOrEmpty(Scope s) {
    exists(s.getLocation()) and result = s.getLocation().getFile() + "#" + s.getLocation().getStartLine() + ":" + s.getLocation().getStartColumn()
    or 
    not exists(s.getLocation()) and result = ""
}

string getScopeNameOrEmpty(Scope s) {
    exists(s.getName()) and result = s.getName()
    or
    not exists(s.getName()) and result = ""
}

from FunctionObject f_called, CallNode cn
// enclosingFunction() does not handle function calls starting in top level script
// TO DO: account for this and get call chains originating from top level script 
where f_called.getAFunctionCall() = cn
select  getNameOrEmpty(f_called), // , // 0. called func name
        getQualifiedNameOrEmpty(f_called), // 1. called func qualified name"
        getFunctionLocationOrEmpty(f_called.getFunction()), // 2. called func loc
        cn, // 3. -- NOT USED --
        getCalledAtLoc(cn), // 4.  called at loc
        getScopeNameOrEmpty(cn.getScope()),  // 5. called in func/class/file name
        getScopeLocationOrEmpty(cn.getScope()), // 6. called in func loc
        ""


