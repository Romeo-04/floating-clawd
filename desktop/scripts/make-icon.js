// Renders Clawd into assets/icon.ico (and a 256px PNG for the README / installer).
// Run: node scripts/make-icon.js
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clawdIconPNG, encodeICO } from '../src/core/png.js';

const out = name => fileURLToPath(new URL(`../assets/${name}`, import.meta.url));
const sizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync(out('icon.ico'), encodeICO(sizes.map(size => ({ size, png: clawdIconPNG(size) }))));
writeFileSync(out('icon.png'), clawdIconPNG(256));
console.log(`wrote assets/icon.ico (${sizes.join(', ')}) and assets/icon.png`);
