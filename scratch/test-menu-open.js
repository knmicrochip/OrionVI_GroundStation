const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8099);
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 3000));

    // Open create menu
    const state = await win.webContents.executeJavaScript(`
        (async () => {
            const btn = document.querySelector('.c-create-button, [title*="Create"], button.c-button--major');
            btn.click();
            await new Promise(r => setTimeout(r, 300));
            const menu = document.querySelector('.c-create-menu, .c-super-menu');
            if (!menu) return { error: 'No menu' };

            const rect = menu.getBoundingClientRect();
            const topEl = document.elementFromPoint(rect.left + 50, rect.top + 50);

            return {
                menuRect: rect,
                topElement: topEl ? {
                    tag: topEl.tagName,
                    cls: topEl.className,
                    id: topEl.id,
                    isMenuOrDescendant: menu.contains(topEl)
                } : null,
                menuChildrenCount: menu.children.length,
                menuInnerHTML: menu.innerHTML.substring(0, 300)
            };
        })()
    `);

    console.log('MENU CHECK STATE:', JSON.stringify(state, null, 2));

    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-menu-open.png'), img.toPNG());

    win.close();
    server.close();
    app.quit();
}

app.whenReady().then(run);

