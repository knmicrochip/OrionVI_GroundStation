const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8084);
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: true, // visible window
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
            .c-overlay, .c-modal, .c-dialog {
                z-index: 10001 !important;
            }
        \`;
        document.head.appendChild(s);
    `);

    // Focus window
    win.focus();

    // Click create button
    await win.webContents.executeJavaScript(`
        const btn = document.querySelector('button.c-create-button');
        btn.click();
    `);

    await new Promise(r => setTimeout(r, 500));

    const check = await win.webContents.executeJavaScript(`
        (() => {
            const menu = document.querySelector('.c-create-menu, .c-super-menu');
            return {
                menuInDOM: Boolean(menu),
                menuDisplay: menu ? window.getComputedStyle(menu).display : null,
                menuZIndex: menu ? window.getComputedStyle(menu).zIndex : null
            };
        })()
    `);
    console.log('CHECK IMMEDIATELY AFTER CLICK:', check);

    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-visible-menu.png'), img.toPNG());

    win.close(); server.close(); app.quit();
}
app.whenReady().then(run);

