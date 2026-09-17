const { app, BrowserWindow } = require('electron');
const path = require('path');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8095);
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    win.webContents.on('console-message', (e, level, msg, line, src) => {
        if (level >= 2) console.log('[CONSOLE ERROR]', msg);
    });

    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 3000));

    // Test creating an Overlay Plot via Open MCT UI
    const result = await win.webContents.executeJavaScript(`
        (async () => {
            const out = {};
            const createBtn = document.querySelector('.c-create-button, [title*="Create"], button.c-button--major');
            if (!createBtn) return { error: 'No create button' };

            createBtn.click();
            await new Promise(r => setTimeout(r, 600));

            const menu = document.querySelector('.c-create-menu, .c-super-menu');
            if (!menu) return { error: 'No menu after click' };

            const plotOption = Array.from(menu.querySelectorAll('li, .c-menu__item, [class*="item"]'))
                .find(el => el.innerText.includes('Overlay Plot'));
            out.plotOptionFound = Boolean(plotOption);
            if (!plotOption) return out;

            plotOption.click();
            await new Promise(r => setTimeout(r, 1000));

            const overlay = document.querySelector('.c-overlay, .c-modal, .c-dialog, .c-form');
            out.dialogFound = Boolean(overlay);
            if (!overlay) return out;

            // Type a custom name
            const nameInput = overlay.querySelector('input[type="text"]');
            if (nameInput) {
                nameInput.value = 'Custom Telemetry Trend Test';
                nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                nameInput.dispatchEvent(new Event('change', { bubbles: true }));
            }

            const okBtn = Array.from(overlay.querySelectorAll('button'))
                .find(b => b.textContent.trim().toLowerCase() === 'ok');
            out.okBtnFound = Boolean(okBtn);
            if (okBtn) {
                okBtn.click();
                await new Promise(r => setTimeout(r, 2000));
                out.navigatedHash = window.location.hash;
            }

            // Check if object exists in Open MCT
            const objIdStr = out.navigatedHash ? out.navigatedHash.split('?')[0].split('/').pop() : null;
            if (objIdStr) {
                try {
                    const [ns, key] = objIdStr.includes(':') ? objIdStr.split(':') : ['', objIdStr];
                    const retrieved = await window.openmct.objects.get({ namespace: ns, key: key });
                    out.retrieved = {
                        name: retrieved.name,
                        type: retrieved.type,
                        identifier: retrieved.identifier
                    };
                } catch (e) {
                    out.retrievalError = e.message;
                }
            }

            return out;
        })()
    `);

    console.log('CREATE OVERLAY PLOT TEST RESULT:', JSON.stringify(result, null, 2));

    win.close();
    server.close();
    app.quit();
}

app.whenReady().then(run);

