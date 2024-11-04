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
import semmle.go.security.TaintedPath::TaintedPath
// import semmle.go.security.TaintedPath
import DataFlow::PathGraph

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
// from Configuration cfg, DataFlow::PathNode source, DataFlow::PathNode sink
// where cfg.hasFlowPath(source, sink)
// select sink.getNode(), source, sink, "This path depends on a $@.", source.getNode(), "user-provided value"


from Configuration cfg, Node source
where cfg.isSource(source)
select source.getEnclosingCallable(), source, "This path depends on a $@."




// from Configuration cfg, Node source
// where cfg.isSink(source)
// select source, "is a source"



// from DataFlow::PathNode source
// // where cfg.hasFlowPath(source, sink)
// select source