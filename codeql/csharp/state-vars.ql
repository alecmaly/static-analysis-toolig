/**
 * @name Empty block
 * @kind problem
 * @problem.severity warning
 * @id go/example/empty-block
 */



// run 
// codeql query run --database=~/Desktop/code4rena/vscode-codeql-starter/geth-codeql-database --output=file.bqrs ~/Desktop/code4rena/vscode-codeql-starter/codeql-custom-queries-go/all-paths.ql



import csharp

string getQualifiedNameOrEmptyVar(Variable v) {
    exists(v.getQualifiedName()) and result = v.getQualifiedName()
    or 
    not exists(v.getQualifiedName()) and result = ""
}

string getLocationOrEmptyVar(Variable v) {
    exists(v.getLocation()) and result = v.getFile() + "#" + v.getLocation().getStartLine() + ":" + v.getLocation().getStartColumn()
    or 
    not exists(v.getLocation()) and result = ""
}

string getWriteLoc(VariableWrite w) {
    result = w.getFile() + "#" + w.getLocation().getStartLine() + ":" + w.getLocation().getStartColumn()
}

string getReadLoc(VariableRead r) {
    result = r.getFile() + "#" + r.getLocation().getStartLine() + ":" + r.getLocation().getStartColumn()
}

string getReadInFunc(VariableRead r) {
    exists(r.getEnclosingCallable()) and result = r.getEnclosingCallable().getName() + "," + r.getEnclosingCallable().getLocation().getFile() + "#" + r.getEnclosingCallable().getLocation().getStartLine()
}

string getWrittenInFunc(VariableWrite w) {
    exists(w.getEnclosingCallable()) and result = w.getEnclosingCallable().getName() + "," + w.getEnclosingCallable().getLocation().getFile() + "#" + w.getEnclosingCallable().getLocation().getStartLine()
}


/* Vars Read/Write */
// Notes:
// - Can look up function name from previous query given getRoot() location
// from Variable v, VariableWrite wn, VariableRead rn, Callable wn_f
// where v.getAWrite() = wn and v.getARead() = rn and wn.getRoot().getLocation() != rn.getRoot().getLocation() and wn_f.getFuncDecl() = wn.getRoot()
// // select v, v.getScope(), getQualifiedNameOrEmptyVar(v), wn.getRoot().getLocation(), getWriteLoc(wn), rn, rn.getRoot().getLocation(), getReadLoc(rn)
// select v, getQualifiedNameOrEmptyVar(v), getLocationOrEmptyVar(v), wn, getWriteLoc(wn), getWrittenInFunc(wn, wn_f), rn, getReadLoc(rn), getReadInFunc(rn)


from Variable v, VariableWrite wn, VariableRead rn //, Callable wn_f
where v = wn.getTarget() and v = rn.getTarget() and wn.getLocation() != rn.getLocation() // and wn_f = wn.getTarget().get
// select v, v.getScope(), getQualifiedNameOrEmptyVar(v), wn.getRoot().getLocation(), getWriteLoc(wn), rn, rn.getRoot().getLocation(), getReadLoc(rn)
select  v.getName(), // 0. var_name
        getQualifiedNameOrEmptyVar(v), // 1. var_qualified_name
        getLocationOrEmptyVar(v), // 2. definition_filepath_loc
        wn, // 3. 
        getWriteLoc(wn), // 4. writtenAt
        getWrittenInFunc(wn), // 5. writtenInFunc
        rn, // 6. 
        getReadLoc(rn), // 7. readAt
        getReadInFunc(rn) // 8. readInFunc

// var_name = getRowData(row, 0)
// var_qualified_name = getRowData(row, 1)
// definition_filepath_loc = getRowData(row, 2).replace("@", "#").split(":")[0]
// writtenAt = getRowData(row, 4)
// writtenInFunc = getRowData(row, 5).replace("@", "#")
// readAt = getRowData(row, 7).replace("@", "#")
// readInFunc = getRowData(row, 8)
    