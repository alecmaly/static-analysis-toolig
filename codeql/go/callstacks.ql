/**
 * @name Empty block
 * @kind problem
 * @problem.severity warning
 * @id go/example/empty-block
 */



// run 
// codeql query run --database=~/Desktop/code4rena/vscode-codeql-starter/geth-codeql-database --output=file.bqrs ~/Desktop/code4rena/vscode-codeql-starter/codeql-custom-queries-go/all-paths.ql



import go
import semmle.go.dataflow.internal.DataFlow

string getQualifiedNameOrEmptyFunc(Function f) {
    exists(f.getQualifiedName()) and result = f.getQualifiedName()
    or 
    not exists(f.getQualifiedName()) and result = ""
}

string getLocationOrEmpty(Function f) {
    exists(f.getBody().getLocation()) and result = f.getBody().getLocation().toString()
    or 
    not exists(f.getBody().getLocation()) and result = ""
}

string getEnclosingCallableOrEmpty(CallNode n) {
    exists(n.getEnclosingCallable().getName()) and result = n.getEnclosingCallable().getName().toString()
    or 
    not exists(n.getEnclosingCallable().getName()) and result = ""
}


string getCallNodeLocation(CallNode n) {
    result = n.getFile() + "#" + n.getStartLine() + ":" + n.getStartColumn()
}



/* ALL CODE PATHS */
// Notes: 
// - .getBody() removes a lot of nodes, can we do this without it? (how do we get location?)
// "wrapHhandler"
from Function f, CallNode n
where f.getACall() = n // and f.getName() = "Header" and n.getFile().toString().regexpMatch(".*simulations/http.go.*")
// select f, getQualifiedNameOrEmptyFunc(f), getLocationOrEmpty(f), n, n.getFile(), n.getStartLine(), n.getStartColumn(), n.getEnclosingCallable(), n.getEnclosingCallable().getFuncDef().getLocation()
select f, getQualifiedNameOrEmptyFunc(f), getLocationOrEmpty(f), n, getCallNodeLocation(n), getEnclosingCallableOrEmpty(n), n.getBasicBlock().getRoot()

