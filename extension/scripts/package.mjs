// Zip the shippable extension files into dist/klierly-extension.zip (uses the system `zip`).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist'), { recursive: true });
const target = join(root, 'dist', 'klierly-extension.zip');
rmSync(target, { force: true });
execFileSync('zip', ['-r', '-X', target, 'manifest.json', 'popup.html', 'popup.js', 'options.html', 'options.js', 'discover.html', 'discover.js', 'captions.html', 'captions.js', 'ui.css', 'icons', 'src'], { cwd: root, stdio: 'inherit' });
console.log(`written ${target}`);
