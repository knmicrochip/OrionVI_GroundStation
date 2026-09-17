const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8093);

    // Battery details window
    const winBatt = new BrowserWindow({
        width: 1024,
        height: 700,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    await winBatt.loadURL('http://localhost:' + port + '/battery-details.html');
    await new Promise(r => setTimeout(r, 2000));
    const battImg = await winBatt.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-battery-details.png'), battImg.toPNG());
    winBatt.close();

    // Antenna details window
    const winAnt = new BrowserWindow({
        width: 1024,
        height: 700,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    await winAnt.loadURL('http://localhost:' + port + '/antenna-details.html');
    await new Promise(r => setTimeout(r, 2000));
    const antImg = await winAnt.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-antenna-details.png'), antImg.toPNG());
    winAnt.close();

    server.close();
    app.quit();
}

app.whenReady().then(run);

