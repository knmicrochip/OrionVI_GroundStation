const { app, BrowserWindow } = require('electron');
const path = require('path');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8098);
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 3000));

    const menuDetails = await win.webContents.executeJavaScript(`
        (async () => {
            const btn = document.querySelector('.c-create-button, [title*="Create"], button.c-button--major');
            if (!btn) return { error: 'No button' };

            btn.click();
            await new Promise(r => setTimeout(r, 300));

            const menu = document.querySelector('.c-create-menu, .c-super-menu');
            if (!menu) return { error: 'No menu element in DOM' };

            const rect = menu.getBoundingClientRect();
            const cs = window.getComputedStyle(menu);
            
            // Check offsetParent and parent hierarchy
            const parents = [];
            let curr = menu;
            while (curr) {
                const s = window.getComputedStyle(curr);
                parents.push({
                    tag: curr.tagName,
                    cls: curr.className,
                    id: curr.id,
                    pos: s.position,
                    top: s.top,
                    left: s.left,
                    overflow: s.overflow,
                    zIndex: s.zIndex,
                    opacity: s.opacity,
                    transform: s.transform,
                    display: s.display,
                    visibility: s.visibility,
                    clip: s.clip,
                    clipPath: s.clipPath
                });
                curr = curr.parentElement;
            }

            return {
                menuTag: menu.tagName,
                menuClasses: menu.className,
                rect: {
                    x: rect.x,
                    y: rect.y,
                    top: rect.top,
                    bottom: rect.bottom,
                    left: rect.left,
                    right: rect.right,
                    width: rect.width,
                    height: rect.height
                },
                computed: {
                    position: cs.position,
                    top: cs.top,
                    left: cs.left,
                    right: cs.right,
                    bottom: cs.bottom,
                    zIndex: cs.zIndex,
                    display: cs.display,
                    visibility: cs.visibility,
                    opacity: cs.opacity,
                    transform: cs.transform,
                    pointerEvents: cs.pointerEvents
                },
                parents
            };
        })()
    `);

    console.log('MENU POSITION & VISIBILITY DETAILS:\n', JSON.stringify(menuDetails, null, 2));

    win.close();
    server.close();
    app.quit();
}

app.whenReady().then(run);

