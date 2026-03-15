# GBStudio Plugin Patcher - Application Documentation

## Overview

The GBStudio Plugin Patcher is a tool for managing, updating, and validating GBStudio plugins through three distinct workflows:

1. **Engine Update** - When GBStudio updates to a new version, use three-way merges to automatically adapt plugins
2. **Plugin Update** - Synchronize plugin engineAlt variants with updated engine sources
3. **Create Patches** - Generate .patch files for plugins with automatic engineAlt compatibility handling

## Application Architecture

### Main Workflows

#### 1. Engine Update Mode
**Purpose**: When updating to a new GBStudio engine version, intelligently merge changes into existing plugins.

**Required Fields**:
- Previous Engine Folder (old GBStudio version)
- New Engine Folder (new GBStudio version)
- Plugins Source Folder (your plugins directory)
- Updated Plugins Output Folder

**Process Flow**:
```
1. Read all files from previous and new engines
   ↓
2. For each plugin:
   a. Read plugin engine files
   b. Read plugin engineAlt variants
   c. Perform three-way merge:
      - Base: previous engine file
      - Ours: new engine file
      - Theirs: plugin engine file
   d. Update plugin files with merged results
   e. For each engineAlt folder:
      - Perform three-way merge between new/previous plugin and alt variant
      - Handle conflicts by logging detailed information
   ↓
3. Write merged plugins to output folder
4. Log conflicts to patch_conflicts.log if any occur
5. Display results in UI
```

**Three-Way Merge Logic**:
- Detects when plugin files diverged from the old engine
- Automatically applies engine updates where plugins haven't made changes
- Identifies conflicts when both engine and plugin modified the same lines
- Preserves manual plugin edits that don't conflict

**Conflict Handling**:
- If conflicts detected → logged and documented
- If no conflicts → merged content saved automatically
- engineAlt variants handled with same merge strategy

---

#### 2. Plugin Update Mode
**Purpose**: Update plugin engineAlt sources to match changes made to plugin engine sources.

**Required Fields**:
- Previous Plugin Folder (original plugins)
- New Plugin Folder (updated plugins)
- Updated Plugins Output Folder

**Process Flow**:
```
1. Read all plugin engine files from previous and new plugin folders
   ↓
2. Read all engineAlt variant files from new plugin folder
   ↓
3. For each engineAlt variant:
   a. For each file in the engineAlt folder:
      - Perform three-way merge:
        - Base: previous plugin engine file
        - Ours: new plugin engine file
        - Theirs: engineAlt variant file
      - Update engineAlt files with merged results
   ↓
4. Write updated plugins to output folder
```

**Use Case**: After manually editing plugin source code, sync those changes to compatibility variants without overwriting manually configured differences.

---

#### 3. Create Patches Mode
**Purpose**: Generate .patch files for plugins to contribute to GBStudio or share with others.

**Required Fields**:
- Engine Folder (baseline for comparison)
- Plugins Source Folder (plugins to create patches for)
- Patched Plugins Output Folder
- Optional: Generate EngineAlt For Plugin Inter-compatibility
- Optional: Test applying patches after creation

**Process Flow**:
```
1. Read engine files (baseline)
   ↓
2. For each plugin:
   a. Read plugin engine files
   b. Create .patch file for each file that differs from baseline
   c. Remove original files (keep only .patch files)
   ↓
3. If "Generate EngineAlt" enabled:
   a. Analyze plugin dependencies from engineAlt folders
   b. For each engineAlt variant in plugin:
      - Create patches for engineAlt files
      - Generate engineAltRules in plugin.json with:
        * Minimal unique abbreviations (e.g., "Co" for ConfigLoadSavePlugin)
        * When conditions with plugin combinations
        * Use aliases pointing to abbreviation folders
   ↓
4. Write patched plugins to output folder
   ↓
5. If "Test applying patches" enabled:
   a. Copy engine to temporary directory
   b. Apply all generated patches in order
   c. Validate patch applicability
   d. Clean up temporary files
```

**EnginAlt Generation**:
- Generates unique abbreviations for plugin names (minimal distinguishing prefix)
- Creates rules sorted by specificity (most specific first)
- Supports both full names and abbreviated forms
- Example: "ConfigLoadSavePlugin_MetaTilePlugin" → folders "Co_Me" and rule with either form

## Implementation Details

### File Structure

```
src/
├── main.js                      # Main process - IPC handlers
├── UdatedPluginsPage.jsx       # UI - Mode selection and folder inputs
├── UpdatePluginHelper.js       # IPC wrapper functions for all modes
├── FolderSelector.jsx          # Reusable folder input component
├── testPluginOutput.js         # Patch validation/testing logic
├── preload.js                  # IPC bridge configuration
├── main.css                    # Styling
└── index.html                  # Entry point
```

### IPC Handlers (main.js)

#### `select-folder` Handler
Opens native file dialog for folder selection.

#### `open-folder` Handler
Opens selected folder in system file explorer using `shell.openPath()`.

#### `engine-update` Handler
```javascript
ipcMain.handle('engine-update', async (_, data) => {
  // Three-way merge: previous engine → new engine, apply to plugins
  // Handles plugin engineAlt folder variants
  // Records conflicts in patch_conflicts.log
})
```

**Inputs**:
- `previousEngineFolder` - Old engine version
- `newEngineFolder` - New engine version
- `pluginsFolder` - Plugins to update
- `updatedPluginsFolderOutput` - Output directory

**Outputs**:
- Updated plugin files in output folder
- `patch_conflicts.log` (if conflicts found)
- `update_process.log` (detailed operation log)

---

#### `update-plugins` Handler (update-plugin-sources)
```javascript
ipcMain.handle('update-plugins', async (_, data) => {
  // Three-way merge: previous plugin engine → new plugin engine, apply to engineAlts
})
```

**Inputs**:
- `previousPluginFolder` - Original plugins
- `newPluginFolder` - Updated plugins
- `updatedPluginsFolderOutput` - Output directory

---

#### `create-patches` Handler
```javascript
ipcMain.handle('create-patches', async (_, data) => {
  // Generate .patch files for plugin differences from baseline engine
  // Generate engineAlt compatibility folders and rules
})
```

**Inputs**:
- `engineFolder` - Baseline engine
- `pluginsFolder` - Plugins to patch
- `updatedPluginsFolderOutput` - Output directory
- `createEngineAlts` - Whether to generate compatibility variants

**Process**:
1. Creates patches by comparing plugin files to engine files
2. Generates unique abbreviations for plugin combinations
3. Creates engineAltRules in plugin.json with minimal, conflict-free abbreviations
4. Output contains only .patch files (originals removed)

---

#### `test-plugin-output` Handler
```javascript
ipcMain.handle('test-plugin-output', async (_, data) => {
  // Validates patch applicability
})
```

**Inputs**:
- `engineFolder` - Baseline to apply patches against
- `updatedPluginsFolderOutput` - Generated patches to test

**Process** (PluginOutputValidator):
1. Copies engine to temporary directory
2. Tests all plugin combinations for engineAlt rules
3. Applies patches in order
4. Reports success/failure for each combination
5. Cleans up temporary files

---

### Patch Abbreviation Algorithm

When generating engineAltRules with multiple plugin combinations, abbreviations are created using the **minimal distinguishing prefix** strategy:

```javascript
// For combination: ["ConfigLoadSavePlugin", "MetaTilePlugin"]
abbreviations = [
  "Co",  // Config... unique at 2 chars
  "Me"   // Meta... unique at 2 chars
]
// Result: folder name "Co_Me", rule with "ConfigLoadSavePlugin" or "ConfigLoadSavePlugin_MetaTilePlugin"

// For combination: ["ConfigLoadSavePlugin", "CopyRomDataToRamPlugin"]
abbreviations = [
  "Conf",  // Config... needs 4 chars to distinguish
  "Copy"   // Copy... unique at 1 char but uses 4 to match
]
// Result: folder name "Conf_Copy"
```

**Benefits**:
- Minimal folder names while avoiding collisions
- Unique within each plugin combination
- Readable abbreviations (first letters with minimal extension)

---

### Three-Way Merge Logic

All merge operations use the `diff3` library's three-way merge algorithm:

```javascript
const mergeResult = diff3.diff3Merge(
  newContent.split(/\r?\n/),     // "ours" - target content
  previousContent.split(/\r?\n/), // "base" - original common ancestor
  altContent.split(/\r?\n/)       // "theirs" - variant content
);

// Returns array of {ok: lines} or {conflict: {a, o, b}} objects
```

**Conflict Detection**:
- Conflict marked in result: `mergeResult.some(part => part.conflict)`
- Conflict recorded with details showing all three versions
- Original content kept when conflicts detected

---

## User Interface Features

### Mode Selection Dropdown
Located at the top of the page, allows switching between three update modes. Changing the mode:
- Updates required folder fields
- Shows/hides optional checkboxes
- Updates folder label descriptions

### Folder Selectors
Each folder input has three controls:
- **Text field** - Display selected path or type custom path
- **Browse button** - Open native folder dialog
- **Open button** - Launch folder in file explorer (disabled if empty)

### Progress Display
Shows real-time progress as operations execute:
```
Processing PluginName / engine/file.c.patch
Processing PluginName / engineAlt/variant/file.c.patch
```

### Optional Features (Mode-Specific)
- **Engine Update & Plugin Update**: None
- **Create Patches**:
  - "Generate EngineAlt For Plugin Inter-compatibility" - Enables engineAlt variant generation
  - "Test applying patches after creation" - Automatically runs patch validation after generation

### Button States
- **Enabled**: Ready to process (all required fields filled, not currently processing)
- **Disabled**: Missing required fields OR processing in progress
- **Processing**: Shows "Processing..." text instead of "Update"

---

## Output Files

### Successful Operation Output

**Top-level Output Files**:
- `update_process.log` - Detailed log of all operations and decisions
- `patch_conflicts.log` - (Only if conflicts found) Detailed conflict information

**Plugin Structure** (per plugin):
```
Mico27/PluginName/
├── plugin.json          (updated with engineAltRules if applicable)
├── engine/
│   ├── file.c.patch     (for "Create patches" mode)
│   ├── file.c           (for "Engine update" mode)
│   └── ...
├── engineAlt/
│   ├── VariantA/
│   │   ├── file.c.patch
│   │   └── ...
│   ├── VariantB/
│   │   ├── file.c
│   │   └── ...
│   └── ...
├── events/
│   └── ...
└── LICENSE
```

### Log File Formats

#### update_process.log
```
✅ Engine files gathered: 234 files
✅ Previous plugin files gathered: 42 files
✅ New plugin files gathered: 42 files
Merged engine changes into: src/core/load_save.c
[WARN] Merge conflicts for src/core/load_save.h - keeping original
✅ Gathered 5 files from engineAlt folder: ConfigLoadSavePlugin
Merged plugin engine changes into engineAlt/ConfigLoadSavePlugin/src/core/load_save.c
✅ All operations completed successfully
```

#### patch_conflicts.log
```
Patch Application Conflicts Report
========================================

Generated: 2026-03-15T14:32:45.123Z
Total conflicts: 2

Conflicts:
Plugin: Mico27/PluginA
File: src/core/data.c
Reason: Merge conflicts detected
Conflict Details:
<<<<<<< NEW ENGINE
  new_function();
=======
  old_function();
>>>>>>> PLUGIN
  existing_code();
---
Plugin: Mico27/PluginB
File: include/config.h
Reason: Merge error: EACCES permission denied
---
```

---

## Error Handling & Resolution

### Merge Conflicts
**When It Occurs**: Both the new engine and plugin modified the same lines, creating ambiguity.

**What Happens**:
- Conflict is logged with detailed context (NEW ENGINE vs PLUGIN sections)
- Original plugin file is preserved
- Operation continues with other files

**Resolution**:
1. Review the specific conflict in `patch_conflicts.log`
2. Manually edit the plugin file to resolve
3. Re-run the operation
4. Or adjust plugin to not conflict with next engine version

---

### Patch Application Failures
**When It Occurs**: Generated patch doesn't apply cleanly to the baseline engine.

**Causes**:
1. File structure changed unexpectedly
2. Your engine copy doesn't match the original used to generate patches
3. Patch was created for a different engine version

**Resolution**:
1. Verify engines match original (compare checksums)
2. Check that plugin source engine matches patch baseline
3. Re-generate patches from correct baseline

---

### Missing Required Folders
**When It Occurs**: User hasn't selected all required folders for the selected mode.

**What Happens**:
- Update button remains disabled
- No visual error (validation is implicit)

**Resolution**:
- Use "Browse" button to select each required folder
- Or manually type valid folder paths
- Button will enable once all fields are complete

---

## Debug Mode & Logging

### Access Logs
1. After operation completes, logs are saved to:
   - `{output_folder}/update_process.log`
   - `{output_folder}/patch_conflicts.log` (if conflicts)
2. Open with any text editor

### DevTools
1. **Main Process**: Press F12 during operation to open DevTools
2. **Renderer Process**: Automatically opens with main window
3. Console shows:
   - IPC handler execution timing
   - File system operations
   - Error stack traces

### Verbose Logging
Each operation logs:
- Files gathered counts
- Merge decisions and conflicts
- Write operations
- Cleanup status

---

## Usage Examples

### Example 1: GBStudio Engine Update
```
1. Download GBStudio 4.2.0 (previous) and 4.2.1 (new)
2. Select Mode: "Engine update"
3. Previous Engine: path/to/gbstudio-4.2.0/engine
4. New Engine: path/to/gbstudio-4.2.1/engine
5. Plugins Source: path/to/my-plugins
6. Output: path/to/updated-plugins
7. Click Update
→ Plugins automatically adapted to 4.2.1
→ Review update_process.log for any conflicts
```

### Example 2: Create Plugin Patches
```
1. Select Mode: "Create patches"
2. Engine: path/to/baseline-gbstudio/engine
3. Plugins: path/to/my-plugins
4. Output: path/to/patches-output
5. Enable: "Generate EngineAlt For Plugin Inter-compatibility"
6. Enable: "Test applying patches after creation"
7. Click Update
→ Plugin files converted to .patch files
→ engineAlt variants generated
→ plugin.json updated with engineAltRules
→ Patches validated automatically
```

### Example 3: Update Plugin Variants
```
1. Select Mode: "Plugin update"
2. Previous Plugins: path/to/old-plugins
3. New Plugins: path/to/updated-plugins
4. Output: path/to/synced-plugins
5. Click Update
→ engineAlt variants updated with changes
→ Compatibility variants preserved
```

---

## Technical Specifications

### Merge Algorithm
- **Library**: `diff3` npm package
- **Type**: Three-way merge (RFC 3-way)
- **Semantics**: Line-based, context-sensitive
- **Conflict Markers**: `<<<<<<`, `=======`, `>>>>>>>`

### Patch Format
- **Standard**: Unified Diff (`.patch`)
- **Library**: `diff` npm package (jsdiff)
- **Extensions**: Supports binary files in engine (skipped)
- **Line Endings**: Normalized to `\n` before processing

### File System
- **Temp Directory**: `.test-output` in workspace root
- **Permissions**: Requires read access to inputs, write access to output
- **Cleanup**: Automatic after each operation

### Performance Characteristics
- **Engine Update**: O(n*m) where n=engine files, m=plugins
- **Create Patches**: O(n*m) where n=plugins, m=plugin files
- **Plugin Update**: O(n*m) where n=plugins, m=engineAlt folders
- **Typical Time**: 5-30 seconds depending on plugin count and file sizes

---

## Troubleshooting Reference

| Problem | Likely Cause | Check |
|---------|-------------|-------|
| Button disabled | Missing required folder | Verify all fields filled for selected mode |
| "Merge conflicts" | Plugin + new engine modified same lines | Review patch_conflicts.log |
| Patch won't apply | Wrong baseline engine used | Ensure engine version matches patches |
| Permissions error | Output folder is read-only | Check folder permissions |
| Process hangs | Very large file in plugin | Wait or check console for progress |
| engineAlt not generated | No plugin dependencies detected | Verify plugins have engineAlt source folders |
| Wrong abbreviations | Hash collision in naming | Very rare; re-run operation |
