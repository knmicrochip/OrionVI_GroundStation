const { app, BrowserWindow } = require('electron');
const { startServer } = require('../example-server/server');

async function test() {
    await app.whenReady();
    const { server, port } = await startServer(0);
    const win = new BrowserWindow({ width: 1280, height: 800, show: false });
    
    win.webContents.on('console-message', (e, level, msg, line, src) => {
        console.log('[Console]', msg);
    });

    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 3500));

    const info = await win.webContents.executeJavaScript(`
        (() => {
            const createBtn = document.querySelector('.c-create-button, .c-button--major, [title*="Create"], button.c-button--major, .c-create-btn');
            const allButtons = Array.from(document.querySelectorAll('button, a, div[role="button"]')).map(b => ({
                tag: b.tagName,
                text: (b.textContent || '').trim().substring(0, 30),
                className: b.className,
                title: b.title || '',
                id: b.id || '',
                rect: b.getBoundingClientRect()
            }));

            let clickResult = null;
            if (createBtn) {
                const initialMenus = Array.from(document.querySelectorAll('.c-menu, .c-overlay, [class*="menu"], [class*="popup"], [class*="dropdown"]')).map(m => m.className);
                createBtn.click();
                const afterMenus = Array.from(document.querySelectorAll('.c-menu, .c-overlay, [class*="menu"], [class*="popup"], [class*="dropdown"]')).map(m => ({
                    className: m.className,
                    innerHTML: m.innerHTML.substring(0, 100),
                    rect: m.getBoundingClientRect(),
                    display: window.getComputedStyle(m).display,
                    visibility: window.getComputedStyle(m).visibility,
                    zIndex: window.getComputedStyle(m).zIndex
                }));
                clickResult = {
                    found: true,
                    btn: {
                        text: createBtn.textContent.trim(),
                        className: createBtn.className,
                        rect: createBtn.getBoundingClientRect(),
                        disabled: createBtn.disabled,
                        pointerEvents: window.getComputedStyle(createBtn).pointerEvents,
                        display: window.getComputedStyle(createBtn).display
                    },
                    initialMenus,
                    afterMenus
                };
            } else {
                clickResult = { found: false };
            }
            return {
                createBtnFound: Boolean(createBtn),
                clickResult,
                createMatches: allButtons.filter(b => b.text.toLowerCase().includes('create') || b.className.includes('create') || b.title.toLowerCase().includes('create'))
            };
        })()
    `);
    console.log('Test Info:\n', JSON.stringify(info, null, 2));

    await new Promise(r => setTimeout(r, 1000));
    win.close();
    server.close();
    app.quit();
}
test().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});

