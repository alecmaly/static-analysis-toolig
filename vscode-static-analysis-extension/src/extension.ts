import * as vscode from 'vscode';
import * as path from "path";
import * as fs from "fs";
import * as fsp from "fs/promises";


import {
	Settings,
	getCallstacksGraphParams, mergeCallstacksIntoGraphParams,
	SearchTemplate,
	ScopeSummary, FunctionResult, FunctionRelationship, FunctionIdObj, FilteredFunctionState,
	CallGraphHashmap, CallstacksEdgeColorsHashmap, FiletLineColumnOffsetHashmap, 
	CallGraph, graphGroup, graphNode, graphEdge, SourceFilesHashmap, ScopeDefinitionsHashmap, RelatedCallstacksHashmap, funcStateVarReadWrittenMappingHashmap, ScopeDefinition,
	DecorationRange, DecorationsData
} from './types';


import { StaticAnalysisCodeLensProvider } from './codelens';
import { LookupAddress, lookup, lookupService } from 'dns';
import { start } from 'repl';
// import { lookup } from 'dns';
// import { start } from 'repl';


export async function activate(context: vscode.ExtensionContext) {
	const provider = new StaticAnalysisViewProvider(context.extensionUri);
	vscode.window.registerWebviewViewProvider('static-analysis-view', provider, { webviewOptions: { retainContextWhenHidden: true } })

	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    // Register event listeners
    watcher.onDidChange((uri) => {
        vscode.window.showInformationMessage(`File changed: ${uri.fsPath}`);
        provider.sourceFilesCache[uri.fsPath] = undefined
    });
	context.subscriptions.push(watcher);


	// context.subscriptions.push(
	// 	vscode.commands.registerCommand('staticAnalysis.load', () => {
	// 		// CatCodingPanel.createOrShow(context.extensionUri);
	// 	})
	// );

	context.subscriptions.push(
		vscode.commands.registerCommand('static-analysis.navigateToFunction', (f: FunctionResult) => {
			provider.showFunction(f.id)
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('static-analysis.references', (f: FunctionResult) => {
			provider.showReferences(f)
		})
	);

	let last_manual_mapped_func: string | null = null
	context.subscriptions.push(
		vscode.commands.registerCommand('static-analysis.manuallyMapFunctionRelationship', (f: FunctionResult) => {
			provider.manuallyMapFunctionRelationship(f.id)
		})
	);
	

	await provider.loadFunctionsAndScopeInfo()
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			// ["solidity", "python", "c", "cpp", "javascript", "typescript", "java", "go"],
			{ scheme: 'file' },
			// SHOULD ALSO REGISTER OTHER LANGUGES CODELENSES
			new StaticAnalysisCodeLensProvider({ pattern: '**/*' }, provider.functionDefinitions.filter(f => { return !f.is_inherited }), provider.getAuditCommentsLineOffset, provider.getFileLines, provider.sourceFilesCache)
		)
	);


	context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('static-analysis.enableUnsafeEval')) {
                // Reload the webview if the specific setting has changed
				provider.reloadWebview()
            }

			if (event.affectsConfiguration('static-analysis.enableTextHighlights')) {
				configureTextHighlights(provider)
			}
        })
    );


	configureTextHighlights(provider)
}

function configureTextHighlights(provider: StaticAnalysisViewProvider) {
	const activeDecorations: Map<vscode.TextEditor, vscode.TextEditorDecorationType[]> = new Map();

	if (vscode.workspace.workspaceFolders) {
		let decorationsFilePath = path.join(vscode.workspace.workspaceFolders[0].uri.path, ".vscode", "ext-static-analysis", "decorations.json") // Update this path as needed
		
		if (!fs.existsSync(decorationsFilePath)) {
			console.error("Decorations file does not exist:", decorationsFilePath);
			return;
		}

		function parseStyle(style: string): vscode.DecorationRenderOptions {
			const options: vscode.DecorationRenderOptions = {};
	
			style.split(";").forEach((rule) => {
				const [key, value] = rule.split(":").map((part) => part.trim());
				if (key && value) {
					switch (key) {
						case "border":
							options.border = value;
							break;
						case "background-color":
							options.backgroundColor = value;
							break;
						case "color":
							options.color = value;
							break;
						case "text-decoration":
							options.textDecoration = value;
							break;
						case "opacity":
							options.opacity = value;
						// Add more cases as needed
					}
				}
			});
	
			return options;
		}
	
		function clearDecorations(editor: vscode.TextEditor) {
			const decorations = activeDecorations.get(editor);
			if (decorations) {
				decorations.forEach((type) => {
					editor.setDecorations(type, []); // Clear the decorations
				});
				activeDecorations.delete(editor); // Remove from tracking
			}
		}

		/**
		 * Apply decorations to the provided editor based on the decoration data.
		 */
		function applyDecorations(editor: vscode.TextEditor, decorations: { type: vscode.TextEditorDecorationType, range: DecorationRange }[]) {
			// Group ranges by decoration type
			const decorationRanges: Map<vscode.TextEditorDecorationType, vscode.Range[]> = new Map();
		
			decorations.forEach(({ type, range }) => {
				let offset = provider.getAuditCommentsLineOffset(editor.document.uri.fsPath, range.line + 1)
				
				const decorationRange = new vscode.Range(
					new vscode.Position(range.line + offset - 1, range.start - 1),
					new vscode.Position(range.line + offset - 1, range.end - 1)
				);
		
				if (!decorationRanges.has(type)) {
					decorationRanges.set(type, []);
				}
		
				decorationRanges.get(type)?.push(decorationRange);
			});
		
			// Apply all ranges for each decoration type
			const appliedTypes: vscode.TextEditorDecorationType[] = [];
			decorationRanges.forEach((ranges, type) => {
				editor.setDecorations(type, ranges);
				if (type && !appliedTypes.includes(type)) {
					appliedTypes.push(type);
				}
			});

			activeDecorations.set(editor, appliedTypes);
		}
	
		/**
		 * Load decorations from the JSON file and apply them to all open editors.
		 */
		async function loadDecorations(filePath: string) {
			// if static-analysis.enableTextHighlights is enabled
			const decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
			try {
				const rawData = await fs.readFileSync(filePath, 'utf-8');
				let decorationsJson: DecorationsData = JSON.parse(rawData);

				if (vscode.workspace.workspaceFolders) {
					// make filepaths absolute if they are relative
					let workspaceFolder = vscode.workspace.workspaceFolders[0].uri.path
					for (let [filePath, decorations] of Object.entries(decorationsJson)) {
						if (!filePath.startsWith(workspaceFolder)) {
							const absolutePath = path.join(workspaceFolder, filePath)
							decorationsJson[absolutePath] = decorations
							delete decorationsJson[filePath]
						}
					}
				}

	
				vscode.window.visibleTextEditors.forEach((editor) => {
					clearDecorations(editor); // Clear existing decorations
					const filePath = editor.document.fileName;
					const decorationsForFile = decorationsJson[filePath];
	
					if (decorationsForFile) {
						const decorations: { type: vscode.TextEditorDecorationType, range: DecorationRange }[] = [];
	
						for (const [style, ranges] of Object.entries(decorationsForFile)) {
							let decorationType = decorationTypes.get(style);
							if (!decorationType) {
								const decorationOptions = parseStyle(style);
								decorationType = vscode.window.createTextEditorDecorationType(decorationOptions);
								decorationTypes.set(style, decorationType);
							}
	
							ranges.forEach((range) => {
								if (decorationType) {
									decorations.push({ type: decorationType, range: range });
								}
							});

						}
						
						if (vscode.workspace.getConfiguration("static-analysis").get("enableTextHighlights")) {
							applyDecorations(editor, decorations);
						}
					}
				});
			} catch (error) {
				console.error("Failed to load decorations:", error);
			}
		}
	
		/**
		 * Watch for changes in the decorations JSON file.
		 */
		fs.watch(decorationsFilePath, { persistent: true }, (eventType) => {
			if (eventType === 'change') {
				loadDecorations(decorationsFilePath);
			}
		});
	
		/**
		 * Handle newly opened or active editors.
		 */
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (editor) {
				loadDecorations(decorationsFilePath);
			}
		});
	
		// Load decorations initially
		loadDecorations(decorationsFilePath);
	}
}


function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
	return {
		// Enable javascript in the webview
		enableScripts: true,

		// enable vscode.open (allow opening files)
		enableCommandUris: ['vscode.open'],

		// And restrict the webview to only loading content from our extension's `media` directory.
		localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
	};
}



// creates WebViewProvider
class StaticAnalysisViewProvider implements vscode.WebviewViewProvider {
	// example code from: https://github.com/microsoft/vscode-extension-samples/blob/main/webview-view-sample/src/extension.ts
	public static readonly viewType = 'staticanalysis.view';

	private DATA_PATH = path.join(".vscode", "ext-static-analysis")

	private _view?: vscode.WebviewView;
	public helpHTML: string = '';
	public lastManuallyMappedFunction: string | null = null
	public scopeSummaries: ScopeSummary[] = [];
	public functionDefinitions: FunctionResult[] = [];
	public functionDefinitionsMap: Map<string, FunctionResult> = new Map();
	public functionManualRelationship: FunctionRelationship[] = [];  // not making a hashmap because this list should never get too large
	
	private defaultFileLineColumnOffset: FiletLineColumnOffsetHashmap = {}; // used to find column when opening function, primarily when id does not contain column number

	private scopeDefinitions: ScopeDefinitionsHashmap = {}  // can also be used to enumerate scopes themselves
	private callstacks?: string[][];
	private callstacksHtml?: string[];
	private func_pair_edge_colors: CallstacksEdgeColorsHashmap = {}
	private decoratorUnicode: string = "";
	private functionSortOption: "Alpha. + Line #" | "Alpha. + SLOC" | "SLOC" | "Alpha. + # Callstacks" | "# Callstacks" = "Alpha. + Line #"

	private searchTemplates: SearchTemplate[] = []

	private funcStateVarReadWrittenMapping: funcStateVarReadWrittenMappingHashmap = {};
	private scopeGraphs: CallGraphHashmap = {};
	private inheritanceGraph: CallGraph = { nodes: [], edges: [] };
	private hasInheritedFunctions: boolean = false;
	private relatedCallstacksHash: RelatedCallstacksHashmap = {};
	// NOTE: excludeRelatedCallstacks is case sensitive, comparing case insensitive would not be accurate for case sensitive languages like JavaScript
	// however, may want to make case insensitive in the future because we are looking for related functions, not necessarily exact matches (case sensitivity may not be important in most cases)
	private settings: Settings = { excludedRelatedCallstacks: ["slitherConstructorConstantVariables", "constructor", "initialize", "initializer", "init", "__init__", "run", "main", "__main__"], manualFunctionRelationshipPath: "", showAllFunctions: false };

	private callstacksGraphCache: CallGraphHashmap = {}; // should use a data structure to separate: groups | nodes | edges ?
	public sourceFilesCache: SourceFilesHashmap = {}

	private currentFilteredFunctionState: FilteredFunctionState = { regexPattern: "", excludeRegexPattern: "", filteredFunctionIds: [], hideReviewedState: "Hide Reviewed Except In Scope" }; // sets default

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) {
	}

	private getFirstWorkspaceFolderPath(): string | null {
		if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
			return vscode.workspace.workspaceFolders[0].uri.fsPath;
		} else {
			vscode.window.showErrorMessage('No workspace folder found.');
			return null;
		}
	}

	private async appendAndCreateFolder(folderName: string) {
		const workspaceFolderPath: string | null = this.getFirstWorkspaceFolderPath();
		if (!workspaceFolderPath) return;

		const newFolderPath = path.join(workspaceFolderPath, folderName);
		if (!fs.existsSync(newFolderPath)) {
			fs.promises.mkdir(newFolderPath, { recursive: true });
			vscode.window.showInformationMessage(`Folder created: ${newFolderPath}`);
		} else {
			vscode.window.showInformationMessage(`Folder already exists: ${newFolderPath}`);
		}

		return newFolderPath;
	}


	private async saveFile(content: string) {
		const fspath = await this.appendAndCreateFolder(`${path.join(this.DATA_PATH, 'graphs')}`) || ""

		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length == 0) {
			return false;
		}

		vscode.window.showSaveDialog({ defaultUri: vscode.Uri.parse(fspath) }).then(fileUri => {
			if (fileUri) {
				// Write the content to the selected file path
				fs.writeFileSync(fileUri.fsPath, content, 'utf8');
				// Optionally handle after-save actions
			}
		});
	}

	private async loadFile(): Promise<{ filename: string, content: string }> {
		const filepath = await this.appendAndCreateFolder(`${path.join(this.DATA_PATH, 'graphs')}`) || "";

		try {
			const fileUris = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.parse(filepath) });
			if (fileUris && fileUris[0]) {
				const filePath = fileUris[0].fsPath;
				const content = await fsp.readFile(filePath, 'utf8');
				return { filename: path.basename(filePath), content };
			} else {
				vscode.window.showInformationMessage("No file selected.");
				return { filename: "", content: "" };
			}
		} catch (error) {
			console.error("Error reading file:", error);
			vscode.window.showErrorMessage("Error reading file");
			return { filename: "", content: "" };
		}
	}

	private async saveFunctionInfo(): Promise<boolean> {
		// export async function readResults(print : boolean = false) : Promise<boolean> {
		// Verify there is a workspace folder open to run analysis on.
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length == 0) {
			return false;
		}

		// Loop for every workspace to read results from.
		for (let i = 0; i < vscode.workspace.workspaceFolders.length; i++) {

			// Obtain our workspace results path.
			const workspacePath = vscode.workspace.workspaceFolders[i].uri.fsPath;

			// If the file exists, we read its contents into memory.
			const resultsPath = path.join(workspacePath, this.DATA_PATH, 'functions_html.json');
			try {
				fs.writeFileSync(resultsPath, JSON.stringify(this.functionDefinitions));
			} catch {
				return false;
			}

			const callstacksPath = path.join(workspacePath, this.DATA_PATH, 'callstacks.json');
			try {
				fs.writeFileSync(callstacksPath, JSON.stringify(this.callstacks));
			} catch {
				return false;
			}

			return true;
		}

		return false;
	}

	
	private decodeBase64Unicode(str: string) {
		const text = atob(str);
		const bytes = new Uint8Array(text.length);
		for (let i = 0; i < text.length; i++) {
			bytes[i] = text.charCodeAt(i);
		}
		const decoder = new TextDecoder('utf-8');
		return decoder.decode(bytes);
	}
	

	private escapeForHtmlAttribute(html: string) {
		// Quick check to avoid unnecessary processing
		if (!/[&<>"'\s]/.test(html)) {
			return html;
		}
		return html
			.replace(/[&<>"'\s]/g, function(match) {
				switch (match) {
					case '&': return "&amp;";
					case '<': return "&lt;";
					case '>': return "&gt;";
					case '"': return "&quot;";
					case "'": return "&#39;";
					case ' ': return "&nbsp;"; // Including space handling
					default: return match; // Default case should not be hit due to the regex
				}
			});
	}
	

	private isIconChar(c: string) {
		if (c.length === 0) return false;

		const code = c.codePointAt(0);

		if (!code) return false;
		return (
			(code >= 0x2600 && code <= 0x26FF) ||  // Miscellaneous Symbols
			(code >= 0x2700 && code <= 0x27BF) ||  // Dingbats
			(code >= 0x1F600 && code <= 0x1F64F) ||  // Emoticons (Emoji)
			(code >= 0x1F300 && code <= 0x1F5FF) ||  // Miscellaneous Symbols and Pictographs
			(code >= 0x1F680 && code <= 0x1F6FF) ||  // Transport and Map Symbols
			(code >= 0x1F780 && code <= 0x1F7FF) ||  // Geometric Shapes Extended
			(code >= 0x25A0 && code <= 0x25FF) ||  // Geometric Shapes
			(code >= 0x2190 && code <= 0x21FF) ||  // Arrows
			/* additional icons */
			(code >= 0x2200 && code <= 0x22FF) ||  // Mathematical Operators
			(code >= 0x2300 && code <= 0x23FF) ||  // Miscellaneous Technical
			(code >= 0x2460 && code <= 0x24FF) ||  // Enclosed Alphanumerics
			(code >= 0x2500 && code <= 0x257F) ||  // Box Drawing
			(code >= 0x2580 && code <= 0x259F) ||  // Block Elements
			(code >= 0x27F0 && code <= 0x27FF) ||  // Supplemental Arrows-A
			(code >= 0x2900 && code <= 0x297F) ||  // Supplemental Arrows-B
			(code >= 0x1F800 && code <= 0x1F8FF) ||  // Supplemental Arrows-C
			(code >= 0x1F900 && code <= 0x1F9FF) ||  // Supplemental Pictographs
			(code >= 0x1F650 && code <= 0x1F67F) ||  // Emoticons Extended
			(code >= 0x1F650 && code <= 0x1F67F) ||  // Ornamental Dingbats (Note: This is the same as Emoticons Extended)
			(code >= 0x10190 && code <= 0x101CF) ||  // Ancient Symbols
			(code >= 0x1F000 && code <= 0x1F02F) ||  // Mahjong Tiles
			(code >= 0x1F030 && code <= 0x1F09F) ||  // Domino Tiles
			(code >= 0x1F0A0 && code <= 0x1F0FF)     // Playing Cards
		);
	}

	public buildDecoratorUnicode() {
		// this.functionDefinitions.map(ele => { return ele.decorator })
		const uniqueChars = new Set();
		for (let str of this.functionDefinitions.map(ele => { return ele.decorator })) {
			for (let char of str) {
				if (this.isIconChar(char))
					uniqueChars.add(char);
			}
		}
		// return [...uniqueChars].join("")
		this.decoratorUnicode = [...uniqueChars].join("")
	}

	// TODO: finish this function
	// NOTE: if too computationally expensive for large codebases over long sessions, consider marking Callstacks/Graphs as out of sync and thus rebuild cache later (or just remove them from cache to be rebuilt upon next load)... would need to remove scope caches as well
	public updateCache() {
		// updates HTML callstacks + graph caches (typically for updated decorators)

	}

	// TODO: update to only build upon viewing a function + cache... will have to clear cache when decorator changes (i.e.: when marking/unmarking reviewed || when decorator is updated)
	public async buildCallstacks(): Promise<boolean> {
		this.buildDecoratorUnicode()
		if (this._view)
			this._view.webview.postMessage({ command: "setDecoratorUnicode", decorator: this.decoratorUnicode });

		// Convert the array to a Map for faster lookups
		// this.callstacksHtml = this.callstacks?.map(callstack => {
		// 	let functionChainWithLines: string[] = []

		// 	let html = ""
		// 	html += callstack.map(ele => {
		// 		let f_calledIn = ""
		// 		if (Array.isArray(ele)) {
		// 			// if callstack is an array of arrays [[f_calledIn, calledAt], [f_calledIn2, calledAt2], ...]
		// 			// e.g.: built from CodeQL
		// 			f_calledIn = ele[0]
		// 			let calledAt = ele[1]
		// 		} else {
		// 			// callstack is just a callstack of f_calledIn [f_calledIn, f_calledIn2, ...]
		// 			// e.g.: built from custom Slither detector
		// 			f_calledIn = ele
		// 		}

		// 		let lookup_func = this.functionDefinitionsMap.get(f_calledIn);
		// 		if (lookup_func) {
		// 			if (lookup_func.startLine && lookup_func.endLine) {
		// 				// functionChainWithLines.push(`${lookup_func.filepath.split("#")[0]}#${lookup_func.startLine}-${lookup_func.endLine}`)
		// 				let hashIndex = lookup_func.filepath.indexOf("#");
		// 				let filepath = hashIndex !== -1 ? lookup_func.filepath.substring(0, hashIndex) : lookup_func.filepath;
		// 				functionChainWithLines.push(`${filepath}#${lookup_func.startLine}-${lookup_func.endLine}`);
		// 			}
		// 			return this.getFunctionDescriptiveStr(lookup_func, true)
		// 		} else {
		// 			let f_calledIn_parts = f_calledIn.split(",");
		// 			let f_calledIn_link = f_calledIn_parts.slice(-1)[0];
		// 			let f_calledIn_text = f_calledIn_parts.slice(0, -1).join(",");
		// 			return `<a href='file://${f_calledIn_link}'>${f_calledIn_text}</a> | ?`
		// 		}
		// 	}).join(" > ")
		// 	html += "</li>"

		// 	html = `<li class='callstack'><span class='export-callstack' func_chain='${functionChainWithLines.join(',')}'>🏳️‍🌈</span> ${html}`;
		// 	// let x = `<li class='callstack'>${callstack.map(f => { return  })}</li>`

		// 	return html
		// })

		return true
	}

	private getRelatedCallstacks(f: FunctionResult): number[] {
		if (this.relatedCallstacksHash[f.id]) {
			return this.relatedCallstacksHash[f.id]
		}

		let known_callstacks: number[] = []
		if (f.entrypoint_callstacks) known_callstacks = known_callstacks.concat(f.entrypoint_callstacks)
		if (f.exit_callstacks) known_callstacks = known_callstacks.concat(f.exit_callstacks)
		if (f.other_callstacks) known_callstacks = known_callstacks.concat(f.other_callstacks)

		let related_callstacks_ixs: number[] = []
		this.callstacks?.forEach((callstack, i) => {
			// skip if we know of these callstacks
			// compare HTML because may have duplicate callstacks with different indexes (e.x.: how Solidity data is gathered across multiple detectors)
			// if (this.getCallstacksHTML(known_callstacks).includes(this.getCallstacksHTML([i]))) {
			if (known_callstacks.includes(i)) {
				return
			}

			for (let ele of callstack) {
				let func_id = this.getFunctionId(ele)
				let func_name = func_id.split(",")[0]

				// continue evaluating callstack for other interesting functions
				if (this.settings?.excludedRelatedCallstacks.includes(func_name)) {	
					continue
				}
				
				if (func_id.startsWith(`${f.functionName},`)) {
					related_callstacks_ixs.push(i)
					return
				}
			}

		})

		this.relatedCallstacksHash[f.id] = related_callstacks_ixs
		return related_callstacks_ixs
	}

	private getInheritanceGraph(scope_id: string) {
		if (scope_id === 'all')
			return this.inheritanceGraph

		// get this.inheritanceGraph and filter by scope_id.split(",")[0] (scope name)
		let scope_name = scope_id.split(",")[0]
		let graph: CallGraph = { nodes: [], edges: [] }
		// get all edges first, collect list of nodes from edges, only keep seen nodes
		let seen_nodes: string[] = [scope_name]
		let nodes_before, nodes_after
		do {
			nodes_before = seen_nodes.length
			for (let e of this.inheritanceGraph.edges) {
				if (seen_nodes.includes(e.data.source) && !seen_nodes.includes(e.data.target)) {
					seen_nodes.push(e.data.target)
				}
				if (seen_nodes.includes(e.data.target) && !seen_nodes.includes(e.data.source)) {
					seen_nodes.push(e.data.source)
				}
			}
			nodes_after = seen_nodes.length
		} while (nodes_before != nodes_after)

		let new_nodes = this.inheritanceGraph.nodes.filter(n => { return seen_nodes.includes(n.data.id) })
		let new_edges = this.inheritanceGraph.edges.filter(e => { return seen_nodes.includes(e.data.source) || seen_nodes.includes(e.data.target) })
		
		return {
			nodes: new_nodes,
			edges: new_edges
		}
	}


	private getScopeGraph(scope_id: string, return_scopes_only: boolean = false, include_inherited_functions: boolean = true, include_related_function_callstacks: boolean = false) {
		let cache__key = scope_id ===  'all~' ? 'all~' : Array.from(arguments).reduce((acc, arg) => { return acc + "~" + arg })
		
		if (!this.scopeGraphs[cache__key]) {
			let scope = this.scopeSummaries.find(s => { return s.id === scope_id })
			let inherited_scopes_recursive = this.scopeDefinitions[scope_id]?.scope_summary?.inherits_recursive?.concat(scope_id) || [scope_id]

			// consider filtering 'all' by `f.decorator.includes('🎯')` to reduce processing and make graph smaller
			let functions_to_chart: FunctionResult[] = scope_id.startsWith('all~') ? this.functionDefinitions
																						.filter(f => { return (!('is_inherited' in f) || 'is_inherited' in f  && f.is_inherited === false) }) : this.functionDefinitions
																						.filter(f => {
																							if (include_inherited_functions) {
																								// get all recursive inherited scopes
																								return inherited_scopes_recursive.includes(f.scope_id) // get all functions in scope    // & !is_shadowed
																							} else {
																								// include functions if `is_inherited` is not defined, assume it is not inherited
																								return f.scope_id === scope_id && (!('is_inherited' in f) || 'is_inherited' in f  && f.is_inherited === false)
																							}
																						}) || []
																							

			if (scope_id.startsWith("all~")) {
				let search_term = scope_id.split("~")[1]
				functions_to_chart = functions_to_chart.filter(f => { 
					let regex = new RegExp(escapeRegExp(search_term), 'gi');  
					return f.functionName.includes(search_term) || this.getFileSource(f.filepath.split("#")[0], f.startLine, f.endLine).match(regex) 
				})
			}


			// functions_to_chart = functions_to_chart.slice(0, 5)
			let mergeCallstacksIntoGraphParams: mergeCallstacksIntoGraphParams = {
				graph: { nodes: [], edges: [] },
				callstacksGraphParams: {
					callstacks: [],
					return_scopes_only: return_scopes_only,
					root_scope_id: scope_id,
					append_related_function_html: include_related_function_callstacks
				},
				override_color: ""
			}

			for (let f of functions_to_chart) {
				// this.mergeCallstacksIntoGraph(f.entrypoint_callstacks, graph, seen_nodes, seen_edges, return_scopes_only, f.scope_id)
				mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = f.entrypoint_callstacks || []
				this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)
				mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = f.exit_callstacks || []
				this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)
				mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = f.other_callstacks || []
				this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)
			}

			// adding related callstacks (doing after adding all nodes to graph to prevent duplicate nodes & color related nodes correctly)
			if (include_related_function_callstacks) {
				for (let f of functions_to_chart) {
					// first merge graph
					let related_callstack_indexes = this.getRelatedCallstacks(f)
					mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = related_callstack_indexes
					mergeCallstacksIntoGraphParams.override_color = 'lightgreen'
					this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)
				}

				// then highlight related functions
				for (let f of functions_to_chart) { 
					for (let node of mergeCallstacksIntoGraphParams.graph.nodes) {
						if (node.data.id.startsWith(f.functionName) && node.data.id !== f.id) {
							node.data.backgroundColor = 'greenyellow'
						}
					}
				}
			}
			let graph = mergeCallstacksIntoGraphParams.graph

			// get all functions in scope not already retrieved
			// NOTE: Consider second state param to prevent this (declutter functions that aren't in any callstacks)
			if (!return_scopes_only) {
				let mapped_functions = graph.nodes.map(node => { return node.data.id })
				let missing_functions = functions_to_chart.filter(f => { return !mapped_functions.includes(f.id) })

				let seen_parent_ids: string[] = graph.nodes.filter(n => { return 'isParent' in n.data && n.data.isParent === true }).map(n => { return n.data.id })
				for (let f of missing_functions) {
					let source_code = this.getFileSource(f.filepath.split("#")[0], f.startLine, f.endLine)
					graph.nodes.push({ classes: 'l1', data: { id: f.id, parent: f.scope_id, title: this.getFunctionDescriptiveStr(f, true, true, true), content: source_code } })
					
					// push parent if not exists
					if (!seen_parent_ids.includes(f.scope_id)) {
						// TODO: 
						// Find scopes where inherited scope is used, color inherited scope (update where `isParent: true`)
						// let isInRecursive = this.scopeSummaries.find(s => { return s.id === f.scope_id }).inherits_recursive.includes()
						// explicit overrides from imported scopeSummary (json filie) will be applied with priority
						let lookup_scope = this.scopeSummaries.find(s => { return s.id === f?.scope_id })
						let backgroundColor = ""
						if (lookup_scope?.backgroundColor && lookup_scope?.backgroundColor !== "") {
							backgroundColor = lookup_scope?.backgroundColor
						} else {
							backgroundColor = scope?.inherits_recursive?.includes(f.scope_id) ? "red" : ""
							backgroundColor = scope?.inherits_from_recursive?.includes(f.scope_id) ? "purple" : ""
							backgroundColor = scope_id === f.scope_id ? "blue" : backgroundColor
						}

						graph.nodes.push({ data: { id: f.scope_id, label: f.scope_id.split(",")[0], isParent: true, backgroundColor: backgroundColor } })
						seen_parent_ids.push(f.scope_id)
					}
				}
			}

			// append related functions links w/ strikethrough
			graph.nodes = this.updateGraphRelatedFunctionHTMLLinks(graph.nodes)

			this.scopeGraphs[cache__key] = graph
		}
		return this.scopeGraphs[cache__key]
	}



	// private mergeCallstacksIntoGraph(callstacks: number[] | undefined, graph: CallGraph, seen_nodes: string[] = [], seen_edges: string[] = [], return_scopes_only = false, root_scope_id: string = "", override_color: string = "", append_related_function_html: boolean = false) {
	private mergeCallstacksIntoGraph({graph, seen_nodes = [], seen_edges = [], callstacksGraphParams, override_color = ""}: mergeCallstacksIntoGraphParams) {
		if (callstacksGraphParams.callstacks && callstacksGraphParams.callstacks.length > 0) {
			let graph_to_merge = this.getCallstacksGraph(callstacksGraphParams)
			for (let n of graph_to_merge.nodes) {
				let id = JSON.stringify(n)
				if (!seen_nodes.includes(id)) {
					if (override_color)
						n.data.backgroundColor = n.data.backgroundColor || override_color
					graph.nodes.push(n)
					seen_nodes.push(id)
				}
			}
			for (let e of graph_to_merge.edges) {
				let id = JSON.stringify(e)
				if (!seen_edges.includes(id)) {
					graph.edges.push(e)
					seen_edges.push(id)
				}
			}
		}
	}

	public async loadFunctionsAndScopeInfo(): Promise<boolean> {
		// export async function readResults(print : boolean = false) : Promise<boolean> {
		// Verify there is a workspace folder open to run analysis on.
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length == 0) {
			return false;
		}

		// Loop for every workspace to read results from.
		for (let i = 0; i < vscode.workspace.workspaceFolders.length; i++) {

			// Obtain our workspace results path.
			const workspacePath = vscode.workspace.workspaceFolders[i].uri.fsPath;

			// If the file exists, we read its contents into memory.
			this.helpHTML = `<span style='font-size: 150%'>Static Analysis Context tooling by <a target='_blank' href='https://alecmaly.com'>alecmaly.com</a></span><br><br>`
			const helpFilePath = path.join(workspacePath, this.DATA_PATH, 'help.html');
			if (fs.existsSync(helpFilePath)) {
				// Read our cached results
				this.helpHTML += fs.readFileSync(helpFilePath, 'utf8');

				if (!this.helpHTML) return false;
			} 

			// If the file exists, we read its contents into memory.
			const scopeSummariesPath = path.join(workspacePath, this.DATA_PATH, 'scope_summaries_html.json');
			if (fs.existsSync(scopeSummariesPath)) {
				// Read our cached results
				this.scopeSummaries = JSON.parse(fs.readFileSync(scopeSummariesPath, 'utf8'));

				if (!this.scopeSummaries) return false;
			}


			// settings
			const settingsFilepath = path.join(workspacePath, this.DATA_PATH, 'vscode_static_analsysis_settings.json');
			if (fs.existsSync(settingsFilepath)) {
				let updateSettingsFile = false
				// Read our cached results
				let settings_to_import = JSON.parse(fs.readFileSync(settingsFilepath, 'utf8'))

				if (!settings_to_import.excludedRelatedCallstacks) {
					// file exists but excludedRelatedCallstacks is empty, init with defaults
					settings_to_import.excludedRelatedCallstacks = this.settings.excludedRelatedCallstacks
					updateSettingsFile = true
				}
				this.settings = settings_to_import
				if (updateSettingsFile) {
					fs.writeFileSync(settingsFilepath, JSON.stringify(this.settings))
				}
			} else {
				fs.writeFileSync(settingsFilepath, JSON.stringify(this.settings))
			}
		

			// If the file exists, we read its contents into memory.
			const manualFunctionRelationshipPath = path.join(workspacePath, this.DATA_PATH, 'manual_function_relationship_map.json');
			this.settings.manualFunctionRelationshipPath = manualFunctionRelationshipPath
			if (fs.existsSync(manualFunctionRelationshipPath)) {
				// Read our cached results
				this.functionManualRelationship = JSON.parse(fs.readFileSync(manualFunctionRelationshipPath, 'utf8'))

				if (!this.functionManualRelationship) return false;
			}

			// If the file exists, we read its contents into memory.
			const resultsPath = path.join(workspacePath, this.DATA_PATH, 'functions_html.json');
			if (fs.existsSync(resultsPath)) {
				// Read our cached results
				this.functionDefinitions = JSON.parse(fs.readFileSync(resultsPath, 'utf8'))

				this.hasInheritedFunctions = this.functionDefinitions.filter(f => { return f.is_inherited === true }).length > 0
				this.functionDefinitionsMap = new Map(this.functionDefinitions.filter(f => { return this.hasInheritedFunctions ? f.is_inherited === false : true }).map(item => [item.id, item]));


				this.functionDefinitions.forEach(f => {
					// Add a new property that is the sum of numCallstacks1 and numCallstacks2
					f.callstackCount = (f.entrypoint_callstacks?.length || 0) + (f.exit_callstacks?.length || 0) + (f.other_callstacks?.length || 0)

					if (!this.settings.excludedRelatedCallstacks.includes(f.functionName)) {
						let realtedFunctions = Array.from(new Set(this.functionDefinitions
							.filter(f2 => { return f.functionName === f2.functionName })  // && (this.hasInheritedFunctions ? f.is_inherited === false : true)   // NOTE: may want to include inherited functions in related functions
							.map(f2 => { return f2.id })))
							
							
						f.relatedFunctions = realtedFunctions
					}

					let scope_summary = this.scopeSummaries.find(s => { return s.id === f.scope_id })
					if (scope_summary) {
						let inheritance_str = `(#inherits ${scope_summary?.inherits_recursive?.length || 0} in<>out ${scope_summary?.inherits_from_recursive?.length || 0})`
						f.inheritance_str = inheritance_str
					}

					this.defaultFileLineColumnOffset[`${f.filepath.split(':')[0]}`] = f.startCol || 0
				});

				if (!this.functionDefinitions) return false;
			}

			// load inheritance graph
			const inheritanceGraphPath = path.join(workspacePath, this.DATA_PATH, 'graphs', 'inheritance_graph.json');
			if (fs.existsSync(inheritanceGraphPath)) {
				// Read our cached results
				this.inheritanceGraph = JSON.parse(fs.readFileSync(inheritanceGraphPath, 'utf8'))

				if (!this.inheritanceGraph) return false;
			}


			
			const searchTemplatesPath = path.join(workspacePath, this.DATA_PATH, 'search_templates.json');
			if (fs.existsSync(searchTemplatesPath)) {
				// Read our cached results
				try {
					this.searchTemplates = JSON.parse(fs.readFileSync(searchTemplatesPath, 'utf8'))
				} catch { }
				if (!this.searchTemplates) return false;
			}

			// If the file exists, we read its contents into memory.
			const funcStateVarReadWrittenMappingPath = path.join(workspacePath, this.DATA_PATH, 'func_state_var_read_written_mapping.json');
			if (fs.existsSync(funcStateVarReadWrittenMappingPath)) {
				// Read our cached results
				try {
					this.funcStateVarReadWrittenMapping = JSON.parse(fs.readFileSync(funcStateVarReadWrittenMappingPath, 'utf8'))
				} catch { }
				if (!this.funcStateVarReadWrittenMapping) return false;
			}



			// load callstacks
			const callstacksPath = path.join(workspacePath, this.DATA_PATH, 'callstacks.json');
			if (fs.existsSync(callstacksPath)) {
				// Read our cached results
				// this.callstacksHtml = fs.readFileSync(callstacksPath, 'utf8').split("\n").map(cs => { return `<li class='callstack'>${cs}</li>` })
				this.callstacks = JSON.parse(fs.readFileSync(callstacksPath, 'utf8'))

				if (!this.callstacks) return false;
			}

			const callstacksEdgeColorsPath = path.join(workspacePath, this.DATA_PATH, 'func_call_edge_colors.json');
			if (fs.existsSync(callstacksEdgeColorsPath)) {
				// Read our cached results
				// this.callstacksHtml = fs.readFileSync(callstacksPath, 'utf8').split("\n").map(cs => { return `<li class='callstack'>${cs}</li>` })
				this.func_pair_edge_colors = JSON.parse(fs.readFileSync(callstacksEdgeColorsPath, 'utf8'))

				if (!this.func_pair_edge_colors) return false;
			}


			


			// initialize scopes
			
			for (let f of this.functionDefinitions) {
				if (f.scope_id && !this.scopeDefinitions[f.scope_id]) {
					let lookup_scope = this.scopeSummaries.find(s => { return s.id === f.scope_id })

					let scope_obj: ScopeDefinition = {
						id: f.scope_id,
						name: f.scope_id.split(",")[0],
						type: lookup_scope?.type || "", // would want to lookup scope type here, currently not used anywhere
						filepath: f.scope_id.split(",")[1],
						decorator: "", // built later
						numFunctions_inherited: this.functionDefinitions.filter(f2 => { return f2.scope_id === f.scope_id && f2.is_inherited === true }).length,
						numFunctions: this.functionDefinitions.filter(f2 => { return f2.scope_id === f.scope_id && f2.is_inherited === false }).length,
						
						scope_summary: lookup_scope
					}

					this.scopeDefinitions[f.scope_id] = scope_obj
				}
			}

			// TODO: remove from here once dependencies are fixed
			await this.buildCallstacks()


			// build in scope graph
			// include all in scope functions, or all functions if scope is not defined for any function
			let graph: CallGraph
			try {
				graph = this.getScopeGraph('all~', true)
			} catch { graph = { nodes: [], edges: [] } }

			// append # of other similar scope names
			for (let n of graph.nodes) {
				if ('title' in n.data) {
					let num_scopes_w_same_name = graph.nodes.filter(node => { return 'title' in node.data && 'title' in n.data && node.data.title === n.data.title && node.data.id !== n.data.id }).length + 1
					n.data.new_title = `(${num_scopes_w_same_name}) ${n.data.title}`
				}
			}
			// append collected scope decorators
			for (let n of graph.nodes) {
				if ('title' in n.data)
					n.data.title = n.data.new_title + (this.scopeDefinitions[n.data.id]?.decorator || '')
			}

			this.scopeGraphs['all~'] = graph
		}

		return true;
	}

	public getFileLines(filepath: string) {
		// if not in cache, read file and cache
		if (!this.sourceFilesCache[filepath] && fs.existsSync(filepath)) {
			// Read our cached results
			this.sourceFilesCache[filepath] = fs.readFileSync(filepath, 'utf8')
				.split("\n")
		}
		return this.sourceFilesCache[filepath] || []
	}
	private getFileSource(filepath: string, startLine: number | null = null, endLine: number | null = null, filter_audit_comments: boolean = true): string {
		let filtered_lines = filter_audit_comments ? this.getFileLines(filepath)?.filter(line => { return !line.includes("~@") }) : this.sourceFilesCache[filepath]
		if (!filtered_lines) { return "..." }

		if (!startLine) { startLine = 1 }
		if (!endLine) { endLine = filtered_lines.length - 1 }

		return filtered_lines.slice(startLine - 1, endLine).join("\n") // startLine - 1 since index starts at 0
	}

	public getAuditCommentsLineOffset(filepath: string, originalLineNum: number): number {
		filepath = filepath.split("#")[0].replace("file://", "")
		let lines = this.getFileLines(filepath)
		let num_comments = lines.slice(0, originalLineNum - 1).filter(line => { return line.includes("~@") }).length

		// recursive function to check if comments exist in difference between start line and new start line
		function getOffset(startLine: number, newStartLine: number, lines: string[]) {
			let num_comments = lines.slice(startLine, newStartLine).filter(line => { return line.includes("~@") }).length
			if (num_comments > 0) {
				return getOffset(newStartLine, newStartLine + num_comments, lines)
			} else {
				return newStartLine - startLine
			}
		}

		let offset = getOffset(originalLineNum, originalLineNum + num_comments, lines)
		
		return offset
	}

	private getFunctionId(ele: string) {
		let f_calledIn = ""
		if (Array.isArray(ele)) {
			// if callstack is an array of arrays [[f_calledIn, calledAt], [f_calledIn2, calledAt2], ...]
			// e.g.: built from CodeQL
			f_calledIn = ele[0]
			let calledAt = ele[1]
		} else {
			// callstack is just a callstack of f_calledIn [f_calledIn, f_calledIn2, ...]
			// e.g.: built from custom Slither detector
			f_calledIn = ele
		}

		return f_calledIn
	}

	private updateGraphRelatedFunctionHTMLLinks(nodes: (graphNode | graphGroup)[], funcs_seen: string[] = []) {
		// skip this if funcs_seen.length > 0???
		for (let node of nodes) {
			funcs_seen.push(node.data.id)
		}

		for (let node of nodes) {
			if (!('title' in node.data))
				continue

			let lookup_func: FunctionResult | undefined = this.functionDefinitionsMap.get(node.data.id)
			if (lookup_func) {
				let relatedFunctionsHTML = lookup_func?.relatedFunctions?.length > 1 ? `(${lookup_func.relatedFunctions.map((f2_id, i) => { 
									// add `title` for tooltip
									let f2 = this.functionDefinitionsMap.get(f2_id) 
									let tooltip = f2 ? this.escapeForHtmlAttribute(this.getFunctionDescriptiveStr(f2)) : f2_id
									let anchor = `<a style='color: ${f2_id === lookup_func?.id ? 'red' : ''}' href='file://${f2_id.split(",")[1]}' value='${f2_id}' title='${tooltip}'>${i}</a>` 
									anchor = funcs_seen.includes(f2_id) ? anchor : `<s>${anchor}</s>`
									return anchor
								}).join(", ")})` : ""
				node.data.relatedFunctionsHTML = relatedFunctionsHTML
			}
		}
		return nodes
	}

	private getManuallyMappedRelationships(func_id: string, { return_scopes_only = false, seen_relationships = [], root_scope_id = "", append_related_function_html = true, directional_edges_only = undefined }: getCallstacksGraphParams): CallGraph {
		let nodes: (graphNode | graphGroup)[] = []
		let edges: graphEdge[] = []

		// include manually related callstacks
		let manually_mapped_relationships = this.functionManualRelationship.filter(relationship => { return relationship.caller_id === func_id || relationship.callee_id === func_id})
		for (let relationship of manually_mapped_relationships) {

			if (seen_relationships.includes(JSON.stringify(relationship))) {
				continue
			}
			seen_relationships.push(JSON.stringify(relationship))

			let pushed_node = false
			let callee_lookup_func: FunctionResult | undefined = this.functionDefinitionsMap.get(relationship.callee_id)
			let caller_lookup_func: FunctionResult | undefined = this.functionDefinitionsMap.get(relationship.caller_id)

			// continue if hiding manual callstacks from either caller or callee
			if ( caller_lookup_func?.hide_outgoing_callstacks || callee_lookup_func?.hide_incoming_callstacks) {
				continue
			}

			if (callee_lookup_func && callee_lookup_func.id !== func_id && (directional_edges_only === undefined || directional_edges_only.include_direction === "outgoing" || directional_edges_only.include_direction === "both" )) {
				let mergeCallstacksIntoGraphParams: mergeCallstacksIntoGraphParams = {
					graph: { nodes: nodes, edges: edges },
					seen_nodes: nodes.map(n => { return JSON.stringify(n) }),
					seen_edges: edges.map(e => { return JSON.stringify(e) }),
					callstacksGraphParams: {
						callstacks: [],
						return_scopes_only: return_scopes_only,
						seen_relationships: seen_relationships,
						root_scope_id: root_scope_id,
						append_related_function_html: append_related_function_html,
						directional_edges_only: {
							include_direction: "outgoing",
							target_function_id: relationship.callee_id
						}
					}
				}

				mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = callee_lookup_func.entrypoint_callstacks || []
				this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)

				// ??: Consider removing if makes the graph too large. 
				mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = callee_lookup_func.exit_callstacks || []
				this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)

				// does not filter
				// ??: filter other_callstacks to only include where starting @ callee node (currently includes whole graph)
				mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = callee_lookup_func.other_callstacks || []
				this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)

				// include related funtions?...
				// ..

				nodes = mergeCallstacksIntoGraphParams.graph.nodes
				edges = mergeCallstacksIntoGraphParams.graph.edges

				let source_code = this.getFileSource(callee_lookup_func.filepath.split("#")[0], callee_lookup_func.startLine, callee_lookup_func.endLine)
				nodes.push({ classes: 'l1', data: { id: callee_lookup_func.id, parent: callee_lookup_func.scope_id, title: this.getFunctionDescriptiveStr(callee_lookup_func, true, true, true), content: source_code } }) // .length > 1 ? `(${realtedFunctions.map((f2_id, i) => { return `<a style='color: ${f2_id === f.id ? 'red' : ''}' href='file://${f2_id.split(",")[1]}' value='${f2_id}'>${i}</a>` }).join(", ")})` : ""
				pushed_node = true
			}

			if (caller_lookup_func && caller_lookup_func.id !== func_id  && (directional_edges_only === undefined || directional_edges_only.include_direction === "incoming" || directional_edges_only.include_direction === "both" )) {
				let mergeCallstacksIntoGraphParams: mergeCallstacksIntoGraphParams = {
					graph: { nodes: nodes, edges: edges },
					seen_nodes: nodes.map(n => { return JSON.stringify(n) }),
					seen_edges: edges.map(e => { return JSON.stringify(e) }),
					callstacksGraphParams: {
						callstacks: [],
						return_scopes_only: return_scopes_only,
						seen_relationships: seen_relationships,
						root_scope_id: root_scope_id,
						append_related_function_html: append_related_function_html,
						directional_edges_only: {
							include_direction: "incoming",
							target_function_id: relationship.caller_id
						}
					}
				}

				mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = caller_lookup_func.entrypoint_callstacks || []
				this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)

				// ??: Consider removing if makes the graph too large. 
				mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = caller_lookup_func.exit_callstacks || []
				this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)

				// does not filter
				// ??: filter other_callstacks to only include where starting @ callee node (currently includes whole graph)
				mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = caller_lookup_func.other_callstacks || []
				this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)

				// include related funtions?...
				// ..

				nodes = mergeCallstacksIntoGraphParams.graph.nodes
				edges = mergeCallstacksIntoGraphParams.graph.edges

				let source_code = this.getFileSource(caller_lookup_func.filepath.split("#")[0], caller_lookup_func.startLine, caller_lookup_func.endLine)
				nodes.push({ classes: 'l1', data: { id: caller_lookup_func.id, parent: caller_lookup_func.scope_id, title: this.getFunctionDescriptiveStr(caller_lookup_func, true, true, true), content: source_code } }) // .length > 1 ? `(${realtedFunctions.map((f2_id, i) => { return `<a style='color: ${f2_id === f.id ? 'red' : ''}' href='file://${f2_id.split(",")[1]}' value='${f2_id}'>${i}</a>` }).join(", ")})` : ""
				pushed_node = true
			}

			if (pushed_node) {
				edges.push({ data: { source: relationship.caller_id, target: relationship.callee_id, lineColor: 'orange' } })
			}
		}

		return { nodes: nodes, edges: edges }
	}

	// private getCallstacksGraph(callstacks: number[], cache__key: string = "", return_scopes_only: boolean = false, root_scope_id: string = "", append_related_function_html: boolean = true): CallGraph {
	private getCallstacksGraph({ callstacks, cache__key = "", return_scopes_only = false, seen_relationships = [], root_scope_id = "", append_related_function_html = true, directional_edges_only = undefined }: getCallstacksGraphParams): CallGraph {
		if (!this.callstacks || this.callstacks.length === 0) {
			return { nodes: [], edges: [] }
		}

		// get from cache, if exists
		if (cache__key && this.callstacksGraphCache && this.callstacksGraphCache[cache__key]) {
			return this.callstacksGraphCache[cache__key]
		}

		let root_scope: ScopeSummary | undefined = this.scopeSummaries.find(s => { return s.id === root_scope_id })

		let scopes_seen: string[] = [];
		let funcs_seen: string[] = [];

		let nodes: (graphGroup | graphNode)[] = [];
		let edges: graphEdge[] = [];
		callstackLoop: for (let i of callstacks) {
			let last_scope_id_seen

			let callstack: string[] = this.callstacks[i].map(ele => { return this.getFunctionId(ele) })

			let getCallstackSubset = (callstack: string[]) => {
				let startIndex = 0, endIndex = callstack.length;
			  
				// Loop through callstack only once
				callstack.some((func_id, index) => {
				  const f: FunctionResult | undefined = this.functionDefinitionsMap.get(func_id)
			  
				  if (f && f.hide_incoming_callstacks) startIndex = index;
				  if (f && f.hide_outgoing_callstacks) {
					endIndex = index + 1;
					return true; // Break loop once endIndex is found
				  }
				});
			  
				return callstack.slice(startIndex, endIndex);
			  }

			  callstack = getCallstackSubset(callstack)
			
			

			// looking up / looking down functions from target function
			if (directional_edges_only !== undefined && directional_edges_only.include_direction !== "both") {
				if (directional_edges_only.include_direction === "incoming") {
					let from_index = callstack.findLastIndex(func_id => { return func_id === directional_edges_only.target_function_id })
					callstack = callstack.slice(0, from_index + 1)
				} else if(directional_edges_only.include_direction === "outgoing") {
					let from_index = callstack.findIndex(func_id => { return func_id === directional_edges_only.target_function_id })
					callstack = callstack.slice(from_index)
				}
			}

			functionLoop: for (let [j, func_id] of callstack.entries()) {
				if (j > 0) {
					// push relationship edge
					if (!return_scopes_only) {
						let caller = callstack[j - 1]
						let callee = callstack[j]
						let lineColor = this.func_pair_edge_colors[`${caller}~${callee}`] || ""
						edges.push({ data: { source: callstack[j - 1], target: callstack[j], lineColor: lineColor } })
					// edges.push({ data: { source: this.getFunctionId(this.callstacks[i][j - 1]), target: this.getFunctionId(this.callstacks[i][j]) } })
					}
				}

				// if func has been seen before, it's node has been added
				if (funcs_seen.includes(func_id))
					continue
				funcs_seen.push(func_id)
				

				
				
				let lookup_func: FunctionResult | undefined = this.functionDefinitionsMap.get(func_id)	
				if (lookup_func) {
					if (return_scopes_only) {
						nodes.push({ classes: 'l1', data: { id: lookup_func.scope_id, title: lookup_func.scope_id.split(",")[0], content: lookup_func.scope_id } })
						scopes_seen.push(lookup_func.scope_id)

						if (last_scope_id_seen && lookup_func.scope_id)
							edges.push({ data: { source: last_scope_id_seen, target: lookup_func.scope_id } })

						// collect decorators from all functions for scope
						if (lookup_func.scope_id) {
							for (let c of [...lookup_func.decorator]) {
								if (!this.isIconChar(c))
									continue


								if (lookup_func.scope_id && !this.scopeDefinitions[lookup_func.scope_id]?.decorator) {
									this.scopeDefinitions[lookup_func.scope_id].decorator = c
								} else if (lookup_func.scope_id && !this.scopeDefinitions[lookup_func.scope_id].decorator.includes(c)) {
									this.scopeDefinitions[lookup_func.scope_id].decorator += c
								}
							}
						}

						last_scope_id_seen = lookup_func.scope_id
						continue
					}

					// get source code from cache or read file
					// readfile
					let source_code = this.getFileSource(lookup_func.filepath.split("#")[0], lookup_func.startLine, lookup_func.endLine)
					nodes.push({ classes: 'l1', data: { id: lookup_func.id, parent: lookup_func.scope_id, title: this.getFunctionDescriptiveStr(lookup_func, true, true, true), content: source_code } }) // .length > 1 ? `(${realtedFunctions.map((f2_id, i) => { return `<a style='color: ${f2_id === f.id ? 'red' : ''}' href='file://${f2_id.split(",")[1]}' value='${f2_id}'>${i}</a>` }).join(", ")})` : ""

					// push scope if not seen before
					if (lookup_func.scope_id && !scopes_seen.includes(lookup_func.scope_id)) {
						let lookup_scope = this.scopeSummaries.find(s => { return s.id === lookup_func?.scope_id })
						let backgroundColor = ""
						if (lookup_scope?.backgroundColor && lookup_scope?.backgroundColor !== "") {
							backgroundColor = lookup_scope?.backgroundColor
						} else {
							backgroundColor = root_scope?.inherits_recursive?.includes(lookup_func.scope_id) ? "red" : ""
							backgroundColor = root_scope?.inherits_from_recursive?.includes(lookup_func.scope_id) ? "purple" : backgroundColor
							backgroundColor = root_scope_id === lookup_func.scope_id ? "blue" : backgroundColor
						}
						
						nodes.push({ data: { id: lookup_func.scope_id, label: lookup_func.scope_id.split(",")[0], isParent: true, backgroundColor: backgroundColor } })    // perhaps change label to func.scope_id.split(",")[0]  ?
						scopes_seen.push(lookup_func.scope_id)
					}

					// return this.getFunctionDescriptiveStr(lookup_func, true);

					// TODO: idea for incoming, update nodes to nodes_to_add, reset if hide_incoming_callstacks = true, set at end of loop
					// don't show reminaing functions
					// TODO: fix, broken, will not show related call stacks up the chain
					// if (lookup_func.hide_outgoing_callstacks) {
					// 	// return { nodes: nodes, edges: edges }
					// 	break callstackLoop   /// wtf, broken
					// }
				}
				else {
					if (!return_scopes_only)
						nodes.push({ classes: 'l1', data: { id: func_id, title: `<a href='file://${func_id.split(",").slice(-1)[0]}'>${func_id.split(",").slice(0, -1).join(",")}</a> | ?` } })
				}

				

				// TODO: FIX INCLUDE MANUALLY MAPPED
				// this.getManuallyMappedRelationships(func_id, seen_relationships)
				let params: getCallstacksGraphParams = {
					callstacks: [],  	// not used
					cache__key: "",		// not used
					return_scopes_only: return_scopes_only,
					seen_relationships: seen_relationships,
					root_scope_id: root_scope_id,
					append_related_function_html: append_related_function_html,
					directional_edges_only: directional_edges_only
				}
				let manualMappedRelationshipsGraph: CallGraph = this.getManuallyMappedRelationships(func_id, params)
				for (let node of manualMappedRelationshipsGraph.nodes) {
					let id = JSON.stringify(node)
					if (!funcs_seen.includes(id)) {
						nodes.push(node)
						funcs_seen.push(id)
					}
				}
				for (let edge of manualMappedRelationshipsGraph.edges) {
					edges.push(edge)
				}



			}
		}


		if (append_related_function_html) {
			// append related functions links w/ strikethrough
			nodes = this.updateGraphRelatedFunctionHTMLLinks(nodes, funcs_seen)
		}


		let graph: CallGraph = { nodes: nodes, edges: edges }
		if (cache__key && this.callstacksGraphCache) {
			this.callstacksGraphCache[cache__key] = graph
		}

		return graph;
	}

	// TODO: update this function to build HTML callstacks on the spot
	private getCallstacksHTML(callstacks: number[]) {
		if (!this.callstacksHtml) {
			return ""
		}

		let html = ""
		for (let index of callstacks) {
			html += this.callstacksHtml[index] + "<br>"
		}

		return html
	}


	private hasNonEmptyValue(obj: any, prop: string): boolean {
		const value = obj[prop];

		// Check for null, undefined, or empty string
		if (!value || (typeof value === 'string' && value.trim() === '')) {
			return false;
		}

		// Check for empty array
		if (Array.isArray(value) && value.length === 0) {
			return false;
		}

		// Check for empty object
		if (typeof value === 'object' && !Object.keys(value).length) {
			return false;
		}

		return true;
	}

	private getFunctionDescriptiveStr(f: FunctionResult, hyperlinedHTML: boolean = false, include_manual_relationship_link: boolean = false, function_params_newline: boolean = false) {
		if (hyperlinedHTML) {
			// graph
			let manual_relationship_link = `<span class='manual-relationship-link' style='cursor: pointer' value='${f.id}'>🪢</span>`
			let search_link = `<span style='cursor: pointer' search_regex='\\.${f.functionName}'>🔍</span>`
			let html_link = `<a href='#${f.id}' data-scope="${f.scope_id}">🔗</a>`
			let tooltip = this.escapeForHtmlAttribute(this.getFunctionDescriptiveStr(f))
			let f_str = `(${f.endLine - f.startLine - 1}) ${f.reviewed ? '[X] ' : ''}${include_manual_relationship_link ? `${manual_relationship_link} ` : ""}${search_link} ${html_link} <a href='file://${f.filepath}' title=${tooltip}>${f.qualifiedName_full || f.qualifiedName || f.functionName}</a>${!function_params_newline && f.functionParameters ? f.functionParameters : ""}${!function_params_newline && f.functionReturns ? " -> " + f.functionReturns : ""} |${f.decorator ? ` ${f.decorator} ` : ""}${function_params_newline && f.functionParameters ? "<br>" + f.functionParameters : ""}${function_params_newline && f.functionReturns ? "<br> -> " + f.functionReturns : ""}`

			return f_str
		}


		// search functions
		let relativePath = f.filepath
		if (vscode.workspace.workspaceFolders) {
			for (let workspacePath of vscode.workspace.workspaceFolders) {
				let regex = new RegExp(escapeRegExp('^' + workspacePath.uri.fsPath));  // '^' matches the beginning of the string
				relativePath = relativePath.replace(regex, ".")
			}
		}
		return `${f.reviewed ? '[X] ' : ''}${f.qualifiedName || f.functionName}${!function_params_newline && f.functionParameters ? f.functionParameters : ""}${!function_params_newline && f.functionReturns ? " -> " + f.functionReturns : ""} | (Taints: ${f.tainted_locations_count || "?"}) (SLOC: ${f.endLine - f.startLine || '?'}) (# callstacks: ${f.callstackCount}) ${f.decorator},...${f.inheritance_str}...${relativePath}${function_params_newline && f.functionParameters ? "<br>" + f.functionParameters : ""}${function_params_newline && f.functionReturns ? "<br> -> " + f.functionReturns : ""}`
	}

	private filterFunctionDefinitions(functions: FunctionResult[], regexPattern: string = "", excludeRegexPattern: string = ""): FunctionResult[] {
		// max lines in file must be < 1000000000
		const max_filesize = 6
		excludeRegexPattern = excludeRegexPattern.trim()

		return functions
			// .filter(f => { return !f.hasOwnProperty('is_inherited') || f.is_inherited === false }) // do not show inherited functions
			.filter(f => {
				// do not show inherited functions, these will be shown on their base [class]
				if (f.hasOwnProperty('is_inherited') && f.is_inherited === true)
					return false

				const regex = new RegExp(escapeRegExp(regexPattern), 'gi');
				const excludeRegex = new RegExp(escapeRegExp(excludeRegexPattern), 'gi');
				const hasInterestingContent = this.settings.showAllFunctions || this.hasNonEmptyValue(f, 'decorator') || this.hasNonEmptyValue(f, 'entrypoint_callstacks') || this.hasNonEmptyValue(f, 'exit_callstacks') || this.hasNonEmptyValue(f, 'other_callstacks') || this.hasNonEmptyValue(f, 'state_vars_read') || this.hasNonEmptyValue(f, 'state_vars_written')

				// hide based on reviewed state
				if (this.currentFilteredFunctionState.hideReviewedState === "In Scope Only" && !f.decorator.includes("🎯")) {
					return false
				}
				
				if (this.currentFilteredFunctionState.hideReviewedState === "Hide Reviewed Except In Scope" && f.reviewed && !f.decorator.includes("🎯")) {
					return false
				}

				if (this.currentFilteredFunctionState.hideReviewedState === "Hide Reviewed" && f.reviewed) {
					return false
				}

				let functionDescripiveStr = this.getFunctionDescriptiveStr(f).replace("[X] ", '')

				if (excludeRegexPattern)
					return regex.test(functionDescripiveStr) && !excludeRegex.test(functionDescripiveStr) && hasInterestingContent
				else
					return regex.test(functionDescripiveStr) && hasInterestingContent
			})
			.sort((f, f2) => {
				if (this.functionSortOption === '# Callstacks') {
					return (f2.callstackCount - f.callstackCount)
				}

				if (this.functionSortOption === 'Alpha. + # Callstacks') {
					let f_1 = f.filepath.split("#")[0] + "#" + ((f.callstackCount)).toString().padStart(max_filesize, "0")
					let f_2 = f2.filepath.split("#")[0] + "#" + ((f2.callstackCount)).toString().padStart(max_filesize, "0")

					return f_2.localeCompare(f_1)
				}

				if (this.functionSortOption === 'SLOC') {
					return (f2.endLine - f2.startLine) - (f.endLine - f.startLine)
				}

				if (this.functionSortOption === 'Alpha. + SLOC') {
					let f_1 = f.filepath.split("#")[0] + "#" + (f.endLine - f.startLine).toString().padStart(max_filesize, "0")
					let f_2 = f2.filepath.split("#")[0] + "#" + (f2.endLine - f2.startLine).toString().padStart(max_filesize, "0")

					return f_2.localeCompare(f_1)
				}

				// default sort option:   'Alpha. + Line #'
				let f_1 = f.filepath.split("#")[0] + "#" + f.startLine.toString().padStart(max_filesize, "0")
				let f_2 = f2.filepath.split("#")[0] + "#" + f2.startLine.toString().padStart(max_filesize, "0")

				return f_1.localeCompare(f_2)
			})
	}

	public showScope(scope_id: string, checkbox_ids_to_check: string[]) {
		if (this._view) {
			this._view.show?.(true); // `show` is not implemented in 1.49 but is for 1.50 insiders

			let scope = this.scopeSummaries.find(scope => { return scope.id == scope_id })
			if (!scope)
				return

			this._view.webview.postMessage({ command: "displayScope", scope: scope, checkbox_ids_to_check: checkbox_ids_to_check });
		}
	}

	public showReferences(f: FunctionResult) {
		// for (let ref of references) {
		let start_filepath = f.filepath.split("#")[0]
			// let line = parseInt(ref.split("#")[1])
			// }

		let reference_ranges = !f.called_at ? [] : f.called_at.map(ref => {
			let filepath = ref.split("#")[0].replace("file://", "")
			let line = parseInt(ref.split("#")[1]) // may want to resolve line numbers w/ parser instead of here
			return new vscode.Location(vscode.Uri.file(filepath), new vscode.Position(line + this.getAuditCommentsLineOffset(filepath, line), 0))
		})
		vscode.commands.executeCommand('editor.action.peekLocations', 
			vscode.Uri.file(start_filepath), 
			new vscode.Position(f.startLine + this.getAuditCommentsLineOffset(f.filepath, f.startLine), 0),
			reference_ranges
		);
	}

	public showFunction(f_id: string, navigated_from_history: boolean = false, mode: "Combined" | "Split" = "Combined", include_related_callstacks: boolean = false) {
		if (this._view) {
			this._view.show?.(true); // `show` is not implemented in 1.49 but is for 1.50 insiders

			let func = this.functionDefinitions.find(f => { return f.id == f_id && !f.is_inherited})
			if (!func)
				return

			let getCallstacksGraphParams: getCallstacksGraphParams = {
				callstacks: [],
				cache__key: "",
				root_scope_id: func.scope_id
			}

			if (mode === "Split") { 
				func.entrypoint_callstacks_html = ""
				if (func.entrypoint_callstacks && func.entrypoint_callstacks.length > 0) {
					// let callstacks = this.getCallstacksHTML(func.entrypoint_callstacks)
					// func.entrypoint_callstacks_html = "<h3>Entrypoint Callstacks</h3></ul>" + callstacks + "</ul>"
					func.entrypoint_callstacks_html = "<h3>Entrypoint Callstacks</h3>"
	
					getCallstacksGraphParams.callstacks = func.entrypoint_callstacks
					getCallstacksGraphParams.cache__key = `${func.id}-entrypoint`
					let callstacks_graph = this.getCallstacksGraph(getCallstacksGraphParams)
					func.entrypoint_callstacks_graph = callstacks_graph
				}
	
				func.exit_callstacks_html = ""
				if (func.exit_callstacks && func.exit_callstacks.length > 0) {
					// let callstacks = this.getCallstacksHTML(func.exit_callstacks)
					// func.exit_callstacks_html = "<h3>Exit Callstacks</h3></ul>" + callstacks + "</ul>"
					func.exit_callstacks_html = "<h3>Exit Callstacks</h3>"
	
					getCallstacksGraphParams.callstacks = func.exit_callstacks
					getCallstacksGraphParams.cache__key = `${func.id}-exit`
					let callstacks_graph = this.getCallstacksGraph(getCallstacksGraphParams)
					func.exit_callstacks_graph = callstacks_graph
				}
	
				func.other_callstacks_html = ""
				if (func.other_callstacks && func.other_callstacks.length > 0) {
					// let callstacks = this.getCallstacksHTML(func.other_callstacks)
					// func.other_callstacks_html = "<h3>Other Callstacks</h3></ul>" + callstacks + "</ul>"
					func.other_callstacks_html = "<h3>Other Callstacks</h3>"
	
					getCallstacksGraphParams.callstacks = func.other_callstacks
					getCallstacksGraphParams.cache__key = `${func.id}-other`
					let callstacks_graph = this.getCallstacksGraph(getCallstacksGraphParams)
					func.other_callstacks_graph = callstacks_graph
				}
			}


			
			// all callstacks in a single graph			
			
			// get related callstacks
			let related_callstack_indexes: number[] = this.getRelatedCallstacks(func)
			// let callstacks = this.getCallstacksHTML(related_callstack_indexes)
			// func.related_callstacks_html = "<h3>Related Callstacks</h3></ul>" + callstacks + "</ul>"
			
			// getCallstacksGraphParams.callstacks = related_callstack_indexes
			// getCallstacksGraphParams.cache__key = `${func.id}-related`
			// let callstacks_graph = this.getCallstacksGraph(getCallstacksGraphParams)
			// func.related_callstacks_graph = callstacks_graph
			// // color all related nodes
			// for (let node of func.related_callstacks_graph.nodes) {
			// 	if (node.data.id.startsWith(`${func.functionName},`) && node.data.id !== func.id) {
			// 		node.data.backgroundColor = "greenyellow"
			// 	}
			// }
			
			if (mode === "Combined") {
				getCallstacksGraphParams.callstacks = [...new Set(func.entrypoint_callstacks.concat(func.exit_callstacks).concat(func.other_callstacks))]
				getCallstacksGraphParams.cache__key = ""
				
				let all_callstacks_graph: CallGraph
				if (getCallstacksGraphParams.callstacks.length > 0) {
					all_callstacks_graph = this.getCallstacksGraph(getCallstacksGraphParams)
				} else {
					let nodes = [] 

					// add function
					let source_code = this.getFileSource(func.filepath.split("#")[0], func.startLine, func.endLine)
					nodes.push({ classes: 'l1', data: { id: func.id, parent: func.scope_id, title: this.getFunctionDescriptiveStr(func, true, true, true), content: source_code } }) // .length > 1 ? `(${realtedFunctions.map((f2_id, i) => { return `<a style='color: ${f2_id === f.id ? 'red' : ''}' href='file://${f2_id.split(",")[1]}' value='${f2_id}'>${i}</a>` }).join(", ")})` : ""

					// add scope / parent node (if exists)
					if (func.scope_id) {
						nodes.push({ data: { id: func.scope_id, label: func.scope_id.split(",")[0], isParent: true, backgroundColor: "blue" } })    // perhaps change label to func.scope_id.split(",")[0]  ?
					}

					all_callstacks_graph = { nodes: nodes, edges: [] }


					let manualRelationshipGraph = this.getManuallyMappedRelationships(func.id, getCallstacksGraphParams)
					for (let node of manualRelationshipGraph.nodes) {
						all_callstacks_graph.nodes.push(node)
					}
					for (let edge of manualRelationshipGraph.edges) {
						all_callstacks_graph.edges.push(edge)
					}

				}

				if (include_related_callstacks) {
					let seen_func_ids = all_callstacks_graph.nodes.map(n => { return n.data.id })

					getCallstacksGraphParams.cache__key = ""
					getCallstacksGraphParams.callstacks = related_callstack_indexes
					let mergeCallstacksIntoGraphParams: mergeCallstacksIntoGraphParams = {
						graph: all_callstacks_graph,
						seen_nodes: all_callstacks_graph.nodes.map(n => { return JSON.stringify(n) }),
						seen_edges: all_callstacks_graph.edges.map(e => { return JSON.stringify(e) }),
						callstacksGraphParams: getCallstacksGraphParams
					}
					this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)
					all_callstacks_graph = mergeCallstacksIntoGraphParams.graph

					// color related nodes
					for (let node of all_callstacks_graph.nodes) {
						if (!seen_func_ids.includes(node.data.id) && node.data.id !== func.id && node.data.id.startsWith(`${func.functionName},`)) {
							node.data.backgroundColor = "greenyellow"
							continue
						}
						if (node.data.id && !seen_func_ids.includes(node.data.id)) {
							node.data.backgroundColor = "lightgreen"
							continue
						}
					}

					// getCallstacksGraphParams.callstacks = [...new Set(getCallstacksGraphParams.callstacks.concat(related_callstack_indexes))]
					// getCallstacksGraphParams.cache__key = `${func.id}-all-related`
				}

				// color selected node
				if (all_callstacks_graph.nodes) {
					let n = all_callstacks_graph.nodes.find(node => { return node.data.id === func?.id })
					if (n) n.data.backgroundColor = "yellow"
				}

				func.callstacks_graph = all_callstacks_graph
			}

			let additional_checkboxes_to_check = func.callstacks_graph.nodes.map(n => { 
				let color = n.data?.backgroundColor || (func && n.data.id !== func.id ? 'orange' : '')
				return `${n.data.id}~~${color}` 
			})
			let checkbox_ids_to_check = [...new Set(func.checkbox_ids_to_check.concat(additional_checkboxes_to_check))]	


			// get related functions (is this too computationally expensive for apps with too many functions?, should we process on load of file?)
			let exclude_list: string[] = ['interface', 'test', 'mock']
			
			// exact matches
			let related_functions_exact_html = this.functionDefinitions
				.filter((value, index, self) => self.findIndex(f => f.id === value.id) === index)  // filter unique
				.filter(f => { return func && f !== func && f.functionName.toLowerCase() === func.functionName.toLowerCase() && exclude_list.every(exclude => !f.id.includes(exclude)); })
				.map(f => { return `(SLOC: ${f.endLine - f.startLine}) ` + this.getFunctionDescriptiveStr(f, true) + ` | ${f.id}` })
				.join("<br>")

			// non-exact matches
			let related_functions_fuzzy_html = this.functionDefinitions
				.filter((value, index, self) => self.findIndex(f => f.id === value.id) === index)  // filter unique
				.filter(f => { return func && f !== func && f.functionName.toLowerCase() !== func.functionName.toLowerCase() && f.functionName.toLowerCase().includes(func.functionName.toLowerCase()) && exclude_list.every(exclude => !f.id.includes(exclude)); })
				.map(f => { return `(SLOC: ${f.endLine - f.startLine}) ` + this.getFunctionDescriptiveStr(f, true) + ` | ${f.id}` })
				.join("<br>")

			func.related_functions_html = (related_functions_exact_html ? `<b>(exact)</b><br> ${related_functions_exact_html}` : '') + (related_functions_fuzzy_html ? `<br><b>(substring)</b><br> ${related_functions_fuzzy_html}` : '')

			this._view.webview.postMessage({ command: "displayFunction", function: func, navigated_from_history: navigated_from_history });
			this.showScope(func.scope_id, checkbox_ids_to_check)
		}
	}


	public showFilteredScopesRegex(regexPattern: string, excludeRegexPattern: string) {
		const max_filesize = 6
		excludeRegexPattern = excludeRegexPattern.trim()


		if (this._view) {
			this._view.show?.(true); // `show` is not implemented in 1.49 but is for 1.50 insiders


			let scopeIdObjs = Object.keys(this.scopeDefinitions).filter(scope_id => {
				let scope = this.scopeDefinitions[scope_id]
				let scope_summary = this.scopeSummaries.find(s => { return s.id === scope_id })

				const regex = new RegExp(escapeRegExp(regexPattern), 'gi');
				const excludeRegex = new RegExp(escapeRegExp(excludeRegexPattern), 'gi');

				let inheritance_str = `(#inherits ${scope_summary?.inherits_recursive?.length || 0} in<>out ${scope_summary?.inherits_from_recursive?.length || 0})`
				let scopeDescripiveStr = `(${scope.type}) ${scope.id}${scope.decorator}${inheritance_str}`  // this is what is filtered on, not what is displayed

				if (excludeRegexPattern)
					return regex.test(scopeDescripiveStr) && !excludeRegex.test(scopeDescripiveStr)
				else
					return regex.test(scopeDescripiveStr)
			})
				.sort((f, f2) => {
					// default sort option:   'Alpha. + Line #'
					let f_1 = f.split("#")[0] + "#" + f.toString().padStart(max_filesize, "0")
					let f_2 = f2.split("#")[0] + "#" + f2.toString().padStart(max_filesize, "0")

					return f_1.localeCompare(f_2)
				})
				.map(scope_id => {
					return { "id": scope_id, "scopeDefinition": this.scopeDefinitions[scope_id] }
				})


			// return scopeIdObjs
			this._view.webview.postMessage({ command: "searchScopes", scopeIdObjs: scopeIdObjs || [] })
		}
	}

	public showFilteredFunctionsRegex(regexPattern: string, excludeRegexPattern: string) {
		if (this._view) {
			this._view.show?.(true); // `show` is not implemented in 1.49 but is for 1.50 insiders

			// get functions
			let functionIdObjs = this.filterFunctionDefinitions(this.functionDefinitions, regexPattern, excludeRegexPattern)
				.map(f => {
					return { "id": f.id, "name": this.getFunctionDescriptiveStr(f), "scope_id": f.scope_id }
				})

			// get callstacks
			let callstacks: string[] = []
			// let seen = new Set();
			// let callstacks = this.callstacksHtml?.filter(callstack_html => {
			// 	if (seen.has(callstack_html)) return false; // Skip duplicates
			// 	seen.add(callstack_html);

			// 	const regex = new RegExp(regexPattern, 'gi');
			// 	const excludeRegex = new RegExp(excludeRegexPattern, 'gi');

			// 	if (excludeRegexPattern != "")
			// 		return regex.test(callstack_html) && !excludeRegex.test(callstack_html)
			// 	else
			// 		return regex.test(callstack_html)
			// })

			this.currentFilteredFunctionState = { regexPattern: regexPattern, excludeRegexPattern: excludeRegexPattern, filteredFunctionIds: functionIdObjs.map(f => { return f.id }), hideReviewedState: this.currentFilteredFunctionState.hideReviewedState }
			this._view.webview.postMessage({ command: "searchFunctions", functionIdObjs: functionIdObjs || [], callstacks: callstacks })
		}
	}

	public joinGraphByFunction(graph_nodes: graphNode[], graph_edges: graphEdge[], f_id: string, direction: "outgoing" | "incoming") {
		let graph: CallGraph = { nodes: graph_nodes, edges: graph_edges }
		let f = this.functionDefinitionsMap.get(f_id)

		if (f?.callstackCount === 0) return			

		let mergeCallstacksIntoGraphParams: mergeCallstacksIntoGraphParams = {
			graph: graph,
			seen_nodes: graph.nodes.map(n => { return n.data.id }),
			seen_edges: [], // graph.edges.map(e => { return e.data.source })
			callstacksGraphParams: {
				callstacks: [],
				directional_edges_only: {
					target_function_id: f_id,
					include_direction: direction
				}
			}
		}
			
		mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = f?.entrypoint_callstacks || []
		this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)

		mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = f?.exit_callstacks || []
		this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)
		
		mergeCallstacksIntoGraphParams.callstacksGraphParams.callstacks = f?.other_callstacks || []
		this.mergeCallstacksIntoGraph(mergeCallstacksIntoGraphParams)
		

		// resolve transitive relationships
		
		// reset titles?
		
		// append related functions links w/ strikethrough
		graph.nodes = this.updateGraphRelatedFunctionHTMLLinks(graph.nodes)

		for (let n of graph.nodes) {
			if ('title' in n.data && n.data.isCollapsed !== false) {
				n.data.isCollapsed = true;
			}
		}

		// update function dectorators
		if (graph && 'nodes' in graph) {
			let node = graph.nodes.find(n => { return n.data.id === f_id })
			let f = this.functionDefinitionsMap.get(f_id)
			if (node && 'title' in node.data && f) {
				node.data.title = this.getFunctionDescriptiveStr(f, true, true, true)
			}
			//  = this.getFunctionDescriptiveStr(this.functionDefinitions[f_id], true, true, true)
		}

		return graph
	}

	public manuallyMapFunctionRelationship(f_id: string) {
		if (!this.lastManuallyMappedFunction) {
			this.lastManuallyMappedFunction = f_id
			return
		}

		let caller_id = this.lastManuallyMappedFunction
		let callee_id = f_id
		this.lastManuallyMappedFunction = null

		let already_mapped = this.functionManualRelationship.filter(relationship => { return relationship.caller_id === caller_id && relationship.callee_id === callee_id })
		if (already_mapped.length > 0) {
			vscode.window.showInformationMessage(`These functions are already mapped`)
			return
		}

		vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		vscode.window.showInformationMessage(`Manually map functions:\n\ncaller: ${caller_id}\n\ncallee: ${callee_id}\n\nAre you sure?`, { modal: true }, 'Confirm')
			.then(selection => {
				if (selection === 'Confirm') {
					this.functionManualRelationship.push({ caller_id: caller_id, callee_id: callee_id })
					
					fs.writeFileSync(this.settings.manualFunctionRelationshipPath, JSON.stringify(this.functionManualRelationship))

					// clear callstacksGraph cache + rebuild callstacks
					this.scopeGraphs = {}
					this.callstacksGraphCache = {}
					this.buildCallstacks()
					vscode.window.showInformationMessage('Confirmed!');
				}
			});
	}
 
	public async reloadWebview() {
		if (this._view) {
			this._view.webview.html = this._getHtmlForWebview(this._view.webview);
		}
	}

	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		resolveContext: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		if (this.functionDefinitions.length === 0 || this.scopeSummaries.length === 0) {
			await this.loadFunctionsAndScopeInfo();
		}

		this._view = webviewView;

		webviewView.webview.options = getWebviewOptions(this._extensionUri)

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async message => {
			if (message.command === "open") {
				// opens file
				// const uri = vscode.Uri.parse(message.link);
				// const line = (+uri.fragment.substring(1)) - 1;
				// const startLine = uri.fragment.split('-')[0] ? Number(uri.fragment.split('-')[0].split(':')[0]) : 0;
				// const startCol = uri.fragment.split('-')[0].split(':')[1] ? Number(uri.fragment.split('-')[0].split(':')[1]) - 1 : 0;
				// const endLine = uri.fragment.split('-')[1] ? Number(uri.fragment.split('-')[1].split(':')[0]) : startLine;
				// const endCol = uri.fragment.split('-')[0].split(':')[1] ? Number(uri.fragment.split('-')[0].split(':')[1]) - 1 : 0;

				let uri = message.link
				let fragment = uri.split("#")[1] || ""

				const startLine = fragment.split('-')[0] ? Number(fragment.split('-')[0].split(':')[0]) : 0;
				let startCol = fragment.split('-')[0].split(':')[1] ? Number(fragment.split('-')[0].split(':')[1]) - 1 : this.defaultFileLineColumnOffset[uri.replace("file://", "").split(":")[0]] || 0

				
				const startLine_w_offset = this.getAuditCommentsLineOffset(uri, startLine) + startLine
				
				let pos1 = new vscode.Position(0, 0);
				let pos2 = new vscode.Position(0, 0);
				let sel = new vscode.Selection(pos1, pos2);

				let currentWorkspaceFolderUri: string
				if (vscode.workspace.workspaceFolders) {
					currentWorkspaceFolderUri = vscode.workspace.workspaceFolders[0].uri.toString().replace("file://", "")
				}

				// const folder_uri = vscode.Uri.file(uri.toString().split("#")[0].replace("file://", ""));
				const folder_uri = vscode.Uri.file(decodeURIComponent(uri.split("#")[0].replace("file://", "")));
				// click = open in active editor | ctrl click = open in new column
				const open_in_column = message.is_ctrl_click ? vscode.window.visibleTextEditors.length + 1 : vscode.window.activeTextEditor

				await vscode.commands.executeCommand('vscode.open', folder_uri, open_in_column).then((e) => {

					let editor = vscode.window.activeTextEditor
					if (editor)
						editor.selection = sel;

					let move_to_line = startLine_w_offset - 1
					if (move_to_line > 0) {
						vscode.commands
							.executeCommand("cursorMove", {
								to: "down",
								by: "line",
								value: startLine_w_offset - 1,
							})
					}
					if (startCol > 0) {
						vscode.commands.executeCommand("cursorMove", {
							to: "right",
							by: "character",
							value: startCol,
						})
					}

					// center screen
					if (editor)
						editor.revealRange(new vscode.Range(startLine_w_offset, startCol, startLine_w_offset, startCol), vscode.TextEditorRevealType.InCenter);


					if (currentWorkspaceFolderUri)
						vscode.commands.executeCommand('vscode.openFolder', currentWorkspaceFolderUri);
				})

				/**** .showTextDocument() will break global search when used. Keeping note here to remember in event of refactor. ****/
				// await vscode.window.showTextDocument(uri)
			}

			if (message.command === "content_to_new_file") {
				let filename = message.filename
				let content = this.decodeBase64Unicode(message.content)

				// const filepath = await this.appendAndCreateFolder('.vscode/fuzztemplates')

				// vscode open content in a new unsaved file
				const uri = vscode.Uri.parse(`untitled:${filename}`);
				const document = await vscode.workspace.openTextDocument(uri);

				// set focus on the new file
				const editor = await vscode.window.showTextDocument(document);
				
				
				editor.edit(editBuilder => {
					let lastLine = editor.document.lineCount-1
					let lastChar = editor.document.lineAt(editor.document.lineCount-1).range.end.character

					// clear all content
					editBuilder.delete(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine, lastChar)))
					editBuilder.insert(new vscode.Position(0, 0), content);
				});
			}

			if (message.command === 'show_inheritance_graph') {
				if (this._view)
					this._view.webview.postMessage({ command: "showInScopeGraph", graph: this.getInheritanceGraph(message.scope_id) });
			}

			if (message.command === 'show_scope_graph') {
				if (this._view)
					this._view.webview.postMessage({ command: "showInScopeGraph", graph: this.getScopeGraph(message.scope_id, false, message.include_inherited_funcs, message.include_related_callstacks) });
			}

			if (message.command === 'set_function_sort_option') {
				this.functionSortOption = message.sortOption
				this.showFilteredFunctionsRegex(this.currentFilteredFunctionState.regexPattern, this.currentFilteredFunctionState.excludeRegexPattern)
			}


			if (message.command === 'toggle_hide_reviewed') {
				this.currentFilteredFunctionState.hideReviewedState = message.hideReviewedState
				this.showFilteredFunctionsRegex(this.currentFilteredFunctionState.regexPattern, this.currentFilteredFunctionState.excludeRegexPattern)
			}

			if (message.command === "show_function") {
				this.showFunction(message.function_id, message.navigated_from_history, message.mode, message.include_related_callstacks)
			}

			if (message.command === "show_scope") {
				this.showScope(message.scope_id, message.checkbox_ids_to_check)
			}

			if (message.command === "search_functions") {
				this.showFilteredFunctionsRegex(message.regex, message.exclude_regex)
			}

			if (message.command === "search_scopes") {
				this.showFilteredScopesRegex(message.regex, message.exclude_regex)
			}

			if (message.command === "mark_function_reviewed") {
				let func = this.functionDefinitionsMap.get(message.funcId)
				if (func) {
					func.reviewed = message.value;

					// TODO: move to updateCache function
					// update graph cache
					Object.keys(this.callstacksGraphCache).forEach((key: string) => {
						const graph: CallGraph = this.callstacksGraphCache[key];

						for (let node of graph.nodes) {
							if (func && 'title' in node.data && node.data.id === func.id) {
								node.data.title = this.getFunctionDescriptiveStr(func, true, true, true)
							}
						}
					});

					this.buildCallstacks()
				}
			}

			if (message.command === "set_hide_callstacks_from_function") {
				let func = this.functionDefinitionsMap.get(message.f_id)


				if (func) {
					let append_to_graph = false
					if (message.direction === "incoming") {
						func.hide_incoming_callstacks = message.value ? message.value : !func.hide_incoming_callstacks
						func.decorator = func.hide_incoming_callstacks ? func.decorator + "🔼" : func.decorator.replaceAll("🔼", "")
						append_to_graph = !func.hide_incoming_callstacks
					}
					if (message.direction === "outgoing") {
						func.hide_outgoing_callstacks = message.value ? message.value : !func.hide_outgoing_callstacks
						func.decorator = func.hide_outgoing_callstacks ? func.decorator + "🔽" : func.decorator.replaceAll("🔽", "")
						append_to_graph = !func.hide_outgoing_callstacks
					}
					
					this.scopeGraphs = {}
					this.callstacksGraphCache = {}
					this.buildCallstacks()

					// extend graph by function (if adding back, either incoming/outgoing)
					// will reshow graph to update decorator of current function and append callstacks (if needed)
					if (message.graph_id) {
						const graph = this.joinGraphByFunction(message.graph_nodes, message.graph_edges, message.f_id, message.direction)
						
						// send message back to client to update
						if (this._view)
							this._view.webview.postMessage({ command: "setGraph", graph_id: message.graph_id, graph: graph, f_id: message.f_id });
					}
				}
			}

			if (message.command === "mark_all_reviewed") {
				vscode.window.showInformationMessage(`Mark all functions as reviewed?`, { modal: true }, 'Reviewed', "Unreviewed")
					.then(selection => {
						if (!selection) {
							return
						}

						this.functionDefinitions
							.filter(f => { return this.currentFilteredFunctionState.filteredFunctionIds.includes(f.id) })
							.forEach(f => {
								// f.reviewed = message.reviewed
								f.reviewed = selection === 'Reviewed'
		
								// TODO: move to updateCache function
								// update graph cache
								Object.keys(this.callstacksGraphCache).forEach((key: string) => {
									const graph: CallGraph = this.callstacksGraphCache[key];
		
									for (let node of graph.nodes) {
										if ('title' in node.data && node.data.id === f.id) {
											node.data.title = this.getFunctionDescriptiveStr(f, true, true, true)
										}
									}
								});
							})
		
		
						this.showFilteredFunctionsRegex(this.currentFilteredFunctionState.regexPattern, this.currentFilteredFunctionState.excludeRegexPattern)
						this.buildCallstacks()
					})
			}

			if (message.command === "bulk_update_decorator") {
				vscode.window.showInformationMessage(`Bulk update decorator:`, { modal: true}, 'Add', 'Remove' )
					.then(selection => {

						if (!selection) {
							return
						}

						vscode.window.showInputBox({ prompt: `Enter decorator to ${selection.toLowerCase()}:`}).then(val => {
							if (!val) {
								return
							}

							this.functionDefinitions
								.filter(f => { return this.currentFilteredFunctionState.filteredFunctionIds.includes(f.id) })
								.forEach(f => {
										let did_update = false
										if (selection === 'Add' && !f.decorator.includes(val)) {
											f.decorator = f.decorator + val
											did_update = true
										} else if (selection === 'Remove' && f.decorator.includes(val)) {
											f.decorator = f.decorator.replaceAll(val, "")
											did_update = true
										}

										if (!did_update) {
											return
										}
								
										// TODO: move to updateCache function
										// update graph cache
										Object.keys(this.callstacksGraphCache).forEach((key: string) => {
												const graph: CallGraph = this.callstacksGraphCache[key];
									
										for (let node of graph.nodes) {
											if ('title' in node.data && node.data.id === f.id) {
												node.data.title = this.getFunctionDescriptiveStr(f, true, true, true)
											}
										}
									});
								})
							
							this.showFilteredFunctionsRegex(this.currentFilteredFunctionState.regexPattern, this.currentFilteredFunctionState.excludeRegexPattern)
							this.buildCallstacks()
							
							vscode.window.showInformationMessage(`Confirmed! ${selection} - ${val}`);
							
						})
					});

						
			}

			if (message.command === "load") {
				this.scopeGraphs = {}
				this.callstacksGraphCache = {}
				await this.loadFunctionsAndScopeInfo()
				webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
				if (this._view) {
					this._view.webview.postMessage({ command: "setElesDisabled", selector: "#btn-load", is_disabled: false });
					
					if (message.lastFunction) {
						this.showFunction(message.lastFunction.id)
						if (message.lastScope) {
							let scope = this.scopeSummaries.find(scope => { return scope.id == message.lastScope.scope.id })
							this._view.webview.postMessage({ command: "displayScope", scope: scope, checkbox_ids_to_check: message.lastScope.checkbox_ids_to_check });
						}
					}
					// this._view.webview.postMessage({ command: "displayFunction", function: message.lastFunction, navigated_from_history: false });
				}
			}

			if (message.command === "save") {
				await this.saveFunctionInfo()
				if (this._view)
					this._view.webview.postMessage({ command: "setElesDisabled", selector: "#btn-save", is_disabled: false });

			}

			if (message.command === "update_decorator") {
				let func = this.functionDefinitionsMap.get(message.funcId)
				
				if (func)
					func.decorator = message.value
				this.buildCallstacks()
			}

			if (message.command === "update_function_notes") {
				let func = this.functionDefinitionsMap.get(message.funcId)
				
				if (func)
					func.function_notes = message.value
			}

			if (message.command === "toggleHelpHTML") {
				if (this._view)
					this._view.webview.postMessage({ command: "toggleHelpHTML", helpHTML: this.helpHTML });
			}

			if (message.command === "togogle_interesting_functions_mode") {
				this.settings.showAllFunctions = message.value === "true" ? true : false
			}

			if (message.command === "requestFuncStateVarReadWriteMapping") {
				if (this._view)
					this._view.webview.postMessage({ command: "receiveFuncStateVarReadWriteMapping", mapping: this.funcStateVarReadWrittenMapping });
			}

			// graph commands
			if (message.command === "save_graph") {
				this.saveFile(message.content)
			}

			if (message.command === "load_graph") {
				let file_obj = await this.loadFile()
				
				// load graph @ message.graph_id
				if (this._view)
					this._view.webview.postMessage({ command: "setGraph", graph_id: message.graph_id, filename: file_obj.filename, graph: JSON.parse(file_obj.content) });
			}			
			
			if (message.command === 'manually_map_function_relationship') {

				this.manuallyMapFunctionRelationship(message.f_id)
			}
			
			

			if (message.command === "expand_graph_by_function") {
				const graph = this.joinGraphByFunction(message.graph_nodes, message.graph_edges, message.f_id, message.direction)

				// load graph @ message.graph_id
				if (this._view)
					this._view.webview.postMessage({ command: "setGraph", graph_id: message.graph_id, graph: graph, f_id: message.f_id });
			}

			if (message.command === "eval_failure") {
				vscode.window.showErrorMessage(`If unsafe eval is not enabled, please enable in extension settings.\n${message.error}`)
			}

		});
	}



	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

		const scriptMarkUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'mark.min.js'));
		const scriptPakoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'pako.min.js'));

		const scriptCytoscapeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'cytoscapes', 'cytoscape.min.js'));
		const scriptElkUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'cytoscapes', 'elk.bundled.js'));
		

		const scriptElkAdaptorUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'cytoscapes', 'cytoscape-elk.js'));
		const scriptDagreUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'cytoscapes', 'dagre.min.js'));
		const scriptCytoscapeDagreUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'cytoscapes', 'cytoscape-dagre.js'));
		const scriptCytoscapeMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'cytoscapes', 'main.js'));
		const scriptCytoscapeNodeLabelUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'cytoscapes', 'cytoscape-html-node-label.js'));

		const HighlightUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'highlight', 'highlight.min.js'));
		const HighlightSolidityUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'highlight', 'solidity.min.js'));
		const styleHighlightUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'highlight', 'highlight.min.css'));

		const scriptPrismUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'prism', 'prism-core.min.js'));
		const stylePrismUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'prism', 'prism.min.css'));
		const stylePrismTomorrowNightThemeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'prism', 'prism-tomorrow.min.css'));
		const scriptPrismSolidityUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'prism', 'prism-solidity.min.js'));
		// const scriptPrismAutoloaderUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'prism', 'prism-autoloader.min.js'));

		const nonce = getNonce();

		// Local path to css styles
		const styleMainPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css');

		// Uri to load styles into webview
		const stylesMainUri = webview.asWebviewUri(styleMainPath);

		const enableUnsafeEval = vscode.workspace.getConfiguration('static-analysis').get<boolean>('enableUnsafeEval');

		return `<!DOCTYPE html>
			<html lang="en">
				
				<head>
					<meta charset="UTF-8">

					<!--
						Use a content security policy to only allow loading styles from our extension directory,
						and only allow scripts that have a specific nonce.
						(See the 'webview-sample' extension sample for img-src content security policy examples)
					-->
					<!-- 
						<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
					-->
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${enableUnsafeEval ? "'unsafe-eval'" : ""};">

					<meta name="viewport" content="width=device-width, initial-scale=1.0">
			
					<link href="${stylesMainUri}" rel="stylesheet">
					<link href="${styleHighlightUri}" rel="stylesheet">
					<link href="${stylePrismUri}" rel="stylesheet">

					<title>Static Analysis: Functions View</title>
				</head>
				<body>

					<header class='sticky-header'>
						<button id='show-all-inheritance-graph-btn'>Show Inheritance Graph</button>
						<button id='show-all-scope-graph-btn'>Show In Scope Graph</button>
						<button id='show-callstacks-graph-with-search-term-btn'>Show Callstacks Graph w/ Search Term</button>
						<select id='select-cytoscapes-layout'>
							<option>dagre</option>
							<option>elk</option>
						</select>
						<select id='select-syntax-highlighter'>
							<option>Prism</option>
							<option>HighlightJS</option>
							<option>Disabled</option>
						</select>
						<select id='select-function-sort'>
							<option>Alpha. + Line #</option>
							<option>Alpha. + SLOC</option>
							<option>SLOC</option>
							<option>Alpha. + # Callstacks</option>
							<option># Callstacks</option>
						</select>
						<select id='toggle-reviewed'>
							<option>Hide Reviewed Except In Scope</option>
							<option>In Scope Only</option>
							<option>Hide Reviewed</option>
							<option>Show Reviewed</option>
						</select>
						${ this.searchTemplates.length > 0 ? "<select id='select-search-template'><option></option>" : '' }
							${this.searchTemplates.map((t, i) => { 
								let include = !t.include ? '' : t.include.replace(/"/g, '&quot;')
								let exclude = !t.exclude ? '' : t.exclude.replace(/"/g, '&quot;')
								let highlight = !t.highlight ? '' : t.highlight.replace(/"/g, '&quot;')
								
								return `<option data-include="${include}" data-exclude="${exclude}" data-highlight="${highlight}">${t.name || ""}: ${t.include} | ${t.exclude}</option>` }).join("")
							}
						${ this.searchTemplates.length > 0 ? "</select>" : '' }
						<button id='search-functions'>Search Functions</button>
						<button id='search-scopes'>Search Scopes</button>
						<input id='function-selector-textbox' class='input-textbox' placeholder='filter functions' type='text' />
						<input id='function-selector-exclude-textbox' class='input-textbox' placeholder='exclude functions regex' type='text' />
						<button id='function-back'>back</button>
						<button id='function-forward'>forward</button>
						<button id='btn-mark-all-reviewed' disabled>Mak All (Un)Reviewed</button>
						<button id='btn-bulk-update-decorator' disabled>+/- decorator</button>
						<button id='btn-save'>save</button>
						<button id='btn-load'>load</button>
						<input id='search-textbox' class='input-textbox' placeholder='search/highlight regex' type='text' />
						${this.helpHTML ? "<button id='toggle-help'>Help</button>" : ''}
						<button id='include-related-callstacks-btn' value="false">Excluding Related Callstacks</button>
						<button id='callstacks-graph-mode-btn' value="Combined">Fn Graph Mode: Combined</button>
						<button id='show-all-functions-btn' value="false">Showing Interesting Functions</button>
						<span id='selectedStateVar' style='float: right'></span>
						<br>
						<span id='decorator-description'>Unique decorator unicode (save/load to refresh): <span id='decorator-description-value'>${this.decoratorUnicode}</span></span>   
						<div id='help'></div>
					</header>


					<div id='content'>
						<ul id='functions-list'></ul>
						
						<div id='scope-graph-container' style='display: none'></div>

						<div class='container'>
							<div id='function-summary'></div>
							<div id='resizable-handle'></div>
							<div id='scope-detail'></div>
						</div>
					</div>
				
					<script nonce="${nonce}" src="${scriptUri}"></script>
					<script nonce="${nonce}" src="${scriptMarkUri}"></script>
					<script nonce="${nonce}" src="${scriptPakoUri}"></script>

					<!-- Cytoscape imports -->
					<script nonce="${nonce}" src="${scriptCytoscapeUri}"></script>
					<script nonce="${nonce}" src="${scriptElkUri}"></script>
					<script nonce="${nonce}" src="${scriptElkAdaptorUri}"></script>
					<script nonce="${nonce}" src="${scriptDagreUri}"></script>
					<script nonce="${nonce}" src="${scriptCytoscapeDagreUri}"></script>
					<script nonce="${nonce}" src="${scriptCytoscapeMainUri}"></script>
					<script nonce="${nonce}" src="${scriptCytoscapeNodeLabelUri}"></script>
					
					<script nonce="${nonce}" src="${HighlightUri}"></script>
					<script nonce="${nonce}" src="${HighlightSolidityUri}"></script>

					<script nonce="${nonce}" src="${scriptPrismUri}"></script>
					<script nonce="${nonce}" src="${scriptPrismSolidityUri}"></script>

				</body>
			</html>`;
	}
}


function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}


function escapeRegExp(text: string) {
    try {
        new RegExp(text)
        return text
    } catch (e) {
        return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    }
}
