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

/* ALL CODE PATHS */
// Notes: 
// - .getBody() removes a lot of nodes, can we do this without it? (how do we get location?)
from Function f
// where exists(f.getBody().getLocation())
select f, f.getFuncDecl().getLocation(), f.getBody().getLocation(), getQualifiedNameOrEmptyFunc(f)

