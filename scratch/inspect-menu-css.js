const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8086);
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        webPreferences: { contextIsolation: true }
    });

    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 3000));

    // Inspect menu before and after z-index fix
    const details = await win.webContents.executeJavaScript(`
        (async () => {
            const btn = document.querySelector('button.c-create-button');
            btn.click();
            await new Promise(r => setTimeout(r, 300));
            
            const menu = document.querySelector('.c-create-menu, .c-super-menu');
            if (!menu) return { error: 'No menu' };

            const r = menu.getBoundingClientRect();
            const cs = window.getComputedStyle(menu);

            return {
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                display: cs.display,
                visibility: cs.visibility,
                opacity: cs.opacity,
                zIndex: cs.zIndex,
                bg: cs.backgroundColor,
                color: cs.color,
                html: menu.outerHTML.substring(0, 500)
            };
        })()
    `);

    console.log('MENU DETAILS:', JSON.stringify(details, null, 2));

    win.close(); server.close(); app.quit();
}
app.whenReady().then(run);

