# Plugin Output Validation Test Suite

## Overview

After the `update-plugins` function completes, an automated test suite validates the generated plugin patches by attempting to apply them to a temporary copy of the input engine. This mimics how GBStudio applies plugins during compilation.

## Test Flow

```
1. User clicks "Update" button
   ↓
2. update-plugins handler processes plugins (generates patches & engineAlts)
   ↓
3. Checks for conflicts.log file:
   - If conflicts exist → Test stops, shows conflict report
   - If no conflicts → Continue to step 4
   ↓
4. Copy engine folder to temporary test location
   ↓
5. For each plugin (in order):
   a. Apply all patches from main 'engine' folder
   b. Apply all patches from 'engineAlt' folders (compatibility versions)
   ↓
6. Report results:
   - Plugins passed/failed
   - Patches applied successfully
   - Any patch application failures
   ↓
7. Clean up temporary test folder
   ↓
8. Display results in UI
```

## Implementation Details

### TestPluginOutput Handler (`src/testPluginOutput.js`)

The `PluginOutputValidator` class handles the complete validation:

#### Methods

**`checkForConflicts()`**
- Checks if `patch_conflicts.log` exists in the output folder
- Returns `false` if conflicts are found (stops testing)
- Returns `true` if no conflicts (continues testing)

**`copyEngineToTemp()`**
- Creates a temporary copy of the input engine folder
- Used as a sandbox to test patch application
- Prevents modifying the original engine

**`collectPatchFiles(pluginPath)`**
- Recursively finds all `.patch` files in a plugin folder
- Returns absolute paths to patch files

**`applyPatchToFile(patchAbsPath, targetAbsPath)`**
- Reads both patch and target files
- Uses the `diff` library's `applyPatch()` function
- Detects patch conflicts (returns `success: false`)
- Writes the patched content if successful

**`testPluginPatches(pluginPath, pluginName)`**
- Tests a single plugin's patches
- Tests both main engine patches and engineAlt compatibility patches
- Returns detailed results for each patch group

**`testAllPlugins()`**
- Iterates through all plugins in the output folder
- Tests each plugin separately
- Aggregates results

**`generateSummary()`**
- Creates consolidated statistics:
  - Plugins passed/failed count
  - Total patches and application success rate
  - Failed patch count

**`printReport()`**
- Outputs a formatted test report to console with:
  - Summary statistics
  - Per-plugin results
  - Pass/fail indicator

### IPC Integration

#### Main Process (`src/main.js`)

```javascript
ipcMain.handle('test-plugin-output', async (_, data) => {
  const validator = new PluginOutputValidator({
    engineFolder,
    updatedPluginsFolderOutput,
    logger: { ... }
  });
  
  const results = await validator.runTests();
  return {
    success: results.success,
    passed: results.summary.passedPlugins,
    failed: results.summary.failedPlugins,
    total: results.summary.totalPlugins,
    patchesApplied: results.summary.appliedPatches,
    totalPatches: results.summary.totalPatches,
    failedPatches: results.summary.failedPatches,
    details: results
  };
});
```

#### Preload Script (`src/preload.js`)

```javascript
testPluginOutput: (data) => ipcRenderer.invoke('test-plugin-output', data),
```

#### Helper (`src/UpdatePluginHelper.js`)

```javascript
testPluginOutput: async (data) => {
  const result = await window.electronAPI.testPluginOutput(data);
  return result;
}
```

#### UI Integration (`src/UpdatePluginsPage.jsx`)

```javascript
// After successful update-plugins:
if (result.success && result.conflicts === 0) {
  const testResult = await UpdatePluginHelper.testPluginOutput(testData);
}
```

## UI Display

The test results are displayed in a formatted box below the update button:

```
✅ Tests Passed                    (or ❌ Tests Failed)
Plugins: X/Y passed
Patches: A/B applied
Failed patches: C (if any)
```

## How It Mirrors GBStudio

Based on `GBStudioEnginePlugins.ts`:

| Feature | GBStudio | Test Suite |
|---------|----------|-----------|
| **Conflict Detection** | Checked via `applyPatchToFile()` | Returns `success: false` on conflict |
| **Plugin Order** | Processed in order | Same order as update-plugins |
| **Engine Variants** | `selectAlternateEngine()` tests conditions | Tests all engineAlt folders |
| **Patch Application** | `applyPatch()` from diff library | Same `applyPatch()` function |
| **Error Handling** | Logs warnings | Reports detailed failures |
| **File Collisions** | Tracked in `writtenByPlugin` map | Not tracked (not needed for validation) |

## Common Issues & Diagnostics

### Patch Fails to Apply
- **Cause**: The patch targets a file that was modified unexpectedly
- **Solution**: Check the plugin's engine files for manual edits that broke alignment
- **Diagnosis**: The patch diff no longer applies cleanly

### Conflicts Found During Generation
- **Cause**: Two plugins modified the same file with conflicting changes
- **Solution**: Review the `patch_conflicts.log` file
- **Action**: Manually resolve conflicts or adjust plugin order

### EngineAlt Patch Failures
- **Cause**: Plugin combination doesn't work together as expected
- **Solution**: Review which plugins are in that engineAlt combination
- **Example**: If `PluginA_PluginB` patches fail, the two plugins don't compose well

## Performance Notes

- Test runs in temporary directory (doesn't modify original files)
- Cleanup is automatic (temp folder deleted after tests)
- Console output captured and displayed
- Typical test time: 2-10 seconds depending on plugin count

## Future Enhancements

- [ ] Add test report export (JSON/HTML)
- [ ] Cache engine copy for faster repeated tests
- [ ] Parallel plugin testing
- [ ] Visual diff previews for failed patches
- [ ] Test history/comparison
- [ ] Integration with CI/CD systems
