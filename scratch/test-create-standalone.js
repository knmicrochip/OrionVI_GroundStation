const { app, BrowserWindow } = require('electron');
const path = require('path');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8091);
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.webContents.on('console-message', (e, level, msg, line, src) => {
        console.log('[RENDERER CONSOLE]', msg);
    });

    await win.loadURL('http://localhost:' + port);
    console.log('Loaded, waiting 4s...');
    await new Promise(r => setTimeout(r, 4000));

    const diag = await win.webContents.executeJavaScript(`
        (async () => {
            const out = {};
            out.openmctDefined = typeof window.openmct !== 'undefined';
            if (!out.openmctDefined) return out;

            // Check types registered
            out.types = window.openmct.types.listTypes().map(t => ({
                key: t.key,
                name: t.name,
                creatable: t.creatable
            }));

            // Check roots
            try {
                const rootObjects = await window.openmct.objects.getRoot();
                out.rootObjects = rootObjects;
            } catch (e) {
                out.rootError = e.message;
            }

            // Check Create button in DOM
            const createBtn = document.querySelector('.c-create-button, button.c-button--major, [title*="Create"]');
            out.createBtn = createBtn ? {
                text: createBtn.innerText,
                className: createBtn.className,
                disabled: createBtn.disabled
            } : null;

            if (createBtn) {
                createBtn.click();
                await new Promise(r => setTimeout(r, 500));
                const menu = document.querySelector('.c-menu, .c-super-menu, .c-create-menu');
                out.menuFound = Boolean(menu);
                if (menu) {
                    out.menuItems = Array.from(menu.querySelectorAll('li, .c-menu__item, .c-super-menu__item'))
                        .map(el => el.innerText.trim());
                }
            }

            return out;
        })()
    `);

    console.log('DIAGNOSTIC:', JSON.stringify(diag, null, 2));

    win.close();
    server.close();
    app.quit();
}

app.whenReady().then(run);

