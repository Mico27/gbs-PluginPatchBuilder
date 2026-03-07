import * as React from 'react';
import { createRoot } from 'react-dom/client';

const FolderSelector = () => {
  const [folders, setFolders] = React.useState(['', '', '', '']);

  const handleBrowse = async (index) => {
    const path = await window.electronAPI.selectFolder();
    if (path) {
      const newFolders = [...folders];
      newFolders[index] = path;
      setFolders(newFolders);
    }
  };

  const handleUpdate = () => {
    // Handle update logic here
    console.log('Updating with folders:', folders);
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Folder Selector</h2>
      {folders.map((folder, index) => (
        <div key={index} style={{ marginBottom: '10px' }}>
          <label>Folder {index + 1}:</label>
          <input
            type="text"
            value={folder}
            onChange={(e) => {
              const newFolders = [...folders];
              newFolders[index] = e.target.value;
              setFolders(newFolders);
            }}
            style={{ width: '300px', marginRight: '10px' }}
          />
          <button onClick={() => handleBrowse(index)}>Browse</button>
        </div>
      ))}
      <button onClick={handleUpdate} style={{ marginTop: '20px' }}>Update</button>
    </div>
  );
};

const root = createRoot(document.body);
root.render(<FolderSelector />);