# GBStudio Plugin Patcher

Desktop application utility tool for managing, updating, and validating GBStudio plugins with automatic three-way merge support and patch generation.

![GBStudio Plugin Patcher](./assets/dev.gbstudio.gb-studio.ico)

## Features

### 🔄 **Engine Update Mode**
When updating to a new GBStudio version, merge changes into existing plugins using three-way merge algorithm.

- Compares previous and new engine versions
- Automatically applies engine updates to plugin files
- Detects and logs conflicts for manual resolution
- Preserves manual plugin edits that don't conflict
- Updates engineAlt variants with same merge strategy

### 📦 **Plugin Update Mode**
Synchronize plugin engineAlt variants with updated plugin source files.

- Updates compatibility variants after manual edits
- Three-way merge between previous plugin, new plugin, and variants
- Maintains variant-specific customizations
- Prevents losing important changes during updates

### 🔨 **Create Patches Mode**
Generate `.patch` files for plugins with automatic compatibility handling.

- Creates unified diff patches for plugin distribution
- Generates engineAlt compatibility folders automatically
- Creates minimal, unique folder abbreviations (e.g., "Co_Me" for ConfigLoadSavePlugin_MetaTilePlugin)
- Auto-generates engineAltRules in plugin.json
- Optional patch validation before completion

## Quick Start

### Requirements

- **Node.js** 16+ and npm
- **ImageMagick** (optional, for icon generation)
- Windows, macOS, or Linux

### Installation

Check release packages for an install or zipped standalone version.

Or build from repositionry:

1. **Clone the repository**
   ```bash
   git clone https://github.com/Mico27/gbs-PluginPatchBuilder.git
   cd gbs-PluginPatchBuilder
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm start
   ```

The application window will open automatically.

---

## Usage

### Engine Update Workflow

Use this when GBStudio releases a new version and you need to update your plugins.

1. Select **Engine update** from the dropdown
2. Choose your **Previous Engine Folder** (old GBStudio version)
3. Choose your **New Engine Folder** (new GBStudio version)
4. Choose your **Plugins Source Folder**
5. Choose an **Output Folder**
6. Click **Update**

**Result**: Updated plugins with merged changes in output folder. Any conflicts are logged to `patch_conflicts.log`.

---

### Plugin Update Workflow

Use this when you manually edit plugin source code and want to sync changes to compatibility variants.

1. Select **Plugin update** from the dropdown
2. Choose your **Previous Plugin Folder**
3. Choose your **New Plugin Folder** (with your edits)
4. Choose an **Output Folder**
5. Click **Update**

**Result**: Updated plugins with engineAlt variants synchronized to your changes.

---

### Create Patches Workflow

Use this to generate `.patch` files for sharing or contributing plugins.

1. Select **Create patches** from the dropdown
2. Choose your **Engine Folder** (baseline)
3. Choose your **Plugins Source Folder**
4. Choose an **Output Folder**
5. **(Optional)** Enable "Generate EngineAlt For Plugin Inter-compatibility"
6. **(Optional)** Enable "Test applying patches after creation"
7. Click **Update**

**Result**: 
- Plugins converted to `.patch` files
- Optional engineAlt folders generated
- Optional automatic validation of patches

---

## Troubleshooting

### "Merge conflicts detected"
Check `patch_conflicts.log` in the output folder for conflict details. You'll need to manually resolve these conflicts in your plugin files.

### "Patch fails to apply"
Means that the patch during automatic validation of patches failed to apply, usualy due to a faulty patch generated from lack of a manually combined plugin source file.

Let me know on the GB Studio discord if you have any other question or problems with this utility tool.

---

## License

MIT License - see [LICENSE](./LICENSE) file for details

---

## Related Projects

- [GBStudio](https://github.com/chrismaltby/gb-studio) - The Game Boy toolkit
- [GBStudio Plugins](https://github.com/topics/gbstudio-plugin) - Official plugin collection

---
