const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { startServer } = require('./example-server/server');

let mainWindow = null;
let serverInstance = null;

async function launchServer() {
    const preferredPorts = [8088, 8085, 0];
    for (const p of preferredPorts) {
        try {
            return await startServer(p);
        } catch (err) {
            console.warn(`Port ${p} unavailable, trying next...`);
        }
    }
    return await startServer(0);
}

async function createWindow() {
    const { server, port } = await launchServer();
    serverInstance = server;

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'Open MCT Desktop',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    const targetUrl = `http://localhost:${port}`;
    console.log(`Loading Open MCT in Electron window from: ${targetUrl}`);

    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        const file = sourceId ? path.basename(sourceId) : 'inline';
        console.log(`[Renderer] [${file}:${line}] ${message}`);
    });

    mainWindow.loadURL(targetUrl);

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        const isAntenna = url.includes('antenna-details.html');
        const isCamera = url.includes('camera-view.html') || url.includes('camera');
        let title = 'Orion Rover - Battery Telemetry & Diagnostics';
        if (isAntenna) title = 'Orion Rover - 5GHz RF Comms & Antenna Link';
        if (isCamera) title = 'Orion Rover - Camera Stream Feed';

        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                width: isCamera ? 840 : 960,
                height: isCamera ? 540 : 680,
                minWidth: isCamera ? 440 : 640,
                minHeight: isCamera ? 320 : 480,
                title: title,
                autoHideMenuBar: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true
                }
            }
        };
    });

    if (process.env.TEST_RUN) {
        const testMode = process.env.TEST_RUN.trim();
        mainWindow.webContents.on('did-finish-load', async () => {
            console.log('Page finished loading successfully.');
            if (testMode === 'e2e') {
                try {
                    await new Promise(r => setTimeout(r, 2000));
                    const fs = require('fs');
                    const http = require('http');
                    const mockPayloads = JSON.parse(fs.readFileSync(path.join(__dirname, 'example-server/mock-payloads.json'), 'utf8'));

                    // Inject mock payloads to verify real-time ingestion
                    await new Promise((resolve) => {
                        const postData = JSON.stringify(mockPayloads);
                        const req = http.request({
                            hostname: 'localhost',
                            port: port,
                            path: '/api/inject-telemetry',
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength(postData)
                            }
                        }, (res) => {
                            let data = '';
                            res.on('data', chunk => data += chunk);
                            res.on('end', () => {
                                console.log('[E2E Mock Ingest Response]', data);
                                resolve();
                            });
                        });
                        req.write(postData);
                        req.end();
                    });

                    await new Promise(r => setTimeout(r, 1500));

                    const result = await mainWindow.webContents.executeJavaScript(`
                        (async () => {
                            const hash = window.location.hash;
                            const tabs = Array.from(document.querySelectorAll('.c-tabs-view__tab, .c-tab, button.tab')).map(el => el.textContent.trim());
                            const frames = document.querySelectorAll('.c-layout-frame, .c-layout__frame, .c-layout, [class*="layout"], [class*="frame"]').length;
                            const tables = document.querySelectorAll('table, .c-table, [class*="table"]').length;
                            const openmctLoaded = Boolean(window.openmct);
                            const engineLoaded = Boolean(window.OrionExceptionEngine);
                            const engineSummary = engineLoaded ? window.OrionExceptionEngine.getSummary() : null;
                            const b3Res = await fetch('/history/rover.power.battery.3.v').then(r => r.json()).catch(() => []);
                            const busRes = await fetch('/history/rover.power.bus.voltage').then(r => r.json()).catch(() => []);
                            return {
                                hash,
                                tabs,
                                frames,
                                tables,
                                openmctLoaded,
                                engineLoaded,
                                masterStatus: engineSummary ? engineSummary.masterStatus : 'N/A',
                                activeAlerts: engineSummary ? engineSummary.activeAlertsCount : -1,
                                b3Telemetry: b3Res.slice(-1),
                                busTelemetry: busRes.slice(-1)
                            };
                        })()
                    `);
                    console.log('[E2E Verification Result]', JSON.stringify(result));
                } catch (e) {
                    console.error('[E2E Verification Error]', e.message);
                }
                setTimeout(() => {
                    console.log('Automated verification finished, closing window.');
                    mainWindow.close();
                }, 1000);
            } else if (testMode === 'test_create') {
                try {
                    await new Promise(r => setTimeout(r, 2000));
                    const diag = await mainWindow.webContents.executeJavaScript(`
                        (async () => {
                            const createBtn = document.querySelector('.c-create-button, [title*="Create"], button.c-button--major');
                            createBtn.click();
                            await new Promise(r => setTimeout(r, 600));

                            const layoutOption = Array.from(document.querySelectorAll('.c-create-menu li, .c-super-menu__menu li, .c-menu__item, [class*="menu-item"], .c-super-menu__item'))
                                .find(el => el.textContent.includes('Display Layout'));
                            if (layoutOption) {
                                layoutOption.click();
                                await new Promise(r => setTimeout(r, 800));
                                
                                const okBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toLowerCase() === 'ok');
                                if (okBtn) okBtn.click();
                                await new Promise(r => setTimeout(r, 1500));
                            }

                            const afterHash = window.location.hash;
                            const mainView = document.querySelector('.l-shell__main-view, .c-main-view');
                            const layoutEl = document.querySelector('.c-layout, .c-layout-view');
                            const editBtn = document.querySelector('button[title*="Edit"], .c-button--edit, .icon-pencil');
                            const errors = Array.from(document.querySelectorAll('.c-message, .c-banner--error, [class*="error"]')).map(e => e.textContent.trim());
                            
                            // Check if object exists in provider
                            const parsedId = afterHash.split('?')[0].split('/').pop();
                            let fetchedObj = null;
                            try {
                                const [ns, key] = parsedId.includes(':') ? parsedId.split(':') : ['', parsedId];
                                fetchedObj = await openmct.objects.get({ namespace: ns, key: key });
                            } catch (e) {
                                fetchedObj = { error: e.message };
                            }

                            return {
                                afterHash,
                                mainViewHTML: mainView ? mainView.innerHTML.substring(0, 300) : null,
                                layoutElFound: Boolean(layoutEl),
                                editBtnFound: Boolean(editBtn),
                                fetchedObj,
                                errors
                            };
                        })()
                    `);
                    console.log('[TREE AND ROOTS DIAGNOSTIC]', JSON.stringify(diag, null, 2));
                } catch (e) {
                    console.error('[CREATE DIAG ERROR]', e);
                }
                setTimeout(() => {
                    mainWindow.close();
                }, 1000);
            } else if (testMode === 'test_cameras') {
                try {
                    const fs = require('fs');
                    const artifactDir = 'C:\\Users\\mkowa\\.gemini\\antigravity\\brain\\186f4c10-013f-4fe5-aee0-4e02ea0957c9';
                    await new Promise(r => setTimeout(r, 4000));

                    console.log('[Test Cameras] Navigating to TELEOP display...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:disp_teleop';
                    `);
                    await new Promise(r => setTimeout(r, 2500));

                    const gridImg = await mainWindow.webContents.capturePage();
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-camera-grid.png'), gridImg.toPNG());
                    console.log('[Test Cameras] Saved screenshot-camera-grid.png');

                    console.log('[Test Cameras] Switching to 1+3 HERO mode...');
                    await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const heroBtn = document.querySelector('.btn-deck-mode[data-mode="hero"]');
                            if (heroBtn) heroBtn.click();
                        })()
                    `);
                    await new Promise(r => setTimeout(r, 1500));

                    const heroImg = await mainWindow.webContents.capturePage();
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-camera-hero.png'), heroImg.toPNG());
                    console.log('[Test Cameras] Saved screenshot-camera-hero.png');

                    console.log('[Test Cameras] Navigating to individual camera feed: cam_mast...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:cam_mast';
                    `);
                    await new Promise(r => setTimeout(r, 2000));

                    const singleFeedImg = await mainWindow.webContents.capturePage();
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-camera-feed-mast.png'), singleFeedImg.toPNG());
                    console.log('[Test Cameras] Saved screenshot-camera-feed-mast.png');

                    console.log('[Test Cameras] Opening pop-out window for camera-view.html?cam=1...');
                    const popout = new BrowserWindow({
                        width: 840,
                        height: 540,
                        minWidth: 440,
                        minHeight: 320,
                        title: 'Orion Rover - Mast Intel RealSense D435i Feed',
                        webPreferences: {
                            nodeIntegration: false,
                            contextIsolation: true
                        }
                    });
                    await popout.loadURL(`http://localhost:${port}/camera-view.html?cam=1`);
                    await new Promise(r => setTimeout(r, 1800));

                    const popoutImg = await popout.webContents.capturePage();
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-camera-popout.png'), popoutImg.toPNG());
                    console.log('[Test Cameras] Saved screenshot-camera-popout.png');
                    popout.close();

                    console.log('[Test Cameras] Verification completed successfully!');
                } catch (e) {
                    console.error('[Test Cameras Error]', e);
                }
                setTimeout(() => {
                    mainWindow.close();
                }, 1000);
            } else {
                setTimeout(() => {
                    console.log('Automated verification finished, closing window.');
                    mainWindow.close();
                }, 2500);
            }
        });
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow().catch((err) => {
        console.error('Failed to initialize application:', err);
        app.quit();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    if (serverInstance) {
        console.log('Shutting down local Open MCT server...');
        serverInstance.close();
        serverInstance = null;
    }
});
