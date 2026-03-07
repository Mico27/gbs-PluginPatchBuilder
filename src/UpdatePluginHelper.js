export const UpdatePluginHelper = {
  updatePlugins: async (data) => {
    console.log('Updating with folders:', data);
    if (window.electronAPI && window.electronAPI.updatePlugins) {
      try {
        const result = await window.electronAPI.updatePlugins(data);
        console.log('updatePlugins result:', result);
        return result;
      } catch (err) {
        console.error('error during updatePlugins ipc call', err);
        throw err;
      }
    } else {
      console.warn('IPC updatePlugins not available');
      return { success: false };
    }
  }
};