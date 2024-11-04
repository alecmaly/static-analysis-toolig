/**
 * @name Empty block
 * @kind problem
 * @problem.severity warning
 * @id go/example/empty-block
 */



// run 
// codeql query run --database=~/Desktop/code4rena/vscode-codeql-starter/geth-codeql-database --output=file.bqrs ~/Desktop/code4rena/vscode-codeql-starter/codeql-custom-queries-go/all-paths.ql



import csharp

string getQualifiedNameOrEmptyFunc(Method f) {
    exists(f.getQualifiedName()) and result = f.getQualifiedName()
    or 
    not exists(f.getQualifiedName()) and result = ""
}

string getLocationOrEmpty(Location l) {
    result = l.getFile() + "#" + l.getStartLine() + ":" + l.getStartColumn() + ":" + l.getEndLine() + ":" + l.getEndColumn()
}


/* ALL CODE PATHS */
// Notes: 
// - .getBody() removes a lot of nodes, can we do this without it? (how do we get location?)
from Callable f
// where exists(f.getBody().getLocation())
// select f, f.getFuncDecl().getLocation(), f.getBody().getLocation(), getQualifiedNameOrEmptyFunc(f)
select f, getLocationOrEmpty(f.getLocation()), getLocationOrEmpty(f.getBody().getLocation()), getQualifiedNameOrEmptyFunc(f), ""

