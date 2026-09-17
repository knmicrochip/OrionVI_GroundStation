const { app, BrowserWindow } = require('electron');
const path = require('path');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8094);
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    await win.loadURL('http://localhost:' + port);
    await new Promise(r => setTimeout(r, 3000));

    const headInfo = await win.webContents.executeJavaScript(`
        (() => {
            const head = document.querySelector('.l-shell__head');
            if (!head) return { error: 'No head found' };

            const children = Array.from(head.children).map(c => ({
                tag: c.tagName,
                cls: c.className,
                html: c.outerHTML.substring(0, 300)
            }));

            // Search for indicator elements anywhere in document
            const indicatorsInDoc = Array.from(document.querySelectorAll('.orion-battery-indicator, .orion-antenna-indicator, #ind-batt-led, #ind-ant-led'))
                .map(el => ({
                    id: el.id,
                    cls: el.className,
                    parentCls: el.parentElement ? el.parentElement.className : 'null',
                    display: window.getComputedStyle(el).display,
                    visibility: window.getComputedStyle(el).visibility,
                    rect: el.getBoundingClientRect()
                }));

            // Check what openmct.indicators contains
            const indicatorsAPI = Object.keys(window.openmct.indicators || {});

            return {
                headClasses: head.className,
                headChildren: children,
                indicatorsInDoc,
                indicatorsAPI
            };
        })()
    `);

    console.log('HEAD INFO:', JSON.stringify(headInfo, null, 2));

    win.close();
    server.close();
    app.quit();
}

app.whenReady().then(run);

