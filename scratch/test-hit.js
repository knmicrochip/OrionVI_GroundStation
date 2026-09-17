const { app, BrowserWindow } = require('electron');
const { startServer } = require('../example-server/server');

async function test() {
    const { server, port } = await startServer(8092);
    const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: true } });
    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 2500));
    
    const info = await win.webContents.executeJavaScript(`
        (() => {
            const btn = document.querySelector('.c-create-button, [title*="Create"], button.c-button--major');
            btn.click();
            const menu = document.querySelector('.c-create-menu, .c-super-menu');
            
            // Walk from the element at (50, 50) up to body
            const hitEl = document.elementFromPoint(50, 50);
            const chain = [];
            let el = hitEl;
            while (el) {
                const s = window.getComputedStyle(el);
                chain.push({
                    tag: el.tagName,
                    cls: el.className,
                    id: el.id,
                    pos: s.position,
                    zIndex: s.zIndex
                });
                el = el.parentElement;
            }
            return { hitEl: hitEl ? hitEl.outerHTML : null, chain };
        })()
    `);
    console.log('HIT ELEMENT AND PARENTS CHAIN:', JSON.stringify(info, null, 2));
    win.close(); server.close(); app.quit();
}
app.whenReady().then(test);

