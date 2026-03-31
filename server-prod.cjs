// CommonJS wrapper to start the ESM server
// This is needed because Electron uses CJS
const { execSync, spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
const node = process.execPath;

// Run the ESM server using the same Node.js binary
const child = spawn(node, [serverPath], {
  env: { ...process.env, PORT: process.env.PORT || '3847' },
  cwd: __dirname,
  stdio: 'inherit'
});

child.on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', () => child.kill());
process.on('SIGINT', () => child.kill());
process.on('exit', () => child.kill());
