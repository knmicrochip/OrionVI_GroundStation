const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8083);
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: true,
        webPreferences: { contextIsolation: true }
    });

    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 3000));

    // Add z-index fix
    await win.webContents.executeJavaScript(`
        const s = document.createElement('style');
        s.textContent = \`
            .c-menu, .c-super-menu, .c-create-menu, .c-menu--pointer {
                z-index: 10000 !important;
            }
            .c-overlay, .c-modal, .c-dialog, .c-form {
                z-index: 10001 !important;
            }
        \`;
        document.head.appendChild(s);
    `);

    win.focus();

    // Click create button
    await win.webContents.executeJavaScript(`
        const btn = document.querySelector('button.c-create-button');
        btn.click();
    `);
    await new Promise(r => setTimeout(r, 400));

    // Click 'Display Layout'
    await win.webContents.executeJavaScript(`
        const item = Array.from(document.querySelectorAll('.c-create-menu li'))
            .find(el => el.textContent.includes('Display Layout'));
        if (item) item.click();
    `);
    await new Promise(r => setTimeout(r, 600));

    const check = await win.webContents.executeJavaScript(`
        (() => {
            const overlay = document.querySelector('.c-overlay, .c-modal, .c-dialog');
            return {
                overlayFound: Boolean(overlay),
                overlayDisplay: overlay ? window.getComputedStyle(overlay).display : null,
                overlayZIndex: overlay ? window.getComputedStyle(overlay).zIndex : null
            };
        })()
    `);
    console.log('DIALOG CHECK:', check);

    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-create-dialog.png'), img.toPNG());

    win.close(); server.close(); app.quit();
}
app.whenReady().then(run);

