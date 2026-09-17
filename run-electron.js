const { spawn } = require('child_process');
const electron = require('electron');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const appPath = path.resolve(__dirname);
const args = [appPath, ...process.argv.slice(2)];

const child = spawn(electron, args, {
    stdio: 'inherit',
    env
});

child.on('close', (code) => {
    process.exit(code ?? 0);
});

child.on('error', (err) => {
    console.error('Failed to start Electron process:', err);
    process.exit(1);
});

