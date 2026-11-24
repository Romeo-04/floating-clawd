// Launch Electron with ELECTRON_RUN_AS_NODE cleared (some editor terminals set it, which
// makes Electron behave like plain Node and breaks `import { app } from 'electron'`).
const { spawn } = require('node:child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env })
  .on('exit', code => process.exit(code ?? 0));
