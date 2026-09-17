const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8097);
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    win.webContents.on('console-message', (e, level, msg, line, src) => {
        console.log('[BROWSER]', msg);
    });

    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 3000));

    const info = await win.webContents.executeJavaScript(`
        (() => {
            const btn = document.querySelector('.c-create-button, [title*="Create"], button.c-button--major, .c-button--major');
            if (!btn) return { error: 'Button not found' };

            const rect = btn.getBoundingClientRect();
            const cs = window.getComputedStyle(btn);
            
            // Check elementFromPoint
            const elAtPoint = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);

            // Check parent tree
            const parents = [];
            let curr = btn;
            while (curr) {
                parents.push({
                    tag: curr.tagName,
                    cls: curr.className,
                    id: curr.id,
                    pointerEvents: window.getComputedStyle(curr).pointerEvents,
                    zIndex: window.getComputedStyle(curr).zIndex,
                    overflow: window.getComputedStyle(curr).overflow,
                    position: window.getComputedStyle(curr).position
                });
                curr = curr.parentElement;
            }

            // Inspect Vue component if available
            const vueInstance = btn.__vue__ || (btn.parentElement && btn.parentElement.__vue__);

            return {
                btnOuter: btn.outerHTML,
                rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                computed: {
                    display: cs.display,
                    visibility: cs.visibility,
                    pointerEvents: cs.pointerEvents,
                    cursor: cs.cursor,
                    opacity: cs.opacity
                },
                elAtCenter: elAtPoint ? {
                    tag: elAtPoint.tagName,
                    cls: elAtPoint.className,
                    id: elAtPoint.id,
                    isBtnOrChild: btn.contains(elAtPoint)
                } : null,
                parents,
                hasVue: Boolean(vueInstance)
            };
        })()
    `);

    console.log('CREATE BUTTON DEBUG INFO:', JSON.stringify(info, null, 2));

    // Try real synthetic mouse click using sendInputEvent
    const btnRect = info.rect;
    if (btnRect) {
        const x = Math.round(btnRect.left + btnRect.width / 2);
        const y = Math.round(btnRect.top + btnRect.height / 2);
        console.log('Sending mouse click to:', x, y);
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        await new Promise(r => setTimeout(r, 100));
        win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await new Promise(r => setTimeout(r, 100));
        win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        await new Promise(r => setTimeout(r, 800));

        const afterClick = await win.webContents.executeJavaScript(`
            (() => {
                const menus = Array.from(document.querySelectorAll('.c-create-menu, .c-super-menu, .c-menu, [class*="menu"]')).map(m => ({
                    tag: m.tagName,
                    cls: m.className,
                    display: window.getComputedStyle(m).display,
                    visibility: window.getComputedStyle(m).visibility,
                    rect: m.getBoundingClientRect(),
                    text: m.innerText.substring(0, 100)
                }));
                const overlays = Array.from(document.querySelectorAll('.c-overlay, .c-modal, .c-dialog, [class*="overlay"], [class*="modal"]')).map(m => ({
                    tag: m.tagName,
                    cls: m.className,
                    display: window.getComputedStyle(m).display
                }));
                return { menus, overlays };
            })()
        `);
        console.log('AFTER MOUSE CLICK:', JSON.stringify(afterClick, null, 2));

        const afterImg = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'screenshot-after-real-click.png'), afterImg.toPNG());
    }

    win.close();
    server.close();
    app.quit();
}

app.whenReady().then(run);

