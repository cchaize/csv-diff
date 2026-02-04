"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs_1 = require("fs");
const sync_1 = require("csv-parse/sync");
function activate(context) {
    const csvDiffProvider = new CsvDiffProvider();
    vscode.window.registerTreeDataProvider('csvDiffView', csvDiffProvider);
    context.subscriptions.push(vscode.commands.registerCommand('csvDiffViewer.refresh', () => {
        csvDiffProvider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('csvDiffViewer.showDiff', async (item) => {
        await showCsvDiff(item.resourceUri);
    }));
    // Auto-refresh on file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.csv');
    watcher.onDidChange(() => csvDiffProvider.refresh());
    watcher.onDidCreate(() => csvDiffProvider.refresh());
    watcher.onDidDelete(() => csvDiffProvider.refresh());
    context.subscriptions.push(watcher);
}
class CsvDiffProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }
        const modifiedCsvFiles = [];
        // Get git repository
        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        const git = gitExtension?.getAPI(1);
        if (!git) {
            return [];
        }
        for (const repo of git.repositories) {
            const changes = repo.state.workingTreeChanges;
            for (const change of changes) {
                if (change.uri.fsPath.endsWith('.csv')) {
                    modifiedCsvFiles.push(new CsvFileItem(path.basename(change.uri.fsPath), change.uri, vscode.TreeItemCollapsibleState.None));
                }
            }
        }
        return modifiedCsvFiles;
    }
}
class CsvFileItem extends vscode.TreeItem {
    constructor(label, resourceUri, collapsibleState) {
        super(label, collapsibleState);
        this.label = label;
        this.resourceUri = resourceUri;
        this.collapsibleState = collapsibleState;
        this.tooltip = resourceUri.fsPath;
        this.command = {
            command: 'csvDiffViewer.showDiff',
            title: 'Show CSV Diff',
            arguments: [this]
        };
        this.iconPath = new vscode.ThemeIcon('file-text');
    }
}
async function showCsvDiff(fileUri) {
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        const git = gitExtension?.getAPI(1);
        if (!git || git.repositories.length === 0) {
            vscode.window.showErrorMessage('No git repository found');
            return;
        }
        const repo = git.repositories[0];
        // Get HEAD version
        const headContent = await repo.show('HEAD', fileUri.fsPath);
        // Get current version
        const currentContent = await fs_1.promises.readFile(fileUri.fsPath, 'utf-8');
        // Parse CSV files
        const oldData = parseCsv(headContent);
        const newData = parseCsv(currentContent);
        // Analyze differences
        const diff = analyzeCsvDiff(oldData, newData);
        // Display report
        await displayDiffReport(fileUri, diff);
    }
    catch (error) {
        vscode.window.showErrorMessage(`Error analyzing CSV: ${error}`);
    }
}
function parseCsv(content) {
    try {
        return (0, sync_1.parse)(content, {
            skip_empty_lines: true,
            relax_quotes: true,
            trim: true
        });
    }
    catch (error) {
        throw new Error(`Failed to parse CSV: ${error}`);
    }
}
function analyzeCsvDiff(oldData, newData) {
    const diff = {
        addedColumns: [],
        removedColumns: [],
        movedColumns: [],
        movedRows: [],
        oldHeaders: [],
        newHeaders: []
    };
    if (oldData.length === 0 || newData.length === 0) {
        return diff;
    }
    const oldHeaders = oldData[0];
    const newHeaders = newData[0];
    diff.oldHeaders = oldHeaders;
    diff.newHeaders = newHeaders;
    // Detect added columns
    for (let i = 0; i < newHeaders.length; i++) {
        const header = newHeaders[i];
        if (!oldHeaders.includes(header)) {
            diff.addedColumns.push(header);
        }
    }
    // Detect removed columns
    for (let i = 0; i < oldHeaders.length; i++) {
        const header = oldHeaders[i];
        if (!newHeaders.includes(header)) {
            diff.removedColumns.push(header);
        }
    }
    // Detect moved columns (columns that exist in both but at different positions)
    for (let i = 0; i < oldHeaders.length; i++) {
        const header = oldHeaders[i];
        const newIndex = newHeaders.indexOf(header);
        if (newIndex !== -1 && newIndex !== i) {
            diff.movedColumns.push({
                column: header,
                oldIndex: i,
                newIndex: newIndex
            });
        }
    }
    // Detect moved rows (using first column as identifier)
    if (oldData.length > 1 && newData.length > 1) {
        const oldRows = oldData.slice(1);
        const newRows = newData.slice(1);
        for (let i = 0; i < oldRows.length; i++) {
            const rowId = oldRows[i][0]; // Use first column as ID
            for (let j = 0; j < newRows.length; j++) {
                if (newRows[j][0] === rowId && i !== j) {
                    diff.movedRows.push({
                        rowId: rowId,
                        oldIndex: i + 1, // +1 because we excluded header
                        newIndex: j + 1
                    });
                    break;
                }
            }
        }
    }
    return diff;
}
async function displayDiffReport(fileUri, diff) {
    const panel = vscode.window.createWebviewPanel('csvDiffReport', `CSV Diff: ${path.basename(fileUri.fsPath)}`, vscode.ViewColumn.One, {});
    panel.webview.html = getWebviewContent(fileUri, diff);
}
function getWebviewContent(fileUri, diff) {
    const fileName = path.basename(fileUri.fsPath);
    let html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CSV Diff Report</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
        }
        h1 {
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
        }
        h2 {
            margin-top: 30px;
            color: var(--vscode-foreground);
        }
        .section {
            margin: 20px 0;
            padding: 15px;
            background-color: var(--vscode-editor-background);
            border-radius: 5px;
        }
        .added {
            color: #4ec9b0;
        }
        .removed {
            color: #f48771;
        }
        .moved {
            color: #dcdcaa;
        }
        ul {
            list-style-type: none;
            padding-left: 0;
        }
        li {
            padding: 5px 0;
            margin: 5px 0;
        }
        .no-changes {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .count {
            font-weight: bold;
            margin-left: 10px;
        }
    </style>
</head>
<body>
    <h1>📊 Rapport de différences CSV</h1>
    <p><strong>Fichier:</strong> ${fileName}</p>
    
    <div class="section">
        <h2 class="added">➕ Colonnes ajoutées <span class="count">(${diff.addedColumns.length})</span></h2>
        ${diff.addedColumns.length > 0
        ? `<ul>${diff.addedColumns.map(col => `<li class="added">• ${col}</li>`).join('')}</ul>`
        : '<p class="no-changes">Aucune colonne ajoutée</p>'}
    </div>
    
    <div class="section">
        <h2 class="removed">➖ Colonnes supprimées <span class="count">(${diff.removedColumns.length})</span></h2>
        ${diff.removedColumns.length > 0
        ? `<ul>${diff.removedColumns.map(col => `<li class="removed">• ${col}</li>`).join('')}</ul>`
        : '<p class="no-changes">Aucune colonne supprimée</p>'}
    </div>
    
    <div class="section">
        <h2 class="moved">🔄 Colonnes déplacées <span class="count">(${diff.movedColumns.length})</span></h2>
        ${diff.movedColumns.length > 0
        ? `<ul>${diff.movedColumns.map(m => `<li class="moved">• ${m.column}: position ${m.oldIndex} → ${m.newIndex}</li>`).join('')}</ul>`
        : '<p class="no-changes">Aucune colonne déplacée</p>'}
    </div>
    
    <div class="section">
        <h2 class="moved">↕️ Lignes déplacées <span class="count">(${diff.movedRows.length})</span></h2>
        ${diff.movedRows.length > 0
        ? `<ul>${diff.movedRows.map(m => `<li class="moved">• Ligne "${m.rowId}": ligne ${m.oldIndex} → ${m.newIndex}</li>`).join('')}</ul>`
        : '<p class="no-changes">Aucune ligne déplacée</p>'}
    </div>
</body>
</html>`;
    return html;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map