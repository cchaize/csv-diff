# CSV Diff Viewer - Extension VSCode

Une extension VSCode qui affiche les différences dans les fichiers CSV modifiés, similaire à l'interface Source Control.

## 🎯 Fonctionnalités

- **Vue Source Control pour CSV** : Affiche tous les fichiers CSV modifiés dans une vue dédiée
- **Analyse des différences** :
  - Colonnes ajoutées ➕
  - Colonnes supprimées ➖
  - Colonnes déplacées 🔄
  - Lignes déplacées ↕️
- **Rapport visuel** : Interface claire avec code couleur pour chaque type de modification

## 📦 Installation

### Méthode 1 : Développement local

1. Clonez ou copiez les fichiers de l'extension dans un dossier
2. Ouvrez le dossier dans VSCode
3. Installez les dépendances :
   ```bash
   npm install
   ```
4. Compilez l'extension :
   ```bash
   npm run compile
   ```
5. Appuyez sur `F5` pour lancer l'extension en mode debug

### Méthode 2 : Package VSIX

1. Installez `vsce` (VSCode Extension Manager) :
   ```bash
   npm install -g @vscode/vsce
   ```
2. Créez le package :
   ```bash
   vsce package
   ```
3. Installez le fichier `.vsix` généré :
   - Menu VSCode : `Extensions` → `...` → `Install from VSIX...`
   - Ou via ligne de commande : `code --install-extension csv-diff-viewer-0.0.1.vsix`

## 🚀 Utilisation

1. **Ouvrez un projet Git** contenant des fichiers CSV
2. **Modifiez un fichier CSV** dans votre projet
3. **Ouvrez la vue "CSV Changes"** :
   - Elle apparaît automatiquement dans la section Source Control
   - Ou via `Ctrl+Shift+P` → "View: Show CSV Changes"
4. **Cliquez sur un fichier CSV** dans la liste pour voir le rapport des différences

## 📊 Exemple de rapport

Le rapport affiche :

```
📊 Rapport de différences CSV
Fichier: data.csv

➕ Colonnes ajoutées (2)
• email
• phone

➖ Colonnes supprimées (1)
• fax

🔄 Colonnes déplacées (1)
• name: position 2 → 0

↕️ Lignes déplacées (3)
• Ligne "Alice": ligne 2 → 5
• Ligne "Bob": ligne 3 → 2
```

## 🔧 Configuration requise

- VSCode version 1.85.0 ou supérieure
- Git installé et initialisé dans votre workspace
- Extension Git de VSCode activée

## ⚙️ Commandes disponibles

- `CSV Diff Viewer: Refresh` - Rafraîchir la liste des fichiers CSV modifiés
- `CSV Diff Viewer: Show Diff` - Afficher le rapport de différences (automatique au clic)

## 🏗️ Structure du projet

```
csv-diff-extension/
├── package.json          # Configuration de l'extension
├── tsconfig.json         # Configuration TypeScript
├── src/
│   └── extension.ts      # Code principal de l'extension
└── README.md            # Ce fichier
```

## 🔍 Comment ça marche

1. **Détection** : L'extension surveille les changements Git pour identifier les fichiers CSV modifiés
2. **Extraction** : Elle récupère la version HEAD (git) et la version actuelle du fichier
3. **Parsing** : Utilise `csv-parse` pour analyser les deux versions
4. **Analyse** : Compare les en-têtes et les lignes pour détecter les modifications
5. **Affichage** : Génère un rapport HTML avec code couleur dans un webview

## 🛠️ Développement

### Compiler en mode watch
```bash
npm run watch
```

### Débugger
1. Appuyez sur `F5` dans VSCode
2. Une nouvelle fenêtre VSCode s'ouvre avec l'extension chargée
3. Ouvrez un projet Git avec des CSV
4. Modifiez un CSV et observez la vue "CSV Changes"

## 📝 Notes techniques

- **Identification des lignes** : L'extension utilise la première colonne comme identifiant unique pour détecter les déplacements de lignes
- **Format CSV** : Compatible avec les CSV standards (virgule, point-virgule, etc.)
- **Performance** : Optimisé pour des fichiers CSV de taille moyenne (< 10 000 lignes)

## 🐛 Limitations connues

- Les lignes doivent avoir un identifiant unique dans la première colonne pour la détection de déplacement
- Ne détecte pas les modifications du contenu des cellules (uniquement structure)
- Nécessite un repository Git

## 🤝 Contribuer

Pour contribuer à cette extension :
1. Fork le projet
2. Créez une branche pour votre fonctionnalité
3. Committez vos changements
4. Créez une Pull Request

## 📄 Licence

MIT

## 👤 Auteur

Extension créée pour faciliter la gestion et le suivi des modifications de fichiers CSV dans VSCode.
