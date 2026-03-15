export const UpdatePluginHelper = {
  engineUpdate: async (data) => {
    console.log("Updating with folders:", data);
    if (window.electronAPI && window.electronAPI.engineUpdate) {
      try {
        const result = await window.electronAPI.engineUpdate(data);
        console.log("engineUpdate result:", result);
        return result;
      } catch (err) {
        console.error("error during engineUpdate ipc call", err);
        throw err;
      }
    } else {
      console.warn("IPC engineUpdate not available");
      return { success: false };
    }
  },

  updatePluginSources: async (data) => {
    console.log("Updating with folders:", data);
    if (window.electronAPI && window.electronAPI.updatePluginSources) {
      try {
        const result = await window.electronAPI.updatePluginSources(data);
        console.log("updatePluginSources result:", result);
        return result;
      } catch (err) {
        console.error("error during updatePluginSources ipc call", err);
        throw err;
      }
    } else {
      console.warn("IPC updatePluginSources not available");
      return { success: false };
    }
  },

  createPatches: async (data) => {
    console.log("Creating patches with folders:", data);
    if (window.electronAPI && window.electronAPI.createPatches) {
      try {
        const result = await window.electronAPI.createPatches(data);
        console.log("createPatches result:", result);
        return result;
      } catch (err) {
        console.error("error during createPatches ipc call", err);
        throw err;
      }
    } else {
      console.warn("IPC createPatches not available");
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
