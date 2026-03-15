# GBStudio Plugin Patcher

A powerful desktop application for managing, updating, and validating GBStudio plugins with automatic three-way merge support and patch generation.

![GBStudio Plugin Patcher](./assets/dev.gbstudio.gb-studio.ico)

## Features

### 🔄 **Engine Update Mode**
When updating to a new GBStudio version, intelligently merge changes into existing plugins using three-way merge algorithm.

- Compares previous and new engine versions
- Automatically applies engine updates to plugin files
- Detects and logs conflicts for manual resolution
- Preserves manual plugin edits that don't conflict
- Updates engineAlt variants with same merge strategy

### 📦 **Plugin Update Mode**
Synchronize plugin engineAlt variants with updated engine source files.

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

### ✨ Additional Features

- 📝 Real-time progress tracking during operations
- 🔍 Detailed conflict reporting with context
- 📂 Quick folder access with integrated file explorer buttons
- ⚙️ Form validation - Update button disabled until all required fields filled
- 🧪 Automatic patch testing and validation
- 📋 Comprehensive operation logs
- 🎨 Blueprint-themed dark UI

---

## Quick Start

### Requirements

- **Node.js** 16+ and npm
- **ImageMagick** (optional, for icon generation)
- Windows, macOS, or Linux

### Installation

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

## Configuration

### GitHub Publishing

Publish releases to GitHub with both **installers** and **standalone portable zips**.

**Option 1: Full Publish (Recommended)**
```bash
npm run publish:full
```
Creates and publishes everything:
- ✅ Windows installer (.exe) - Traditional installation
- ✅ Standalone zips - Extract and run, no installation needed
- ✅ Linux packages (.deb, .rpm, AppImage)

**Option 2: Guided Publish**
```bash
npm run publish:guided
```
Simpler alternative that handles token securely.

**Option 3: Manual Control**
```bash
# Build artifacts
npm run make

# Publish (with token set)
GITHUB_TOKEN=your_token npm run publish
```

For detailed publishing instructions, see [PUBLISHING.md](./PUBLISHING.md).

**Getting a GitHub Token:**
1. Visit https://github.com/settings/tokens
2. Generate new token (classic)
3. Select `repo` scope
4. Copy token and use with publishing command

---

## Development

### Project Structure

```
src/
├── main.js                    # IPC handlers and main process logic
├── UpdatePluginsPage.jsx      # Main UI with mode selection
├── UpdatePluginHelper.js      # IPC wrapper functions
├── FolderSelector.jsx         # Folder input component
├── testPluginOutput.js        # Patch validation logic
├── preload.js                 # IPC bridge
├── main.css                   # Styling
└── index.html                 # Entry point
```

### Available Scripts

- `npm start` - Start development server
- `npm run package` - Package the application
- `npm run make` - Create installers and portable zips
- `npm run publish:full` - Build and publish everything to GitHub (recommended)
- `npm run publish:guided` - Interactive GitHub publishing
- `npm run publish` - Raw publish (advanced, requires GITHUB_TOKEN set)

### Debugging

1. **DevTools**: Press F12 during development to open Chrome DevTools
2. **Main Process Logs**: Check console output for IPC operations
3. **Logs**: Check `{output_folder}/update_process.log` after operations

### Three-Way Merge Algorithm

The application uses the `diff3` library for intelligent merging:

- **Base**: The common ancestor version (e.g., previous engine)
- **Ours**: The target version (e.g., new engine)
- **Theirs**: The variant (e.g., plugin or engineAlt)

Conflicts occur when both "ours" and "theirs" modified the same lines. The tool logs these conflicts for manual resolution rather than losing data.

---

## Building & Distribution

### Create Installers & Portable Zips

```bash
npm run make
```

Generates platform-specific artifacts:

**Windows:**
- `.exe` - Installer (traditional setup experience)
- `.zip` - Portable standalone version (extract and run)

**macOS/Linux:**
- `.zip` - Portable standalone version

**Linux-specific:**
- `.deb` - Debian/Ubuntu package
- `.rpm` - RedHat/Fedora package
- `.AppImage` - Universal Linux format

All zip files are **standalone** - just extract and run with no installation required.

### Publish to GitHub

```bash
npm run publish:full
```

Creates all artifacts and publishes to GitHub releases with:
- Version tag
- Auto-generated release notes
- All platform installers and portable zips

Users can then:
- Download installer for traditional installation
- Download zip file for portable use (all platforms)
- Use package managers on Linux

---

## Output File Structure

### Engine Update / Plugin Update

```
output_folder/
├── update_process.log           # Detailed operation log
├── patch_conflicts.log          # (If conflicts found)
└── author/
    └── PluginName/
        ├── plugin.json
        ├── engine/
        │   └── src/
        │       └── *.c
        ├── engineAlt/
        │   └── VariantName/
        │       └── ...
        ├── events/
        └── LICENSE
```

### Create Patches

```
output_folder/
├── update_process.log
└── author/
    └── PluginName/
        ├── plugin.json          (with engineAltRules if applicable)
        ├── engine/
        │   └── src/
        │       └── *.patch      (instead of .c files)
        ├── engineAlt/
        │   ├── Variant1/
        │   │   └── *.patch
        │   └── Variant2/
        │       └── *.patch
        ├── events/
        └── LICENSE
```

---

## Troubleshooting

### "Update button is disabled"
Make sure all required folder fields for the selected mode are filled.

### "Merge conflicts detected"
Check `patch_conflicts.log` in the output folder for conflict details. You'll need to manually resolve these conflicts in your plugin files.

### "Patch fails to apply"
Usually means the baseline engine doesn't match the one used to generate the patch. Ensure you're using the correct engine version.

### "GITHUB_TOKEN not found"
When publishing:
- Use `npm run publish:guided` for interactive setup
- Or set `$env:GITHUB_TOKEN = "token"; npm run publish` (Windows)
- Or `GITHUB_TOKEN="token" npm run publish` (macOS/Linux)

See [GITHUB_TOKEN_SETUP.md](./GITHUB_TOKEN_SETUP.md) for details.

---

## Documentation

- [TEST_DOCUMENTATION.md](./TEST_DOCUMENTATION.md) - Complete technical documentation
- [GITHUB_TOKEN_SETUP.md](./GITHUB_TOKEN_SETUP.md) - GitHub publishing setup
- [ICON_SETUP.md](./ICON_SETUP.md) - Icon generation guide (if applicable)

---

## Requirements & Dependencies

### Runtime
- Node.js 16+
- Electron 40.8.0

### Key Libraries
- **React 19** - UI framework
- **electron-forge** - Build and packaging
- **diff** - Patch generation
- **node-diff3** - Three-way merge algorithm

### Optional (for development)
- **ImageMagick** - Icon generation (Windows: `choco install imagemagick`)

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License - see [LICENSE](./LICENSE) file for details

---

## Support & Links

- **GitHub**: [Mico27/gbs-PluginPatchBuilder](https://github.com/Mico27/gbs-PluginPatchBuilder)
- **Author**: [Mico27](https://github.com/Mico27)
- **Email**: mickaelfortier616@msn.com

---

## Acknowledgments

- **GBStudio** - The excellent Game Boy toolkit this tool supports
- **electron-forge** - Robust Electron build framework
- **diff3** - Reliable three-way merge implementation

---

## Version History

### v1.0.0 (Current)
- Initial release
- Engine Update mode
- Plugin Update mode
- Create Patches mode
- GitHub release publishing
- Real-time progress tracking

---

## Related Projects

- [GBStudio](https://github.com/chrismaltby/gb-studio) - The Game Boy toolkit
- [GBStudio Plugins](https://github.com/topics/gbstudio-plugin) - Official plugin collection

---

**Happy patching! 🎮**
