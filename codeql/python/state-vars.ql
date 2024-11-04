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

// string getQualifiedNameOrEmptyVar(Variable v) {
//     exists(v.getQualifiedName()) and result = v.getQualifiedName()
//     or 
//     not exists(v.getQualifiedName()) and result = ""
// }

string getLocationOrEmptyVar(Variable v) {
    exists(v.getScope().getLocation()) and result = v.getScope().getLocation().getFile() + "#" + v.getScope().getLocation().getStartLine() + ":" + v.getScope().getLocation().getStartColumn()
    or 
    not exists(v.getScope().getLocation()) and result = ""
}

string getWriteLoc(Name w) {
    result = w.getLocation().getFile() + "#" + w.getLocation().getStartLine() + ":" + w.getLocation().getStartColumn()
}
string getReadLoc(NameNode w) {
    result = w.getLocation().getFile() + "#" + w.getLocation().getStartLine() + ":" + w.getLocation().getStartColumn()
}

// string getReadLoc(VariableRead r) {
//     result = r.getFile() + "#" + r.getLocation().getStartLine() + ":" + r.getLocation().getStartColumn()
// }

// string getReadInFunc(VariableRead r) {
//     exists(r.getEnclosingCallable()) and result = r.getEnclosingCallable().getName() + "," + r.getEnclosingCallable().getLocation().getFile() + "#" + r.getEnclosingCallable().getLocation().getStartLine()
// }

// string getWrittenInFunc(VariableWrite w) {
//     exists(w.getEnclosingCallable()) and result = w.getEnclosingCallable().getName() + "," + w.getEnclosingCallable().getLocation().getFile() + "#" + w.getEnclosingCallable().getLocation().getStartLine()
// }


/* Vars Read/Write */
// Notes:
// - Can look up function name from previous query given getRoot() location
// from Variable v, VariableWrite wn, VariableRead rn, Callable wn_f
// where v.getAWrite() = wn and v.getARead() = rn and wn.getRoot().getLocation() != rn.getRoot().getLocation() and wn_f.getFuncDecl() = wn.getRoot()
// // select v, v.getScope(), getQualifiedNameOrEmptyVar(v), wn.getRoot().getLocation(), getWriteLoc(wn), rn, rn.getRoot().getLocation(), getReadLoc(rn)
// select v, getQualifiedNameOrEmptyVar(v), getLocationOrEmptyVar(v), wn, getWriteLoc(wn), getWrittenInFunc(wn, wn_f), rn, getReadLoc(rn), getReadInFunc(rn)



predicate enclosingFunctionName(Name node, FunctionObject f) {
    f.getFunction().getAChildNode*() = node
}


string funcObjNameAndFilepath(FunctionObject fo) {
    result = funcNameAndFilepath(fo.getFunction())
}

string funcNameAndFilepath(Function f) {
    result = f.getName() + "," + f.getLocation().getFile() + "#" + f.getLocation().getStartLine() + ":" + f.getLocation().getStartColumn()
}




from Variable v, Name wn, NameNode rn, FunctionObject f_wn, FunctionObject f_rn
where 
    v.getAnAccess() = wn and 
    v.getAUse() = rn and 
    // enclosingFunction(rn, f_rn) and 
    enclosingFunctionName(wn, f_wn)
    // f_rn != f_wn 
// select v, v.getScope(), getQualifiedNameOrEmptyVar(v), wn.getRoot().getLocation(), getWriteLoc(wn), rn, rn.getRoot().getLocation(), getReadLoc(rn)
select  v.getId(), // 0. var_name
        "", // 1. var_qualified_name
        getLocationOrEmptyVar(v), // 2. definition_filepath_loc
        // wn, // 3. 
        // getWriteLoc(wn), // 4. writtenAt
        // funcObjNameAndFilepath(f_wn), // 5. writtenInFunc
        rn, // 6. 
        getReadLoc(rn), // 7. readAt
        // funcObjNameAndFilepath(f_rn), // 8. readInFunc
        ""

// var_name = getRowData(row, 0)
// var_qualified_name = getRowData(row, 1)
// definition_filepath_loc = getRowData(row, 2).replace("@", "#").split(":")[0]
// writtenAt = getRowData(row, 4)
// writtenInFunc = getRowData(row, 5).replace("@", "#")
// readAt = getRowData(row, 7).replace("@", "#")
// readInFunc = getRowData(row, 8)
    