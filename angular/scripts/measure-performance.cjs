const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const browser = path.join(root, 'dist', 'workspace', 'app', 'browser');
const indexPath = path.join(browser, 'index.html');
const maximumInitialBytes = 550 * 1024;

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

if (!fs.existsSync(indexPath)) throw new Error(`Missing production artifact: ${indexPath}`);

const index = fs.readFileSync(indexPath, 'utf8');
const assets = [...index.matchAll(/["']([^"']+\.(?:js|css))["']/g)]
  .map((match) => match[1])
  .filter((asset) => /\.(?:js|css)$/.test(asset))
  .map((asset) => path.join(browser, asset.replace(/^\.\//, '').replace(/^\//, '')))
  .filter((file, index, files) => fs.existsSync(file) && files.indexOf(file) === index);
const total = assets.reduce((sum, file) => sum + fs.statSync(file).size, 0);

console.log(`Initial assets: ${formatBytes(total)}`);
for (const file of assets) console.log(`  ${path.relative(browser, file)}: ${formatBytes(fs.statSync(file).size)}`);
console.log(`Initial budget: ${formatBytes(maximumInitialBytes)}`);

if (total > maximumInitialBytes) {
  throw new Error(`Initial assets exceed the performance budget by ${formatBytes(total - maximumInitialBytes)}`);
}
