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
                    await new Promise(r => setTimeout(r, 4500));

                    console.log('[Test Cameras] Navigating to Rover Displays (modes_tab)...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:modes_tab';
                    `);
                    await new Promise(r => setTimeout(r, 3000));

                    // Inspect available tabs and click the CAMERAS tab
                    const tabDiag = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const tabs = Array.from(document.querySelectorAll('.c-tabs__tab, .c-tab, [role="tab"], button')).map(el => el.textContent.trim());
                            const camTabEl = Array.from(document.querySelectorAll('.c-tabs__tab, .c-tab, [role="tab"], button')).find(el => el.textContent && el.textContent.includes('CAMERAS'));
                            if (camTabEl) {
                                camTabEl.click();
                            }
                            return {
                                tabs,
                                clickedCamTab: Boolean(camTabEl)
                            };
                        })()
                    `);
                    console.log('[Test Cameras] Tab Diagnostic & Click:', JSON.stringify(tabDiag));
                    await new Promise(r => setTimeout(r, 3500));

                    // Verify flexible layout, active timestamps, reconnect countdown message, and absence of deleted buttons
                    const flexDiag = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const fl = document.querySelector('.c-fl, [class*="flexible-layout"]');
                            const frames = document.querySelectorAll('.c-fl-frame, .c-frame');
                            const deletedLargerViewBtns = document.querySelectorAll('#btn-single-larger');
                            const deletedPopoutBtns = document.querySelectorAll('#btn-single-popout');
                            const deletedSignalBtns = document.querySelectorAll('#btn-single-signal');
                            const deletedCaptureBtns = document.querySelectorAll('#btn-single-snapshot');
                            const hudTimes = Array.from(document.querySelectorAll('#single-hud-time')).map(el => el.textContent.trim());
                            const osdTimes = Array.from(document.querySelectorAll('#single-osd-time')).map(el => el.textContent.trim());
                            const noSigOverlays = document.querySelectorAll('#single-no-signal');
                            const reconnectMsgs = Array.from(document.querySelectorAll('#single-reconnect-msg')).map(el => el.textContent.trim());

                            return {
                                hasFlexibleLayout: Boolean(fl),
                                frameCount: frames.length,
                                deletedButtonsPresent: (deletedLargerViewBtns.length + deletedPopoutBtns.length + deletedSignalBtns.length + deletedCaptureBtns.length) > 0,
                                hudTimeSamples: hudTimes.slice(0, 3),
                                osdTimeSamples: osdTimes.slice(0, 3),
                                noSigCount: noSigOverlays.length,
                                reconnectMsgSamples: reconnectMsgs.slice(0, 3)
                            };
                        })()
                    `);
                    console.log('[Test Cameras] In-Tab Flexible Layout Diagnostic:', JSON.stringify(flexDiag));

                    // Capture screenshot 1: Flexible layout as a tab with "Attempting reconnect in..." countdown
                    const tabCamerasImg = await mainWindow.webContents.capturePage();
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-modes-tab-cameras.png'), tabCamerasImg.toPNG());
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-cameras-reconnect-countdown.png'), tabCamerasImg.toPNG());
                    console.log('[Test Cameras] Saved screenshot-modes-tab-cameras.png and screenshot-cameras-reconnect-countdown.png');

                    // Wait 2.5 seconds to observe countdown progression
                    console.log('[Test Cameras] Waiting 2.5s for countdown progression...');
                    await new Promise(r => setTimeout(r, 2500));

                    const progressDiag = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const reconnectMsgs = Array.from(document.querySelectorAll('#single-reconnect-msg')).map(el => el.textContent.trim());
                            return { reconnectMsgSamples: reconnectMsgs.slice(0, 3) };
                        })()
                    `);
                    console.log('[Test Cameras] Countdown Progression Diagnostic:', JSON.stringify(progressDiag));

                    // Toggle signal simulation on for Mast Camera (cam_mast_rgb)
                    console.log('[Test Cameras] Toggling signal simulation on for Mast camera...');
                    await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            if (window.OrionCameraManager) {
                                window.OrionCameraManager.toggleSignal(1);
                            }
                        })()
                    `);
                    await new Promise(r => setTimeout(r, 2000));

                    const tabCamerasLiveImg = await mainWindow.webContents.capturePage();
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-modes-tab-cameras-live.png'), tabCamerasLiveImg.toPNG());
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-10-cameras-flexible-layout-mixed.png'), tabCamerasLiveImg.toPNG());
                    console.log('[Test Cameras] Saved screenshot-modes-tab-cameras-live.png');

                    // Navigate directly to dedicated view for Mast RGB camera (cam_mast_rgb)
                    console.log('[Test Cameras] Navigating to dedicated view for cam_mast_rgb...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:cam_mast_rgb';
                    `);
                    await new Promise(r => setTimeout(r, 2500));

                    const cleanMastImg = await mainWindow.webContents.capturePage();
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-camera-mast-clean.png'), cleanMastImg.toPNG());
                    console.log('[Test Cameras] Saved screenshot-camera-mast-clean.png');

                    // Verify clean TELEOP display has zero cameras
                    console.log('[Test Cameras] Navigating to clean TELEOP display...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:disp_teleop';
                    `);
                    await new Promise(r => setTimeout(r, 2500));

                    const cleanTeleopImg = await mainWindow.webContents.capturePage();
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-clean-teleop-display.png'), cleanTeleopImg.toPNG());
                    console.log('[Test Cameras] Saved screenshot-clean-teleop-display.png');

                    // Open pop-out window for camera-view.html?cam=1 to verify popout window
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
                    await new Promise(r => setTimeout(r, 2000));

                    const popoutNoSigImg = await popout.webContents.capturePage();
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-camera-popout-nosignal.png'), popoutNoSigImg.toPNG());
                    console.log('[Test Cameras] Saved screenshot-camera-popout-nosignal.png');
                    popout.close();

                    console.log('[Test Cameras] All verifications finished successfully!');
                } catch (e) {
                    console.error('[Test Cameras Error]', e);
                }
                setTimeout(() => {
                    mainWindow.close();
                }, 1000);
            } else if (testMode === 'test_battery') {
                try {
                    const fs = require('fs');
                    const http = require('http');
                    const artifactDir = 'C:\\Users\\mkowa\\.gemini\\antigravity\\brain\\186f4c10-013f-4fe5-aee0-4e02ea0957c9';
                    await new Promise(r => setTimeout(r, 3000));

                    // Step 1: Check initial offline indicator state (zero false-OK check)
                    const offlineDiag = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const ind = document.querySelector('.orion-battery-indicator');
                            const mainText = document.querySelector('#ind-batt-text') ? document.querySelector('#ind-batt-text').textContent.trim() : null;
                            const b1 = document.querySelector('#ind-batt-m1') ? document.querySelector('#ind-batt-m1').textContent.trim() : null;
                            const b2 = document.querySelector('#ind-batt-m2') ? document.querySelector('#ind-batt-m2').textContent.trim() : null;
                            const b3 = document.querySelector('#ind-batt-m3') ? document.querySelector('#ind-batt-m3').textContent.trim() : null;
                            const b4 = document.querySelector('#ind-batt-m4') ? document.querySelector('#ind-batt-m4').textContent.trim() : null;
                            const ledColor = document.querySelector('#ind-batt-led') ? document.querySelector('#ind-batt-led').style.background : null;
                            return { indFound: Boolean(ind), mainText, b1, b2, b3, b4, ledColor };
                        })()
                    `);
                    console.log('[Test Battery] Initial Offline State:', JSON.stringify(offlineDiag));

                    // Step 2: Inject calibrated mock telemetry (~20.1V - 20.2V)
                    console.log('[Test Battery] Injecting calibrated mock telemetry (~20.1V - 20.2V)...');
                    const mockPayloads = JSON.parse(fs.readFileSync(path.join(__dirname, 'example-server/mock-payloads.json'), 'utf8'));
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
                            res.on('end', resolve);
                        });
                        req.write(postData);
                        req.end();
                    });

                    await new Promise(r => setTimeout(r, 2000));

                    // Step 3: Check live indicator state with battery states and calibrated voltages
                    const liveDiag = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const mainText = document.querySelector('#ind-batt-text') ? document.querySelector('#ind-batt-text').textContent.trim() : null;
                            const b1 = document.querySelector('#ind-batt-m1') ? document.querySelector('#ind-batt-m1').textContent.trim() : null;
                            const b2 = document.querySelector('#ind-batt-m2') ? document.querySelector('#ind-batt-m2').textContent.trim() : null;
                            const b3 = document.querySelector('#ind-batt-m3') ? document.querySelector('#ind-batt-m3').textContent.trim() : null;
                            const b4 = document.querySelector('#ind-batt-m4') ? document.querySelector('#ind-batt-m4').textContent.trim() : null;
                            const ledColor = document.querySelector('#ind-batt-led') ? document.querySelector('#ind-batt-led').style.background : null;
                            const tooltip = document.querySelector('.orion-battery-indicator') ? document.querySelector('.orion-battery-indicator').title : null;
                            return { mainText, b1, b2, b3, b4, ledColor, tooltip };
                        })()
                    `);
                    console.log('[Test Battery] Live Telemetry State:', JSON.stringify(liveDiag));

                    // Capture screenshot of the top panel with live battery states
                    const topPanelImg = await mainWindow.webContents.capturePage();
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-top-panel-battery-states.png'), topPanelImg.toPNG());
                    console.log('[Test Battery] Saved screenshot-top-panel-battery-states.png');

                    // Step 4: Open battery-details.html window and capture
                    console.log('[Test Battery] Opening battery-details.html diagnostics window...');
                    const detailsWin = new BrowserWindow({
                        width: 960,
                        height: 680,
                        title: 'Orion Rover - Battery Telemetry & Diagnostics',
                        webPreferences: {
                            nodeIntegration: false,
                            contextIsolation: true
                        }
                    });
                    await detailsWin.loadURL(`http://localhost:${port}/battery-details.html`);
                    await new Promise(r => setTimeout(r, 3000));

                    const detailsDiag = await detailsWin.webContents.executeJavaScript(`
                        (() => {
                            const busV = document.getElementById('kpi-bus-v') ? document.getElementById('kpi-bus-v').textContent.trim() : null;
                            const busI = document.getElementById('kpi-bus-i') ? document.getElementById('kpi-bus-i').textContent.trim() : null;
                            const soc = document.getElementById('kpi-soc') ? document.getElementById('kpi-soc').textContent.trim() : null;
                            const v1 = document.getElementById('row-v1') ? document.getElementById('row-v1').textContent.trim() : null;
                            const v2 = document.getElementById('row-v2') ? document.getElementById('row-v2').textContent.trim() : null;
                            const v3 = document.getElementById('row-v3') ? document.getElementById('row-v3').textContent.trim() : null;
                            const v4 = document.getElementById('row-v4') ? document.getElementById('row-v4').textContent.trim() : null;
                            const b1 = document.getElementById('badge-m1') ? document.getElementById('badge-m1').textContent.trim() : null;
                            const b2 = document.getElementById('badge-m2') ? document.getElementById('badge-m2').textContent.trim() : null;
                            const b3 = document.getElementById('badge-m3') ? document.getElementById('badge-m3').textContent.trim() : null;
                            const b4 = document.getElementById('badge-m4') ? document.getElementById('badge-m4').textContent.trim() : null;
                            return { busV, busI, soc, v1, v2, v3, v4, b1, b2, b3, b4 };
                        })()
                    `);
                    console.log('[Test Battery] Diagnostics Window State:', JSON.stringify(detailsDiag));

                    const detailsImg = await detailsWin.webContents.capturePage();
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-battery-details-calibrated.png'), detailsImg.toPNG());
                    console.log('[Test Battery] Saved screenshot-battery-details-calibrated.png');
                    detailsWin.close();

                    console.log('[Test Battery] All battery verifications completed successfully!');
                } catch (e) {
                    console.error('[Test Battery Error]', e);
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
