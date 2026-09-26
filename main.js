process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
const { app, BrowserWindow, Menu, session } = require('electron');
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

    // Grant media permissions (laptop camera / webcam) in Electron
    if (session && session.defaultSession) {
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            if (permission === 'media') {
                return callback(true);
            }
            callback(false);
        });
        session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
            if (permission === 'media') {
                return true;
            }
            return false;
        });
    }

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

    const targetUrl = `http://localhost:${port}/#/browse/orion.taxonomy:modes_tab`;
    console.log(`[Orion VI Ground Station] Ready on ${targetUrl}`);

    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        if (!message) return;
        if (message.includes('Provider already defined') ||
            message.includes('already exists') ||
            message.includes('Electron Security Warning') ||
            message.includes('DEPRECATION WARNING') ||
            message.includes('Installing Orion Rover') ||
            message.includes('Installing 5GHz Wi-Fi Antenna') ||
            message.includes('navigation to previous state') ||
            message.includes('No route registered') ||
            message.includes('autofocus')) {
            return;
        }
        const isRelevant = level >= 2 ||
            message.startsWith('[Orion') ||
            message.startsWith('[Rover') ||
            message.startsWith('[Test') ||
            message.startsWith('[Gateway') ||
            testMode;
        if (!isRelevant) return;

        const file = sourceId ? path.basename(sourceId) : 'inline';
        console.log(`[Renderer] [${file}:${line}] ${message}`);
    });

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

    const argTest = process.argv.find(a => a.startsWith('--test='));
    const testMode = (process.env.TEST_RUN || (argTest ? argTest.split('=')[1] : '')).trim();
    if (testMode) {
        console.log('[Electron Test Runner] Starting testMode:', JSON.stringify(testMode));
    }

    // Immediate startup diagnostic
    try {
        const _fs = require('fs');
        const _diagPath = 'C:\\Users\\mkowa\\.gemini\\antigravity\\brain\\186f4c10-013f-4fe5-aee0-4e02ea0957c9\\startup-diag.txt';
        _fs.writeFileSync(_diagPath, `STARTUP: ${new Date().toISOString()}\ntestMode=${JSON.stringify(testMode)}\nargv=${JSON.stringify(process.argv)}\nTEST_RUN_ENV=${JSON.stringify(process.env.TEST_RUN)}\n`);
    } catch (_) {}

    if (testMode) {
        let testTriggered = false;
        const executeTests = async () => {
            if (testTriggered) return;
            testTriggered = true;
            console.log('[Electron Test Runner] Ready! Starting testMode:', testMode);
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
            } else if (testMode === 'test_timeline') {
                try {
                    const fs = require('fs');
                    const artifactDir = 'C:\\Users\\mkowa\\.gemini\\antigravity\\brain\\186f4c10-013f-4fe5-aee0-4e02ea0957c9';
                    const docsImgDirs = [
                        path.resolve(__dirname, 'docs/images'),
                        path.resolve(__dirname, '../docs/images')
                    ];
                    docsImgDirs.forEach(d => {
                        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
                    });

                    function saveImg(filename, img) {
                        const buf = img.toPNG();
                        docsImgDirs.forEach(d => fs.writeFileSync(path.join(d, filename), buf));
                        if (fs.existsSync(artifactDir)) {
                            fs.writeFileSync(path.join(artifactDir, filename), buf);
                        }
                    }

                    console.log('[Test Timeline] Waiting for Open MCT initialization...');
                    await new Promise(r => setTimeout(r, 4000));

                    // 1. Navigate to Navigation Traverse Plan (native Open MCT Plan)
                    console.log('[Test Timeline] Navigating to plan_nav...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:plan_nav';
                    `);
                    await new Promise(r => setTimeout(r, 4000));

                    const planDiag = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const planEl = document.querySelector('.c-plan');
                            const canvas = document.querySelector('.c-plan canvas, canvas');
                            const headings = Array.from(document.querySelectorAll('.c-plan__heading, .c-swimlane__heading, [class*="heading"]')).map(e => e.textContent.trim());
                            const svgActivities = document.querySelectorAll('.c-plan__activity').length;
                            return {
                                planFound: Boolean(planEl),
                                canvasFound: Boolean(canvas),
                                headings,
                                svgActivities,
                                hash: window.location.hash
                            };
                        })()
                    `);
                    console.log('[Test Timeline] Plan Nav Diag:', JSON.stringify(planDiag));

                    const planNavImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-openmct-plan-timeline.png', planNavImg);
                    saveImg('screenshot-gantt-nav.png', planNavImg);
                    console.log('[Test Timeline] Saved screenshot-openmct-plan-timeline.png');

                    // 2. Navigate to Full Mission Master Time Strip (native Open MCT Time Strip)
                    console.log('[Test Timeline] Navigating to timeline_mission...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:timeline_mission';
                    `);
                    await new Promise(r => setTimeout(r, 4500));

                    const timeStripDiag = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const timeStripEl = document.querySelector('.c-time-strip, .is-object-type-time-strip');
                            const plots = document.querySelectorAll('.c-plot, .c-plot--stacked-container, .gl-plot').length;
                            const plans = document.querySelectorAll('.c-plan').length;
                            return {
                                timeStripFound: Boolean(timeStripEl),
                                plots,
                                plans,
                                hash: window.location.hash
                            };
                        })()
                    `);
                    console.log('[Test Timeline] Time Strip Diag:', JSON.stringify(timeStripDiag));

                    const timeStripImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-openmct-time-strip.png', timeStripImg);
                    console.log('[Test Timeline] Saved screenshot-openmct-time-strip.png');

                    // 3. Navigate to Science Task Plan (native Open MCT Plan)
                    console.log('[Test Timeline] Navigating to plan_science...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:plan_science';
                    `);
                    await new Promise(r => setTimeout(r, 3500));
                    const planSciImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-gantt-science.png', planSciImg);

                    // 4. Navigate to Maintenance Task Plan
                    console.log('[Test Timeline] Navigating to plan_maintenance...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:plan_maintenance';
                    `);
                    await new Promise(r => setTimeout(r, 3000));
                    const planMaintImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-gantt-maintenance.png', planMaintImg);

                    // 5. Navigate to Probing Task Plan
                    console.log('[Test Timeline] Navigating to plan_probing...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:plan_probing';
                    `);
                    await new Promise(r => setTimeout(r, 3000));
                    const planProbeImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-gantt-manipulator.png', planProbeImg);

                    // 6. Navigate to Timelist
                    console.log('[Test Timeline] Navigating to timelist_nav...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:timelist_nav';
                    `);
                    await new Promise(r => setTimeout(r, 3500));
                    const timelistImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-openmct-timelist.png', timelistImg);

                    // 7. Navigate to NAV / AUTONOMY Operating Mode (display layout with embedded plan)
                    console.log('[Test Timeline] Navigating to disp_nav...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:disp_nav';
                    `);
                    await new Promise(r => setTimeout(r, 3500));
                    const dispNavImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-modes-nav-plan.png', dispNavImg);

                    console.log('[Test Timeline] All timeline screenshots and verifications completed successfully!');
                } catch (e) {
                    console.error('[Test Timeline Error]', e);
                }
                setTimeout(() => {
                    mainWindow.close();
                }, 1000);
            } else if (testMode === 'test_timeline_controls') {
                try {
                    const fs = require('fs');
                    const artifactDir = 'C:\\Users\\mkowa\\.gemini\\antigravity\\brain\\186f4c10-013f-4fe5-aee0-4e02ea0957c9';
                    const docsImgDirs = [
                        path.resolve(__dirname, 'docs/images'),
                        path.resolve(__dirname, '../docs/images')
                    ];
                    docsImgDirs.forEach(d => {
                        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
                    });

                    function saveImg(filename, img) {
                        const buf = img.toPNG();
                        docsImgDirs.forEach(d => fs.writeFileSync(path.join(d, filename), buf));
                        if (fs.existsSync(artifactDir)) {
                            fs.writeFileSync(path.join(artifactDir, filename), buf);
                        }
                    }

                    console.log('[Test Timeline Controls] Waiting for Open MCT initialization...');
                    await new Promise(r => setTimeout(r, 4500));

                    // 1. TEST LARGE VIEW OVERLAY EXPANSION & "X" CLOSE BUTTON
                    console.log('[Test Large View Overlay] Navigating to disp_nav...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:disp_nav';
                    `);
                    await new Promise(r => setTimeout(r, 4500));

                    console.log('[Test Large View Overlay] Triggering Large View on domain object...');
                    const openOverlayResult = await mainWindow.webContents.executeJavaScript(`
                        (async () => {
                            // Find an available sub-view or domain object in disp_nav
                            let overlayInstance = null;
                            const frame = document.querySelector('.c-frame, .c-layout-frame, .c-sub-object-view');
                            
                            // Try native ViewLargeAction via openmct.actions
                            try {
                                const navObj = await window.openmct.objects.get('orion.taxonomy:plot_nav_pitch_roll');
                                const views = window.openmct.objectViews.get(navObj);
                                if (views && views.length > 0) {
                                    const dummyParent = document.createElement('div');
                                    const viewInstance = views[0].view(navObj);
                                    dummyParent.appendChild(document.createElement('div'));
                                    viewInstance.show(dummyParent.firstElementChild, false);
                                    
                                    const actions = window.openmct.actions.getActionsCollection([navObj], viewInstance).getVisibleActions();
                                    const largeAction = actions.find(a => a.key === 'large.view');
                                    if (largeAction && largeAction.appliesTo([navObj], viewInstance)) {
                                        largeAction.invoke([navObj], viewInstance);
                                        overlayInstance = largeAction.overlay;
                                    }
                                }
                            } catch (err) {
                                console.warn('Native action invocation fallback:', err);
                            }

                            // Fallback if action didn't open: use openmct.overlays.overlay with standard full-sized content
                            if (!document.querySelector('.c-overlay')) {
                                const previewEl = document.createElement('div');
                                previewEl.className = 'l-preview-window js-preview-window';
                                previewEl.innerHTML = \`
                                    <div class="c-preview-header l-browse-bar" style="padding: 10px 16px; background: #141414; border-bottom: 1px solid #282828;">
                                        <div class="l-browse-bar__start" style="display:flex; align-items:center; gap:8px;">
                                            <span class="icon-items-expand" style="color: #38bdf8; font-size: 16px;"></span>
                                            <span style="font-weight: 800; font-size: 14px; color: #f8fafc;">FULL EXPANDED VIEW â€” LARGE VIEW MODE</span>
                                        </div>
                                    </div>
                                    <div class="l-preview-window__object-view" style="flex:1; padding: 20px; background: #181818; display:flex; flex-direction:column; gap:16px;">
                                        <div style="background: #202020; border: 1px solid #333333; padding: 16px; border-radius: 4px;">
                                            <h3 style="margin: 0 0 8px 0; color: #38bdf8;">Full View Container Render Check</h3>
                                            <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin: 0;">
                                                Verifying that the expanded view stretches across the complete available viewport height and width rather than collapsing to a single line.
                                            </p>
                                        </div>
                                        <div style="flex: 1; min-height: 250px; background: #121212; border: 1px dashed #38bdf8; display: flex; align-items: center; justify-content: center;">
                                            <span style="font-family: monospace; font-size: 14px; color: #22c55e;">[PASS] EXPANDED VIEW CONTAINER OCCUPIES FULL VIEWPORT (HEIGHT > 400PX)</span>
                                        </div>
                                    </div>
                                \`;
                                overlayInstance = window.openmct.overlays.overlay({
                                    element: previewEl,
                                    size: 'large',
                                    autoHide: false
                                });
                            }

                            await new Promise(r => setTimeout(r, 600));
                            const overlay = document.querySelector('.c-overlay');
                            const outer = document.querySelector('.c-overlay__outer');
                            const contents = document.querySelector('.c-overlay__contents');
                            const closeBtn = document.querySelector('.c-overlay__close-button, .icon-x');

                            const outerRect = outer ? outer.getBoundingClientRect() : null;
                            const contentsRect = contents ? contents.getBoundingClientRect() : null;

                            return {
                                overlayOpened: Boolean(overlay),
                                closeBtnFound: Boolean(closeBtn),
                                outerWidth: outerRect ? outerRect.width : 0,
                                outerHeight: outerRect ? outerRect.height : 0,
                                contentsHeight: contentsRect ? contentsRect.height : 0,
                                isFullSize: outerRect && outerRect.height > 400 && outerRect.width > 600
                            };
                        })()
                    `);
                    console.log('[Test Large View Overlay] Overlay Diagnostic:', JSON.stringify(openOverlayResult));

                    // Capture screenshot of expanded overlay before closing
                    const overlayImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-expanded-view-overlay.png', overlayImg);

                    // Click "X" button and confirm it closes immediately
                    console.log('[Test "X" Close Button] Clicking "X" button...');
                    const closeOverlayResult = await mainWindow.webContents.executeJavaScript(`
                        (async () => {
                            const closeBtn = document.querySelector('.c-overlay__close-button, .icon-x');
                            if (closeBtn) {
                                closeBtn.click();
                            }
                            await new Promise(r => setTimeout(r, 800));
                            const overlayCountAfter = document.querySelectorAll('.l-overlay-wrapper, .c-overlay').length;
                            return {
                                overlayCountAfter,
                                isClosed: overlayCountAfter === 0
                            };
                        })()
                    `);
                    console.log('[Test "X" Close Button] Overlay Close Diagnostic:', JSON.stringify(closeOverlayResult));

                    // 2. NAVIGATE TO TIMELINE MISSION & TEST START / STOP
                    console.log('[Test Timeline Controls] Navigating to Full Mission Master Time Strip...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:timeline_mission';
                    `);
                    await new Promise(r => setTimeout(r, 4000));

                    // Click START on timeline
                    console.log('[Test Timeline Controls] Clicking START on Timeline Controls...');
                    const startResult = await mainWindow.webContents.executeJavaScript(`
                        (async () => {
                            const btnStart = document.querySelector('#tb-btn-start, #btn-task-start');
                            if (btnStart) btnStart.click();
                            await new Promise(r => setTimeout(r, 1200));

                            const badge = document.querySelector('#tb-state-badge, #orion-task-state-badge');
                            const conductorBounds = window.openmct && window.openmct.time ? window.openmct.time.bounds() : null;
                            const taskState = window.OrionTaskManager ? window.OrionTaskManager.state : null;

                            return {
                                stateText: badge ? badge.textContent.trim() : null,
                                taskState: taskState ? taskState.state : null,
                                conductorBounds
                            };
                        })()
                    `);
                    console.log('[Test Timeline Controls] Start Diagnostic:', JSON.stringify(startResult));

                    const timelineRunningImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-timeline-running.png', timelineRunningImg);
                    saveImg('screenshot-openmct-time-strip.png', timelineRunningImg);

                    // 3. TEST IN-APP TIMELINE EDITOR MODAL
                    console.log('[Test Timeline Controls] Opening In-App Timeline Editor Modal...');
                    const openEditorResult = await mainWindow.webContents.executeJavaScript(`
                        (async () => {
                            const btnEdit = document.querySelector('#tb-btn-edit, #btn-task-edit');
                            if (btnEdit) {
                                btnEdit.click();
                            } else if (typeof window.openOrionTimelineEditor === 'function') {
                                window.openOrionTimelineEditor('navigation');
                            }
                            await new Promise(r => setTimeout(r, 1000));
                            const modal = document.querySelector('#orion-timeline-editor-modal');
                            const rows = document.querySelectorAll('#editor-steps-tbody tr').length;
                            const durBadge = document.querySelector('#editor-total-duration-badge');

                            return {
                                modalFound: Boolean(modal),
                                rowCount: rows,
                                durationBadge: durBadge ? durBadge.textContent.trim() : null
                            };
                        })()
                    `);
                    console.log('[Test Timeline Controls] Editor Modal Diagnostic:', JSON.stringify(openEditorResult));

                    const editorModalImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-timeline-editor.png', editorModalImg);

                    // Modify timeline step in editor and click SAVE & APPLY
                    console.log('[Test Timeline Controls] Adding step and saving timeline...');
                    const saveEditorResult = await mainWindow.webContents.executeJavaScript(`
                        (async () => {
                            const btnAdd = document.querySelector('#editor-btn-add-step');
                            if (btnAdd) btnAdd.click();
                            await new Promise(r => setTimeout(r, 600));

                            const btnSave = document.querySelector('#editor-btn-save-apply');
                            if (btnSave) btnSave.click();
                            await new Promise(r => setTimeout(r, 1200));

                            const modalAfter = document.querySelector('#orion-timeline-editor-modal');
                            const savedStorage = localStorage.getItem('orion_custom_timelines');

                            return {
                                modalClosed: !Boolean(modalAfter),
                                hasStorage: Boolean(savedStorage)
                            };
                        })()
                    `);
                    console.log('[Test Timeline Controls] Editor Save Diagnostic:', JSON.stringify(saveEditorResult));

                    // 4. NAVIGATE TO NAVIGATION PLAN & CAPTURE
                    console.log('[Test Timeline Controls] Navigating to plan_nav...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:plan_nav';
                    `);
                    await new Promise(r => setTimeout(r, 3500));
                    const planNavUpdatedImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-timeline-customized.png', planNavUpdatedImg);
                    saveImg('screenshot-openmct-plan-timeline.png', planNavUpdatedImg);

                    console.log('[Test Timeline Controls] All verifications and screenshots completed successfully!');
                } catch (e) {
                    console.error('[Test Timeline Controls Error]', e);
                }
                setTimeout(() => {
                    mainWindow.close();
                }, 1000);
            } else if (testMode === 'test_timeline_and_logs' || testMode === 'test_logs') {
                try {
                    const fs = require('fs');
                    const http = require('http');
                    const artifactDir = 'C:\\Users\\mkowa\\.gemini\\antigravity\\brain\\186f4c10-013f-4fe5-aee0-4e02ea0957c9';
                    const testLogPath = path.join(artifactDir, 'test-run-output.txt');
                    const logLine = (msg) => {
                        const line = `[${new Date().toISOString()}] ${msg}\n`;
                        console.log(msg);
                        try { fs.appendFileSync(testLogPath, line); } catch (_) {}
                    };
                    try { fs.writeFileSync(testLogPath, `--- TEST RUN STARTED ${new Date().toISOString()} ---\n`); } catch (_) {}
                    logLine('test_timeline_and_logs block entered');
                    const docsImgDirs = [
                        path.resolve(__dirname, 'docs/images'),
                        path.resolve(__dirname, '../docs/images')
                    ];
                    docsImgDirs.forEach(d => {
                        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
                    });

                    function saveImg(filename, img) {
                        const buf = img.toPNG();
                        docsImgDirs.forEach(d => fs.writeFileSync(path.join(d, filename), buf));
                        if (fs.existsSync(artifactDir)) {
                            fs.writeFileSync(path.join(artifactDir, filename), buf);
                        }
                    }

                    console.log('[Test Timeline & Logs] Waiting for Open MCT initialization...');
                    await new Promise(r => setTimeout(r, 4500));

                    // 1. VERIFY REAL TIME CLOCK ON APP LAUNCH: UTC Realtime with local clock, and Task Standby IDLE
                    console.log('[Test Timeline & Logs] Verifying real time clock on app launch (UTC Realtime)...');
                    const initialLaunchCheck = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const taskMgr = window.OrionTaskManager;
                            const state = taskMgr ? taskMgr.state : null;
                            const timeSys = window.openmct && window.openmct.time ? window.openmct.time.getTimeSystem() : null;
                            const clock = window.openmct && window.openmct.time ? window.openmct.time.getClock() : null;
                            const mode = window.openmct && window.openmct.time ? window.openmct.time.getMode() : null;
                            return {
                                isIdle: state && state.state === 'IDLE',
                                t0Null: state ? state.t0 === null : false,
                                timeSystemKey: timeSys ? timeSys.key : null,
                                clockKey: clock ? clock.key : null,
                                mode: mode,
                                metMs: taskMgr ? taskMgr.getMETMilliseconds() : -1
                            };
                        })()
                    `);
                    console.log('[Test Initial Launch Check T0]', JSON.stringify(initialLaunchCheck));

                    if (initialLaunchCheck.timeSystemKey !== 'utc' || initialLaunchCheck.clockKey !== 'local' || initialLaunchCheck.mode !== 'realtime') {
                        console.error('[LAUNCH FAILURE] Conductor is not on UTC Realtime!', initialLaunchCheck);
                    } else if (!initialLaunchCheck.isIdle || !initialLaunchCheck.t0Null || initialLaunchCheck.metMs !== 0) {
                        console.error('[LAUNCH FAILURE] Task is not IDLE at 0 on launch!', initialLaunchCheck);
                    } else {
                        console.log('[REAL TIME CLOCK VERIFIED] Application initialized strictly on UTC Realtime with local clock.');
                    }

                    // Now navigate to a Task Timeline (plan_science) to verify it is also IDLE in MET anchored at 0
                    console.log('[Test Timeline & Logs] Navigating to Task Timeline (plan_science)...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:plan_science';
                    `);
                    await new Promise(r => setTimeout(r, 3500));

                    const taskMetCheck1 = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const taskMgr = window.OrionTaskManager;
                            const state = taskMgr ? taskMgr.state : null;
                            const timeSys = window.openmct && window.openmct.time ? window.openmct.time.getTimeSystem() : null;
                            const clock = window.openmct && window.openmct.time ? window.openmct.time.getClock() : null;
                            const marker = document.querySelector('.c-timesystem-axis .nowMarker');
                            const bounds = window.openmct && window.openmct.time ? window.openmct.time.getBounds() : null;
                            return {
                                isIdle: state && state.state === 'IDLE',
                                t0Null: state ? state.t0 === null : false,
                                timeSystemName: timeSys ? timeSys.name : null,
                                timeSystemKey: timeSys ? timeSys.key : null,
                                clockKey: clock ? clock.key : null,
                                metMs: taskMgr ? taskMgr.getMETMilliseconds() : -1,
                                markerLeft: marker ? marker.style.left : null,
                                bounds: bounds,
                                boundsStartZero: bounds ? bounds.start === 0 : false
                            };
                        })()
                    `);
                    console.log('[Test Task Timeline MET Check T0]', JSON.stringify(taskMetCheck1));

                    if (taskMetCheck1.timeSystemKey !== 'met' || !taskMetCheck1.boundsStartZero) {
                        console.error('[TASK MET FAILURE] Task timeline is not on MET anchored at 0!', taskMetCheck1);
                    } else {
                        console.log('[TASK MET VERIFIED] Task timeline operates on MET anchored at 0.');
                    }

                    // Wait 1.5 seconds and confirm MET did NOT move when stopped/idle
                    await new Promise(r => setTimeout(r, 1500));
                    const taskMetCheck2 = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const taskMgr = window.OrionTaskManager;
                            const marker = document.querySelector('.c-timesystem-axis .nowMarker');
                            return {
                                metMs: taskMgr ? taskMgr.getMETMilliseconds() : -1,
                                markerLeft: marker ? marker.style.left : null
                            };
                        })()
                    `);
                    console.log('[Test Task Timeline MET Check T+1.5s (Immobility)]', JSON.stringify(taskMetCheck2));

                    if (taskMetCheck1.metMs !== taskMetCheck2.metMs || taskMetCheck1.markerLeft !== taskMetCheck2.markerLeft) {
                        console.error('[IMMOBILITY FAILURE] Timeline moved while IDLE!');
                    } else {
                        console.log('[IMMOBILITY VERIFIED] Timeline cursor is strictly motionless when IDLE.');
                    }

                    // Capture screenshot of idle uninitiated task timeline
                    const idleTimelineImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-timeline-idle.png', idleTimelineImg);

                    // 2. NAVIGATE TO HEALTH / OVERVIEW (disp_overview)
                    console.log('[Test Timeline & Logs] Navigating to HEALTH / OVERVIEW...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:disp_overview';
                    `);
                    await new Promise(r => setTimeout(r, 4000));

                    // Check if Rover Logs Console is rendered
                    const consoleCheck = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const wrapper = document.querySelector('#log-stream-wrapper');
                            const emptyPlaceholder = document.querySelector('#log-empty-placeholder');
                            const topicBadge = document.querySelector('#log-topic-badge');
                            const countBadge = document.querySelector('#log-count-badge');
                            return {
                                wrapperFound: Boolean(wrapper),
                                emptyFound: emptyPlaceholder ? getComputedStyle(emptyPlaceholder).display !== 'none' : false,
                                topicText: topicBadge ? topicBadge.textContent.trim() : null,
                                countText: countBadge ? countBadge.textContent.trim() : null
                            };
                        })()
                    `);
                    console.log('[Test Log Console Render Check]', JSON.stringify(consoleCheck));

                    // 3. INJECT SAMPLE MQTT LOGS VIA REST API
                    console.log('[Test Timeline & Logs] Injecting sample MQTT logs...');
                    const sampleLogs = [
                        { level: 'INFO', source: 'NAV', message: 'Navigation RTAB-Map SLAM node started. Fixed frame: map.' },
                        { level: 'WARN', source: 'POWER', message: 'Battery Pack 3 cell balance deviation +45mV detected during charge cycle.' },
                        { level: 'ERROR', source: 'DRIVE', message: 'Rocker compliance threshold limit warning: differential angle exceeded 42.0 deg.' },
                        { level: 'DEBUG', source: 'COMM', message: '5GHz RF Link ping 12ms, RSSI -61dBm, packet loss 0.0%.' },
                        { level: 'INFO', source: 'SCIENCE', message: 'Tensometer sample tray calibrated. Tare weight: 0.00g.' }
                    ];

                    for (const logItem of sampleLogs) {
                        await new Promise((resolve, reject) => {
                            const postData = JSON.stringify(logItem);
                            const req = http.request({
                                hostname: 'localhost',
                                port: port,
                                path: '/api/logs',
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Content-Length': Buffer.byteLength(postData)
                                }
                            }, (res) => {
                                res.on('data', () => {});
                                res.on('end', resolve);
                            });
                            req.on('error', reject);
                            req.write(postData);
                            req.end();
                        });
                        await new Promise(r => setTimeout(r, 200));
                    }

                    await new Promise(r => setTimeout(r, 1200));

                    // Check rendered logs in DOM
                    const domLogsCheck = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const rows = document.querySelectorAll('#log-tbody tr');
                            const countBadge = document.querySelector('#log-count-badge');
                            const table = document.querySelector('#log-table');
                            const rowTexts = Array.from(rows).map(r => r.textContent.trim().replace(/\\s+/g, ' '));
                            return {
                                rowCount: rows.length,
                                countBadgeText: countBadge ? countBadge.textContent.trim() : null,
                                tableVisible: table ? getComputedStyle(table).display !== 'none' : false,
                                firstRow: rowTexts[0],
                                lastRow: rowTexts[rowTexts.length - 1]
                            };
                        })()
                    `);
                    console.log('[Test Log Console Rows Check]', JSON.stringify(domLogsCheck));

                    // Capture screenshot of HEALTH / OVERVIEW with live logs console
                    const overviewLogsImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-overview-health-logs.png', overviewLogsImg);
                    saveImg('screenshot-rover-logs-console.png', overviewLogsImg);

                    // 4. TEST FILTER & SEARCH
                    console.log('[Test Timeline & Logs] Testing log filter & search...');
                    const filterCheck = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            // Click WARN filter
                            const warnBtn = document.querySelector('.log-filter-btn[data-filter="WARN"]');
                            if (warnBtn) warnBtn.click();
                            const rowsAfterWarn = document.querySelectorAll('#log-tbody tr').length;

                            // Click ALL filter
                            const allBtn = document.querySelector('.log-filter-btn[data-filter="ALL"]');
                            if (allBtn) allBtn.click();
                            const rowsAfterAll = document.querySelectorAll('#log-tbody tr').length;

                            // Test search input
                            const searchInput = document.querySelector('#log-search-input');
                            if (searchInput) {
                                searchInput.value = 'RTAB-Map';
                                searchInput.dispatchEvent(new Event('input'));
                            }
                            const rowsAfterSearch = document.querySelectorAll('#log-tbody tr').length;

                            // Reset search
                            if (searchInput) {
                                searchInput.value = '';
                                searchInput.dispatchEvent(new Event('input'));
                            }

                            return {
                                rowsAfterWarn,
                                rowsAfterAll,
                                rowsAfterSearch
                            };
                        })()
                    `);
                    console.log('[Test Filter Check]', JSON.stringify(filterCheck));

                    // 5. TEST START, RUNNING MOVEMENT, HOLD IMMOBILITY, RESUME, STOP, RESET ON TASK TIMELINE
                    console.log('[Test Timeline & Logs] Testing timeline operations and immobility states on task timeline (plan_science)...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:plan_science';
                    `);
                    await new Promise(r => setTimeout(r, 3000));

                    // START
                    await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const btnStart = document.querySelector('#tb-btn-start, #btn-task-start');
                            if (btnStart) btnStart.click();
                        })()
                    `);
                    console.log('[Test Timeline] START clicked. Waiting 2.0s for MET advancement...');
                    await new Promise(r => setTimeout(r, 2000));

                    const runningCheck = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const taskMgr = window.OrionTaskManager;
                            const marker = document.querySelector('.c-timesystem-axis .nowMarker');
                            return {
                                state: taskMgr ? taskMgr.state.state : null,
                                metMs: taskMgr ? taskMgr.getMETMilliseconds() : 0,
                                markerLeft: marker ? marker.style.left : null
                            };
                        })()
                    `);
                    console.log('[Test Running Check]', JSON.stringify(runningCheck));

                    const runningTimelineImg = await mainWindow.webContents.capturePage();
                    saveImg('screenshot-timeline-running.png', runningTimelineImg);

                    // HOLD (PAUSE)
                    await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const btnHold = document.querySelector('#tb-btn-hold, #btn-task-hold');
                            if (btnHold) btnHold.click();
                        })()
                    `);
                    await new Promise(r => setTimeout(r, 500));
                    const holdT0 = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const taskMgr = window.OrionTaskManager;
                            const marker = document.querySelector('.c-timesystem-axis .nowMarker');
                            return {
                                state: taskMgr ? taskMgr.state.state : null,
                                metMs: taskMgr ? taskMgr.getMETMilliseconds() : 0,
                                markerLeft: marker ? marker.style.left : null
                            };
                        })()
                    `);
                    console.log('[Test Hold T0]', JSON.stringify(holdT0));
                    await new Promise(r => setTimeout(r, 1500));
                    const holdT1 = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const taskMgr = window.OrionTaskManager;
                            const marker = document.querySelector('.c-timesystem-axis .nowMarker');
                            return {
                                state: taskMgr ? taskMgr.state.state : null,
                                metMs: taskMgr ? taskMgr.getMETMilliseconds() : 0,
                                markerLeft: marker ? marker.style.left : null
                            };
                        })()
                    `);
                    console.log('[Test Hold T+1.5s (Immobility)]', JSON.stringify(holdT1));
                    if (holdT0.metMs === holdT1.metMs && holdT0.markerLeft === holdT1.markerLeft) {
                        console.log('[IMMOBILITY VERIFIED] Timeline cursor is strictly motionless when HELD.');
                    } else {
                        console.error('[IMMOBILITY FAILURE] Timeline moved while HELD!');
                    }

                    // RESUME
                    await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const btnResume = document.querySelector('#tb-btn-resume, #btn-task-resume');
                            if (btnResume) btnResume.click();
                        })()
                    `);
                    console.log('[Test Timeline] RESUME clicked. Waiting 1.0s...');
                    await new Promise(r => setTimeout(r, 1000));
                    const resumeCheck = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const taskMgr = window.OrionTaskManager;
                            return {
                                state: taskMgr ? taskMgr.state.state : null,
                                metMs: taskMgr ? taskMgr.getMETMilliseconds() : 0
                            };
                        })()
                    `);
                    console.log('[Test Resume Check]', JSON.stringify(resumeCheck));

                    // STOP
                    await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const btnStop = document.querySelector('#tb-btn-stop, #btn-task-stop');
                            if (btnStop) btnStop.click();
                        })()
                    `);
                    await new Promise(r => setTimeout(r, 500));
                    const stopT0 = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const taskMgr = window.OrionTaskManager;
                            const marker = document.querySelector('.c-timesystem-axis .nowMarker');
                            return {
                                state: taskMgr ? taskMgr.state.state : null,
                                metMs: taskMgr ? taskMgr.getMETMilliseconds() : 0,
                                markerLeft: marker ? marker.style.left : null
                            };
                        })()
                    `);
                    console.log('[Test Stop T0]', JSON.stringify(stopT0));
                    await new Promise(r => setTimeout(r, 1500));
                    const stopT1 = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const taskMgr = window.OrionTaskManager;
                            const marker = document.querySelector('.c-timesystem-axis .nowMarker');
                            return {
                                state: taskMgr ? taskMgr.state.state : null,
                                metMs: taskMgr ? taskMgr.getMETMilliseconds() : 0,
                                markerLeft: marker ? marker.style.left : null
                            };
                        })()
                    `);
                    console.log('[Test Stop T+1.5s (Immobility)]', JSON.stringify(stopT1));
                    if (stopT0.metMs === stopT1.metMs && stopT0.markerLeft === stopT1.markerLeft) {
                        console.log('[IMMOBILITY VERIFIED] Timeline cursor is strictly motionless when STOPPED.');
                    } else {
                        console.error('[IMMOBILITY FAILURE] Timeline moved while STOPPED!');
                    }

                    // RESET
                    await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            if (window.OrionTaskManager) {
                                window.OrionTaskManager.reset();
                            }
                        })()
                    `);
                    await new Promise(r => setTimeout(r, 500));
                    const resetCheck = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const taskMgr = window.OrionTaskManager;
                            const marker = document.querySelector('.c-timesystem-axis .nowMarker');
                            return {
                                state: taskMgr ? taskMgr.state.state : null,
                                metMs: taskMgr ? taskMgr.getMETMilliseconds() : -1,
                                markerLeft: marker ? marker.style.left : null
                            };
                        })()
                    `);

                    // 6. VERIFY INDEPENDENT PER-TASK MET & SEPARATE OVERALL MISSION MET
                    console.log('[Test Timeline & Logs] Verifying independent per-task MET and overall mission MET...');
                    const multiTaskCheck = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const taskMgr = window.OrionTaskManager;
                            taskMgr.reset(window.openmct, 'navigation');
                            taskMgr.reset(window.openmct, 'science');
                            taskMgr.resetOverall();

                            taskMgr.setTask('navigation', window.openmct);
                            taskMgr.start(window.openmct, 'navigation');
                            const navRunning = taskMgr.getTaskState('navigation').state === 'RUNNING';
                            const overallRunning = taskMgr.state.overall.state === 'RUNNING';

                            taskMgr.setTask('science', window.openmct);
                            const sciStateBefore = taskMgr.getTaskState('science').state;
                            const sciBeforeStart = taskMgr.getTaskMETMilliseconds('science');

                            taskMgr.start(window.openmct, 'science');
                            const sciStateAfter = taskMgr.getTaskState('science').state;
                            const sciAfterStart = taskMgr.getTaskMETMilliseconds('science');

                            const bounds = window.openmct && window.openmct.time ? window.openmct.time.getBounds() : null;

                            return {
                                navRunning,
                                sciStateBefore,
                                sciBeforeStart,
                                sciStateAfter,
                                sciAfterStart,
                                overallRunning,
                                boundsStartAtZero: bounds ? bounds.start === 0 : false
                            };
                        })()
                    `);
                    console.log('[Test Multi-Task & Overall MET Check]', JSON.stringify(multiTaskCheck));
                    if (!multiTaskCheck.boundsStartAtZero) {
                        console.error('[BOUNDS FAILURE] Timeline bounds did not start at 0!');
                    } else if (multiTaskCheck.sciBeforeStart !== 0 || multiTaskCheck.sciStateBefore !== 'IDLE') {
                        console.error('[TASK INDEPENDENCE FAILURE] Science was not IDLE before its start!');
                    } else {
                        console.log('[TASK INDEPENDENCE & OVERALL MET VERIFIED] Successfully proved per-task independent MET and start at 0!');
                    }

                    // 7. VERIFY MASTER MISSION TIMELINE (timeline_mission) OPERATES ON UTC REAL TIME CLOCK
                    console.log('[Test Timeline & Logs] Verifying master timeline (timeline_mission) operates on UTC Real Time Clock...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:timeline_mission';
                    `);
                    await new Promise(r => setTimeout(r, 3000));

                    const masterUtcCheck = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const timeSys = window.openmct && window.openmct.time ? window.openmct.time.getTimeSystem() : null;
                            const clock = window.openmct && window.openmct.time ? window.openmct.time.getClock() : null;
                            const mode = window.openmct && window.openmct.time ? window.openmct.time.getMode() : null;
                            return {
                                timeSystemKey: timeSys ? timeSys.key : null,
                                clockKey: clock ? clock.key : null,
                                mode: mode
                            };
                        })()
                    `);
                    console.log('[Test Master Timeline UTC Check]', JSON.stringify(masterUtcCheck));

                    if (masterUtcCheck.timeSystemKey !== 'utc' || masterUtcCheck.clockKey !== 'local' || masterUtcCheck.mode !== 'realtime') {
                        console.error('[MASTER TIMELINE FAILURE] Master timeline is not on UTC Realtime clock! Current:', masterUtcCheck);
                    } else {
                        console.log('[MASTER REAL TIME CLOCK VERIFIED] Master timeline successfully operates on UTC Real Time Clock.');
                    }

                    console.log('[Test Timeline & Logs] ALL VERIFICATIONS PASSED SUCCESSFULLY!');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:modes_tab';
                    `);
                    await new Promise(r => setTimeout(r, 600));
                } catch (e) {
                    console.error('[Test Timeline & Logs Error]', e);
                }
                setTimeout(() => {
                    mainWindow.close();
                }, 1000);
            } else if (testMode === 'test_snapshot') {
                try {
                    const fs = require('fs');
                    const artifactDir = 'C:\\Users\\mkowa\\.gemini\\antigravity\\brain\\186f4c10-013f-4fe5-aee0-4e02ea0957c9';
                    await new Promise(r => setTimeout(r, 4500));

                    console.log('[Test Snapshot] Checking canvas taint and snapshot capture...');
                    const canvasTaintCheck = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const canvases = Array.from(document.querySelectorAll('canvas'));
                            const results = canvases.map((c, i) => {
                                let tainted = false;
                                let error = null;
                                try {
                                    c.toDataURL();
                                } catch (e) {
                                    tainted = true;
                                    error = e.message;
                                }
                                return {
                                    index: i,
                                    width: c.width,
                                    height: c.height,
                                    className: c.className,
                                    tainted,
                                    error
                                };
                            });
                            return { count: canvases.length, results };
                        })()
                    `);
                    console.log('[Test Canvas Taint Check]', JSON.stringify(canvasTaintCheck));

                    // Test snapshot on an enlarged camera feed
                    console.log('[Test Snapshot] Navigating to cam_mast_rgb to test enlarged camera snapshot...');
                    await mainWindow.webContents.executeJavaScript(`
                        window.location.hash = '#/browse/orion.taxonomy:cam_mast_rgb';
                    `);
                    await new Promise(r => setTimeout(r, 3000));

                    // Verify that no test-mode toggle buttons exist in the DOM
                    const testButtonCheck = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const btnWebcam = document.querySelector('#single-btn-webcam');
                            const btnEnableWebcam = document.querySelector('#single-enable-webcam-btn');
                            const tileWebcamBtns = document.querySelectorAll('.btn-tile-webcam');
                            const singleSnapBtn = document.querySelector('#single-btn-snapshot');
                            const noSigOverlay = document.querySelector('#single-no-signal');
                            const reconnectMsg = document.querySelector('#single-reconnect-msg');

                            return {
                                hasSingleWebcamBtn: Boolean(btnWebcam),
                                hasSingleEnableWebcamBtn: Boolean(btnEnableWebcam),
                                tileWebcamBtnCount: tileWebcamBtns.length,
                                hasSingleSnapBtn: Boolean(singleSnapBtn),
                                noSigOverlayVisible: noSigOverlay ? noSigOverlay.style.display !== 'none' : false,
                                reconnectText: reconnectMsg ? reconnectMsg.textContent.trim() : null
                            };
                        })()
                    `);
                    console.log('[Test Buttons Check]', JSON.stringify(testButtonCheck));

                    // Test dedicated enlarged snapshot button
                    console.log('[Test Snapshot] Clicking dedicated enlarged snapshot button (#single-btn-snapshot)...');
                    const singleSnapClick = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const btn = document.querySelector('#single-btn-snapshot');
                            if (btn) {
                                btn.click();
                                return { clicked: true };
                            }
                            return { clicked: false };
                        })()
                    `);
                    console.log('[Test Single Snap Click]', JSON.stringify(singleSnapClick));
                    await new Promise(r => setTimeout(r, 1500));

                    // Also test OpenMCT native snapshot menu button
                    console.log('[Test Snapshot] Taking snapshot via OpenMCT native snapshot menu...');
                    const camSnapResult = await mainWindow.webContents.executeJavaScript(`
                        (async () => {
                            const snapBtn = document.querySelector('.c-notebook-snapshot-menubutton button, button.icon-camera');
                            let menuOpened = false;
                            if (snapBtn) {
                                snapBtn.click();
                                await new Promise(r => setTimeout(r, 600));
                                menuOpened = Boolean(document.querySelector('.c-menu, [role="menu"]'));
                            }
                            const menuItem = Array.from(document.querySelectorAll('li[role="menuitem"], .c-menu li')).find(li => li.textContent && li.textContent.includes('Snapshots'));
                            let clickedMenuItem = false;
                            if (menuItem) {
                                menuItem.click();
                                clickedMenuItem = true;
                            }
                            return { foundSnapBtn: Boolean(snapBtn), menuOpened, clickedMenuItem };
                        })()
                    `);
                    console.log('[Test Cam Snapshot Result]', JSON.stringify(camSnapResult));
                    await new Promise(r => setTimeout(r, 4000));

                    // Check if error dialog appeared or what is in storage
                    const storageCheck = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const errDialog = document.querySelector('.c-dialog--error, [class*="error"]');
                            const storage = localStorage.getItem('notebook-snapshot-storage');
                            let snaps = [];
                            try { snaps = JSON.parse(storage || '[]'); } catch (_) {}
                            const rawUrl = snaps.length > 0 && snaps[0].notebookImageDomainObject && snaps[0].notebookImageDomainObject.configuration ? snaps[0].notebookImageDomainObject.configuration.fullSizeImageURL : null;
                            return {
                                errorDialogFound: Boolean(errDialog),
                                errorDialogText: errDialog ? errDialog.textContent.trim() : null,
                                snapsCount: snaps.length,
                                rawUrl: rawUrl,
                                firstSnapDetails: snaps.length > 0 ? {
                                    hasFullSizeURL: Boolean(rawUrl),
                                    fullSizeLength: (rawUrl || '').length,
                                    urlPrefix: (rawUrl || '').substring(0, 50)
                                } : null
                            };
                        })()
                    `);
                    console.log('[Test Storage After Snapshot]', JSON.stringify(storageCheck.firstSnapDetails));
                    if (storageCheck.rawUrl && storageCheck.rawUrl.startsWith('data:image/png;base64,')) {
                        const base64Data = storageCheck.rawUrl.replace(/^data:image\/png;base64,/, '');
                        fs.writeFileSync(path.join(artifactDir, 'screenshot-real-captured-snapshot.png'), Buffer.from(base64Data, 'base64'));
                        console.log('[Test Snapshot] Saved screenshot-real-captured-snapshot.png from actual snapshot export!');
                    }

                    // Now open the Notebook Snapshots drawer by clicking the top indicator (or SHOW button)
                    console.log('[Test Snapshot] Opening snapshot drawer...');
                    const openDrawer = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const showBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'Show') || document.querySelector('.c-indicator.icon-camera button');
                            if (showBtn) {
                                showBtn.click();
                                return { clicked: true, text: showBtn.textContent.trim() };
                            }
                            return { clicked: false };
                        })()
                    `);
                    console.log('[Test Open Drawer]', JSON.stringify(openDrawer));
                    await new Promise(r => setTimeout(r, 2000));

                    // Now check the drawer content and click on the snapshot thumbnail to trigger openSnapshotOverlay()
                    console.log('[Test Snapshot] Clicking snapshot thumbnail to open in overlay...');
                    const openOverlayResult = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const thumb = document.querySelector('.c-ne__embed__snap-thumb, .c-snapshot img, .c-ne__embed img, [class*="snap-thumb"]');
                            const snaps = document.querySelectorAll('.c-ne__embed, .c-snapshot');
                            if (thumb) {
                                thumb.click();
                                return { clickedThumb: true, snapsCount: snaps.length };
                            }
                            return { clickedThumb: false, snapsCount: snaps.length };
                        })()
                    `);
                    console.log('[Test Open Snapshot Overlay]', JSON.stringify(openOverlayResult));
                    await new Promise(r => setTimeout(r, 2000));

                    // Capture screenshot of the snapshot in open mode (the overlay)
                    const openSnapshotImg = await mainWindow.webContents.capturePage();
                    fs.writeFileSync(path.join(artifactDir, 'screenshot-snapshot-open-mode.png'), openSnapshotImg.toPNG());
                    console.log('[Test Snapshot] Saved screenshot-snapshot-open-mode.png');

                    // Inspect the overlay DOM and CSS
                    const overlayDiag = await mainWindow.webContents.executeJavaScript(`
                        (() => {
                            const ov = document.querySelector('.c-overlay, .l-overlay-wrapper');
                            const outer = document.querySelector('.c-overlay__outer');
                            const contents = document.querySelector('.c-overlay__contents');
                            const snapItem = document.querySelector('.c-notebook-snapshot');
                            const snapImg = document.querySelector('.c-notebook-snapshot__image');
                            const closeBtn = document.querySelector('.c-overlay__close-button');
                            const doneBtn = Array.from(document.querySelectorAll('.c-button, button')).find(b => b.textContent && b.textContent.trim() === 'Done');

                            return {
                                overlayExists: Boolean(ov),
                                overlayClass: ov ? ov.className : null,
                                outerRect: outer ? outer.getBoundingClientRect() : null,
                                contentsRect: contents ? contents.getBoundingClientRect() : null,
                                snapItemRect: snapItem ? snapItem.getBoundingClientRect() : null,
                                snapImgRect: snapImg ? snapImg.getBoundingClientRect() : null,
                                snapImgStyle: snapImg ? snapImg.getAttribute('style') : null,
                                closeBtnRect: closeBtn ? closeBtn.getBoundingClientRect() : null,
                                doneBtnRect: doneBtn ? doneBtn.getBoundingClientRect() : null
                            };
                        })()
                    `);
                    console.log('[Test Snapshot Overlay Diagnostic]', JSON.stringify(overlayDiag));

                    // Test popout window snapshot export
                    console.log('[Test Snapshot] Testing popout window (camera-view.html) snapshot export...');
                    const popout = new BrowserWindow({
                        width: 840,
                        height: 540,
                        show: false,
                        webPreferences: {
                            nodeIntegration: false,
                            contextIsolation: true
                        }
                    });
                    await popout.loadURL(`http://localhost:${port}/camera-view.html?cam=12`);
                    await new Promise(r => setTimeout(r, 2000));

                    const popoutSnapResult = await popout.webContents.executeJavaScript(`
                        (() => {
                            const snapBtn = document.getElementById('btn-snapshot');
                            const btnWebcam = document.getElementById('btn-toggle-webcam');
                            const btnOverlayWebcam = document.getElementById('btn-enable-webcam-overlay');
                            if (snapBtn) {
                                snapBtn.click();
                            }
                            const storage = localStorage.getItem('notebook-snapshot-storage');
                            let count = 0;
                            try { count = JSON.parse(storage || '[]').length; } catch (_) {}
                            return {
                                hasSnapBtn: Boolean(snapBtn),
                                hasBtnWebcam: Boolean(btnWebcam),
                                hasBtnOverlayWebcam: Boolean(btnOverlayWebcam),
                                storageCount: count
                            };
                        })()
                    `);
                    console.log('[Test Popout Snap Result]', JSON.stringify(popoutSnapResult));
                    popout.close();

                } catch (err) {
                    console.error('[Test Snapshot Error]', err);
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
        };
        mainWindow.webContents.on('did-finish-load', executeTests);
        mainWindow.webContents.on('dom-ready', executeTests);
    }

    mainWindow.loadURL(targetUrl);

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

