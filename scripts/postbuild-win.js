const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');

const outputDir = path.resolve(__dirname, '..', pkg.build?.directories?.output || 'dist');
const buildVersion = pkg.build?.buildVersion || pkg.version;
const appName = pkg.name;
const safeSuffix = appName.toLowerCase() === appName ? 'setup-' : 'Setup-';
const safeInstallerName = `${appName}-${safeSuffix}${pkg.version}.exe`;
const installerName = `${pkg.build?.productName || pkg.productName || pkg.name} Setup ${buildVersion}.exe`;

const installerPath = path.join(outputDir, installerName);
const safeInstallerPath = path.join(outputDir, safeInstallerName);
const blockmapPath = `${installerPath}.blockmap`;
const safeBlockmapPath = `${safeInstallerPath}.blockmap`;

if (!fs.existsSync(installerPath)) {
  process.exit(0);
}

fs.copyFileSync(installerPath, safeInstallerPath);

if (fs.existsSync(blockmapPath)) {
  fs.copyFileSync(blockmapPath, safeBlockmapPath);
}
