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
  const { engineChanged, engineFolder, previousEngineFolder, newEngineFolder, pluginsFolder, updatedPluginsFolderOutput, createEngineAlts } = data;
  // when the engine has changed, compare plugin files against the *new* engine
  const baseFolder = engineChanged ? newEngineFolder : engineFolder;
  const diff3 = require('node-diff3');
  const jsdiff = require('diff');
  const fs = require('fs').promises;
  const path = require('path');

  // Normalize whitespace in text content
  const normalizeWhitespace = (content) => {
    return content.replace(/\r\n/g, '\n');
  };

  // Logging helper to capture console output
  const logs = [];
  const log = {
    info: (message) => {
      const logEntry = typeof message === 'string' ? message : JSON.stringify(message);
      console.log(logEntry);
      logs.push(logEntry);
    },
    warn: (message) => {
      const logEntry = typeof message === 'string' ? message : JSON.stringify(message);
      console.warn(logEntry);
      logs.push(`[WARN] ${logEntry}`);
    }
  };

  // Empty the output folder first
  try {
    await fs.rm(updatedPluginsFolderOutput, { recursive: true, force: true });
    log.info('Emptied output folder: ' + updatedPluginsFolderOutput);
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
    let modifiedEngineAltFiles = new Map(); // Track which plugins modified which engine alt files
    
    // If engine changed, prepare for three-way merge
    let previousEngineFiles = new Map();
    let newEngineFiles = new Map();
    
    if (engineChanged) {
      log.info('Engine changed, preparing for three-way merge...');
      
      // Gather previous engine files
      try {
        const prevFiles = await gatherFiles(previousEngineFolder);
        for (const filePath of prevFiles) {
          //const relative = path.relative(previousEngineFolder, filePath);
          const relative = filePath.substring(previousEngineFolder.length + 1);
          const content = await fs.readFile(filePath, 'utf8');
          previousEngineFiles.set(relative, content);
        }
      } catch (err) {
        log.warn('Could not read previous engine files: ' + err.message);
      }
      
      // Gather new engine files
      try {
        const newFiles = await gatherFiles(newEngineFolder);
        for (const filePath of newFiles) {
          //const relative = path.relative(newEngineFolder, filePath);
          const relative = filePath.substring(newEngineFolder.length + 1);
          const content = await fs.readFile(filePath, 'utf8');
          newEngineFiles.set(relative, content);
        }
      } catch (err) {
        log.warn('Could not read new engine files: ' + err.message);
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
        log.info('Copied plugin structure (excluding engine) for ' + pluginInfo.fullName);
        
        // Copy engine.json directly
        const engineJsonSrc = path.join(enginePath, 'engine.json');
        const engineJsonDst = path.join(outputPluginPath, 'engine', 'engine.json');
        try {
          const engineJsonContent = await fs.readFile(engineJsonSrc, 'utf8');
          await fs.mkdir(path.dirname(engineJsonDst), { recursive: true });
          await fs.writeFile(engineJsonDst, engineJsonContent, 'utf8');
          log.info('Copied engine.json for ' + pluginInfo.fullName);
        } catch (err) {
          log.warn('Could not copy engine.json for ' + pluginInfo.fullName + ' ' + err.message);
        }
        
        // Apply engine patches to plugin engine files
        let engineFiles = [];
        try {
          engineFiles = await gatherFiles(enginePath);
        } catch (err) {
          log.info('No engine folder for ' + pluginInfo.fullName);
          continue;
        }
        
        for (const filePath of engineFiles) {
          //const relative = path.relative(enginePath, filePath);
          const relative = filePath.substring(enginePath.length + 1);
          
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
                log.warn('Merge conflicts for ' + relative + ' - copying original');
                
                // Track file modification even with conflicts
                if (!modifiedEngineFiles.has(relative)) {
                  modifiedEngineFiles.set(relative, []);
                }
                modifiedEngineFiles.get(relative).push({ plugin: pluginInfo.fullName, content: pluginContent });

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
                log.info('Merged engine changes into: ' + relative);
                
                // Track this file modification for compatibility patches
                if (!modifiedEngineFiles.has(relative)) {
                  modifiedEngineFiles.set(relative, []);
                }
                modifiedEngineFiles.get(relative).push({ plugin: pluginInfo.fullName, content: mergedContent });
              }
            } catch (err) {
              log.warn('Error merging file ' + relative + ' ' + err.message);
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
            log.info('No engine files for merge: ' + relative + ' - copied as-is');
          }
        }
        



        // If engine changed, also process engineAlt folder for three-way merge
        const engineAltPath = path.join(pluginPath, 'engineAlt');
        let engineAltDirs = [];
        try {
          const altDirEntries = await fs.readdir(engineAltPath, { withFileTypes: true });
          engineAltDirs = altDirEntries.filter(d => d.isDirectory()).map(d => d.name);
        } catch (err) {
          // No engineAlt folder, skip
          log.info('No engineAlt folder for ' + pluginInfo.fullName);
        }
        
        for (const compatFolderName of engineAltDirs) {
          const engineAltFilePath = path.join(engineAltPath, compatFolderName);
          let altFiles = [];
          try {
            altFiles = await gatherFiles(engineAltFilePath);
          } catch (err) {
            log.warn('Could not read engineAlt folder for ' + pluginInfo.fullName + ' ' + compatFolderName);
            continue;
          }
          
          for (const filePath of altFiles) {
            //const relative = path.relative(engineAltFilePath, filePath);
            const relative = filePath.substring(engineAltFilePath.length + 1);
            
            const win = BrowserWindow.getAllWindows()[0];
            if (win) {
              win.webContents.send('update-progress', { plugin: pluginInfo.fullName, file: `engineAlt/${compatFolderName}/${relative}` });
            }
            
            const previousEngineContent = previousEngineFiles.get(relative);
            const newEngineContent = newEngineFiles.get(relative);
            
            if (previousEngineContent && newEngineContent) {
              try {
                // Read alt file
                const altContent = await fs.readFile(filePath, 'utf8');
                
                // Perform three-way merge: ours=new, base=previous, theirs=alt
                const mergeResult = diff3.diff3Merge(newEngineContent.split(/\r?\n/), previousEngineContent.split(/\r?\n/), altContent.split(/\r?\n/));
                
                // Check for conflicts
                const hasConflicts = mergeResult.some(part => part.conflict);
                
                if (hasConflicts) {
                  // Extract conflict details
                  const conflictDetails = mergeResult
                    .filter(part => part.conflict)
                    .map(part => {
                      const conflict = part.conflict;
                      return `<<<<<<< NEW ENGINE\n${conflict.a}\n=======\n${conflict.o}\n>>>>>>> ALT\n${conflict.b}\n>>>>>>>`;
                    })
                    .join('\n---\n');
                  
                  // Record conflicts with details
                  conflicts.push({
                    plugin: pluginInfo.fullName,
                    file: `engineAlt/${compatFolderName}/${relative}`,
                    reason: 'Merge conflicts detected',
                    details: conflictDetails
                  });
                  log.warn('Merge conflicts for engineAlt/' + compatFolderName + '/' + relative + ' - copying original');
                  
                  // Copy original alt file
                  const outPath = path.join(outputPluginPath, 'engineAlt', compatFolderName, relative);
                  await fs.mkdir(path.dirname(outPath), { recursive: true });
                  await fs.writeFile(outPath, altContent);
                } else {
                  // No conflicts, save merged result
                  const mergedContent = mergeResult[0].ok.join('\n');
                  const outPath = path.join(outputPluginPath, 'engineAlt', compatFolderName, relative);
                  await fs.mkdir(path.dirname(outPath), { recursive: true });
                  await fs.writeFile(outPath, mergedContent);
                  log.info('Merged engine changes into engineAlt/' + compatFolderName + '/' + relative);
                }
              } catch (err) {
              log.warn('Error merging engineAlt file ' + relative + ' ' + err.message);
                conflicts.push({
                  plugin: pluginInfo.fullName,
                  file: `engineAlt/${compatFolderName}/${relative}`,
                  reason: `Merge error: ${err.message}`
                });
                // Copy original file
                const altContent = await fs.readFile(filePath);
                const outPath = path.join(outputPluginPath, 'engineAlt', compatFolderName, relative);
                await fs.mkdir(path.dirname(outPath), { recursive: true });
                await fs.writeFile(outPath, altContent);
              }
            } else {
              // No corresponding engine files, copy alt file as-is
              const altContent = await fs.readFile(filePath);
              const outPath = path.join(outputPluginPath, 'engineAlt', compatFolderName, relative);
              await fs.mkdir(path.dirname(outPath), { recursive: true });
              await fs.writeFile(outPath, altContent);
              log.info('No engine files for engineAlt merge: ' + compatFolderName + ' / ' + relative + ' - copied as-is');
            }
          }
        }
      } else {
        // Original logic: compare plugin files against engine
        const enginePath = path.join(pluginPath, 'engine');
        const engineAltPath = path.join(pluginPath, 'engineAlt');
        await copyDir(pluginPath, outputPluginPath, [enginePath]);
        log.info('Copied plugin structure (excluding engine) for ' + pluginInfo.fullName);
        
        // Copy engine.json directly
        const engineJsonSrc = path.join(enginePath, 'engine.json');
        const engineJsonDst = path.join(outputPluginPath, 'engine', 'engine.json');
        try {
          const engineJsonContent = await fs.readFile(engineJsonSrc, 'utf8');
          await fs.mkdir(path.dirname(engineJsonDst), { recursive: true });
          await fs.writeFile(engineJsonDst, engineJsonContent, 'utf8');
          log.info('Copied engine.json for ' + pluginInfo.fullName);
        } catch (err) {
          log.warn('Could not copy engine.json for ' + pluginInfo.fullName + ' ' + err.message);
        }
        
        // Now process files in the engine subfolder
        let engineFiles = [];
        try {
          engineFiles = await gatherFiles(enginePath);
        } catch (err) {
          // No engine folder, skip
          log.info('No engine folder for ' + pluginInfo.fullName);
          continue;
        }
        
        for (const filePath of engineFiles) {
          //const relative = path.relative(enginePath, filePath);
          const relative = filePath.substring(enginePath.length + 1);

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
          log.info('processing ' + pluginInfo.fullName + ' engine/' + relative);
          try {
            const [pluginContent, engineContent] = await Promise.all([
              fs.readFile(filePath, 'utf8'),
              fs.readFile(engineFile, 'utf8')
            ]);

            // compute diff using node-diff3 just to see if any differences exist
            const diffObj = diff3.diffPatch(engineContent.split(/\r?\n/), pluginContent.split(/\r?\n/));
            if (!diffObj || diffObj.length === 0) {
              // No changes - copy the file as-is
              log.info('No changes, ignore file: ' + relative);
              continue;
            }
            // Normalize whitespace and create unified diff text from original -> modified
            const normalizedEngineContent = normalizeWhitespace(engineContent);
            const normalizedPluginContent = normalizeWhitespace(pluginContent);
            const patchText = jsdiff.createPatch(relative, normalizedEngineContent, normalizedPluginContent);
            const outPath = path.join(outputPluginPath, 'engine', relative + '.patch');
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, patchText, 'utf8');
            
            // Track this file modification for compatibility patches
            log.info('Found changes in: ' + relative);
            if (!modifiedEngineFiles.has(relative)) {
              modifiedEngineFiles.set(relative, []);
            }
            modifiedEngineFiles.get(relative).push({ plugin: pluginInfo.fullName, content: pluginContent });
            
            // If createEngineAlts is enabled and this file was modified by previous plugins
            if (createEngineAlts && modifiedEngineFiles.get(relative).length > 1) {
              // Get list of all plugins that modified this file (excluding current)
              const previousPlugins = modifiedEngineFiles.get(relative).filter(p => p.plugin !== pluginInfo.fullName);
              
              // Generate all non-empty combinations of previousPlugins
              const generateCombinations = (arr) => {
                const result = [];
                const n = arr.length;
                for (let i = 1; i < (1 << n); i++) {
                  const combination = [];
                  for (let j = 0; j < n; j++) {
                    if (i & (1 << j)) {
                      combination.push(arr[j]);
                    }
                  }
                  result.push(combination);
                }
                return result;
              };
              
                const combinations = generateCombinations(previousPlugins);
              log.info('Creating ' + combinations.length + ' compatibility patches for: ' + relative);

              // Create compatibility patch for each combination
              for (const combination of combinations) {               
                // Extract and sanitize plugin names
                const pluginNames = combination.map(p => {
                  const parts = p.plugin.split(/[/\\]/);
                  return parts.pop();
                });
                const compatFolderName = pluginNames.join('_');
                                
                //if modifiedEngineAltFiles already has an entry for this relative path and compatFolderName, it means a previous combination has modified the same file, so we need to use that as the base for the next patch instead of the original engine file
                let combinedContent = engineContent;
                if (modifiedEngineAltFiles.has(`${relative}|${compatFolderName}`)) {
                  combinedContent = modifiedEngineAltFiles.get(`${relative}|${compatFolderName}`);
                } else {                   
                  // Generate patch text that applies all changes from the combination to the new engine
                  for (const plugin of combination) {
                    // Perform three-way merge: ours=new, base=previous, theirs=alt
                    const mergeResult = diff3.diff3Merge(combinedContent.split(/\r?\n/), engineContent.split(/\r?\n/), plugin.content.split(/\r?\n/));
                    // Check for conflicts
                    const hasConflicts = mergeResult.some(part => part.conflict);
                  
                    if (hasConflicts) { // If there are conflicts, we cannot generate a compatibility patch for this combination, so we skip it and log a warning
                    log.warn('Conflicts detected when generating compatibility patch for combination: ' + pluginNames.join(', ') + ' in file: ' + relative + ' - skipping this combination');
                      conflicts.push({
                        plugin: pluginInfo.fullName,
                        file: `engineAlt/${compatFolderName}/${relative}`,
                        reason: `Conflicts detected when generating compatibility patch for combination: ${pluginNames.join(', ')}`
                      });
                      continue;
                    } else { // No conflicts, save merged result for next iteration
                      combinedContent = mergeResult[0].ok.join('\n');
                    }
                  }
                }
                let combinedPluginContent = pluginContent;
                const combinedPluginContentPath = path.join(engineAltPath, compatFolderName, relative);
                try {
                  combinedPluginContent = await fs.readFile(combinedPluginContentPath, 'utf8');
                } catch (err) {
                  combinedPluginContent = pluginContent;
                  // Perform three-way merge: ours=new, base=previous, theirs=alt
                  const mergeResult = diff3.diff3Merge(combinedContent.split(/\r?\n/), engineContent.split(/\r?\n/), pluginContent.split(/\r?\n/));
                  // Check for conflicts
                  const hasConflicts = mergeResult.some(part => part.conflict);
                  
                  if (hasConflicts) { // If there are conflicts, we cannot generate a compatibility patch for this combination, so we skip it and log a warning
                    log.warn('Conflicts detected when generating compatibility patch for combination: ' + pluginNames.join(', ') + ' in file: ' + relative + ' - skipping this combination');
                    conflicts.push({
                      plugin: pluginInfo.fullName,
                      file: `engineAlt/${compatFolderName}/${relative}`,
                      reason: `Conflicts detected when generating compatibility patch for combination: ${pluginNames.join(', ')}`
                    });
                    continue;
                  } else { // No conflicts, save merged result for next iteration
                    combinedPluginContent = mergeResult[0].ok.join('\n');
                  }
                }
                // compute diff using node-diff3 just to see if any differences exist
                /*
                const diffObj = diff3.diffPatch(combinedContent.split(/\r?\n/), combinedPluginContent.split(/\r?\n/));
                if (!diffObj || diffObj.length === 0) {
                  // No changes - copy the file as-is
                  log.info('No changes, ignore file: ' + relative);
                  //We still add it to modifiedEngineAltFiles so that future combinations will use this version as the base, even though it is identical to the original engine file
                  modifiedEngineAltFiles.set(`${relative}|${compatFolderName}_${pluginInfo.plugin}`, combinedPluginContent);   
                  modifiedEngineAltFiles.set(`${relative}.patch|${compatFolderName}_${pluginInfo.plugin}`, combinedPluginContent);  
                  continue;
                }*/
                // Normalize whitespace and create unified diff text
                const normalizedCombinedContent = normalizeWhitespace(combinedContent);
                const normalizedCombinedPluginContent = normalizeWhitespace(combinedPluginContent);
                const patchText = jsdiff.createPatch(relative, normalizedCombinedContent, normalizedCombinedPluginContent);
                modifiedEngineAltFiles.set(`${relative}|${compatFolderName}_${pluginInfo.plugin}`, combinedPluginContent);
                modifiedEngineAltFiles.set(`${relative}.patch|${compatFolderName}_${pluginInfo.plugin}`, combinedPluginContent);            
                const compatPatchPath = path.join(outputPluginPath, 'engineAlt', compatFolderName, relative + '.patch');                
                await fs.mkdir(path.dirname(compatPatchPath), { recursive: true });
                await fs.writeFile(compatPatchPath, patchText, 'utf8');
                log.info('Created compatibility patch for ' + relative + ' in engineAlt/' + compatFolderName);
              }
              
              // Copy all engine files that are not in any engineAlt folder
              const allExistingEngineFiles = await gatherFiles(path.join(outputPluginPath, 'engine'));
              for (const existingEngineFile of allExistingEngineFiles) {
                
                //const relativeEngineFile = existingEngineFile.replace(path.join(outputPluginPath, 'engine\\'), '');
                const relativeEngineFile = existingEngineFile.substring(path.join(outputPluginPath, 'engine').length + 1);
                
                // Check if this file exists in any engineAlt folder
                let altDirs = [];
                try {
                  const altDirEntries = await fs.readdir(path.join(outputPluginPath, 'engineAlt'), { withFileTypes: true });
                  altDirs = altDirEntries.filter(d => d.isDirectory()).map(d => d.name);
                } catch (err) {
                  // No engineAlt folder yet
                }
                
                for (const altDir of altDirs) {
                  const altFilePath = path.join(outputPluginPath, 'engineAlt', altDir, relativeEngineFile);
                  if (modifiedEngineAltFiles.has(`${relativeEngineFile}|${altDir}_${pluginInfo.plugin}`)) {
                    // File is in the modified list, skip it
                  log.info('File ' + relativeEngineFile + ' is modified in engineAlt/' + altDir + ' - skipping copy for compatibility');
                    continue;
                  }
                  try {
                    await fs.access(altFilePath);
                  } catch (err) {
                    // File doesn't exist in this alt folder
                    await fs.mkdir(path.dirname(altFilePath), { recursive: true });
                    await fs.copyFile(existingEngineFile, altFilePath);
                    log.info('Copied modified engine file to alt folder for compatibility: ' + altFilePath);
                  }
                }
              }
            }
          } catch (err) {
            // if engine file doesn't exist, copy the plugin file as-is
            if (err.code === 'ENOENT') {
              log.info('Engine file not found, copying plugin file: ' + relative);
              const pluginContent = await fs.readFile(filePath);
              const outPath = path.join(outputPluginPath, 'engine', relative);
              await fs.mkdir(path.dirname(outPath), { recursive: true });
              await fs.writeFile(outPath, pluginContent);
            } else {
              // skip other read errors
              log.warn('Skipping file ' + filePath + ' error ' + err.message);
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
    
    // Write console output log
    const consoleLogPath = path.join(updatedPluginsFolderOutput, 'update_process.log');
    const consoleLogContent = logs.join('\n');
    await fs.writeFile(consoleLogPath, consoleLogContent, 'utf8');
    log.info(`Console log written to: ${consoleLogPath}`);
    
    // Write conflicts log if any
    if (conflicts.length > 0) {
      const logPath = path.join(updatedPluginsFolderOutput, 'patch_conflicts.log');
      const logContent = `Patch Application Conflicts Report\n${'='.repeat(40)}\n\nGenerated: ${new Date().toISOString()}\nTotal conflicts: ${conflicts.length}\n\nConflicts:\n${conflicts.map(c => 
        `Plugin: ${c.plugin}\nFile: ${c.file}\nReason: ${c.reason}\n${c.details ? `Conflict Details:\n${c.details}\n` : ''}---`
      ).join('\n')}`;
      
      await fs.writeFile(logPath, logContent, 'utf8');
      log.info(`Conflicts log written to: ${logPath}`);
    }
    
    return { success: true, conflicts: conflicts.length };
  } catch (err) {
    console.error('update-plugins failed:', err);
    throw err;
  }
});
