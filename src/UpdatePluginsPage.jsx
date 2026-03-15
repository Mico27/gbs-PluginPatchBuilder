import * as React from "react";
import { FolderSelector } from "./FolderSelector.jsx";
import { UpdatePluginHelper } from "./UpdatePluginHelper.js";

export const UpdatePluginsPage = () => {
  const [updateMode, setUpdateMode] = React.useState("Plugin update");
  const [engineFolder, setEngineFolder] = React.useState("");
  const [previousEngineFolder, setPreviousEngineFolder] = React.useState("");
  const [newEngineFolder, setNewEngineFolder] = React.useState("");
  const [pluginsFolder, setPluginsFolder] = React.useState("");
  const [previousPluginFolder, setPreviousPluginFolder] = React.useState("");
  const [newPluginFolder, setNewPluginFolder] = React.useState("");
  const [updatedPluginsFolderOutput, setUpdatedPluginsFolderOutput] =
    React.useState("");
  const [progress, setProgress] = React.useState({ plugin: "", file: "" });
  const [createEngineAlts, setCreateEngineAlts] = React.useState(true);
  const [testEngineAlts, setTestEngineAlts] = React.useState(true);
  const [isUpdating, setIsUpdating] = React.useState(false);

  React.useEffect(() => {
    if (window.electronAPI && window.electronAPI.onUpdateProgress) {
      window.electronAPI.onUpdateProgress((data) => {
        setProgress(data);
      });
    }
  }, []);

  const isFormValid = () => {
    switch (updateMode) {
      case "Engine update":
        return (
          previousEngineFolder &&
          newEngineFolder &&
          pluginsFolder &&
          updatedPluginsFolderOutput
        );
      case "Plugin update":
        return (
          previousPluginFolder &&
          newPluginFolder &&
          updatedPluginsFolderOutput
        );
      case "Create patches":
        return engineFolder && pluginsFolder && updatedPluginsFolderOutput;
      default:
        return false;
    }
  };

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      let result = {};
      switch (updateMode) {
        case "Engine update":
          result = await UpdatePluginHelper.engineUpdate({
            previousEngineFolder,
            newEngineFolder,
            pluginsFolder,
            updatedPluginsFolderOutput,
          });
          break;
        case "Plugin update":
          result = await UpdatePluginHelper.updatePluginSources({
            previousPluginFolder,
            newPluginFolder,
            updatedPluginsFolderOutput,
          });
          break;
        case "Create patches":
          result = await UpdatePluginHelper.createPatches({
            engineFolder,
            pluginsFolder,
            updatedPluginsFolderOutput,
            createEngineAlts,
          });
          break;
        default:
          console.error("Unknown update mode:", updateMode);
          setIsUpdating(false);
          return;
      }

      console.log("Plugins updated result", result);

      // Run tests automatically after update completes
      if (
        updateMode == "Create patches" &&
        testEngineAlts &&
        result.success &&
        result.conflicts === 0
      ) {
        setTimeout(async () => {
          try {
            const testResult =
              await UpdatePluginHelper.testPluginOutput({ engineFolder, updatedPluginsFolderOutput });
            console.log("Plugin output tests completed", testResult);
          } catch (err) {
            console.error("testPluginOutput failed", err);
          }
          setIsUpdating(false);
        }, 1000);
      } else {
        setIsUpdating(false);
      }
    } catch (err) {
      console.error("updatePlugins failed", err);
      setIsUpdating(false);
    }
  };

  return (
    <div className="update-plugins-page">
      <h2>GBStudio Plugin Patcher</h2>

      <div className="dropdown-container">
        <label htmlFor="update-mode">Update Mode:</label>
        <select
          id="update-mode"
          value={updateMode}
          onChange={(e) => setUpdateMode(e.target.value)}
        >
          <option value="Engine update">Engine update</option>
          <option value="Plugin update">Plugin update</option>
          <option value="Create patches">Create patches</option>
        </select>
      </div>
      {updateMode == "Engine update" && (
        <div style={{ marginBottom: "15px", fontSize: "13px", color: "#ccc" }}>
          Use this mode when updating to a new GBStudio version. It will compare
          the old and new engine files to determine exactly which plugin files
          need to be updated, minimizing the number of changed files and
          preserving any manual edits to plugin files that aren't affected by
          the engine update.
        </div>
      )}
      {updateMode == "Plugin update" && (
        <div style={{ marginBottom: "15px", fontSize: "13px", color: "#ccc" }}>
          Use this mode when you want to update your plugins engineAlt sources
          to match your plugin engine sources. This is useful if you have made
          manual edits to your plugin engine sources and want to carry those
          over to the engineAlts used for plugin inter-compatibility without
          having to manually copy over files or worry about missing any.
        </div>
      )}
      {updateMode == "Create patches" && (
        <div style={{ marginBottom: "15px", fontSize: "13px", color: "#ccc" }}>
          Use this mode to create .patch files for your plugins based on the
          differences between your engine folder and plugins folder. This is
          useful if you want to contribute your plugin updates to the official
          GBStudio repository - you can generate .patch files that contain only
          your changes and submit those instead of having to manually create
          .patch files or submit your entire plugin folder which may contain
          unrelated changes.
        </div>
      )}

      {updateMode === "Create patches" && (
        <div className="checkbox-container">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={createEngineAlts}
              onChange={(e) => setCreateEngineAlts(e.target.checked)}
            />
            <span>Generate EngineAlt For Plugin Inter-compatibility</span>
          </label>
        </div>
      )}

      {updateMode === "Create patches" && (
        <div className="checkbox-container">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={testEngineAlts}
              onChange={(e) => setTestEngineAlts(e.target.checked)}
            />
            <span>Test applying patches after creation</span>
          </label>
        </div>
      )}

      {updateMode === "Engine update" ? (
        <>
          <FolderSelector
            label="Previous Engine Folder"
            folder={previousEngineFolder}
            onChange={setPreviousEngineFolder}
          />
          <FolderSelector
            label="New Engine Folder"
            folder={newEngineFolder}
            onChange={setNewEngineFolder}
          />
        </>
      ) : (
        updateMode !== "Plugin update" && (
          <FolderSelector
            label="Engine Folder"
            folder={engineFolder}
            onChange={setEngineFolder}
          />
        )
      )}

      {updateMode == "Plugin update" ? (
        <>
          <FolderSelector
            label="Previous Plugin Folder"
            folder={previousPluginFolder}
            onChange={setPreviousPluginFolder}
          />
          <FolderSelector
            label="New Plugin Folder"
            folder={newPluginFolder}
            onChange={setNewPluginFolder}
          />
        </>
      ) : (
        <FolderSelector
          label="Plugins Source Folder"
          folder={pluginsFolder}
          onChange={setPluginsFolder}
        />
      )}

      <FolderSelector
        label={
          updateMode !== "Create patches"
            ? "Updated Plugins Source Folder Output"
            : "Patched Plugins Folder Output"
        }
        folder={updatedPluginsFolderOutput}
        onChange={setUpdatedPluginsFolderOutput}
      />
      <button
        className="update-button"
        onClick={handleUpdate}
        disabled={isUpdating || !isFormValid()}
      >
        {isUpdating ? "Processing..." : "Update"}
      </button>

      {progress.plugin && (
        <div style={{ marginTop: "15px", fontSize: "13px", color: "#ccc" }}>
          Processing {progress.plugin} / {progress.file}
        </div>
      )}
    </div>
  );
};
