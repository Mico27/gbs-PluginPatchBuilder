export const UpdatePluginHelper = {
  updatePlugins: async (data) => {
    console.log("Updating with folders:", data);
    if (window.electronAPI && window.electronAPI.updatePlugins) {
      try {
        const result = await window.electronAPI.updatePlugins(data);
        console.log("updatePlugins result:", result);
        return result;
      } catch (err) {
        console.error("error during updatePlugins ipc call", err);
        throw err;
      }
    } else {
      console.warn("IPC updatePlugins not available");
      return { success: false };
    }
  },

  testPluginOutput: async (data) => {
    console.log("Testing plugin output:", data);
    if (window.electronAPI && window.electronAPI.testPluginOutput) {
      try {
        return await window.electronAPI.testPluginOutput(data);
      } catch (err) {
        console.error("error during testPluginOutput ipc call", err);
        throw err;
      }
    } else {
      console.warn("IPC testPluginOutput not available");
      return { success: false };
    }
  },
};
