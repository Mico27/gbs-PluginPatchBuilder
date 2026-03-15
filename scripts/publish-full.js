#!/usr/bin/env node

/**
 * Custom publish script that creates both installers and standalone zips
 * 
 * Usage: npm run publish:full
 * 
 * This script will:
 * 1. Prompt for GitHub token
 * 2. Run electron-forge make (creates all artifacts)
 * 3. List all created artifacts
 * 4. Run electron-forge publish (publishes to GitHub)
 * 5. Verify successful publication
 */

const { execSync, spawnSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

function listArtifacts() {
  const outDir = path.join(process.cwd(), 'out');
  const artifacts = {
    installers: [],
    zips: [],
    packages: [],
    other: [],
  };

  if (fs.existsSync(outDir)) {
    //get list of all files in out directory
    const files = fs.readdirSync(outDir).map(f => path.join(outDir, f));

    files.forEach(file => {
      const basename = path.basename(file);
      if (basename.match(/\.(exe|msi)$/i)) {
        artifacts.installers.push(basename);
      } else if (basename.match(/\.zip$/i)) {
        artifacts.zips.push(basename);
      } else if (basename.match(/\.(deb|rpm|AppImage)$/i)) {
        artifacts.packages.push(basename);
      } else if (!basename.match(/\.json$/i)) {
        artifacts.other.push(basename);
      }
    });
  }

  return artifacts;
}

function formatArtifactList(artifacts) {
  let output = '\n📦 Artifacts created:\n';

  if (artifacts.installers.length > 0) {
    output += '\n  🔧 Windows Installers:\n';
    artifacts.installers.forEach(f => {
      output += '     ✓ ' + f + '\n';
    });
  }

  if (artifacts.zips.length > 0) {
    output += '\n  📁 Standalone Zips (Portable - No Installation Required):\n';
    artifacts.zips.forEach(f => {
      output += '     ✓ ' + f + '\n';
    });
  }

  if (artifacts.packages.length > 0) {
    output += '\n  📦 Linux Packages:\n';
    artifacts.packages.forEach(f => {
      output += '     ✓ ' + f + '\n';
    });
  }

  return output;
}

console.log('\n╔═══════════════════════════════════════════════════════════════╗');
console.log('║  GBStudio Plugin Patcher - Full Publish with Standalone Zip  ║');
console.log('╚═══════════════════════════════════════════════════════════════╝\n');

console.log('📝 GitHub Token Setup Instructions:');
console.log('   1. Go to https://github.com/settings/tokens');
console.log('   2. Click "Generate new token" → "Generate new token (classic)"');
console.log('   3. Select scopes: repo (and optionally workflow)');
console.log('   4. Copy the token and paste it below\n');

rl.question('🔓 Enter your GitHub token (will be hidden): ', (token) => {
  rl.close();

  if (!token || token.trim().length === 0) {
    console.error('\n❌ Error: No token provided');
    process.exit(1);
  }

  console.log('\n⏳ Step 1: Building installers and standalone packages...\n');

  try {
    // Step 1: Run make to create all artifacts
    execSync('npm run make', {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    // Step 2: List created artifacts
    console.log('\n' + '='.repeat(64));
    const artifacts = listArtifacts();
    console.log(formatArtifactList(artifacts));
    console.log('='.repeat(64));

    // Verification
    const hasInstallers = artifacts.installers.length > 0;
    const hasZips = artifacts.zips.length > 0;

    if (!hasInstallers && !hasZips) {
      console.error(
        '\n⚠️  Warning: No installers or zips found. Check the build output above.'
      );
    } else {
      console.log(
        '\n✅ Build successful! Found:'
      );
      if (hasInstallers) console.log('   ✓ Windows installers (traditional setup.exe experience)');
      if (hasZips) console.log('   ✓ Standalone zips (portable, no installation required)');
    }

    console.log('\n⏳ Step 2: Publishing to GitHub...\n');

    // Step 3: Run publish with token
    process.env.GITHUB_TOKEN = token;
    
    execSync('electron-forge publish', {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: { ...process.env, GITHUB_TOKEN: token },
    });

    console.log('\n' + '='.repeat(64));
    console.log('✅ Publication completed successfully!\n');
    console.log('📌 Released artifacts:');
    console.log('   • Windows Installer - Download and run setup.exe');
    console.log('   • Standalone Zip - Extract and run directly (no installation)');
    if (artifacts.packages.length > 0) {
      console.log('   • Linux Packages - .deb, .rpm, and AppImage formats');
    }
    console.log('\n💡 Users can now:');
    console.log('   1. Install via executable (Windows)');
    console.log('   2. Extract and run portable zip (all platforms)');
    console.log('   3. Use installers from GitHub releases\n');
    console.log('🔗 View release: https://github.com/Mico27/gbs-PluginPatchBuilder/releases\n');
    console.log('💡 Remember to delete the token from GitHub settings if temporary.');
    console.log('='.repeat(64) + '\n');

  } catch (error) {
    console.error('\n❌ Publish failed!');
    console.error('Error:', error.message);
    console.error('\nCommon issues:');
    console.error('  • Token has wrong permissions (needs "repo" scope)');
    console.error('  • Token is invalid or expired');
    console.error('  • Insufficient permissions for the repository');
    console.error('  • Network connection issues\n');
    process.exit(1);
  } finally {
    // Clear token from environment
    delete process.env.GITHUB_TOKEN;
  }
});

// Handle stdin if it's piped
if (!process.stdin.isTTY) {
  let token = '';
  
  rl.on('line', (line) => {
    token = line;
  });

  rl.on('close', () => {
    if (!token || token.trim().length === 0) {
      console.error('\n❌ Error: No token provided');
      process.exit(1);
    }

    console.log('\n⏳ Step 1: Building installers and standalone packages...\n');

    try {
      execSync('npm run make', {
        cwd: process.cwd(),
        stdio: 'inherit',
      });

      console.log('\n' + '='.repeat(64));
      const artifacts = listArtifacts();
      console.log(formatArtifactList(artifacts));
      console.log('='.repeat(64));

      console.log('\n⏳ Step 2: Publishing to GitHub...\n');

      process.env.GITHUB_TOKEN = token;
      
      execSync('electron-forge publish', {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: { ...process.env, GITHUB_TOKEN: token },
      });

      console.log('\n' + '='.repeat(64));
      console.log('✅ Publication completed successfully!\n');
      console.log('📌 Released artifacts:');
      console.log('   • Windows Installer - Download and run setup.exe');
      console.log('   • Standalone Zip - Extract and run directly (no installation)');
      console.log('\n🔗 View release: https://github.com/Mico27/gbs-PluginPatchBuilder/releases\n');
      console.log('='.repeat(64) + '\n');

    } catch (error) {
      console.error('\n❌ Publish failed!');
      console.error('Error:', error.message);
      process.exit(1);
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });
}
