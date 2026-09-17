const { app, BrowserWindow } = require('electron');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8087);
    const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: true } });
    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 3000));

    const vueInfo = await win.webContents.executeJavaScript(`
        (() => {
            const btn = document.querySelector('button.c-create-button');
            if (!btn) return { error: 'No button' };
            
            // Look for Vue instance
            let v = btn.__vue__ || (btn.parentElement && btn.parentElement.__vue__);
            if (!v) {
                // Check all elements in header
                let el = btn;
                while (el && !v) {
                    v = el.__vue__;
                    el = el.parentElement;
                }
            }

            let compData = null;
            if (v) {
                compData = {
                    name: v.$options ? v.$options.name : null,
                    data: v.$data,
                    methods: v.$options && v.$options.methods ? Object.keys(v.$options.methods) : []
                };
            }

            return {
                hasVue: Boolean(v),
                compData
            };
        })()
    `);
    console.log('VUE INFO:', JSON.stringify(vueInfo, null, 2));

    win.close(); server.close(); app.quit();
}
app.whenReady().then(run);

