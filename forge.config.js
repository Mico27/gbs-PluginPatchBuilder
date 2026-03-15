const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { MakerAppImage } = require("@reforged/maker-appimage");

module.exports = {
  packagerConfig: {
    asar: true,
    icon: './assets/app_icon',
    name: "GB Studio Plugin Patcher",
    executableName: "gb-studio-plugin-patcher",
  },
  rebuildConfig: {},
  makers: [
    // Windows Installer (traditional setup.exe experience)
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        setupIcon: './assets/app_icon.ico',
      },
    },
    // Standalone Zip files for all platforms (portable, no installation needed)
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32', 'linux'],
    },
    // Linux AppImage format
    new MakerAppImage({}),
    // Linux Debian package
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: { 
          icon: './assets/app_icon.png',
        },
      },
    },
    // Linux RPM package
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: { 
          icon: './assets/app_icon.png',
        },
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html: './src/index.html',
              js: './src/renderer.js',
              name: 'main_window',
              preload: {
                js: './src/preload.js',
              },
            },
          ],
        },
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'Mico27',
          name: 'gbs-PluginPatchBuilder',
        },
        prerelease: false,
        generateReleaseNotes: true,

      },
    },
  ],
};
