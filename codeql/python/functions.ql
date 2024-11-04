/**
 * @name Empty block
 * @kind problem
 * @problem.severity warning
 * @id javascript/example/empty-block
 */

 import python
 import shared
 
 // how to handle decorators?
 
 
 /* ALL CODE PATHS */
 // Notes:
 // - .getBody() removes a lot of nodes, can we do this without it? (how do we get location?)
 from Function f
 // from DataFlow::FunctionNode fn
 // where exists(f.getBody().getLocation())
 // where getNameOrEmpty(f).regexpMatch(".*token.*")
 // where getNameOrEmpty(f) = "token = ... (token)"
 // where f.getFile().toString() = "~/Desktop/code4rena/vscode-codeql-starter/storefront/src/pages/StoreFront/StoreFront.tsx"
 // where getNameOrEmpty(f) = "map"
 select getNameOrEmpty(f), getLocationOrFileRoot(f), getLocationBodyOrFileRoot(f), ""
 
 