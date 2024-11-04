/**
 * @name Empty block
 * @kind problem
 * @problem.severity warning
 * @id go/example/empty-block
 */



// run 
// codeql query run --database=~/Desktop/code4rena/vscode-codeql-starter/geth-codeql-database --output=file.bqrs ~/Desktop/code4rena/vscode-codeql-starter/codeql-custom-queries-go/all-paths.ql



import javascript

// string getQualifiedNameOrEmptyVar(Variable v) {
//     exists(v.getQualifiedName()) and result = v.getQualifiedName()
//     or 
//     not exists(v.getQualifiedName()) and result = ""
// }

string getLocationOrEmptyVar(Variable v) {
    exists(v.getADeclaration().getLocation()) and result = v.getADeclaration().getLocation().toString()
    or 
    not exists(v.getADeclaration().getLocation()) and result = ""
}

string getWriteLoc(Expr w) {
    result = w.getFile() + "#" + w.getLocation().getStartLine().toString() + ":" + w.getLocation().getStartColumn().toString()
}

string getWrittenInFunc(Expr w) {
    result = w.getEnclosingFunction().getName() + "," + w.getEnclosingFunction().getLocation().getFile() + "#" + w.getEnclosingFunction().getLocation().getStartLine()
}

string getReadLoc(VarAccess r) {
    result = r.getFile() + "#" + r.getLocation().getStartLine() + ":" + r.getLocation().getStartColumn()
}

string getReadInFunc(VarAccess r) {
    result = r.getEnclosingFunction().getName() + "," + r.getEnclosingFunction().getLocation().getFile() + "#" + r.getEnclosingFunction().getLocation().getStartLine()
}



// from Variable v, Write wn, Read rn, Function wn_f
// where v.getAWrite() = wn and v.getARead() = rn and wn.getRoot().getLocation() != rn.getRoot().getLocation() and wn_f.getFuncDecl() = wn.getRoot()
// // select v, v.getScope(), getQualifiedNameOrEmptyVar(v), wn.getRoot().getLocation(), getWriteLoc(wn), rn, rn.getRoot().getLocation(), getReadLoc(rn)
// select v, getQualifiedNameOrEmptyVar(v), getLocationOrEmptyVar(v), wn, getWriteLoc(wn), getWrittenInFunc(wn, wn_f), rn, getReadLoc(rn), getReadInFunc(rn)


/* Vars Read/Write */
// Notes:
// - Can look up function name from previous query given getRoot() location
// from Variable v, AssignExpr wn, Read rn, Function wn_f
// where v.geta v.getAWrite() = wn and v.getARead() = rn and wn.getRoot().getLocation() != rn.getRoot().getLocation() and wn_f.getFuncDecl() = wn.getRoot()
// // select v, v.getScope(), getQualifiedNameOrEmptyVar(v), wn.getRoot().getLocation(), getWriteLoc(wn), rn, rn.getRoot().getLocation(), getReadLoc(rn)
// select v, getQualifiedNameOrEmptyVar(v), getLocationOrEmptyVar(v), wn, getWriteLoc(wn), getWrittenInFunc(wn, wn_f), rn, getReadLoc(rn), getReadInFunc(rn)
from Variable v, Expr wn, VarAccess rn
where v.getAnAssignedExpr() = wn and v.getAnAccess() = rn
select v, "", getLocationOrEmptyVar(v), wn, getWriteLoc(wn), getWrittenInFunc(wn), rn, getReadLoc(rn), getReadInFunc(rn)

// select v, getQualifiedNameOrEmptyVar(v), getLocationOrEmptyVar(v), wn, getWriteLoc(wn), getWrittenInFunc(wn, wn_f), rn, getReadLoc(rn), getReadInFunc(rn)


