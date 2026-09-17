const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8096);

    // 1. Main Window
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    win.webContents.on('console-message', (e, level, msg, line, src) => {
        if (level >= 2) console.log('[MAIN CONSOLE ERROR]', msg);
    });

    await win.loadURL('http://localhost:' + port);
    console.log('Main window loaded, waiting 4s...');
    await new Promise(r => setTimeout(r, 4000));

    const mainImg = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-main.png'), mainImg.toPNG());
    console.log('Saved screenshot-main.png');

    // Click Create button to capture menu
    await win.webContents.executeJavaScript(`
        (() => {
            const btn = document.querySelector('.c-create-button, [title*="Create"], button.c-button--major');
            if (btn) btn.click();
        })()
    `);
    await new Promise(r => setTimeout(r, 800));
    const createImg = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-create-menu.png'), createImg.toPNG());
    console.log('Saved screenshot-create-menu.png');
    win.close();

    // 2. Battery Details Window
    const winBatt = new BrowserWindow({
        width: 960,
        height: 680,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    await winBatt.loadURL('http://localhost:' + port + '/battery-details.html');
    await new Promise(r => setTimeout(r, 2000));
    const battImg = await winBatt.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-battery.png'), battImg.toPNG());
    console.log('Saved screenshot-battery.png');
    winBatt.close();

    // 3. Antenna Details Window
    const winAnt = new BrowserWindow({
        width: 960,
        height: 680,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    await winAnt.loadURL('http://localhost:' + port + '/antenna-details.html');
    await new Promise(r => setTimeout(r, 2000));
    const antImg = await winAnt.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-antenna.png'), antImg.toPNG());
    console.log('Saved screenshot-antenna.png');
    winAnt.close();

    server.close();
    app.quit();
}

app.whenReady().then(run);

