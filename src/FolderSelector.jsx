import * as React from 'react';

export const FolderSelector = ({ label, folder, onChange }) => {
  const handleBrowse = async () => {
    const path = await window.electronAPI.selectFolder();
    if (path) {
      onChange(path);
    }
  };

  const handleOpen = async () => {
    if (folder) {
      await window.electronAPI.openFolder(folder);
    }
  };

  return (
    <div className="folder-selector-container">
      <label className="folder-selector-label">
        {label}:
      </label>
      <div className="folder-selector-input-group">
        <input
          type="text"
          value={folder}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder="No folder selected"
          className="folder-selector-input"
        />
        <button 
          onClick={handleBrowse}
          className="folder-selector-button"
        >
          Browse
        </button>
        <button
          onClick={handleOpen}
          disabled={!folder}
          className="folder-selector-button"
          title="Open folder in file explorer"
        >
          Open
        </button>
      </div>
    </div>
  );
};