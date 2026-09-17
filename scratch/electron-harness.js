
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../example-server/server');

async function run() {
    const { server, port } = await startServer(8089);
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    const consoleLogs = [];
    win.webContents.on('console-message', (e, level, msg, line, src) => {
        consoleLogs.push({ level, msg, line, src: path.basename(src || '') });
        console.log('[BROWSER CONSOLE]', msg);
    });

    await win.loadURL('http://localhost:' + port);
    console.log('Page loaded, waiting 3s for Open MCT to initialize...');
    await new Promise(r => setTimeout(r, 3000));

    // Capture initial screenshot
    const image1 = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-initial.png'), image1.toPNG());
    console.log('Saved screenshot-initial.png');

    // Inspect DOM & test Create button
    const testResult = await win.webContents.executeJavaScript(`
        (async () => {
            const results = {};
            results.currentHash = window.location.hash;
            results.title = document.title;
            
            // Check top indicators
            const indicators = Array.from(document.querySelectorAll('.c-indicator, [class*="indicator"]'))
                .map(el => ({ text: el.innerText.trim(), html: el.outerHTML.substring(0, 150) }));
            results.indicators = indicators;

            // Check Create Button
            const createBtn = document.querySelector('.c-create-button, [title*="Create"], button.c-button--major');
            results.createButtonFound = Boolean(createBtn);
            if (createBtn) {
                createBtn.click();
                await new Promise(r => setTimeout(r, 600));

                const menu = document.querySelector('.c-create-menu');
                const menuItems = menu ? Array.from(menu.querySelectorAll('li, .c-menu__item, [class*="item"]')).map(el => ({ text: el.innerText.trim(), tag: el.tagName })) : [];
                results.menuItems = menuItems;

                const layoutOption = menu ? Array.from(menu.querySelectorAll('li')).find(el => el.innerText.includes('Display Layout')) : null;
                results.layoutOptionFound = Boolean(layoutOption);
                if (layoutOption) {
                    layoutOption.click();
                    await new Promise(r => setTimeout(r, 1000));

                    // Check if dialog / form appeared
                    const overlay = document.querySelector('.c-overlay, .c-modal, .c-dialog, .c-form');
                    results.overlayFound = Boolean(overlay);
                    if (overlay) {
                        results.overlayHTML = overlay.outerHTML.substring(0, 400);
                        
                        const okBtn = Array.from(overlay.querySelectorAll('button, input[type="submit"]'))
                            .find(b => b.textContent.trim().toLowerCase().includes('ok') || b.textContent.trim().toLowerCase().includes('save') || (b.value && b.value.toLowerCase().includes('ok')));
                        results.okBtnFound = Boolean(okBtn);
                        if (okBtn) {
                            okBtn.click();
                            await new Promise(r => setTimeout(r, 2000));
                            results.afterCreateHash = window.location.hash;
                        }
                    }
                }
            }

            // Check tabs & layout items
            results.tabs = Array.from(document.querySelectorAll('.c-tabs-view__tab, .c-tab')).map(el => el.textContent.trim());
            results.layoutFrames = document.querySelectorAll('.c-layout-frame, .c-layout__frame').length;
            results.tables = document.querySelectorAll('table, .c-table').length;
            results.plots = document.querySelectorAll('.gl-plot, .c-plot, canvas').length;

            return results;
        })()
    `);

    console.log('TEST RESULT:', JSON.stringify(testResult, null, 2));

    const image2 = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot-post-create.png'), image2.toPNG());
    console.log('Saved screenshot-post-create.png');

    win.close();
    server.close();
    app.quit();
}

app.whenReady().then(run);
