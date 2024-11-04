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

string getQualifiedNameOrEmptyVar(Variable v) {
    exists(v.getQualifiedName()) and result = v.getQualifiedName()
    or 
    not exists(v.getQualifiedName()) and result = ""
}

string getLocationOrEmptyVar(Variable v) {
    exists(v.getDeclaration().getLocation()) and result = v.getDeclaration().getLocation().toString()
    or 
    not exists(v.getQualifiedName()) and result = ""
}

string getWriteLoc(Write w) {
    result = w.getFile() + "#" + w.getRhs().getStartLine().toString() + ":" + w.getRhs().getStartColumn().toString()
}
string getReadLoc(Read r) {
    result = r.getFile() + "#" + r.getStartLine() + ":" + r.getStartColumn()
}

string getReadInFunc(Read r) {
    result = r.getEnclosingCallable().getFuncDef().getName() + "," + r.getEnclosingCallable().getFuncDef().getLocation().getFile() + "#" + r.getEnclosingCallable().getFuncDef().getLocation().getStartLine()
}

string getWrittenInFunc(Write w, Function f) {
    result = f.getName() + "," + w.getRoot().getLocation().getFile() + "#" + w.getRoot().getLocation().getStartLine()
}


/* Vars Read/Write */
// Notes:
// - Can look up function name from previous query given getRoot() location
from Variable v, Write wn, Read rn, Function wn_f
where v.getAWrite() = wn and v.getARead() = rn and wn.getRoot().getLocation() != rn.getRoot().getLocation() and wn_f.getFuncDecl() = wn.getRoot()
// select v, v.getScope(), getQualifiedNameOrEmptyVar(v), wn.getRoot().getLocation(), getWriteLoc(wn), rn, rn.getRoot().getLocation(), getReadLoc(rn)
select v, getQualifiedNameOrEmptyVar(v), getLocationOrEmptyVar(v), wn, getWriteLoc(wn), getWrittenInFunc(wn, wn_f), rn, getReadLoc(rn), getReadInFunc(rn)
