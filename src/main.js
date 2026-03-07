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
  const { engineChanged, engineFolder, previousEngineFolder, newEngineFolder, pluginsFolder, updatedPluginsFolderOutput } = data;
  // when the engine has changed, compare plugin files against the *new* engine
  const baseFolder = engineChanged ? newEngineFolder : engineFolder;
  const diff3 = require('node-diff3');
  const jsdiff = require('diff');
  const fs = require('fs').promises;
  const path = require('path');

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
      
      // Copy everything from plugin folder to output EXCEPT the engine folder
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
            console.log('No changes, copying file:', relative);
            const outPath = path.join(outputPluginPath, 'engine', relative);
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, pluginContent);
            continue;
          }
          // create unified diff text from original -> modified
          const patchText = jsdiff.createPatch(relative, engineContent, pluginContent);
          const outPath = path.join(outputPluginPath, 'engine', relative + '.patch');
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, patchText, 'utf8');
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
    return { success: true };
  } catch (err) {
    console.error('update-plugins failed:', err);
    throw err;
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
