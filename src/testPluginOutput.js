const { BrowserWindow } = require("electron");
const fs = require("fs").promises;
const path = require("path");
const { applyPatch } = require("diff");

/**
 * Test suite to validate plugin output by applying patches to a temporary engine copy
 * Tests all engineAltRules and engine variants
 * Similar to how GBStudio applies plugins during compilation
 */

class PluginOutputValidator {
  constructor(options) {
    this.engineFolder = options.engineFolder;
    this.updatedPluginsFolderOutput = options.updatedPluginsFolderOutput;
    this.tempOutputFolder =
      options.tempOutputFolder || path.join(process.cwd(), ".test-output");
    this.tempEngineFolder = path.join(this.tempOutputFolder, "engine-copy");
    this.logger = options.logger || console;
  }

  /**
   * Check if conflicts file exists from update-plugins
   */
  async checkForConflicts() {
    const conflictsLogPath = path.join(
      this.updatedPluginsFolderOutput,
      "patch_conflicts.log",
    );

    try {
      await fs.access(conflictsLogPath);
      // File exists, conflicts were recorded
      const conflictContent = await fs.readFile(conflictsLogPath, "utf8");
      this.logger.error("❌ Conflicts found during patch generation:");
      this.logger.error(conflictContent);
      return false;
    } catch (err) {
      // File doesn't exist, no conflicts
      this.logger.info("✅ No conflicts found during patch generation");
      return true;
    }
  }

  /**
   * Extract referenced additionalPlugins from engineAltRules
   * Returns a Set of plugin identifiers that are referenced in engineAltRules.when.additionalPlugins
   * and actually exist within allPlugins
   */
  async getReferencedAdditionalPlugins(allPlugins) {
    const referencedPlugins = new Set();

    // Create a Set of plugin identifiers for quick lookup
    const pluginIdentifiers = new Set(
      allPlugins.map((p) => `${p.author}/${p.name}`),
    );

    try {
      // Iterate through all plugins
      for (const plugin of allPlugins) {
        const pluginPath = path.join(
          this.updatedPluginsFolderOutput,
          plugin.author,
          plugin.name,
        );
        const pluginJsonPath = path.join(pluginPath, "plugin.json");

        try {
          const pluginJsonContent = await fs.readFile(pluginJsonPath, "utf8");
          const pluginJson = JSON.parse(pluginJsonContent);

          // Extract additionalPlugins from engineAltRules
          if (
            pluginJson.engineAltRules &&
            Array.isArray(pluginJson.engineAltRules)
          ) {
            for (const rule of pluginJson.engineAltRules) {
              if (rule.when && rule.when.additionalPlugins) {
                const additionalPlugins = rule.when.additionalPlugins;

                // Handle both array and single plugin formats
                const pluginsToCheck = Array.isArray(additionalPlugins)
                  ? additionalPlugins
                  : [additionalPlugins];

                referencedPlugins.add(`${plugin.author}/${plugin.name}`); // Also add the plugin itself as referenced

                for (const additionalPlugin of pluginsToCheck) {
                  // Check if this plugin exists in allPlugins
                  if (pluginIdentifiers.has(additionalPlugin)) {
                    referencedPlugins.add(additionalPlugin);
                  }
                }
              }
            }
          }
        } catch (err) {
          // Skip plugins without valid plugin.json
          continue;
        }
      }

      return referencedPlugins;
    } catch (err) {
      this.logger.error(`Failed to extract referenced plugins: ${err.message}`);
      return new Set();
    }
  }

  /**
   * Copy engine to temp location for testing
   */
  async copyEngineToTemp() {
    try {
      await fs.rm(this.tempOutputFolder, { recursive: true, force: true });
      await this.copyDir(this.engineFolder, this.tempEngineFolder);
      this.logger.info(
        `✅ Engine copied to temp folder: ${this.tempEngineFolder}`,
      );
      return true;
    } catch (err) {
      this.logger.error(`❌ Failed to copy engine: ${err.message}`);
      return false;
    }
  }

  /**
   * Recursively copy directory
   */
  async copyDir(src, dest, excludePaths = []) {
    const entries = await fs.readdir(src, { withFileTypes: true });
    await fs.mkdir(dest, { recursive: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (excludePaths.some((exclude) => srcPath.startsWith(exclude))) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath, excludePaths);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  async getPluginEnginePathToUse(pluginPath, combination) {
    try {
      const pluginJsonPath = path.join(pluginPath, "plugin.json");
      const pluginJsonContent = await fs.readFile(pluginJsonPath, "utf8");
      const pluginJson = JSON.parse(pluginJsonContent);
      if (
        pluginJson.engineAltRules &&
        Array.isArray(pluginJson.engineAltRules)
      ) {
        for (const rule of pluginJson.engineAltRules) {
          if (rule.when && rule.when.additionalPlugins) {
            const additionalPlugins = rule.when.additionalPlugins;
            const pluginsToCheck = Array.isArray(additionalPlugins)
              ? additionalPlugins
              : [additionalPlugins];
            if (pluginsToCheck.every((p) => combination.includes(p))) {
              return path.join(pluginPath, "engineAlt", rule.use);
            }
          }
        }
      }
    } catch (err) {
      // No plugin.json or invalid JSON, skip rule logging
    }
    return path.join(pluginPath, "engine");
  }

  async getPatchFilesRecursively(dir) {
    const patchFiles = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Recursively get patches from subdirectories
        const subPatchFiles = await this.getPatchFilesRecursively(fullPath);
        patchFiles.push(...subPatchFiles);
      } else if (entry.name.endsWith(".patch")) {
        patchFiles.push(fullPath);
      }
    }

    return patchFiles;
  }

  /**
   * Run all plugin tests
   */
  async testAllPlugins() {
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

    // Get all plugins from output folder
    const authorDirs = await fs.readdir(this.updatedPluginsFolderOutput, {
      withFileTypes: true,
    });
    const authors = authorDirs
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    //Get all plugins for all authors
    const allPlugins = [];
    for (const author of authors) {
      const authorPath = path.join(this.updatedPluginsFolderOutput, author);
      const pluginDirs = await fs.readdir(authorPath, { withFileTypes: true });
      const plugins = pluginDirs.filter((d) => d.isDirectory());
      for (const plugin of plugins) {
        allPlugins.push({ author, name: plugin.name });
      }
    }

    const referencedPlugins =
      await this.getReferencedAdditionalPlugins(allPlugins);

    //Generate all combinations of plugins to test together (for engineAltRules that require multiple plugins)
    const combinations = generateCombinations(
      Array.from(referencedPlugins).sort(),
    );
    const combinationsCounted = combinations.length;
    this.logger.info(
      `Testing ${combinationsCounted} combinations of plugins...`,
    );
    let currentCombination = 0;
    //Iterate through all combinations of plugins for this author (to test engineAltRules with multiple plugins)
    const win = BrowserWindow.getAllWindows()[0];
    for (const combination of combinations) {
      // send progress      
      if (win) {
        win.webContents.send("update-progress", {
          plugin: `Testing all plugin combinations: ${currentCombination}`,
          file: `${combinationsCounted}`,
        });
      }
      currentCombination++;
      //prepare engine copy for this combination test
      const reset = await this.copyEngineToTemp();
      if (!reset) {
        this.logger.error(`❌ Failed to reset engine`);
        return false;
      }
      this.logger.info(`\nTesting combination: ${combination.join("\n")}`);
      for (const plugin of combination) {
        const pluginPath = path.join(this.updatedPluginsFolderOutput, plugin);
        //get which engineAltRules this plugin has that match this combination (to log which rules are being tested)
        const enginePath = await this.getPluginEnginePathToUse(
          pluginPath,
          combination,
        );
        //Copy pluginPath (excluding .patch files) in tempEngineFolder.
        await this.copyDir(enginePath, this.tempEngineFolder, [
          path.join(enginePath, "*.patch"),
        ]);
        //Get all .patch files within enginePath recursively

        const patchFiles = await this.getPatchFilesRecursively(enginePath);
        for (const patchFilePath of patchFiles) {
          try {
            const patchContent = await fs.readFile(patchFilePath, "utf8");
            const relativePatchPath = path.relative(enginePath, patchFilePath);
            const targetFilePath = path.join(
              this.tempEngineFolder,
              relativePatchPath.replace(".patch", ""),
            );

            // Ensure target directory exists
            await fs.mkdir(path.dirname(targetFilePath), { recursive: true });

            let targetContent = "";
            try {
              targetContent = await fs.readFile(targetFilePath, "utf8");
            } catch (err) {
              // If target file doesn't exist, treat as empty
              targetContent = "";
            }
            const patchedContent = applyPatch(targetContent, patchContent);
            if (patchedContent === false) {
              throw new Error("Patch failed to apply");
            }
            await fs.writeFile(targetFilePath, patchedContent, "utf8");
          } catch (err) {
            if (win) {
              win.webContents.send("update-progress", {
                plugin: `ERROR `,
                file: `❌ Failed to apply patch: ${relativePatchPath} for plugin ${plugin}: ${err.message}`,
              });
            }
            this.logger.error(
              `❌ Failed to apply patch: ${relativePatchPath} for plugin ${plugin}: ${err.message}`,
            );
            return false;
          }
        }
      }
    }
    if (win) {
      win.webContents.send("update-progress", {
        plugin: `COMPLETE `,
        file: `✅ All ${combinationsCounted} plugin combinations applied successfully`,
      });
    }
    return true;
  }

  /**
   * Run complete validation test
   */
  async runTests() {
    this.logger.info("Starting Plugin Output Validation Tests...\n");

    // Step 1: Check for conflicts
    const noConflicts = await this.checkForConflicts();
    if (!noConflicts) {
      return false;
    }

    // Step 2: Copy engine to temp folder
    const copied = await this.copyEngineToTemp();
    if (!copied) {
      return false;
    }

    // Step 3: Test all plugins
    const allValid = await this.testAllPlugins();
    if (!allValid) {
      return false;
    }

    // Cleanup temp folder
    try {
      await fs.rm(this.tempOutputFolder, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(
        `Warning: Could not clean up temp folder: ${err.message}`,
      );
    }

    return true;
  }
}

module.exports = { PluginOutputValidator };
