const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;
const SERVER_PORT = 3847;

function startServer() {
  // In packaged app, server.js is unpacked outside the ASAR archive
  const isPackaged = app.isPackaged;
  const appPath = isPackaged
    ? path.join(path.dirname(app.getPath('exe')), 'resources', 'app.asar.unpacked')
    : __dirname;
  const serverPath = path.join(appPath, 'server.js');
  const serverCwd = appPath;

  console.log('Packaged:', isPackaged);
  console.log('Server path:', serverPath);
  console.log('Server cwd:', serverCwd);

  // Run the server on Electron's OWN bundled Node, via ELECTRON_RUN_AS_NODE.
  // The app used to hunt for a system Node install and refuse to start without
  // one, which made it not really standalone — a machine without Node got an
  // error dialog instead of an app. Electron ships a Node runtime already.
  serverProcess = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(SERVER_PORT), ELECTRON_RUN_AS_NODE: '1' },
    cwd: serverCwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  serverProcess.stdout?.on('data', (d) => console.log('[server]', d.toString().trim()));
  serverProcess.stderr?.on('data', (d) => console.error('[server]', d.toString().trim()));

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err);
    const { dialog } = require('electron');
    dialog.showErrorBox('Server Error', 'Failed to start the LiveLyrics server.\n\n' + err.message);
  });

  serverProcess.on('exit', (code) => {
    console.log('Server exited with code:', code);
  });

  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 30; // 15 seconds max

    const check = () => {
      attempts++;
      if (attempts > maxAttempts) {
        reject(new Error('Server failed to start'));
        return;
      }

      const req = http.get(`http://localhost:${SERVER_PORT}/api/health`, (res) => {
        if (res.statusCode === 200) {
          console.log('Server ready!');
          resolve();
          return;
        }
        setTimeout(check, 500);
      });
      req.on('error', () => setTimeout(check, 500));
    };
    setTimeout(check, 1500);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'LiveLyrics',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    show: false
  });

  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
  } catch (e) {
    console.error('Startup failed:', e);
    const { dialog } = require('electron');
    dialog.showErrorBox('Startup Error', e.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
