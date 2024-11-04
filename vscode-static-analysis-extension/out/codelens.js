'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticAnalysisCodeLensProvider = void 0;
/**
 * @author github.com/tintinweb
 * @license GPLv3
 *
 *
 * */
const vscode = require("vscode");
class StaticAnalysisCodeLensProvider {
    constructor(g_workspace, functions, getAuditCommentsLineOffset, getFileLines, sourceFilesCache) {
        this.functions = functions;
        this.getAuditCommentsLineOffset = getAuditCommentsLineOffset;
        this.getFileLines = getFileLines;
        this.sourceFilesCache = sourceFilesCache;
    }
    provideCodeLenses(document, token) {
        let lenses = [];
        let functionsToMap = this.functions.filter(f => { return f.filepath.toLowerCase().split("#")[0] === document.fileName.toLowerCase(); });
        for (let f of functionsToMap) {
            let offset = this.getAuditCommentsLineOffset(f.filepath, f.startLine);
            let range = new vscode.Range(f.startLine - 1 + offset, 0, f.startLine - 1 + offset, 0);
            lenses.push(new vscode.CodeLens(range, {
                command: 'static-analysis.navigateToFunction',
                title: 'funcSummary',
                arguments: [f]
            }));
            lenses.push(new vscode.CodeLens(range, {
                command: 'static-analysis.references',
                title: `referencesX (${f.called_at?.length || 0})`,
                arguments: [f]
            }));
            lenses.push(new vscode.CodeLens(range, {
                command: 'static-analysis.manuallyMapFunctionRelationship',
                title: '🪢',
                arguments: [f]
            }));
        }
        return lenses;
    }
}
exports.StaticAnalysisCodeLensProvider = StaticAnalysisCodeLensProvider;
//# sourceMappingURL=codelens.js.map