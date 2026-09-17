const { app, BrowserWindow } = require('electron');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8089);
    const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: true } });
    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 3000));

    const html = await win.webContents.executeJavaScript(`
        (() => {
            const btn = document.querySelector('[title*="Create"], button.c-button--major, .c-button--major, [class*="create"]');
            return {
                outerHTML: btn ? btn.outerHTML : 'NOT FOUND',
                tagName: btn ? btn.tagName : null,
                classes: btn ? btn.className : null,
                innerHTML: btn ? btn.innerHTML : null
            };
        })()
    `);
    console.log('BUTTON HTML:', JSON.stringify(html, null, 2));

    win.close(); server.close(); app.quit();
}
app.whenReady().then(run);

