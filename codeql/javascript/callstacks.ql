/**
 * @name Empty block
 * @kind problem
 * @problem.severity warning
 * @id go/example/empty-block
 */



// run 
// codeql query run --database=~/Desktop/code4rena/vscode-codeql-starter/geth-codeql-database --output=file.bqrs ~/Desktop/code4rena/vscode-codeql-starter/codeql-custom-queries-go/all-paths.ql



import javascript
import shared


string getCalleeFunctionNameOrEmpty(DataFlow::InvokeNode invk) {
    // NOTE: This may not match function names precicely and cause issues
    // perhaps we need to only match functions on start line and try using names to resolve
    // duplicates (multiple functions declared on same line)?
    exists(invk.getCalleeName()) and result = invk.getCalleeName()
    or 
    not exists(invk.getCalleeName()) and result = ""
}

// string getFunctionQualifiedName(DataFlow::InvokeNode invk) {
//     exists(invk.getCalleeNode()) and result = invk.getCalleeNode().toString() + "," + invk.getCalleeNode().get
//     or 
//     not exists(invk.getCalleeNode()) and result = ""
// }

string getCalleeFunctionLocationOrEmpty(DataFlow::InvokeNode invk) {
    exists(invk.getCalleeNode()) and result = invk.getCalleeNode().getFile() + "#" + invk.getCalleeNode().getStartLine() + ":" + invk.getCalleeNode().getStartColumn()
    or 
    not exists(invk.getCalleeNode()) and result = ""
}

/* ALL CODE PATHS */
// Notes: 
// - .getBody() removes a lot of nodes, can we do this without it? (how do we get location?)
// from Function f, CallNode n
// where f.getACall() = n 
// select f, getQualifiedNameOrEmptyFunc(f), getFunctionLocationOrEmpty(f), n, n.getFile(), n.getStartLine(), n.getStartColumn(), n.getEnclosingCallable(), n.getEnclosingCallable().getFuncDef().getLocation()


string getInvkLocationOrFileRoot(DataFlow::InvokeNode invk) {
    result = invk.getFile() + "#" + invk.getStartLine() + ":" + invk.getStartColumn()
}


string getInvkEnclosingFunctionNameOrEmpty(DataFlow::InvokeNode invk) {
    exists(invk.getEnclosingFunction()) and result = getNameOrEmpty(invk.getEnclosingFunction())
    or
    not exists(invk.getEnclosingFunction()) and result = "" 
}

string getInvkEnclosingFunctionLocationOrFileRoot(DataFlow::InvokeNode invk) {
    exists(invk.getEnclosingFunction()) and result = getLocationOrFileRoot(invk.getEnclosingFunction())
    or
    not exists(invk.getEnclosingFunction()) and result = invk.getFile() + "#1"
}




from DataFlow::InvokeNode invk, DataFlow::FunctionNode f
// where getInvkEnclosingFunctionNameOrEmpty(invk) = "getContractTokens" 
// where getCalleeFunctionNameOrEmpty(invk).regexpMatch(".*token.*")
// where f.getBody().getContainer() = invk.getEnclosingFunction().getEnclosingContainer()
select 
    getCalleeFunctionNameOrEmpty(invk),                 // 0 called_functionName
    "",                                                 // 1 called_functionQualifiedName
    getCalleeFunctionLocationOrEmpty(invk),             // 2 called_functionFilepath  (ERR: This is location of call, not location of function definition)
    invk,                                               // 3
    getInvkLocationOrFileRoot(invk),                    // 4 f_calledAt 
    getInvkEnclosingFunctionNameOrEmpty(invk),          // 5 f_calledIn_name
    getInvkEnclosingFunctionLocationOrFileRoot(invk)    // 6 f_calledIn_location


