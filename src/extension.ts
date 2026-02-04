import * as vscode from "vscode";
import * as path from "path";
import { promises as fs } from "fs";
import { parse } from "csv-parse/sync";

export function activate(context: vscode.ExtensionContext) {
    const csvDiffProvider = new CsvDiffProvider();

    vscode.window.registerTreeDataProvider("csvDiffView", csvDiffProvider);

    context.subscriptions.push(
        vscode.commands.registerCommand("csvDiffViewer.refresh", () => {
            csvDiffProvider.refresh();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "csvDiffViewer.showDiff",
            async (item: CsvFileItem) => {
                await showCsvDiff(item.resourceUri);
            },
        ),
    );

    // Auto-refresh on file changes
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.csv");
    watcher.onDidChange(() => csvDiffProvider.refresh());
    watcher.onDidCreate(() => csvDiffProvider.refresh());
    watcher.onDidDelete(() => csvDiffProvider.refresh());
    context.subscriptions.push(watcher);
}

class CsvDiffProvider implements vscode.TreeDataProvider<CsvFileItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<
        CsvFileItem | undefined | void
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CsvFileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<CsvFileItem[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const modifiedCsvFiles: CsvFileItem[] = [];

        // Get git repository
        const gitExtension =
            vscode.extensions.getExtension("vscode.git")?.exports;
        const git = gitExtension?.getAPI(1);

        if (!git) {
            return [];
        }

        for (const repo of git.repositories) {
            const changes = repo.state.workingTreeChanges;

            for (const change of changes) {
                if (change.uri.fsPath.endsWith(".csv")) {
                    modifiedCsvFiles.push(
                        new CsvFileItem(
                            path.basename(change.uri.fsPath),
                            change.uri,
                            vscode.TreeItemCollapsibleState.None,
                        ),
                    );
                }
            }
        }

        return modifiedCsvFiles;
    }
}

class CsvFileItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super(label, collapsibleState);
        this.tooltip = resourceUri.fsPath;
        this.command = {
            command: "csvDiffViewer.showDiff",
            title: "Show CSV Diff",
            arguments: [this],
        };
        this.iconPath = new vscode.ThemeIcon("file-text");
    }
}

async function showCsvDiff(fileUri: vscode.Uri) {
    try {
        const gitExtension =
            vscode.extensions.getExtension("vscode.git")?.exports;
        const git = gitExtension?.getAPI(1);

        if (!git || git.repositories.length === 0) {
            vscode.window.showErrorMessage("No git repository found");
            return;
        }

        const repo = git.repositories[0];

        // Get HEAD version
        const headContent = await repo.show("HEAD", fileUri.fsPath);

        // Get current version
        const currentContent = await fs.readFile(fileUri.fsPath, "utf-8");

        // Parse CSV files
        const oldData = parseCsv(headContent);
        const newData = parseCsv(currentContent);

        // Analyze differences
        const diff = analyzeCsvDiff(oldData, newData);

        // Display report
        await displayDiffReport(fileUri, diff);
    } catch (error) {
        vscode.window.showErrorMessage(`Error analyzing CSV: ${error}`);
    }
}

function parseCsv(content: string): string[][] {
    try {
        return parse(content, {
            delimiter: ";",
            quote: '"',
            skip_empty_lines: true,
            relax_quotes: false,
            trim: false,
        });
    } catch (error) {
        throw new Error(`Failed to parse CSV: ${error}`);
    }
}

interface CsvDiff {
    addedColumns: string[];
    removedColumns: string[];
    movedColumns: Array<{ column: string; oldIndex: number; newIndex: number }>;
    movedRows: Array<{ rowId: string; oldIndex: number; newIndex: number }>;
    oldHeaders: string[];
    newHeaders: string[];
}

function analyzeCsvDiff(oldData: string[][], newData: string[][]): CsvDiff {
    const diff: CsvDiff = {
        addedColumns: [],
        removedColumns: [],
        movedColumns: [],
        movedRows: [],
        oldHeaders: [],
        newHeaders: [],
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
                newIndex: newIndex,
            });
        }
    }

    // Detect moved rows by comparing normalized row data
    // (excluding added/removed columns, keeping moved columns at their original positions)
    if (oldData.length > 1 && newData.length > 1) {
        const oldRows = oldData.slice(1);
        const newRows = newData.slice(1);

        // Get indices of columns to keep (those that are not added or removed)
        const oldKeepIndices = oldHeaders
            .map((header, index) =>
                !diff.removedColumns.includes(header) ? index : -1,
            )
            .filter((index) => index !== -1);

        const newKeepIndices = newHeaders
            .map((header, index) =>
                !diff.addedColumns.includes(header) ? index : -1,
            )
            .filter((index) => index !== -1);

        // Track which new rows have been matched to avoid duplicates
        const matchedNewRows = new Set<number>();

        for (let i = 0; i < oldRows.length; i++) {
            // Extract normalized old row (only relevant columns)
            const normalizedOldRow = oldKeepIndices
                .map((index) => oldRows[i][index])
                .join("|");

            for (let j = 0; j < newRows.length; j++) {
                if (matchedNewRows.has(j)) continue;

                // Extract normalized new row (only relevant columns)
                const normalizedNewRow = newKeepIndices
                    .map((index) => newRows[j][index])
                    .join("|");

                if (normalizedOldRow === normalizedNewRow && i !== j) {
                    // Use first column as row identifier for display
                    const rowId = oldRows[i][0];
                    diff.movedRows.push({
                        rowId: rowId,
                        oldIndex: i + 1, // +1 because we excluded header
                        newIndex: j + 1,
                    });
                    matchedNewRows.add(j);
                    break;
                }
            }
        }
    }

    return diff;
}

async function displayDiffReport(fileUri: vscode.Uri, diff: CsvDiff) {
    const panel = vscode.window.createWebviewPanel(
        "csvDiffReport",
        `CSV Diff: ${path.basename(fileUri.fsPath)}`,
        vscode.ViewColumn.One,
        {},
    );

    panel.webview.html = getWebviewContent(fileUri, diff);
}

function getWebviewContent(fileUri: vscode.Uri, diff: CsvDiff): string {
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
        ${
            diff.addedColumns.length > 0
                ? `<ul>${diff.addedColumns.map((col) => `<li class="added">• ${col}</li>`).join("")}</ul>`
                : '<p class="no-changes">Aucune colonne ajoutée</p>'
        }
    </div>
    
    <div class="section">
        <h2 class="removed">➖ Colonnes supprimées <span class="count">(${diff.removedColumns.length})</span></h2>
        ${
            diff.removedColumns.length > 0
                ? `<ul>${diff.removedColumns.map((col) => `<li class="removed">• ${col}</li>`).join("")}</ul>`
                : '<p class="no-changes">Aucune colonne supprimée</p>'
        }
    </div>
    
    <div class="section">
        <h2 class="moved">🔄 Colonnes déplacées <span class="count">(${diff.movedColumns.length})</span></h2>
        ${
            diff.movedColumns.length > 0
                ? `<ul>${diff.movedColumns
                      .map(
                          (m) =>
                              `<li class="moved">• ${m.column}: position ${m.oldIndex} → ${m.newIndex}</li>`,
                      )
                      .join("")}</ul>`
                : '<p class="no-changes">Aucune colonne déplacée</p>'
        }
    </div>
    
    <div class="section">
        <h2 class="moved">↕️ Lignes déplacées <span class="count">(${diff.movedRows.length})</span></h2>
        ${
            diff.movedRows.length > 0
                ? `<ul>${diff.movedRows
                      .map(
                          (m) =>
                              `<li class="moved">• Ligne "${m.rowId}": ligne ${m.oldIndex} → ${m.newIndex}</li>`,
                      )
                      .join("")}</ul>`
                : '<p class="no-changes">Aucune ligne déplacée</p>'
        }
    </div>
</body>
</html>`;

    return html;
}

export function deactivate() {}
