const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8090);
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 3000));

    // Apply CSS fix dynamically first to test
    await win.webContents.executeJavaScript(`
        const style = document.createElement('style');
        style.id = 'menu-zindex-fix';
        style.textContent = \`
            .c-menu, .c-super-menu, .c-create-menu, [class*="c-menu"] {
                z-index: 10000 !important;
            }
            .c-overlay, .c-modal, .c-dialog, [class*="overlay"], [class*="modal"] {
                z-index: 10001 !important;
            }
        \`;
        document.head.appendChild(style);
    `);

    // Click create button
    const res = await win.webContents.executeJavaScript(`
        (async () => {
            const btn = document.querySelector('.c-create-button, [title*="Create"], button.c-button--major');
            if (!btn) return { error: 'No button' };
            btn.click();
            await new Promise(r => setTimeout(r, 500));

            const menu = document.querySelector('.c-create-menu, .c-super-menu');
            if (!menu) return { error: 'No menu' };

            const rect = menu.getBoundingClientRect();
            const topEl = document.elementFromPoint(rect.left + 50, rect.top + 50);

            return {
                menuRect: rect,
                topEl: topEl ? { tag: topEl.tagName, cls: topEl.className, text: topEl.innerText } : null,
                isMenuTop: menu.contains(topEl)
            };
        })()
    `);

    console.log('WITH Z-INDEX FIX RESULT:', JSON.stringify(res, null, 2));

    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-menu-fixed.png'), img.toPNG());

    win.close();
    server.close();
    app.quit();
}

app.whenReady().then(run);

