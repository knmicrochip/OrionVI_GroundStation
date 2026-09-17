const { app, BrowserWindow } = require('electron');
const { startServer } = require('../example-server/server');

async function test() {
    const { server, port } = await startServer(8091);
    const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: true } });
    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 2500));
    
    const info = await win.webContents.executeJavaScript(`
        (() => {
            const btn = document.querySelector('.c-create-button, [title*="Create"], button.c-button--major');
            btn.click();
            const menu = document.querySelector('.c-create-menu, .c-super-menu');
            const tree = document.querySelector('.l-shell__pane-tree');
            const main = document.querySelector('.l-shell__main-container');
            const head = document.querySelector('.l-shell__head');
            const shell = document.querySelector('.l-shell');
            const app = document.querySelector('#app');
            
            function getInfo(el, name) {
                if (!el) return { name, exists: false };
                const s = window.getComputedStyle(el);
                return {
                    name,
                    tag: el.tagName,
                    pos: s.position,
                    zIndex: s.zIndex,
                    overflow: s.overflow,
                    opacity: s.opacity,
                    transform: s.transform
                };
            }
            
            return [
                getInfo(menu, 'c-create-menu'),
                getInfo(tree, 'l-shell__pane-tree'),
                getInfo(main, 'l-shell__main-container'),
                getInfo(head, 'l-shell__head'),
                getInfo(shell, 'l-shell'),
                getInfo(app, '#app')
            ];
        })()
    `);
    console.log('STACKING CONTEXT INFO:', JSON.stringify(info, null, 2));
    win.close(); server.close(); app.quit();
}
app.whenReady().then(test);

