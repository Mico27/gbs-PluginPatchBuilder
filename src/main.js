const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");
const path = require("node:path");
const { PluginOutputValidator } = require("./testPluginOutput");

Menu.setApplicationMenu(null); // Disable default menu

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, "assets/app_icon.png"),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // Open the DevTools.
  //mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Handle folder selection
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0], {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Handle opening folder in file explorer
ipcMain.handle("open-folder", async (_, folderPath) => {
  try {
    const { shell } = require("electron");
    await shell.openPath(folderPath);
    return { success: true };
  } catch (err) {
    console.error("Failed to open folder:", err);
    return { success: false, error: err.message };
  }
});

// Handle plugin updating, producing diff patches
ipcMain.handle("engine-update", async (_, data) => {
  const {
    previousEngineFolder,
    newEngineFolder,
    pluginsFolder,
    updatedPluginsFolderOutput,
  } = data;
  // when the engine has changed, compare plugin files against the *new* engine
  const diff3 = require("node-diff3");
  const fs = require("fs").promises;
  const path = require("path");

  // Logging helper to capture console output
  const logs = [];
  const log = {
    info: (message) => {
      const logEntry =
        typeof message === "string" ? message : JSON.stringify(message);
      console.log(logEntry);
      logs.push(logEntry);
    },
    warn: (message) => {
      const logEntry =
        typeof message === "string" ? message : JSON.stringify(message);
      console.warn(logEntry);
      logs.push(`[WARN] ${logEntry}`);
    },
  };

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
      if (excludePaths.some((exclude) => srcPath.startsWith(exclude))) {
        continue;
      }

      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath, excludePaths);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  const win = BrowserWindow.getAllWindows()[0];

  // Empty the output folder first
  try {
    await fs.rm(updatedPluginsFolderOutput, { recursive: true, force: true });
    log.info("Emptied output folder: " + updatedPluginsFolderOutput);
  } catch (err) {
    // Folder might not exist, that's ok
  }
  await fs.mkdir(updatedPluginsFolderOutput, { recursive: true });

  try {
    let conflicts = [];
    const authorDirs = await fs.readdir(pluginsFolder, { withFileTypes: true });
    const sortedAuthors = authorDirs
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const allPlugins = [];
    //Get all plugins from all authors, sorted alphabetically by author and then plugin name
    for (const authorName of sortedAuthors) {
      const authorPath = path.join(pluginsFolder, authorName);
      const pluginDirs = await fs.readdir(authorPath, {
        withFileTypes: true,
      });
      const plugins = pluginDirs
        .filter((d) => d.isDirectory())
        .map((d) => ({
          author: authorName,
          plugin: d.name,
          fullName: `${authorName}/${d.name}`,
        }));
      allPlugins.push(...plugins);
    }

    // Sort all plugins alphabetically by full name (author/plugin)
    allPlugins.sort((a, b) => a.fullName.localeCompare(b.fullName));

    let modifiedEngineFiles = new Map(); // Track which plugins modified which engine files
    // If engine changed, prepare for three-way merge
    let previousEngineFiles = new Map();
    let newEngineFiles = new Map();
    log.info("Engine changed, preparing for three-way merge...");

    // Gather previous engine files
    try {
      const prevFiles = await gatherFiles(previousEngineFolder);
      for (const filePath of prevFiles) {
        //const relative = path.relative(previousEngineFolder, filePath);
        const relative = filePath.substring(previousEngineFolder.length + 1);
        const content = await fs.readFile(filePath, "utf8");
        previousEngineFiles.set(relative, content);
      }
    } catch (err) {
      log.warn("Could not read previous engine files: " + err.message);
    }

    // Gather new engine files
    try {
      const newFiles = await gatherFiles(newEngineFolder);
      for (const filePath of newFiles) {
        //const relative = path.relative(newEngineFolder, filePath);
        const relative = filePath.substring(newEngineFolder.length + 1);
        const content = await fs.readFile(filePath, "utf8");
        newEngineFiles.set(relative, content);
      }
    } catch (err) {
      log.warn("Could not read new engine files: " + err.message);
    }

    for (const pluginInfo of allPlugins) {
      const pluginPath = path.join(
        pluginsFolder,
        pluginInfo.author,
        pluginInfo.plugin,
      );
      const outputPluginPath = path.join(
        updatedPluginsFolderOutput,
        pluginInfo.author,
        pluginInfo.plugin,
      );

      // Apply engine upgrade patches to plugins
      const enginePath = path.join(pluginPath, "engine");

      // Copy everything from plugin folder to output EXCEPT the engine folder
      await copyDir(pluginPath, outputPluginPath, [enginePath]);
      log.info(
        "Copied plugin structure (excluding engine) for " + pluginInfo.fullName,
      );

      // Copy engine.json directly
      const engineJsonSrc = path.join(enginePath, "engine.json");
      const engineJsonDst = path.join(
        outputPluginPath,
        "engine",
        "engine.json",
      );
      try {
        const engineJsonContent = await fs.readFile(engineJsonSrc, "utf8");
        await fs.mkdir(path.dirname(engineJsonDst), { recursive: true });
        await fs.writeFile(engineJsonDst, engineJsonContent, "utf8");
        log.info("Copied engine.json for " + pluginInfo.fullName);
      } catch (err) {
        log.warn(
          "Could not copy engine.json for " +
            pluginInfo.fullName +
            " " +
            err.message,
        );
      }

      // Apply engine patches to plugin engine files
      let engineFiles = [];
      try {
        engineFiles = await gatherFiles(enginePath);
      } catch (err) {
        log.info("No engine folder for " + pluginInfo.fullName);
        continue;
      }

      for (const filePath of engineFiles) {
        //const relative = path.relative(enginePath, filePath);
        const relative = filePath.substring(enginePath.length + 1);

        // Skip engine.json (already copied)
        if (relative === "engine.json") {
          continue;
        }

        if (win) {
          win.webContents.send("update-progress", {
            plugin: pluginInfo.fullName,
            file: `engine/${relative}`,
          });
        }

        const previousEngineContent = previousEngineFiles.get(relative);
        const newEngineContent = newEngineFiles.get(relative);

        if (previousEngineContent && newEngineContent) {
          try {
            // Read plugin file
            const pluginContent = await fs.readFile(filePath, "utf8");

            // Perform three-way merge: ours=new, base=previous, theirs=plugin
            const mergeResult = diff3.diff3Merge(
              newEngineContent.split(/\r?\n/),
              previousEngineContent.split(/\r?\n/),
              pluginContent.split(/\r?\n/),
            );

            // Check for conflicts
            const hasConflicts = mergeResult.some((part) => part.conflict);

            if (hasConflicts) {
              // Extract conflict details
              const conflictDetails = mergeResult
                .filter((part) => part.conflict)
                .map((part) => {
                  const conflict = part.conflict;
                  return `<<<<<<< NEW ENGINE\n${conflict.a}\n=======\n${conflict.o}\n>>>>>>> PLUGIN\n${conflict.b}\n>>>>>>>`;
                })
                .join("\n---\n");

              // Record conflicts with details
              conflicts.push({
                plugin: pluginInfo.fullName,
                file: relative,
                reason: "Merge conflicts detected",
                details: conflictDetails,
              });
              log.warn(
                "Merge conflicts for " + relative + " - copying original",
              );

              // Track file modification even with conflicts
              if (!modifiedEngineFiles.has(relative)) {
                modifiedEngineFiles.set(relative, []);
              }
              modifiedEngineFiles.get(relative).push({
                plugin: pluginInfo.fullName,
                content: pluginContent,
              });

              // Copy original plugin file
              const outPath = path.join(outputPluginPath, "engine", relative);
              await fs.mkdir(path.dirname(outPath), { recursive: true });
              await fs.writeFile(outPath, pluginContent);
            } else {
              // No conflicts, save merged result
              const mergedContent = mergeResult[0].ok.join("\n");
              const outPath = path.join(outputPluginPath, "engine", relative);
              await fs.mkdir(path.dirname(outPath), { recursive: true });
              await fs.writeFile(outPath, mergedContent);
              log.info("Merged engine changes into: " + relative);

              // Track this file modification for compatibility patches
              if (!modifiedEngineFiles.has(relative)) {
                modifiedEngineFiles.set(relative, []);
              }
              modifiedEngineFiles.get(relative).push({
                plugin: pluginInfo.fullName,
                content: mergedContent,
              });
            }
          } catch (err) {
            log.warn("Error merging file " + relative + " " + err.message);
            conflicts.push({
              plugin: pluginInfo.fullName,
              file: relative,
              reason: `Merge error: ${err.message}`,
            });
            // Copy original file
            const pluginContent = await fs.readFile(filePath);
            const outPath = path.join(outputPluginPath, "engine", relative);
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, pluginContent);
          }
        } else {
          // No corresponding engine files, copy plugin file as-is
          const pluginContent = await fs.readFile(filePath);
          const outPath = path.join(outputPluginPath, "engine", relative);
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, pluginContent);
          log.info(
            "No engine files for merge: " + relative + " - copied as-is",
          );
        }
      }

      // If engine changed, also process engineAlt folder for three-way merge
      const engineAltPath = path.join(pluginPath, "engineAlt");
      let engineAltDirs = [];
      try {
        const altDirEntries = await fs.readdir(engineAltPath, {
          withFileTypes: true,
        });
        engineAltDirs = altDirEntries
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch (err) {
        // No engineAlt folder, skip
        log.info("No engineAlt folder for " + pluginInfo.fullName);
      }

      for (const compatFolderName of engineAltDirs) {
        const engineAltFilePath = path.join(engineAltPath, compatFolderName);
        let altFiles = [];
        try {
          altFiles = await gatherFiles(engineAltFilePath);
        } catch (err) {
          log.warn(
            "Could not read engineAlt folder for " +
              pluginInfo.fullName +
              " " +
              compatFolderName,
          );
          continue;
        }

        for (const filePath of altFiles) {
          //const relative = path.relative(engineAltFilePath, filePath);
          const relative = filePath.substring(engineAltFilePath.length + 1);

          if (win) {
            win.webContents.send("update-progress", {
              plugin: pluginInfo.fullName,
              file: `engineAlt/${compatFolderName}/${relative}`,
            });
          }

          const previousEngineContent = previousEngineFiles.get(relative);
          const newEngineContent = newEngineFiles.get(relative);

          if (previousEngineContent && newEngineContent) {
            try {
              // Read alt file
              const altContent = await fs.readFile(filePath, "utf8");

              // Perform three-way merge: ours=new, base=previous, theirs=alt
              const mergeResult = diff3.diff3Merge(
                newEngineContent.split(/\r?\n/),
                previousEngineContent.split(/\r?\n/),
                altContent.split(/\r?\n/),
              );

              // Check for conflicts
              const hasConflicts = mergeResult.some((part) => part.conflict);

              if (hasConflicts) {
                // Extract conflict details
                const conflictDetails = mergeResult
                  .filter((part) => part.conflict)
                  .map((part) => {
                    const conflict = part.conflict;
                    return `<<<<<<< NEW ENGINE\n${conflict.a}\n=======\n${conflict.o}\n>>>>>>> ALT\n${conflict.b}\n>>>>>>>`;
                  })
                  .join("\n---\n");

                // Record conflicts with details
                conflicts.push({
                  plugin: pluginInfo.fullName,
                  file: `engineAlt/${compatFolderName}/${relative}`,
                  reason: "Merge conflicts detected",
                  details: conflictDetails,
                });
                log.warn(
                  "Merge conflicts for engineAlt/" +
                    compatFolderName +
                    "/" +
                    relative +
                    " - copying original",
                );

                // Copy original alt file
                const outPath = path.join(
                  outputPluginPath,
                  "engineAlt",
                  compatFolderName,
                  relative,
                );
                await fs.mkdir(path.dirname(outPath), { recursive: true });
                await fs.writeFile(outPath, altContent);
              } else {
                // No conflicts, save merged result
                const mergedContent = mergeResult[0].ok.join("\n");
                const outPath = path.join(
                  outputPluginPath,
                  "engineAlt",
                  compatFolderName,
                  relative,
                );
                await fs.mkdir(path.dirname(outPath), { recursive: true });
                await fs.writeFile(outPath, mergedContent);
                log.info(
                  "Merged engine changes into engineAlt/" +
                    compatFolderName +
                    "/" +
                    relative,
                );
              }
            } catch (err) {
              log.warn(
                "Error merging engineAlt file " + relative + " " + err.message,
              );
              conflicts.push({
                plugin: pluginInfo.fullName,
                file: `engineAlt/${compatFolderName}/${relative}`,
                reason: `Merge error: ${err.message}`,
              });
              // Copy original file
              const altContent = await fs.readFile(filePath);
              const outPath = path.join(
                outputPluginPath,
                "engineAlt",
                compatFolderName,
                relative,
              );
              await fs.mkdir(path.dirname(outPath), { recursive: true });
              await fs.writeFile(outPath, altContent);
            }
          } else {
            // No corresponding engine files, copy alt file as-is
            const altContent = await fs.readFile(filePath);
            const outPath = path.join(
              outputPluginPath,
              "engineAlt",
              compatFolderName,
              relative,
            );
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, altContent);
            log.info(
              "No engine files for engineAlt merge: " +
                compatFolderName +
                " / " +
                relative +
                " - copied as-is",
            );
          }
        }
      }
    }

    // Send final progress update
    if (win) {
      const hasConflicts = conflicts.length > 0;
      win.webContents.send("update-progress", {
        plugin: "COMPLETE",
        file: hasConflicts
          ? `Update complete with ${conflicts.length} conflicts`
          : "Update complete successfully",
      });
    }

    // Write console output log
    const consoleLogPath = path.join(
      updatedPluginsFolderOutput,
      "update_process.log",
    );
    const consoleLogContent = logs.join("\n");
    await fs.writeFile(consoleLogPath, consoleLogContent, "utf8");
    log.info(`Console log written to: ${consoleLogPath}`);

    // Write conflicts log if any
    if (conflicts.length > 0) {
      const logPath = path.join(
        updatedPluginsFolderOutput,
        "patch_conflicts.log",
      );
      const logContent = `Patch Application Conflicts Report\n${"=".repeat(40)}\n\nGenerated: ${new Date().toISOString()}\nTotal conflicts: ${conflicts.length}\n\nConflicts:\n${conflicts
        .map(
          (c) =>
            `Plugin: ${c.plugin}\nFile: ${c.file}\nReason: ${c.reason}\n${c.details ? `Conflict Details:\n${c.details}\n` : ""}---`,
        )
        .join("\n")}`;

      await fs.writeFile(logPath, logContent, "utf8");
      log.info(`Conflicts log written to: ${logPath}`);
    }

    return { success: true, conflicts: conflicts.length };
  } catch (err) {
    console.error("engine-update failed:", err);
    throw err;
  }
});

ipcMain.handle("update-plugins", async (_, data) => {
  const { previousPluginFolder, newPluginFolder, updatedPluginsFolderOutput } =
    data;
  // when the engine has changed, compare plugin files against the *new* engine
  const diff3 = require("node-diff3");
  const fs = require("fs").promises;
  const path = require("path");

  // Logging helper to capture console output
  const logs = [];
  const log = {
    info: (message) => {
      const logEntry =
        typeof message === "string" ? message : JSON.stringify(message);
      console.log(logEntry);
      logs.push(logEntry);
    },
    warn: (message) => {
      const logEntry =
        typeof message === "string" ? message : JSON.stringify(message);
      console.warn(logEntry);
      logs.push(`[WARN] ${logEntry}`);
    },
  };

  // Empty the output folder first
  try {
    await fs.rm(updatedPluginsFolderOutput, { recursive: true, force: true });
    log.info("Emptied output folder: " + updatedPluginsFolderOutput);
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
      if (excludePaths.some((exclude) => srcPath.startsWith(exclude))) {
        continue;
      }

      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath, excludePaths);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  const win = BrowserWindow.getAllWindows()[0];

  try {
    let conflicts = [];

    const authorDirs = await fs.readdir(newPluginFolder, {
      withFileTypes: true,
    });
    const sortedAuthors = authorDirs
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const allPlugins = [];
    for (const authorName of sortedAuthors) {
      const authorPath = path.join(newPluginFolder, authorName);
      const pluginDirs = await fs.readdir(authorPath, {
        withFileTypes: true,
      });
      const plugins = pluginDirs
        .filter((d) => d.isDirectory())
        .map((d) => ({
          author: authorName,
          plugin: d.name,
          fullName: `${authorName}/${d.name}`,
        }));
      allPlugins.push(...plugins);
    }

    // Sort all plugins alphabetically by full name (author/plugin)
    allPlugins.sort((a, b) => a.fullName.localeCompare(b.fullName));

    //Copy newPluginFolder into updatedPluginsFolderOutput
    await copyDir(newPluginFolder, updatedPluginsFolderOutput);

    for (const pluginInfo of allPlugins) {
      let previousPluginFiles = new Map();
      let newPluginFiles = new Map();
      const previousPluginPath = path.join(
        previousPluginFolder,
        pluginInfo.author,
        pluginInfo.plugin,
      );
      const newPluginPath = path.join(
        newPluginFolder,
        pluginInfo.author,
        pluginInfo.plugin,
      );
      const outputPluginPath = path.join(
        updatedPluginsFolderOutput,
        pluginInfo.author,
        pluginInfo.plugin,
      );

      // Apply engine upgrade patches to plugins
      const newPluginEnginePath = path.join(newPluginPath, "engine");
      const previousPluginEnginePath = path.join(previousPluginPath, "engine");
      const newPluginEngineAltPath = path.join(newPluginPath, "engineAlt");

      // Gather previous plugin engine files
      try {
        const filePaths = await gatherFiles(previousPluginEnginePath);
        for (const filePath of filePaths) {
          //const relative = path.relative(newEngineFolder, filePath);
          const relative = filePath.substring(
            previousPluginEnginePath.length + 1,
          );
          const content = await fs.readFile(filePath, "utf8");
          previousPluginFiles.set(relative, content);
        }
      } catch (err) {
        log.warn("Could not read previous plugin files: " + err.message);
      }

      // Gather new plugin engine files
      try {
        const filePaths = await gatherFiles(newPluginEnginePath);
        for (const filePath of filePaths) {
          //const relative = path.relative(newEngineFolder, filePath);
          const relative = filePath.substring(newPluginEnginePath.length + 1);
          const content = await fs.readFile(filePath, "utf8");
          newPluginFiles.set(relative, content);
        }
      } catch (err) {
        log.warn("Could not read new plugin files: " + err.message);
      }

      //Iterate through newPluginEngineAltPath and for each plugin combinaison folder, gather files and store them to a map.
      //Then for each of the files, perform a three-way merge between the newPluginEngine file and previousPluginEngine file (if they exist) and the engineAlt file.
      const engineAltFilesByFolder = new Map(); // Map<folderName, Map<relative, content>>
      try {
        const engineAltDirs = await fs.readdir(newPluginEngineAltPath, {
          withFileTypes: true,
        });
        const altFolders = engineAltDirs
          .filter((d) => d.isDirectory())
          .map((d) => d.name);

        for (const altFolder of altFolders) {
          const altFolderPath = path.join(newPluginEngineAltPath, altFolder);
          const altFilesMap = new Map();

          try {
            const filePaths = await gatherFiles(altFolderPath);
            for (const filePath of filePaths) {
              const relative = filePath.substring(altFolderPath.length + 1);
              const content = await fs.readFile(filePath, "utf8");
              altFilesMap.set(relative, content);
            }
            engineAltFilesByFolder.set(altFolder, altFilesMap);
            log.info(
              `Gathered ${altFilesMap.size} files from engineAlt folder: ${altFolder}`,
            );
          } catch (err) {
            log.warn(
              `Could not read engineAlt folder ${altFolder} for ${pluginInfo.fullName}: ${err.message}`,
            );
          }
        }
      } catch (err) {
        // engineAlt folder might not exist
        log.info(`No engineAlt folder found for ${pluginInfo.fullName}`);
      }

      // Perform three-way merge for each engineAlt file
      for (const [altFolder, altFilesMap] of engineAltFilesByFolder.entries()) {
        for (const [relative, altContent] of altFilesMap.entries()) {
          // Skip engine.json
          if (relative === "engine.json") {
            continue;
          }

          if (win) {
            win.webContents.send("update-progress", {
              plugin: pluginInfo.fullName,
              file: `engineAlt/${altFolder}/${relative}`,
            });
          }

          const newPluginContent = newPluginFiles.get(relative);
          const previousPluginContent = previousPluginFiles.get(relative);

          if (newPluginContent && previousPluginContent) {
            try {
              // Perform three-way merge: ours=new, base=previous, theirs=alt
              const mergeResult = diff3.diff3Merge(
                newPluginContent.split(/\r?\n/),
                previousPluginContent.split(/\r?\n/),
                altContent.split(/\r?\n/),
              );

              // Check for conflicts
              const hasConflicts = mergeResult.some((part) => part.conflict);

              if (hasConflicts) {
                // Extract conflict details
                const conflictDetails = mergeResult
                  .filter((part) => part.conflict)
                  .map((part) => {
                    const conflict = part.conflict;
                    return `<<<<<<< NEW PLUGIN\n${conflict.a}\n=======\n${conflict.o}\n>>>>>>> ALT\n${conflict.b}\n>>>>>>>`;
                  })
                  .join("\n---\n");

                // Record conflicts
                conflicts.push({
                  plugin: pluginInfo.fullName,
                  file: `engineAlt/${altFolder}/${relative}`,
                  reason: "Merge conflicts detected",
                  details: conflictDetails,
                });
                log.warn(
                  `Merge conflicts for engineAlt/${altFolder}/${relative} - keeping original alt file`,
                );
              } else {
                // No conflicts, update the alt file with merged result
                const mergedContent = mergeResult[0].ok.join("\n");
                altFilesMap.set(relative, mergedContent);
                //Save the updated alt file to the output folder
                const outPath = path.join(
                  outputPluginPath,
                  `engineAlt/${altFolder}/${relative}`,
                );
                await fs.mkdir(path.dirname(outPath), { recursive: true });
                await fs.writeFile(outPath, mergedContent, "utf8");

                log.info(
                  `Merged plugin engine changes into engineAlt/${altFolder}/${relative}`,
                );
              }
            } catch (err) {
              log.warn(
                `Error merging engineAlt/${altFolder}/${relative}: ${err.message}`,
              );
              conflicts.push({
                plugin: pluginInfo.fullName,
                file: `engineAlt/${altFolder}/${relative}`,
                reason: `Merge error: ${err.message}`,
              });
            }
          } else {
            log.info(
              `Skipping merge for engineAlt/${altFolder}/${relative} - new or previous plugin file not found`,
            );
          }
        }
      }
    }

    // Send final progress update

    if (win) {
      const hasConflicts = conflicts.length > 0;
      win.webContents.send("update-progress", {
        plugin: "COMPLETE",
        file: hasConflicts
          ? `Update complete with ${conflicts.length} conflicts`
          : "Update complete successfully",
      });
    }

    // Write console output log
    const consoleLogPath = path.join(
      updatedPluginsFolderOutput,
      "update_process.log",
    );
    const consoleLogContent = logs.join("\n");
    await fs.writeFile(consoleLogPath, consoleLogContent, "utf8");
    log.info(`Console log written to: ${consoleLogPath}`);

    // Write conflicts log if any
    if (conflicts.length > 0) {
      const logPath = path.join(
        updatedPluginsFolderOutput,
        "patch_conflicts.log",
      );
      const logContent = `Patch Application Conflicts Report\n${"=".repeat(40)}\n\nGenerated: ${new Date().toISOString()}\nTotal conflicts: ${conflicts.length}\n\nConflicts:\n${conflicts
        .map(
          (c) =>
            `Plugin: ${c.plugin}\nFile: ${c.file}\nReason: ${c.reason}\n${c.details ? `Conflict Details:\n${c.details}\n` : ""}---`,
        )
        .join("\n")}`;

      await fs.writeFile(logPath, logContent, "utf8");
      log.info(`Conflicts log written to: ${logPath}`);
    }

    return { success: true, conflicts: conflicts.length };
  } catch (err) {
    console.error("update-plugins failed:", err);
    throw err;
  }
});

ipcMain.handle("create-patches", async (_, data) => {
  const {
    engineFolder,
    pluginsFolder,
    updatedPluginsFolderOutput,
    createEngineAlts,
  } = data;
  // when the engine has changed, compare plugin files against the *new* engine
  const jsdiff = require("diff");
  const fs = require("fs").promises;
  const path = require("path");

  // Helper function to prevent folder name to be an invalid name like CON, NUL, PRN, etc... which would cause fs operations to fail on Windows
  const isIllegalFolderName = (name) => {
    const invalidNames = [
      "CON",
      "PRN",
      "AUX",
      "NUL",
      "COM1",
      "COM2",
      "COM3",
      "COM4",
      "COM5",
      "COM6",
      "COM7",
      "COM8",
      "COM9",
      "LPT1",
      "LPT2",
      "LPT3",
      "LPT4",
      "LPT5",
      "LPT6",
      "LPT7",
      "LPT8",
      "LPT9",
    ];
    return invalidNames.includes(name.toUpperCase());
  };

  // Normalize whitespace in text content
  const normalizeWhitespace = (content) => {
    return content.replace(/\r\n/g, "\n");
  };

  // Logging helper to capture console output
  const logs = [];
  const log = {
    info: (message) => {
      const logEntry =
        typeof message === "string" ? message : JSON.stringify(message);
      console.log(logEntry);
      logs.push(logEntry);
    },
    warn: (message) => {
      const logEntry =
        typeof message === "string" ? message : JSON.stringify(message);
      console.warn(logEntry);
      logs.push(`[WARN] ${logEntry}`);
    },
  };

  // Empty the output folder first
  try {
    await fs.rm(updatedPluginsFolderOutput, { recursive: true, force: true });
    log.info("Emptied output folder: " + updatedPluginsFolderOutput);
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
      if (excludePaths.some((exclude) => srcPath.startsWith(exclude))) {
        continue;
      }

      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath, excludePaths);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  async function fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Generate all non-empty combinations of previousPlugins
  const generateCombinations = (arr) => {
    const result = [];
    const n = arr.length;
    for (let i = 1; i < 1 << n; i++) {
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

  try {
    let conflicts = [];
    const win = BrowserWindow.getAllWindows()[0];

    const authorDirs = await fs.readdir(pluginsFolder, { withFileTypes: true });
    const sortedAuthors = authorDirs
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const allPlugins = [];
    for (const authorName of sortedAuthors) {
      const authorPath = path.join(pluginsFolder, authorName);
      const pluginDirs = await fs.readdir(authorPath, {
        withFileTypes: true,
      });
      const plugins = pluginDirs
        .filter((d) => d.isDirectory())
        .map((d) => ({
          author: authorName,
          plugin: d.name,
          fullName: `${authorName}/${d.name}`,
        }));
      allPlugins.push(...plugins);
    }

    // Sort all plugins alphabetically by full name (author/plugin)
    allPlugins.sort((a, b) => a.fullName.localeCompare(b.fullName));

    // If engine didn't change, just copy plugins and prepare for patch creation
    const baseEngineFileMap = new Map();
    const inputPluginFileMap = new Map(); // Map<filePath, Map<pluginName, content>>
    // check source engineAlt folders for file variations and create patches
    for (const pluginInfo of allPlugins) {
      const inputPluginPath = path.join(
        pluginsFolder,
        pluginInfo.author,
        pluginInfo.plugin,
      );
      const outputPluginPath = path.join(
        updatedPluginsFolderOutput,
        pluginInfo.author,
        pluginInfo.plugin,
      );

      if (win) {
        win.webContents.send("update-progress", {
          plugin: `Patching ${pluginInfo.fullName}`,
          file: `reading files...`,
        });
      }
      //STEP 1 : fill inputPluginFileMap with files from the base plugin for later comparison with engineAlt variants
      const inputEnginePath = path.join(inputPluginPath, "engine");
      const inputEngineAltPath = path.join(inputPluginPath, "engineAlt");
      let inputEngineAltFolders = [];
      try {
        const altDirEntries = await fs.readdir(inputEngineAltPath, {
          withFileTypes: true,
        });
        inputEngineAltFolders = altDirEntries
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch (err) {}
      try {
        //fill inputPluginFileMap with files from the base engine folder
        const engineFiles = await gatherFiles(engineFolder);
        for (const engineFile of engineFiles) {
          const relative = engineFile.substring(engineFolder.length + 1);
          if (relative === "engine.json") {
            continue;
          }
          const engineFileContent = await fs.readFile(engineFile, "utf8");
          // Add to baseEngineFileMap for later comparison with engineAlt variants
          baseEngineFileMap.set(relative, engineFileContent);
        }
        //fill inputPluginFileMap with files from the plugin engine folder
        const inputEngineFiles = await gatherFiles(inputEnginePath);
        for (const inputEngineFile of inputEngineFiles) {
          const relative = inputEngineFile.substring(
            inputEnginePath.length + 1,
          );
          if (relative === "engine.json") {
            continue;
          }
          const inputEngineFileContent = await fs.readFile(
            inputEngineFile,
            "utf8",
          );
          // Add to inputPluginFileMap for later comparison with engineAlt variants
          if (!inputPluginFileMap.has(relative)) {
            inputPluginFileMap.set(relative, new Map());
          }
          inputPluginFileMap
            .get(relative)
            .set(pluginInfo.plugin, inputEngineFileContent);
        }
        //fill inputPluginFileMap with files from the plugin engineAlt folders
        for (const inputEngineAltFolder of inputEngineAltFolders) {
          const inputEngineAltFiles = await gatherFiles(
            path.join(inputEngineAltPath, inputEngineAltFolder),
          );
          for (const inputEngineFile of inputEngineAltFiles) {
            const relative = inputEngineFile.substring(
              path.join(inputEngineAltPath, inputEngineAltFolder).length + 1,
            );
            if (relative === "engine.json") {
              continue;
            }
            const inputEngineFileContent = await fs.readFile(
              inputEngineFile,
              "utf8",
            );
            // Add to inputPluginFileMap for later comparison with engineAlt variants
            if (!inputPluginFileMap.has(relative)) {
              inputPluginFileMap.set(relative, new Map());
            }
            inputPluginFileMap
              .get(relative)
              .set(
                inputEngineAltFolder + "_" + pluginInfo.plugin,
                inputEngineFileContent,
              );
          }
        }
      } catch (err) {
        // failed to read current plugin files, skip processing for this plugin
        log.warn(
          `Could not read plugin files for ${pluginInfo.fullName}: ${err.message}`,
        );
        continue;
      }

      //STEP 2: create patch files for the plugin's engine.
      const outputEnginePath = path.join(outputPluginPath, "engine");
      //Copy inputPluginPath to outputPluginPath
      try {
        await copyDir(inputPluginPath, outputPluginPath, (!createEngineAlts)?[inputEngineAltPath]:[]);
      } catch (err) {
        log.warn(
          `Could not copy engine folder for ${pluginInfo.fullName}: ${err.message}`,
        );
        continue;
      }
      //Iterate files and create patches for the plugin files that are different from the base engine files, and save them to outputEnginePath with the same relative path + ".patch"
      const allPluginFiles = inputPluginFileMap.keys();
      for (const relative of allPluginFiles) {
        const outputFilePath = path.join(outputEnginePath, relative);
        if (relative === "engine.json" || relative.endsWith(".patch")) {
          continue;
        }
        if (win) {
          win.webContents.send("update-progress", {
            plugin: `Patching ${pluginInfo.fullName}`,
            file: `engine/${relative}`,
          });
        }
        const currentFileMap = inputPluginFileMap.get(relative);
        let newFileContent = null;
        let baseFileContent = null;
        if (currentFileMap.has(pluginInfo.plugin)) {
          newFileContent = currentFileMap.get(pluginInfo.plugin);
        }
        if (newFileContent && baseEngineFileMap.has(relative)) {
          baseFileContent = baseEngineFileMap.get(relative);
        }
        if (newFileContent && baseFileContent) {
          const normalizedBaseFileContent =
            normalizeWhitespace(baseFileContent);
          const normalizedAdjustedFileContent =
            normalizeWhitespace(newFileContent);
          const patchText = jsdiff.createPatch(
            relative,
            normalizedBaseFileContent,
            normalizedAdjustedFileContent,
          );
          const patchPath = outputFilePath + ".patch";
          try {
            await fs.mkdir(path.dirname(patchPath), { recursive: true });
            await fs.writeFile(patchPath, patchText, "utf8");
            if (await fileExists(outputFilePath)) {
              //if outputFilePath already exist, delete it
              await fs.rm(outputFilePath);
            }
          } catch (err) {
            //Failed to write patch file
            log.warn(
              `Could not create patch files for engine folder of ${pluginInfo.fullName}: ${err.message}`,
            );
          }
          log.info(
            `Created patch for engine file ${relative} in engine folder of plugin ${pluginInfo.fullName} based on original engine file`,
          );
        }
      }

      if (createEngineAlts) {
        const outputEngineAltPath = path.join(outputPluginPath, "engineAlt");
        //STEP 3: create plugin dependencies list and create engineAlt Folders.
        const pluginDependencies = new Set();
        for (const [relative, pluginMap] of inputPluginFileMap.entries()) {
          if (pluginMap.has(pluginInfo.plugin)) {
            inputPluginFileMap
              .get(relative)
              .keys()
              .forEach((key) => {
                if (!key.includes(pluginInfo.plugin)) {
                  pluginDependencies.add(key.split("_").slice(-1)[0]);
                }
              });
          }
        }
        if (pluginDependencies.size == 0) {
          continue;
        }
        const pluginCombinations = generateCombinations(
          Array.from(pluginDependencies).sort(),
        );
        for (const combination of pluginCombinations) {
          let engineAltFolderName = combination.join("_");
          await fs.mkdir(path.join(outputEngineAltPath, engineAltFolderName), {
            recursive: true,
          });
        }

        //STEP 4: check for engineAlt variants and create patch files for them if needed.
        let outputEngineAltFolders = [];
        try {
          const altDirEntries = await fs.readdir(outputEngineAltPath, {
            withFileTypes: true,
          });
          outputEngineAltFolders = altDirEntries
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
        } catch (err) {
          // No engineAlt folder, skip.
          continue;
        }
        for (const altFolderName of outputEngineAltFolders) {
          const outputAltFolderPath = path.join(
            outputEngineAltPath,
            altFolderName,
          );
          //Copy outputEnginePath to outputAltFolderPath
          try {
            await copyDir(outputEnginePath, outputAltFolderPath);
          } catch (err) {
            log.warn(
              `Could not copy engine folder to alt folder ${altFolderName} for ${pluginInfo.fullName}: ${err.message}`,
            );
            continue;
          }
          try {
            const allPluginFiles = inputPluginFileMap.keys();
            for (const relative of allPluginFiles) {
              const outputAltFilePath = path.join(
                outputAltFolderPath,
                relative,
              );

              // Skip engine.json and .patch files
              if (relative === "engine.json" || relative.endsWith(".patch")) {
                continue;
              }
              //await fileExists(outputAltFilePath + ".patch")
              // Skip if a patch was already done for that file or if the file already exist in output
              if (!inputPluginFileMap.has(relative)) {
                continue;
              }

              if (win) {
                win.webContents.send("update-progress", {
                  plugin: `Patching ${pluginInfo.fullName}`,
                  file: `engineAlt/${altFolderName}/${relative}`,
                });
              }

              const currentFileMap = inputPluginFileMap.get(relative);
              let newFileContent = null;
              let baseFileContent = null;
              //split altFolderName into array by "_"
              const altFolders = altFolderName.split("_");
              const altFoldercombinations =
                generateCombinations(altFolders).reverse();
              for (const combination of altFoldercombinations) {
                let adjustedAltFolderName =
                  combination.join("_") + "_" + pluginInfo.plugin;
                if (currentFileMap.has(adjustedAltFolderName)) {
                  newFileContent = currentFileMap.get(adjustedAltFolderName);
                  break;
                }
              }
              if (newFileContent) {
                for (const combination of altFoldercombinations) {
                  let baseAltFolderName = combination.join("_");
                  if (currentFileMap.has(baseAltFolderName)) {
                    baseFileContent = currentFileMap.get(baseAltFolderName);
                    break;
                  }
                }
                if (!baseFileContent) {
                  if (baseEngineFileMap.has(relative)) {
                    baseFileContent = baseEngineFileMap.get(relative);
                  } else {
                    if (currentFileMap.has(pluginInfo.plugin)) {
                      // since this is an alt of a file within the plugin, we just copy adjustedFileContent instead of patching
                      const outPath = path.join(outputAltFolderPath, relative);
                      await fs.mkdir(path.dirname(outPath), {
                        recursive: true,
                      });
                      await fs.writeFile(outPath, newFileContent, "utf8");
                      continue;
                    }
                  }
                }
              }
              if (newFileContent && baseFileContent) {
                //the adjustedFileContent is from a different alt folder than the current alt folder, we need to create a patch from the adjustedFileContent to the current alt file and save it to outputAltFilePath + ".patch"
                //create patch from existingFileContent and inputAltFilePath content, and save it to outputAltFilePath + ".patch"
                const normalizedBaseFileContent =
                  normalizeWhitespace(baseFileContent);
                const normalizedAdjustedFileContent =
                  normalizeWhitespace(newFileContent);
                const patchText = jsdiff.createPatch(
                  relative,
                  normalizedBaseFileContent,
                  normalizedAdjustedFileContent,
                );
                const patchPath = path.join(
                  outputAltFolderPath,
                  relative + ".patch",
                );
                await fs.mkdir(path.dirname(patchPath), { recursive: true });
                await fs.writeFile(patchPath, patchText, "utf8");

                if (await fileExists(outputAltFilePath)) {
                  //if outPutAltFilePath already exist, delete it
                  await fs.rm(outputAltFilePath);
                }
                currentFileMap.set(
                  altFolderName + "_" + pluginInfo.plugin,
                  newFileContent,
                );
                log.info(
                  `Created patch for engineAlt file ${relative} in alt folder ${altFolderName}`,
                );
              }
            }
          } catch (err) {
            log.warn(
              `Could not read engineAlt folder ${altFolderName}: ${err.message}`,
            );
          }
        }
      }
    }

    // Generate engineAltRules for plugins with engineAlt folders
    log.info("Generating engineAltRules for plugins with engineAlt folders...");

    for (const pluginInfo of allPlugins) {
      const outputPluginPath = path.join(
        updatedPluginsFolderOutput,
        pluginInfo.author,
        pluginInfo.plugin,
      );
      const engineAltPath = path.join(outputPluginPath, "engineAlt");
      const pluginJsonPath = path.join(outputPluginPath, "plugin.json");

      try {
        // Read the plugin.json first
        let pluginJson = null;
        try {
          const pluginJsonContent = await fs.readFile(pluginJsonPath, "utf8");
          pluginJson = JSON.parse(pluginJsonContent);
        } catch (err) {
          log.warn(
            "Could not read plugin.json for " +
              pluginInfo.fullName +
              ": " +
              err.message,
          );
          continue;
        }

        // Check if engineAlt folder exists
        let engineAltFolders = [];
        if (createEngineAlts) {
          try {
            const engineAltDirs = await fs.readdir(engineAltPath, {
              withFileTypes: true,
            });
            engineAltFolders = engineAltDirs
              .filter((d) => d.isDirectory())
              .map((d) => d.name);
          } catch (err) {
            if (err.code !== "ENOENT") {
              log.warn(
                "Could not read engineAlt folder for " +
                  pluginInfo.fullName +
                  ": " +
                  err.message,
              );
            }
            // If engineAlt doesn't exist or can't be read, engineAltFolders stays empty
          }
        }
        if (engineAltFolders.length === 0) {
          // No engineAlt folders, remove engineAltRules from plugin.json if it exists
          if (pluginJson.engineAltRules) {
            delete pluginJson.engineAltRules;
            log.info(
              "Cleared engineAltRules for " +
                pluginInfo.fullName +
                " (no engineAlt folders)",
            );
          }
        } else {
          // Generate engineAltRules
          pluginJson.engineAltRules = [];
          for (const engineAltFolder of engineAltFolders) {
            // Parse the folder name to extract plugin names
            const pluginNames = engineAltFolder.split("_");
            // Minimize engineAltFolder name by abbreviating plugin names with minimal unique prefixes
            // (e.g. "ConfigLoadSavePlugin_MetaTilePlugin" -> "Co_Me") for cleaner rule definitions
            const abbreviatedPluginNames = pluginNames.map((name) => {
              // Try progressively longer prefixes until we find one that's unique among this combination
              for (let len = 1; len <= name.length; len++) {
                const prefix = name.substring(0, len);
                // Check if any OTHER plugin name in this combination would have the same prefix
                const conflict = allPlugins.some((otherPlugin) => {
                  return (
                    otherPlugin.plugin !== name &&
                    otherPlugin.plugin.substring(0, len) === prefix
                  );
                });

                if (!conflict && !isIllegalFolderName(prefix)) {
                  return prefix;
                }
              }
              // Fallback to full name if no unique prefix found
              return name;
            });
            const abbreviatedEngineAltFolder = abbreviatedPluginNames.join("_");
            //rename engineAltFolder to abbreviatedEngineAltFolder
            const oldPath = path.join(engineAltPath, engineAltFolder);
            const newPath = path.join(
              engineAltPath,
              abbreviatedEngineAltFolder,
            );
            try {
              await fs.rename(oldPath, newPath);
            } catch (err) {
              log.warn(
                "Could not rename engineAlt folder for " +
                  pluginInfo.fullName +
                  ": " +
                  err.message,
              );
              abbreviatedEngineAltFolder = engineAltFolder; // fallback to original name if rename fails
            }

            // Create a rule for this combination
            const rule = {
              when: {
                additionalPlugins: pluginNames.map((name) => {
                  // Try with Mico27 author first, then just the name
                  return `Mico27/${name}`;
                }),
              },
              use: abbreviatedEngineAltFolder,
            };
            pluginJson.engineAltRules.push(rule);

            // Also add a rule with just the plugin names (in case author is different)
            if (!pluginNames.some((name) => name.includes("/"))) {
              pluginJson.engineAltRules.push({
                when: {
                  additionalPlugins: pluginNames,
                },
                use: abbreviatedEngineAltFolder,
              });
            }
          }

          // Sort rules by number of additionalPlugins (most specific first)
          pluginJson.engineAltRules.sort((a, b) => {
            const aCount = a.when?.additionalPlugins?.length || 0;
            const bCount = b.when?.additionalPlugins?.length || 0;
            return bCount - aCount;
          });
          log.info(
            "Generated engineAltRules for " +
              pluginInfo.fullName +
              " with " +
              engineAltFolders.length +
              " engineAlt folders",
          );
        }
        // Write updated plugin.json
        await fs.writeFile(
          pluginJsonPath,
          JSON.stringify(pluginJson, null, 2),
          "utf8",
        );
        log.info("Updated plugin.json for " + pluginInfo.fullName);
      } catch (err) {
        log.warn(
          "Error processing plugin.json for " +
            pluginInfo.fullName +
            ": " +
            err.message,
        );
      }
    }

    // Send final progress update

    if (win) {
      const hasConflicts = conflicts.length > 0;
      win.webContents.send("update-progress", {
        plugin: "COMPLETE",
        file: hasConflicts
          ? `Update complete with ${conflicts.length} conflicts`
          : "Update complete successfully",
      });
    }

    // Write console output log
    const consoleLogPath = path.join(
      updatedPluginsFolderOutput,
      "update_process.log",
    );
    const consoleLogContent = logs.join("\n");
    await fs.writeFile(consoleLogPath, consoleLogContent, "utf8");
    log.info(`Console log written to: ${consoleLogPath}`);

    // Write conflicts log if any
    if (conflicts.length > 0) {
      const logPath = path.join(
        updatedPluginsFolderOutput,
        "patch_conflicts.log",
      );
      const logContent = `Patch Application Conflicts Report\n${"=".repeat(40)}\n\nGenerated: ${new Date().toISOString()}\nTotal conflicts: ${conflicts.length}\n\nConflicts:\n${conflicts
        .map(
          (c) =>
            `Plugin: ${c.plugin}\nFile: ${c.file}\nReason: ${c.reason}\n${c.details ? `Conflict Details:\n${c.details}\n` : ""}---`,
        )
        .join("\n")}`;

      await fs.writeFile(logPath, logContent, "utf8");
      log.info(`Conflicts log written to: ${logPath}`);
    }

    return { success: true, conflicts: conflicts.length };
  } catch (err) {
    console.error("update-plugins failed:", err);
    throw err;
  }
});

// Test plugin output by attempting to apply patches to a temporary engine copy
ipcMain.handle("test-plugin-output", async (_, data) => {
  const { engineFolder, updatedPluginsFolderOutput } = data;

  try {
    const validator = new PluginOutputValidator({
      engineFolder,
      updatedPluginsFolderOutput,
      logger: {
        info: (msg) => console.log(msg),
        warn: (msg) => console.warn(msg),
        error: (msg) => console.error(msg),
      },
    });
    return await validator.runTests();
  } catch (err) {
    console.error("test-plugin-output failed:", err);
    throw err;
  }
});
