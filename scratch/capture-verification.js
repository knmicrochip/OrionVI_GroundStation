const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8081);

    // 1. Main Window: Open create menu and take screenshot
    const winMain = new BrowserWindow({
        width: 1440,
        height: 900,
        show: true,
        webPreferences: { contextIsolation: true }
    });
    await winMain.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 3000));
    winMain.focus();

    // Click create button to verify menu floats on top
    await winMain.webContents.executeJavaScript(`
        const btn = document.querySelector('button.c-create-button');
        if (btn) btn.click();
    `);
    await new Promise(r => setTimeout(r, 600));

    const mainImg = await winMain.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-main-menu-open.png'), mainImg.toPNG());
    console.log('Saved screenshot-main-menu-open.png');
    winMain.close();

    // 2. Battery Details Window: Check unlinked status
    const winBatt = new BrowserWindow({
        width: 960,
        height: 680,
        show: false,
        webPreferences: { contextIsolation: true }
    });
    await winBatt.loadURL('http://localhost:' + port + '/battery-details.html');
    await new Promise(r => setTimeout(r, 2000));
    const battImg = await winBatt.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-battery-no-ok.png'), battImg.toPNG());
    console.log('Saved screenshot-battery-no-ok.png');
    winBatt.close();

    // 3. Antenna Details Window: Check unlinked status
    const winAnt = new BrowserWindow({
        width: 960,
        height: 680,
        show: false,
        webPreferences: { contextIsolation: true }
    });
    await winAnt.loadURL('http://localhost:' + port + '/antenna-details.html');
    await new Promise(r => setTimeout(r, 2000));
    const antImg = await winAnt.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-antenna-no-ok.png'), antImg.toPNG());
    console.log('Saved screenshot-antenna-no-ok.png');
    winAnt.close();

    server.close();
    app.quit();
}

app.whenReady().then(run);

