import * as React from 'react';
import { FolderSelector } from './FolderSelector.jsx';
import { UpdatePluginHelper } from './UpdatePluginHelper.js';


export const UpdatePluginsPage = () => {
  const [engineChanged, setEngineChanged] = React.useState(false);
  const [engineFolder, setEngineFolder] = React.useState('');
  const [previousEngineFolder, setPreviousEngineFolder] = React.useState('');
  const [newEngineFolder, setNewEngineFolder] = React.useState('');
  const [pluginsFolder, setPluginsFolder] = React.useState('');
  const [updatedPluginsFolderOutput, setUpdatedPluginsFolderOutput] = React.useState('');
  const [progress, setProgress] = React.useState({ plugin: '', file: '' });
  const [createCompabilityPatches, setCreateCompabilityPatches] = React.useState(false);

  React.useEffect(() => {
    if (window.electronAPI && window.electronAPI.onUpdateProgress) {
      window.electronAPI.onUpdateProgress((data) => {
        setProgress(data);
      });
    }
  }, []);

  const handleUpdate = async () => {
    const data = engineChanged
      ? { engineChanged, previousEngineFolder, newEngineFolder, pluginsFolder, updatedPluginsFolderOutput, createCompabilityPatches }
      : { engineChanged, engineFolder, pluginsFolder, updatedPluginsFolderOutput, createCompabilityPatches };
    try {
      const result = await UpdatePluginHelper.updatePlugins(data);
      console.log('Plugins updated result', result);
    } catch (err) {
      console.error('updatePlugins failed', err);
    }
  };

  return (
    <div className="update-plugins-page">
      <h2>Update plugins</h2>
      
      <div className="checkbox-container">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={engineChanged}
            onChange={(e) => setEngineChanged(e.target.checked)}
          />
          <span>Engine Changed</span>
        </label>
      </div>

      <div className="checkbox-container">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={createCompabilityPatches}
            onChange={(e) => setCreateCompabilityPatches(e.target.checked)}
          />
          <span>Create Compability Patches</span>
        </label>
      </div>

      {engineChanged ? (
        <>
          <FolderSelector label="Previous Engine Folder" folder={previousEngineFolder} onChange={setPreviousEngineFolder} />
          <FolderSelector label="New Engine Folder" folder={newEngineFolder} onChange={setNewEngineFolder} />
        </>
      ) : (
        <FolderSelector label="Engine Folder" folder={engineFolder} onChange={setEngineFolder} />
      )}

      <FolderSelector label="Plugins Folder" folder={pluginsFolder} onChange={setPluginsFolder} />
      <FolderSelector label="Updated Plugins Folder Output" folder={updatedPluginsFolderOutput} onChange={setUpdatedPluginsFolderOutput} />
      <button className="update-button" onClick={handleUpdate}>Update</button>
      {progress.plugin && (
        <div style={{ marginTop: '15px', fontSize: '13px', color: '#ccc' }}>
          Processing {progress.plugin} / {progress.file}
        </div>
      )}
    </div>
  );
};