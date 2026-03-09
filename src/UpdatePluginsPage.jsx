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
  const [createEngineAlts, setCreateEngineAlts] = React.useState(false);

  React.useEffect(() => {
    if (window.electronAPI && window.electronAPI.onUpdateProgress) {
      window.electronAPI.onUpdateProgress((data) => {
        setProgress(data);
      });
    }
  }, []);

  const handleUpdate = async () => {
    const data = engineChanged
      ? { engineChanged, previousEngineFolder, newEngineFolder, pluginsFolder, updatedPluginsFolderOutput, createEngineAlts }
      : { engineChanged, engineFolder, pluginsFolder, updatedPluginsFolderOutput, createEngineAlts };
    try {
      const result = await UpdatePluginHelper.updatePlugins(data);
      console.log('Plugins updated result', result);
    } catch (err) {
      console.error('updatePlugins failed', err);
    }
  };

  return (
    <div className="update-plugins-page">
      <h2>GBStudio Plugin Patcher</h2>
      
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
      {!engineChanged && (
      <div className="checkbox-container">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={createEngineAlts}
            onChange={(e) => setCreateEngineAlts(e.target.checked)}
          />
          <span>Generate EngineAlt For Plugin Intercompability</span>
        </label>
      </div>)}

      {engineChanged ? (
        <>
          <FolderSelector label="Previous Engine Folder" folder={previousEngineFolder} onChange={setPreviousEngineFolder} />
          <FolderSelector label="New Engine Folder" folder={newEngineFolder} onChange={setNewEngineFolder} />
        </>
      ) : (
        <FolderSelector label="Engine Folder" folder={engineFolder} onChange={setEngineFolder} />
      )}

      <FolderSelector label="Plugins Source Folder" folder={pluginsFolder} onChange={setPluginsFolder} />
      <FolderSelector label={engineChanged? "Updated Plugins Source Folder Output": "Patched Plugins Folder Output"} folder={updatedPluginsFolderOutput} onChange={setUpdatedPluginsFolderOutput} />
      <button className="update-button" onClick={handleUpdate}>Update</button>
      {progress.plugin && (
        <div style={{ marginTop: '15px', fontSize: '13px', color: '#ccc' }}>
          Processing {progress.plugin} / {progress.file}
        </div>
      )}
    </div>
  );
};