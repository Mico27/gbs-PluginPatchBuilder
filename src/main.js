const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Handle folder selection
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0], {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

// Handle plugin updating, producing diff patches
ipcMain.handle('update-plugins', async (_, data) => {
  const { engineChanged, engineFolder, previousEngineFolder, newEngineFolder, pluginsFolder, updatedPluginsFolderOutput, createCompabilityPatches } = data;
  // when the engine has changed, compare plugin files against the *new* engine
  const baseFolder = engineChanged ? newEngineFolder : engineFolder;
  const diff3 = require('node-diff3');
  const jsdiff = require('diff');
  const fs = require('fs').promises;
  const path = require('path');

  // Empty the output folder first
  try {
    await fs.rm(updatedPluginsFolderOutput, { recursive: true, force: true });
    console.log('Emptied output folder:', updatedPluginsFolderOutput);
  } catch (err) {
    // Folder might not exist, that's ok
  }
  await fs.mkdir(updatedPluginsFolderOutput, { recursive: true });

  async function gatherFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await gatherFiles(full);
        files.push(...nested);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
    return files;
  }

  async function copyDir(src, dest, excludePaths = []) {
    const entries = await fs.readdir(src, { withFileTypes: true });
    await fs.mkdir(dest, { recursive: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      // Skip excluded paths
      if (excludePaths.some(exclude => srcPath.startsWith(exclude))) {
        continue;
      }
      
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath, excludePaths);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  try {
    let conflicts = [];
    let modifiedEngineFiles = new Map(); // Track which plugins modified which engine files
    
    // If engine changed, prepare for three-way merge
    let previousEngineFiles = new Map();
    let newEngineFiles = new Map();
    
    if (engineChanged) {
      console.log('Engine changed, preparing for three-way merge...');
      
      // Gather previous engine files
      try {
        const prevFiles = await gatherFiles(previousEngineFolder);
        for (const filePath of prevFiles) {
          const relative = path.relative(previousEngineFolder, filePath);
          const content = await fs.readFile(filePath, 'utf8');
          previousEngineFiles.set(relative, content);
        }
      } catch (err) {
        console.warn('Could not read previous engine files:', err.message);
      }
      
      // Gather new engine files
      try {
        const newFiles = await gatherFiles(newEngineFolder);
        for (const filePath of newFiles) {
          const relative = path.relative(newEngineFolder, filePath);
          const content = await fs.readFile(filePath, 'utf8');
          newEngineFiles.set(relative, content);
        }
      } catch (err) {
        console.warn('Could not read new engine files:', err.message);
      }
    }

    const authorDirs = await fs.readdir(pluginsFolder, { withFileTypes: true });
    const sortedAuthors = authorDirs.filter(d => d.isDirectory()).map(d => d.name).sort();

    const allPlugins = [];
    for (const authorName of sortedAuthors) {
      const authorPath = path.join(pluginsFolder, authorName);
      const pluginDirs = await fs.readdir(authorPath, { withFileTypes: true });
      const plugins = pluginDirs.filter(d => d.isDirectory()).map(d => ({
        author: authorName,
        plugin: d.name,
        fullName: `${authorName}/${d.name}`
      }));
      allPlugins.push(...plugins);
    }

    // Sort all plugins alphabetically by full name (author/plugin)
    allPlugins.sort((a, b) => a.fullName.localeCompare(b.fullName));

    for (const pluginInfo of allPlugins) {
      const pluginPath = path.join(pluginsFolder, pluginInfo.author, pluginInfo.plugin);
      const outputPluginPath = path.join(updatedPluginsFolderOutput, pluginInfo.author, pluginInfo.plugin);
      
      if (engineChanged) {
        // Apply engine upgrade patches to plugins
        const enginePath = path.join(pluginPath, 'engine');
        
        // Copy everything from plugin folder to output EXCEPT the engine folder
        await copyDir(pluginPath, outputPluginPath, [enginePath]);
        console.log('Copied plugin structure (excluding engine) for', pluginInfo.fullName);
        
        // Copy engine.json directly
        const engineJsonSrc = path.join(enginePath, 'engine.json');
        const engineJsonDst = path.join(outputPluginPath, 'engine', 'engine.json');
        try {
          const engineJsonContent = await fs.readFile(engineJsonSrc, 'utf8');
          await fs.mkdir(path.dirname(engineJsonDst), { recursive: true });
          await fs.writeFile(engineJsonDst, engineJsonContent, 'utf8');
          console.log('Copied engine.json for', pluginInfo.fullName);
        } catch (err) {
          console.warn('Could not copy engine.json for', pluginInfo.fullName, err.message);
        }
        
        // Apply engine patches to plugin engine files
        let engineFiles = [];
        try {
          engineFiles = await gatherFiles(enginePath);
        } catch (err) {
          console.log('No engine folder for', pluginInfo.fullName);
          continue;
        }
        
        for (const filePath of engineFiles) {
          const relative = path.relative(enginePath, filePath);
          
          // Skip engine.json (already copied)
          if (relative === 'engine.json') {
            continue;
          }
          
          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            win.webContents.send('update-progress', { plugin: pluginInfo.fullName, file: `engine/${relative}` });
          }
          
          const previousEngineContent = previousEngineFiles.get(relative);
          const newEngineContent = newEngineFiles.get(relative);
          
          if (previousEngineContent && newEngineContent) {
            try {
              // Read plugin file
              const pluginContent = await fs.readFile(filePath, 'utf8');
              
              // Perform three-way merge: ours=new, base=previous, theirs=plugin
              const mergeResult = diff3.diff3Merge(newEngineContent.split(/\r?\n/), previousEngineContent.split(/\r?\n/), pluginContent.split(/\r?\n/));
              
              // Check for conflicts
              const hasConflicts = mergeResult.some(part => part.conflict);
              
              if (hasConflicts) {
                // Extract conflict details
                const conflictDetails = mergeResult
                  .filter(part => part.conflict)
                  .map(part => {
                    const conflict = part.conflict;
                    return `<<<<<<< NEW ENGINE\n${conflict.a}\n=======\n${conflict.o}\n>>>>>>> PLUGIN\n${conflict.b}\n>>>>>>>`;
                  })
                  .join('\n---\n');
                
                // Record conflicts with details
                conflicts.push({
                  plugin: pluginInfo.fullName,
                  file: relative,
                  reason: 'Merge conflicts detected',
                  details: conflictDetails
                });
                console.warn('Merge conflicts for', relative, '- copying original');
                
                // Track file modification even with conflicts
                if (!modifiedEngineFiles.has(relative)) {
                  modifiedEngineFiles.set(relative, []);
                }
                modifiedEngineFiles.get(relative).push(pluginInfo.fullName);
                
                // Copy original plugin file
                const outPath = path.join(outputPluginPath, 'engine', relative);
                await fs.mkdir(path.dirname(outPath), { recursive: true });
                await fs.writeFile(outPath, pluginContent);
              } else {
                // No conflicts, save merged result
                const mergedContent = mergeResult[0].ok.join('\n');
                const outPath = path.join(outputPluginPath, 'engine', relative);
                await fs.mkdir(path.dirname(outPath), { recursive: true });
                await fs.writeFile(outPath, mergedContent);
                console.log('Merged engine changes into:', relative);
                
                // Track this file modification for compatibility patches
                if (!modifiedEngineFiles.has(relative)) {
                  modifiedEngineFiles.set(relative, []);
                }
                modifiedEngineFiles.get(relative).push(pluginInfo.fullName);
              }
            } catch (err) {
              console.warn('Error merging file', relative, err.message);
              conflicts.push({
                plugin: pluginInfo.fullName,
                file: relative,
                reason: `Merge error: ${err.message}`
              });
              // Copy original file
              const pluginContent = await fs.readFile(filePath);
              const outPath = path.join(outputPluginPath, 'engine', relative);
              await fs.mkdir(path.dirname(outPath), { recursive: true });
              await fs.writeFile(outPath, pluginContent);
            }
          } else {
            // No corresponding engine files, copy plugin file as-is
            const pluginContent = await fs.readFile(filePath);
            const outPath = path.join(outputPluginPath, 'engine', relative);
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, pluginContent);
            console.log('No engine files for merge:', relative, '- copied as-is');
          }
        }
      } else {
        // Original logic: compare plugin files against engine
        const enginePath = path.join(pluginPath, 'engine');
        await copyDir(pluginPath, outputPluginPath, [enginePath]);
        console.log('Copied plugin structure (excluding engine) for', pluginInfo.fullName);
        
        // Copy engine.json directly
        const engineJsonSrc = path.join(enginePath, 'engine.json');
        const engineJsonDst = path.join(outputPluginPath, 'engine', 'engine.json');
        try {
          const engineJsonContent = await fs.readFile(engineJsonSrc, 'utf8');
          await fs.mkdir(path.dirname(engineJsonDst), { recursive: true });
          await fs.writeFile(engineJsonDst, engineJsonContent, 'utf8');
          console.log('Copied engine.json for', pluginInfo.fullName);
        } catch (err) {
          console.warn('Could not copy engine.json for', pluginInfo.fullName, err.message);
        }
        
        // Now process files in the engine subfolder
        let engineFiles = [];
        try {
          engineFiles = await gatherFiles(enginePath);
        } catch (err) {
          // No engine folder, skip
          console.log('No engine folder for', pluginInfo.fullName);
          continue;
        }
        
        for (const filePath of engineFiles) {
          const relative = path.relative(enginePath, filePath);
          
          // Skip engine.json files (already copied)
          if (relative === 'engine.json') {
            continue;
          }
          
          const engineFile = path.join(baseFolder, relative);
          // send progress
          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            win.webContents.send('update-progress', { plugin: pluginInfo.fullName, file: `engine/${relative}` });
          }
          console.log('processing', pluginInfo.fullName, `engine/${relative}`);
          try {
            const [pluginContent, engineContent] = await Promise.all([
              fs.readFile(filePath, 'utf8'),
              fs.readFile(engineFile, 'utf8')
            ]);

            // compute diff using node-diff3 just to see if any differences exist
            const diffObj = diff3.diffPatch(engineContent.split(/\r?\n/), pluginContent.split(/\r?\n/));
            if (!diffObj || diffObj.length === 0) {
              // No changes - copy the file as-is
              console.log('No changes, ignore file:', relative);
              continue;
            }
            // create unified diff text from original -> modified
            const patchText = jsdiff.createPatch(relative, engineContent, pluginContent);
            const outPath = path.join(outputPluginPath, 'engine', relative + '.patch');
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, patchText, 'utf8');
            
            // Track this file modification for compatibility patches
            if (!modifiedEngineFiles.has(relative)) {
              modifiedEngineFiles.set(relative, []);
            }
            modifiedEngineFiles.get(relative).push(pluginInfo.fullName);
            
            // If createCompabilityPatches is enabled and this file was modified by previous plugins
            if (createCompabilityPatches && modifiedEngineFiles.get(relative).length > 1) {
              // Get list of all plugins that modified this file (excluding current)
              let previousPlugins = modifiedEngineFiles.get(relative).slice(0, -1);
              previousPlugins = previousPlugins.map(p => {
                const parts = p.split(/[/\\]/);
                return parts.pop();
              }); // sanitize for folder names
              const compatFolderName = previousPlugins.join('_');
              const compatPatchPath = path.join(outputPluginPath, 'engineAlt', compatFolderName, relative + '.patch');
              
              await fs.mkdir(path.dirname(compatPatchPath), { recursive: true });
              await fs.writeFile(compatPatchPath, patchText, 'utf8');
              console.log('Created compatibility patch for', relative, 'in engineAlt/', compatFolderName);
            }
          } catch (err) {
            // if engine file doesn't exist, copy the plugin file as-is
            if (err.code === 'ENOENT') {
              console.log('Engine file not found, copying plugin file:', relative);
              const pluginContent = await fs.readFile(filePath);
              const outPath = path.join(outputPluginPath, 'engine', relative);
              await fs.mkdir(path.dirname(outPath), { recursive: true });
              await fs.writeFile(outPath, pluginContent);
            } else {
              // skip other read errors
              console.warn('Skipping file', filePath, 'error', err.message);
            }
          }
        }
      }
    }
    
    // Send final progress update
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      const hasConflicts = conflicts.length > 0;
      win.webContents.send('update-progress', { 
        plugin: 'COMPLETE', 
        file: hasConflicts ? `Update complete with ${conflicts.length} conflicts` : 'Update complete successfully' 
      });
    }
    
    // Write conflicts log if any
    if (conflicts.length > 0) {
      const logPath = path.join(updatedPluginsFolderOutput, 'patch_conflicts.log');
      const logContent = `Patch Application Conflicts Report\n${'='.repeat(40)}\n\nGenerated: ${new Date().toISOString()}\nTotal conflicts: ${conflicts.length}\n\nConflicts:\n${conflicts.map(c => 
        `Plugin: ${c.plugin}\nFile: ${c.file}\nReason: ${c.reason}\n${c.details ? `Conflict Details:\n${c.details}\n` : ''}---`
      ).join('\n')}`;
      
      await fs.writeFile(logPath, logContent, 'utf8');
      console.log(`Conflicts log written to: ${logPath}`);
    }
    
    return { success: true, conflicts: conflicts.length };
  } catch (err) {
    console.error('update-plugins failed:', err);
    throw err;
  }
});
