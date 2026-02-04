# CSV Diff Viewer - VSCode Extension

A VSCode extension that displays differences in modified CSV files, similar to the Source Control interface.

## 🎯 Features

- **Source Control View for CSV** : Displays all modified CSV files in a dedicated view
- **Difference Analysis** :
    - Added columns ➕
    - Removed columns ➖
    - Moved columns 🔄
    - Moved rows ↕️
- **Visual Report** : Clear interface with color coding for each type of modification

## 📦 Installation

### From GitHub Releases (Recommended)

1. Download the latest `.vsix` file from [GitHub Releases](https://github.com/cchaize/csv-diff/releases)

2. Install it in VSCode:
   - **Option A (GUI)**: `Extensions` → `...` → `Install from VSIX...` → Select the file
   - **Option B (Command line)**:
     ```bash
     code --install-extension csv-diff-viewer-0.0.1.vsix
     ```
   - **Option C (Download + Install)**:
     ```bash
     wget https://github.com/cchaize/csv-diff/releases/download/v0.0.1/csv-diff-viewer-0.0.1.vsix
     code --install-extension ./csv-diff-viewer-0.0.1.vsix
     ```

### For Colleagues

1. Install `vsce` (VSCode Extension Manager):
    ```bash
    npm install -g @vscode/vsce
    ```
2. Create the VSIX package:
    ```bash
    vsce package
    ```
3. Share the generated `.vsix` file with colleagues
4. They can install it in VSCode:
    - `Extensions` → `...` → `Install from VSIX...`
    - Or via command line: `code --install-extension csv-diff-viewer-0.0.1.vsix`

### For Local Development

1. Clone the repository
2. Install dependencies:
    ```bash
    npm install
    ```
3. Compile the extension:
    ```bash
    npm run compile
    ```
4. Press `F5` to launch the extension in debug mode

## 🚀 Usage

1. **Open a Git project** containing CSV files
2. **Modify a CSV file** in your project
3. **Open the "CSV Changes" view**:
    - It appears automatically in the Source Control section
    - Or via `Ctrl+Shift+P` → "View: Show CSV Changes"
4. **Click on a CSV file** in the list to see the difference report

## 📊 Report Example

The report displays:

```
📊 CSV Diff Report
File: data.csv

➕ Added Columns (2)
• email
• phone

➖ Removed Columns (1)
• fax

🔄 Moved Columns (1)
• name: position 2 → 0

↕️ Moved Rows (3)
• Row "Alice": row 2 → 5
• Row "Bob": row 3 → 2
```

## 🔧 Requirements

- VSCode version 1.85.0 or higher
- Git installed and initialized in your workspace
- VSCode Git extension enabled

## ⚙️ Available Commands

- `CSV Diff Viewer: Refresh` - Refresh the list of modified CSV files
- `CSV Diff Viewer: Show Diff` - Display the difference report (automatic on click)

## 🏗️ Project Structure

```
csv-diff-extension/
├── package.json          # Extension configuration
├── tsconfig.json         # TypeScript configuration
├── src/
│   └── extension.ts      # Main extension code
└── README.md            # This file
```

## 🔍 How It Works

1. **Detection** : The extension monitors Git changes to identify modified CSV files
2. **Extraction** : It retrieves the HEAD version (git) and the current version of the file
3. **Parsing** : Uses `csv-parse` to analyze both versions
4. **Analysis** : Compares headers and rows to detect modifications
5. **Display** : Generates an HTML report with color coding in a webview

## 🛠️ Development

### Compile in watch mode

```bash
npm run watch
```

### Debugging

1. Press `F5` in VSCode
2. A new VSCode window opens with the extension loaded
3. Open a Git project with CSV files
4. Modify a CSV and watch the "CSV Changes" view

### Building for colleagues

To share with colleagues, build a VSIX file:

```bash
npm install -g @vscode/vsce
vsce package
```

This creates a `.vsix` file that colleagues can install directly in VSCode via `Extensions: Install from VSIX`.

## 📝 Technical Notes

2. A new VSCode window opens with the extension loaded
3. Open a Git project with CSV files
4. Modify a CSV and watch the "CSV Changes" view

## 📝 Technical Notes

- **Row Identification** : The extension uses the first column as a unique identifier to detect row movements
- **CSV Format** : Compatible with standard CSV formats (comma, semicolon, etc.)
- **Performance** : Optimized for medium-sized CSV files (< 10,000 rows)

## 🐛 Known Limitations

- Rows must have a unique identifier in the first column for movement detection
- Does not detect content modifications in cells (structure only)
- Requires a Git repository

## 🤝 Contributing

To contribute to this extension:

1. Fork the project
2. Create a branch for your feature
3. Commit your changes
4. Create a Pull Request

## 📄 License

MIT

## 👤 Author

Extension created to facilitate management and tracking of CSV file modifications in VSCode.
