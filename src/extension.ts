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
        await displayDiffReport(fileUri, diff, oldData, newData);
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
    movedRows: Array<{
        rowId: string;
        oldIndex: number;
        newIndex: number;
        rowData: string[];
    }>;
    addedRows: string[][];
    deletedRows: string[][];
    oldHeaders: string[];
    newHeaders: string[];
}

function analyzeCsvDiff(oldData: string[][], newData: string[][]): CsvDiff {
    const diff: CsvDiff = {
        addedColumns: [],
        removedColumns: [],
        movedColumns: [],
        movedRows: [],
        addedRows: [],
        deletedRows: [],
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

    // Detect moved columns using LIS algorithm
    // Build a list of columns that exist in both old and new, with their positions
    const columnMatches: Array<{ column: string; oldIndex: number; newIndex: number }> = [];
    for (let i = 0; i < oldHeaders.length; i++) {
        const header = oldHeaders[i];
        const newIndex = newHeaders.indexOf(header);

        if (newIndex !== -1) {
            columnMatches.push({
                column: header,
                oldIndex: i,
                newIndex: newIndex,
            });
        }
    }

    // Find LIS based on newIndex positions
    const newIndices = columnMatches.map(m => m.newIndex);
    const lisIndices = getLongestIncreasingSubsequence(newIndices);
    const lisSet = new Set(lisIndices);

    // Mark columns not in LIS as moved
    for (const match of columnMatches) {
        if (!lisSet.has(match.newIndex)) {
            diff.movedColumns.push({
                column: match.column,
                oldIndex: match.oldIndex,
                newIndex: match.newIndex,
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

        // First pass: match all rows and detect added/deleted
        const rowMatches: Array<{
            oldIndex: number;
            newIndex: number;
            rowData: string[];
        }> = [];
        const matchedOldRows = new Set<number>();
        const matchedNewRows = new Set<number>();

        for (let i = 0; i < oldRows.length; i++) {
            // Extract normalized old row (only relevant columns)
            const normalizedOldRow = oldKeepIndices
                .map((index) => oldRows[i][index])
                .join("|");

            let found = false;
            for (let j = 0; j < newRows.length; j++) {
                if (matchedNewRows.has(j)) continue;

                // Extract normalized new row (only relevant columns)
                const normalizedNewRow = newKeepIndices
                    .map((index) => newRows[j][index])
                    .join("|");

                if (normalizedOldRow === normalizedNewRow) {
                    found = true;
                    matchedNewRows.add(j);
                    matchedOldRows.add(i);

                    rowMatches.push({
                        oldIndex: i,
                        newIndex: j,
                        rowData: newRows[j],
                    });
                    break;
                }
            }

            // If row not found in new data, it's deleted
            if (!found) {
                diff.deletedRows.push(oldRows[i]);
            }
        }

        // Detect added rows (rows in new data that weren't matched)
        for (let j = 0; j < newRows.length; j++) {
            if (!matchedNewRows.has(j)) {
                diff.addedRows.push(newRows[j]);
            }
        }

        // Second pass: detect actual moves using Longest Increasing Subsequence (LIS)
        // Rows that maintain their relative order are not moved
        // Only rows that break the sequence are marked as moved

        // Build sequence of newIndex values for matched rows
        const newIndices = rowMatches.map((m) => m.newIndex);

        // Find Longest Increasing Subsequence
        const lis = getLongestIncreasingSubsequence(newIndices);
        const lisSet = new Set(lis);

        // Mark rows not in LIS as moved
        for (const match of rowMatches) {
            if (!lisSet.has(match.newIndex)) {
                const rowId = oldRows[match.oldIndex][0];
                diff.movedRows.push({
                    rowId: rowId,
                    oldIndex: match.oldIndex + 1, // +1 because we excluded header
                    newIndex: match.newIndex + 1,
                    rowData: match.rowData,
                });
            }
        }
    }

    return diff;
}

// Helper function: Find Longest Increasing Subsequence indices
function getLongestIncreasingSubsequence(arr: number[]): number[] {
    if (arr.length === 0) return [];

    const n = arr.length;
    const dp: number[] = new Array(n).fill(1);
    const parent: number[] = new Array(n).fill(-1);

    for (let i = 1; i < n; i++) {
        for (let j = 0; j < i; j++) {
            if (arr[j] < arr[i] && dp[j] + 1 > dp[i]) {
                dp[i] = dp[j] + 1;
                parent[i] = j;
            }
        }
    }

    // Find index with maximum LIS length
    let maxLength = 0;
    let maxIndex = 0;
    for (let i = 0; i < n; i++) {
        if (dp[i] > maxLength) {
            maxLength = dp[i];
            maxIndex = i;
        }
    }

    // Reconstruct LIS
    const result: number[] = [];
    let current = maxIndex;
    while (current !== -1) {
        result.unshift(arr[current]);
        current = parent[current];
    }

    return result;
}

async function displayDiffReport(
    fileUri: vscode.Uri,
    diff: CsvDiff,
    oldData: string[][],
    newData: string[][],
) {
    const panel = vscode.window.createWebviewPanel(
        "csvDiffReport",
        `CSV Diff: ${path.basename(fileUri.fsPath)}`,
        vscode.ViewColumn.One,
        {},
    );

    panel.webview.html = getWebviewContent(fileUri, diff, oldData, newData);
}

function buildCompleteView(
    diff: CsvDiff,
    oldData: string[][],
    newData: string[][],
) {
    // Build headers in the correct order:
    // - Follow current order (newHeaders)
    // - Insert removed columns at their original position
    const allHeaders: string[] = [];
    const headerStatus: Map<string, "added" | "removed" | "moved" | "normal"> =
        new Map();

    const maxHeaderLength = Math.max(
        diff.oldHeaders.length,
        diff.newHeaders.length,
    );
    const addedHeaders = new Set<string>();

    for (let i = 0; i < maxHeaderLength; i++) {
        // First, add removed column from old position if exists
        if (i < diff.oldHeaders.length) {
            const oldHeader = diff.oldHeaders[i];
            if (diff.removedColumns.includes(oldHeader)) {
                if (!addedHeaders.has(oldHeader)) {
                    allHeaders.push(oldHeader);
                    headerStatus.set(oldHeader, "removed");
                    addedHeaders.add(oldHeader);
                }
            }
        }

        // Then, add current column at this position if exists
        if (i < diff.newHeaders.length) {
            const newHeader = diff.newHeaders[i];
            if (!addedHeaders.has(newHeader)) {
                allHeaders.push(newHeader);
                addedHeaders.add(newHeader);

                // Determine status
                if (diff.addedColumns.includes(newHeader)) {
                    headerStatus.set(newHeader, "added");
                } else if (
                    diff.movedColumns.some((m) => m.column === newHeader)
                ) {
                    headerStatus.set(newHeader, "moved");
                } else {
                    headerStatus.set(newHeader, "normal");
                }
            }
        }
    }

    // Build all rows with their status
    const allRows: Array<{
        data: Map<string, string>;
        status: "added" | "removed" | "moved" | "normal";
        identifier: string;
    }> = [];

    const oldRows = oldData.slice(1);
    const newRows = newData.slice(1);

    // Build a map of old row identifiers to their index
    const oldRowIndexMap = new Map<string, number>();
    for (let i = 0; i < oldRows.length; i++) {
        oldRowIndexMap.set(oldRows[i][0], i);
    }

    // Build a map of new row identifiers to their index
    const newRowIndexMap = new Map<string, number>();
    for (let i = 0; i < newRows.length; i++) {
        newRowIndexMap.set(newRows[i][0], i);
    }

    const maxLength = Math.max(oldRows.length, newRows.length);
    const processedOldRows = new Set<number>();
    const processedNewRows = new Set<number>();

    for (let i = 0; i < maxLength; i++) {
        // First, add deleted row from old position if exists
        if (i < oldRows.length && !processedOldRows.has(i)) {
            const oldRow = oldRows[i];
            const identifier = oldRow[0];

            if (diff.deletedRows.some((row) => row[0] === identifier)) {
                const rowData = new Map<string, string>();
                for (let j = 0; j < diff.oldHeaders.length; j++) {
                    rowData.set(diff.oldHeaders[j], oldRow[j]);
                }
                allRows.push({
                    data: rowData,
                    status: "removed",
                    identifier: identifier,
                });
                processedOldRows.add(i);
            }
        }

        // Then, add current row at this position if exists
        if (i < newRows.length && !processedNewRows.has(i)) {
            const newRow = newRows[i];
            const identifier = newRow[0];

            const rowData = new Map<string, string>();

            // Add values from new data
            for (let j = 0; j < diff.newHeaders.length; j++) {
                rowData.set(diff.newHeaders[j], newRow[j]);
            }

            // Add values from old data for removed columns
            const oldIndex = oldRowIndexMap.get(identifier);
            if (oldIndex !== undefined) {
                const oldRow = oldRows[oldIndex];
                for (let j = 0; j < diff.oldHeaders.length; j++) {
                    const header = diff.oldHeaders[j];
                    if (diff.removedColumns.includes(header)) {
                        rowData.set(header, oldRow[j]);
                    }
                }
            }

            // Determine status
            let status: "added" | "removed" | "moved" | "normal" = "normal";
            if (diff.addedRows.some((row) => row[0] === identifier)) {
                status = "added";
            } else if (diff.movedRows.some((m) => m.rowId === identifier)) {
                status = "moved";
            }

            allRows.push({
                data: rowData,
                status: status,
                identifier: identifier,
            });
            processedNewRows.add(i);

            // Mark old row as processed if it exists
            if (oldIndex !== undefined) {
                processedOldRows.add(oldIndex);
            }
        }
    }

    return { allHeaders, headerStatus, allRows };
}

function getWebviewContent(
    fileUri: vscode.Uri,
    diff: CsvDiff,
    oldData: string[][],
    newData: string[][],
): string {
    const fileName = path.basename(fileUri.fsPath);
    const completeView = buildCompleteView(diff, oldData, newData);

    let html = `<!DOCTYPE html>
<html lang="en">
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
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0;
            font-size: 0.9em;
        }
        table th {
            background-color: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            padding: 8px;
            text-align: left;
            border: 1px solid var(--vscode-panel-border);
            font-weight: bold;
        }
        table td {
            padding: 8px;
            border: 1px solid var(--vscode-panel-border);
        }
        table tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .row-info {
            font-style: italic;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 5px;
        }
        .complete-table {
            overflow-x: auto;
        }
        .complete-table table {
            font-size: 0.85em;
        }
        .complete-table th.header-added {
            background-color: rgba(78, 201, 176, 0.2);
            color: #4ec9b0;
        }
        .complete-table th.header-removed {
            background-color: rgba(244, 135, 113, 0.2);
            color: #f48771;
        }
        .complete-table th.header-moved {
            background-color: rgba(220, 220, 170, 0.2);
            color: #dcdcaa;
        }
        .complete-table tr.row-added {
            background-color: rgba(78, 201, 176, 0.1);
        }
        .complete-table tr.row-removed {
            background-color: rgba(244, 135, 113, 0.1);
            color: var(--vscode-descriptionForeground);
            opacity: 0.7;
        }
        .complete-table tr.row-moved {
            background-color: rgba(220, 220, 170, 0.1);
        }
        .complete-table td.cell-removed-column {
            background-color: rgba(244, 135, 113, 0.3);
            color: var(--vscode-descriptionForeground);
            opacity: 0.7;
        }
        .complete-table td.cell-diagonal {
            background: 
                linear-gradient(to top right,
                    rgba(0,0,0,0) 0%,
                    rgba(0,0,0,0) calc(50% - 1px),
                    var(--vscode-panel-border) 50%,
                    rgba(0,0,0,0) calc(50% + 1px),
                    rgba(0,0,0,0) 100%);
        }
    </style>
</head>
<body>
    <h1>📊 CSV Diff Report</h1>
    <p><strong>File:</strong> ${fileName}</p>
    
    <div class="section">
        <h2 class="added">➕ Added Columns <span class="count">(${diff.addedColumns.length})</span></h2>
        ${
            diff.addedColumns.length > 0
                ? `<ul>${diff.addedColumns.map((col) => `<li class="added">• ${col}</li>`).join("")}</ul>`
                : '<p class="no-changes">No columns added</p>'
        }
    </div>
    
    <div class="section">
        <h2 class="removed">➖ Removed Columns <span class="count">(${diff.removedColumns.length})</span></h2>
        ${
            diff.removedColumns.length > 0
                ? `<ul>${diff.removedColumns.map((col) => `<li class="removed">• ${col}</li>`).join("")}</ul>`
                : '<p class="no-changes">No columns removed</p>'
        }
    </div>
    
    <div class="section">
        <h2 class="moved">🔄 Moved Columns <span class="count">(${diff.movedColumns.length})</span></h2>
        ${
            diff.movedColumns.length > 0
                ? `<ul>${diff.movedColumns
                      .map(
                          (m) =>
                              `<li class="moved">• ${m.column}: position ${m.oldIndex} → ${m.newIndex}</li>`,
                      )
                      .join("")}</ul>`
                : '<p class="no-changes">No columns moved</p>'
        }
    </div>
    
    <div class="section">
        <h2 class="moved">↕️ Moved Rows <span class="count">(${diff.movedRows.length})</span></h2>
        ${
            diff.movedRows.length > 0
                ? diff.movedRows
                      .map(
                          (m) => `
                    <div class="row-info">Row ${m.oldIndex} → ${m.newIndex}</div>
                    <table>
                        <thead>
                            <tr>
                                ${diff.newHeaders.map((h) => `<th>${h}</th>`).join("")}
                            </tr>
                        </thead>
                        <tbody>
                            <tr class="moved">
                                ${m.rowData.map((cell) => `<td>${cell}</td>`).join("")}
                            </tr>
                        </tbody>
                    </table>
                `,
                      )
                      .join("")
                : '<p class="no-changes">No rows moved</p>'
        }
    </div>
    
    <div class="section">
        <h2 class="added">➕ Added Rows <span class="count">(${diff.addedRows.length})</span></h2>
        ${
            diff.addedRows.length > 0
                ? `
                <table>
                    <thead>
                        <tr>
                            ${diff.newHeaders.map((h) => `<th>${h}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${diff.addedRows
                            .map(
                                (row) =>
                                    `<tr class="added">${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`,
                            )
                            .join("")}
                    </tbody>
                </table>
                `
                : '<p class="no-changes">No rows added</p>'
        }
    </div>
    
    <div class="section">
        <h2 class="removed">➖ Removed Rows <span class="count">(${diff.deletedRows.length})</span></h2>
        ${
            diff.deletedRows.length > 0
                ? `
                <table>
                    <thead>
                        <tr>
                            ${diff.oldHeaders.map((h) => `<th>${h}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${diff.deletedRows
                            .map(
                                (row) =>
                                    `<tr class="removed">${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`,
                            )
                            .join("")}
                    </tbody>
                </table>
                `
                : '<p class="no-changes">No rows removed</p>'
        }
    </div>
    
    <div class="section complete-table">
        <h2>📋 Complete View</h2>
        <p style="color: var(--vscode-descriptionForeground); font-size: 0.9em;">
            Display of all rows and columns with their status
        </p>
        <table>
            <thead>
                <tr>
                    ${completeView.allHeaders
                        .map((header) => {
                            const status =
                                completeView.headerStatus.get(header) ||
                                "normal";
                            const className =
                                status === "normal" ? "" : `header-${status}`;
                            return `<th class="${className}">${header}</th>`;
                        })
                        .join("")}
                </tr>
            </thead>
            <tbody>
                ${completeView.allRows
                    .map((row) => {
                        const rowClass =
                            row.status === "normal" ? "" : `row-${row.status}`;
                        return `<tr class="${rowClass}">
                        ${completeView.allHeaders
                            .map((header) => {
                                const cellValue = row.data.get(header) || "";
                                const headerStatus =
                                    completeView.headerStatus.get(header) ||
                                    "normal";

                                // Diagonal line for added rows + removed columns
                                const isDiagonal =
                                    row.status === "added" &&
                                    headerStatus === "removed";

                                // Red background for removed columns (except for added rows)
                                const isRemovedColumn =
                                    headerStatus === "removed" &&
                                    row.status !== "added";

                                let cellClass = "";
                                if (isDiagonal) {
                                    cellClass = "cell-diagonal";
                                } else if (isRemovedColumn) {
                                    cellClass = "cell-removed-column";
                                }

                                return `<td class="${cellClass}">${cellValue}</td>`;
                            })
                            .join("")}
                    </tr>`;
                    })
                    .join("")}
            </tbody>
        </table>
    </div>
</body>
</html>`;

    return html;
}

export function deactivate() {}
