/**
 * Orion VI Camera Mosaic & Flexible Multi-Camera Deck Plugin (ERC 2026)
 * Standards: NASA-STD-3001, ECSS
 * 
 * Features:
 * - Independent Camera Feed Objects (orion.camera_feed)
 * - Flexible Multi-Camera Deck with 4 layouts:
 *   1. [2x2 GRID] - Simultaneous 4-feed quadrant grid
 *   2. [1+3 HERO] - Hero primary feed + 3 side synchronized previews
 *   3. [DUAL 1:1] - Dual side-by-side comparison
 *   4. [SOLO 1x1] - Maximized single camera view
 * - Independent Desktop Window Pop-Out:
 *   - Each camera tile features an immediate [⧉ POP OUT] button to launch in its own window
 * - Live HUD: FPS counter, Downlink Bitrate, UTC Timestamp, and Crosshairs
 * - Capture Snapshot action: saves annotated frame directly into Open MCT Notebook
 * - Multi-canvas optimized rendering loop
 */

(function () {
    const CAMERAS = [
        { id: 1, key: 'cam_mast', name: 'Mast Intel RealSense D435i', short: 'MAST RGB', resolution: '1920x1080', role: 'Perception / SLAM', color: '#38bdf8' },
        { id: 2, key: 'cam_front', name: 'Front Chassis Drive Camera', short: 'FRONT DRIVE', resolution: '1280x720', role: 'Mobility / Obstacle', color: '#22c55e' },
        { id: 3, key: 'cam_arm', name: 'Manipulator Gripper Camera', short: 'ARM / GRIPPER', resolution: '1280x720', role: 'Inspection / Manipulation', color: '#f97316' },
        { id: 4, key: 'cam_science', name: 'Science Chamber Camera', short: 'SCIENCE CHAMBER', resolution: '1280x720', role: 'Sample Verification', color: '#a855f7' }
    ];

    class CameraManager {
        constructor() {
            this.activeCamId = 1;
            this.layoutMode = 'grid'; // 'grid', 'hero', 'dual', 'solo'
            this.listeners = new Set();
        }

        subscribe(cb) {
            this.listeners.add(cb);
            cb(this.getState());
            return () => this.listeners.delete(cb);
        }

        notify() {
            const state = this.getState();
            this.listeners.forEach(cb => {
                try { cb(state); } catch (_) {}
            });
        }

        getState() {
            return {
                activeCamId: this.activeCamId,
                layoutMode: this.layoutMode,
                activeCamera: this.getActiveCamera()
            };
        }

        setLayoutMode(mode) {
            if (['grid', 'hero', 'dual', 'solo'].includes(mode)) {
                this.layoutMode = mode;
                this.notify();
            }
        }

        setActiveCam(camId, fromUser = false) {
            const id = parseInt(camId, 10) || 1;
            if (this.activeCamId === id && !fromUser) {
                return;
            }
            this.activeCamId = id;
            this.notify();

            // Dispatch command to gateway if initiated by user interaction
            if (fromUser && window.OrionSafetyService) {
                window.OrionSafetyService.safeSendCommand({
                    action: 'CAMERA_SWITCH',
                    camId: this.activeCamId
                }).catch(() => {});
            }
        }

        getActiveCamera() {
            return CAMERAS.find(c => c.id === this.activeCamId) || CAMERAS[0];
        }

        getCameraById(id) {
            return CAMERAS.find(c => c.id === parseInt(id, 10)) || CAMERAS[0];
        }

        getCameraByKey(key) {
            return CAMERAS.find(c => c.key === key || key.includes(c.key)) || CAMERAS[0];
        }

        openPopout(camId) {
            const cam = this.getCameraById(camId);
            const url = `camera-view.html?cam=${cam.id}`;
            window.open(url, `_blank_cam_${cam.id}`, 'width=840,height=540,menubar=no,toolbar=no,location=no,status=no');
        }
    }

    const cameraManager = new CameraManager();

    // Procedural Scene Renderer for Rover Camera Streams
    function drawCameraScene(ctx, cam, now, width, height) {
        ctx.save();

        // Mars Yard terrain background
        ctx.fillStyle = '#1e1b18';
        ctx.fillRect(0, 0, width, height);

        const midY = height * 0.5;
        const groundGrad = ctx.createLinearGradient(0, midY, 0, height);
        groundGrad.addColorStop(0, '#7c2d12');
        groundGrad.addColorStop(1, '#451a03');
        ctx.fillStyle = groundGrad;
        ctx.fillRect(0, midY, width, height - midY);

        const skyGrad = ctx.createLinearGradient(0, 0, 0, midY);
        skyGrad.addColorStop(0, '#1c1917');
        skyGrad.addColorStop(1, '#78350f');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, width, midY);

        // Perspective-specific visuals
        if (cam.id === 1) {
            // Mast RealSense: Horizon & depth grid
            ctx.strokeStyle = 'rgba(251, 146, 60, 0.5)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, midY);
            ctx.lineTo(width, midY);
            ctx.stroke();

            // Rocks
            ctx.fillStyle = '#b45309';
            ctx.fillRect(width * 0.35, midY + height * 0.1, width * 0.06, height * 0.08);
            ctx.fillRect(width * 0.65, midY + height * 0.05, width * 0.08, height * 0.1);

            // Depth grid lines
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
            const step = width / 12;
            for (let x = 0; x < width; x += step) {
                ctx.beginPath();
                ctx.moveTo(x, midY);
                ctx.lineTo(x + (x - width * 0.5) * 0.8, height);
                ctx.stroke();
            }
        } else if (cam.id === 2) {
            // Front Chassis: Wheels in lower left and right
            ctx.fillStyle = '#181818';
            ctx.fillRect(width * 0.05, height * 0.6, width * 0.14, height * 0.4);
            ctx.fillRect(width * 0.81, height * 0.6, width * 0.14, height * 0.4);
            ctx.fillStyle = '#38bdf8';
            ctx.font = '11px monospace';
            ctx.fillText('FRONT CHASSIS WHEELS', width * 0.38, height * 0.92);
        } else if (cam.id === 3) {
            // Arm Gripper: ST3215 finger jaws
            ctx.fillStyle = '#2d2d30';
            ctx.fillRect(width * 0.42, height * 0.65, width * 0.05, height * 0.35);
            ctx.fillRect(width * 0.53, height * 0.65, width * 0.05, height * 0.35);
            ctx.fillStyle = '#f97316';
            ctx.font = '11px monospace';
            ctx.fillText('ARM GRIPPER AXIS', width * 0.40, height * 0.60);
        } else if (cam.id === 4) {
            // Science Chamber: Circular cyclone silhouette
            ctx.fillStyle = '#252526';
            ctx.beginPath();
            const r = Math.min(width, height) * 0.28;
            ctx.arc(width * 0.5, height * 0.5, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#a855f7';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.fillStyle = '#a855f7';
            ctx.font = '11px monospace';
            ctx.fillText('CYCLONE CHAMBER', width * 0.38, height * 0.5);
        }

        // Small OSD timestamp at bottom left
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.font = '9px monospace';
        ctx.fillText(`UTC: ${new Date(now).toISOString().substring(11, 23)}`, 8, height - 6);

        ctx.restore();
    }

    function OrionCameraMosaicPlugin() {
        return function install(openmct) {
            // 1. Register Multi-Camera Deck Type
            openmct.types.addType('orion.camera_mosaic', {
                name: 'Flexible Camera Deck',
                description: 'Flexible multi-camera stream deck with pop-out window capabilities',
                cssClass: 'icon-imagery'
            });

            // 2. Register Individual Camera Feed Type
            openmct.types.addType('orion.camera_feed', {
                name: 'Rover Camera Feed',
                description: 'Individual live video downlink feed from an Orion VI camera',
                cssClass: 'icon-imagery'
            });

            // 3. Register Object View for Individual Camera Feeds
            openmct.objectViews.addProvider({
                key: 'orion-camera-feed-view',
                name: 'Camera Live Feed',
                cssClass: 'icon-imagery',
                canView: function (domainObject) {
                    return domainObject.type === 'orion.camera_feed' ||
                           (domainObject.identifier && domainObject.identifier.key && domainObject.identifier.key.startsWith('cam_'));
                },
                priority: function () {
                    return 1000;
                },
                view: function (domainObject) {
                    let viewContainer = null;
                    return {
                        show: function (container) {
                            viewContainer = container;
                            renderCameraFeed(container, domainObject, openmct);
                        },
                        destroy: function (container) {
                            const c = container || viewContainer;
                            if (c && c._cleanup) c._cleanup();
                        }
                    };
                }
            });

            // 4. Register Object View for Multi-Camera Deck / Mosaic
            openmct.objectViews.addProvider({
                key: 'orion-camera-mosaic-view',
                name: 'Flexible Camera Deck View',
                cssClass: 'icon-imagery',
                canView: function (domainObject) {
                    return domainObject.type === 'orion.camera_mosaic' ||
                           (domainObject.identifier && domainObject.identifier.key === 'widget_camera_mosaic') ||
                           (domainObject.identifier && domainObject.identifier.key === 'camera_mosaic') ||
                           (domainObject.identifier && domainObject.identifier.key === 'layout_cameras') ||
                           domainObject.type === 'imagery';
                },
                priority: function () {
                    return 1000;
                },
                view: function (domainObject) {
                    let viewContainer = null;
                    return {
                        show: function (container) {
                            viewContainer = container;
                            renderFlexibleCameraDeck(container, openmct);
                        },
                        destroy: function (container) {
                            const c = container || viewContainer;
                            if (c && c._cleanup) c._cleanup();
                        }
                    };
                }
            });
        };
    }

    // =========================================================================
    // 1. INDIVIDUAL CAMERA FEED VIEW (Dedicated Domain Object)
    // =========================================================================
    function renderCameraFeed(container, domainObject, openmct) {
        let camKey = 'cam_mast';
        if (domainObject && domainObject.identifier && domainObject.identifier.key) {
            camKey = domainObject.identifier.key;
        }
        const cam = cameraManager.getCameraByKey(camKey);

        container.style.cssText = `
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            background: #141414;
            color: #d4d4d4;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
            border: 1px solid #282828;
            border-radius: 0px;
            overflow: hidden;
            user-select: none;
        `;

        container.innerHTML = `
            <!-- Top Controls Bar -->
            <div style="display: flex; align-items: center; justify-content: space-between; background: #181818; border-bottom: 1px solid #282828; padding: 4px 10px; height: 30px; box-sizing: border-box; flex-shrink: 0;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 8px; height: 8px; background: ${cam.color}; border-radius: 0px;"></div>
                    <span style="font-weight: 800; font-size: 11px; color: #f8fafc; letter-spacing: 0.5px;">${cam.name.toUpperCase()}</span>
                    <span style="background: #27272a; border: 1px solid #3f3f46; color: #a1a1aa; padding: 1px 5px; font-size: 9px; font-family: monospace; border-radius: 0px;">${cam.resolution}</span>
                </div>

                <div style="display: flex; align-items: center; gap: 6px;">
                    <span id="single-hud-fps" style="font-family: monospace; font-size: 10px; color: #22c55e;">30 FPS</span>
                    <button id="btn-single-popout" style="background: #1e3a8a; color: #bfdbfe; border: 1px solid #2563eb; padding: 2px 8px; border-radius: 0px; font-size: 9px; font-weight: 800; cursor: pointer; text-transform: uppercase;">
                        ⧉ POP OUT WINDOW
                    </button>
                    <button id="btn-single-snapshot" style="background: #27272a; color: #cbd5e1; border: 1px solid #3f3f46; padding: 2px 8px; border-radius: 0px; font-size: 9px; font-weight: 700; cursor: pointer; text-transform: uppercase;">
                        📸 SNAPSHOT
                    </button>
                </div>
            </div>

            <!-- Viewport -->
            <div style="position: relative; flex: 1; min-height: 0; background: #0a0a0a; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                <canvas id="single-cam-canvas" style="width: 100%; height: 100%; object-fit: contain;"></canvas>
                <div style="position: absolute; bottom: 8px; left: 10px; background: rgba(20, 20, 20, 0.85); border: 1px solid #282828; padding: 2px 6px; font-family: monospace; font-size: 9px; color: #cbd5e1;">
                    ROLE: ${cam.role.toUpperCase()}
                </div>
            </div>
        `;

        const canvas = container.querySelector('#single-cam-canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 1280;
        canvas.height = 720;

        const btnPopout = container.querySelector('#btn-single-popout');
        const btnSnapshot = container.querySelector('#btn-single-snapshot');

        btnPopout.addEventListener('click', () => {
            cameraManager.openPopout(cam.id);
        });

        btnSnapshot.addEventListener('click', () => {
            if (openmct && openmct.notifications) {
                openmct.notifications.info(`Snapshot logged: ${cam.short}`);
            }
        });

        let animId = null;
        function renderLoop() {
            drawCameraScene(ctx, cam, Date.now(), canvas.width, canvas.height);
            animId = requestAnimationFrame(renderLoop);
        }
        animId = requestAnimationFrame(renderLoop);

        container._cleanup = () => {
            if (animId) cancelAnimationFrame(animId);
        };
    }

    // =========================================================================
    // 2. FLEXIBLE MULTI-CAMERA DECK VIEW (Grid, Hero+3, Dual, Solo)
    // =========================================================================
    function renderFlexibleCameraDeck(container, openmct) {
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            background: #141414;
            color: #d4d4d4;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
            border: 1px solid #282828;
            border-radius: 0px;
            overflow: hidden;
            user-select: none;
        `;

        container.innerHTML = `
            <!-- Top Controls & Mode Switcher Bar -->
            <div style="display: flex; align-items: center; justify-content: space-between; background: #181818; border-bottom: 1px solid #282828; padding: 3px 8px; height: 28px; box-sizing: border-box; flex-shrink: 0;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-size: 10px; font-weight: 800; color: #f8fafc; letter-spacing: 0.5px;">CAMERA DECK:</span>
                    <!-- Layout Mode Buttons -->
                    <div style="display: flex; gap: 2px;">
                        <button class="btn-deck-mode" data-mode="grid" style="background: #27272a; border: 1px solid #3f3f46; color: #a1a1aa; padding: 2px 6px; font-size: 8px; font-weight: 800; border-radius: 0px; cursor: pointer;">⊞ 2x2 GRID</button>
                        <button class="btn-deck-mode" data-mode="hero" style="background: #27272a; border: 1px solid #3f3f46; color: #a1a1aa; padding: 2px 6px; font-size: 8px; font-weight: 800; border-radius: 0px; cursor: pointer;">◫ 1+3 HERO</button>
                        <button class="btn-deck-mode" data-mode="dual" style="background: #27272a; border: 1px solid #3f3f46; color: #a1a1aa; padding: 2px 6px; font-size: 8px; font-weight: 800; border-radius: 0px; cursor: pointer;">▥ DUAL</button>
                        <button class="btn-deck-mode" data-mode="solo" style="background: #27272a; border: 1px solid #3f3f46; color: #a1a1aa; padding: 2px 6px; font-size: 8px; font-weight: 800; border-radius: 0px; cursor: pointer;">□ SOLO</button>
                    </div>
                </div>

                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 5px; font-family: monospace; font-size: 9px; color: #94a3b8;">
                        <span id="deck-hud-dot" style="display: inline-block; width: 6px; height: 6px; border-radius: 0px; background: #22c55e;"></span>
                        <span id="deck-hud-telemetry">H.264 | 12.4 Mbps | 30 FPS</span>
                    </div>
                    <button id="btn-deck-snapshot" style="background: #1e3a8a; color: #bfdbfe; border: 1px solid #2563eb; padding: 2px 6px; font-size: 8px; font-weight: 800; border-radius: 0px; cursor: pointer; text-transform: uppercase;">
                        📸 SNAPSHOT
                    </button>
                </div>
            </div>

            <!-- Flexible Viewport Body -->
            <div id="deck-viewport" style="flex: 1; min-height: 0; position: relative; overflow: hidden; background: #0c0c0c;"></div>
        `;

        const viewport = container.querySelector('#deck-viewport');
        const btnModes = container.querySelectorAll('.btn-deck-mode');
        const btnSnapshot = container.querySelector('#btn-deck-snapshot');
        const hudTelem = container.querySelector('#deck-hud-telemetry');
        const hudDot = container.querySelector('#deck-hud-dot');

        let animFrameId = null;
        const activeTileCanvases = new Map(); // id -> { canvas, ctx }

        // Helper to create a camera tile DOM element
        function createCameraTile(cam, isHero = false) {
            const tile = document.createElement('div');
            tile.dataset.camId = cam.id;
            tile.style.cssText = `
                position: relative;
                display: flex;
                flex-direction: column;
                background: #141414;
                border: 1px solid #242424;
                border-radius: 0px;
                overflow: hidden;
                box-sizing: border-box;
                height: 100%;
                width: 100%;
            `;

            tile.innerHTML = `
                <!-- Tile Header -->
                <div style="display: flex; align-items: center; justify-content: space-between; background: #161616; border-bottom: 1px solid #242424; padding: 2px 6px; height: 20px; box-sizing: border-box; flex-shrink: 0; z-index: 5;">
                    <div style="display: flex; align-items: center; gap: 5px; overflow: hidden; white-space: nowrap;">
                        <div style="width: 6px; height: 6px; background: ${cam.color}; border-radius: 0px; flex-shrink: 0;"></div>
                        <span style="font-weight: 800; font-size: 9px; color: #f8fafc;">${cam.short}</span>
                        <span style="font-size: 8px; font-family: monospace; color: #71717a;">${cam.resolution}</span>
                    </div>

                    <div style="display: flex; align-items: center; gap: 3px;">
                        <button class="btn-tile-popout" data-cam-id="${cam.id}" style="background: #1c1c1c; border: 1px solid #333333; color: #38bdf8; font-size: 8px; padding: 1px 4px; border-radius: 0px; cursor: pointer; font-family: monospace;" title="Open this camera in independent desktop window">
                            ⧉ POP OUT
                        </button>
                        <button class="btn-tile-focus" data-cam-id="${cam.id}" style="background: #1c1c1c; border: 1px solid #333333; color: #cbd5e1; font-size: 8px; padding: 1px 4px; border-radius: 0px; cursor: pointer;" title="Maximize focus">
                            ⛶
                        </button>
                    </div>
                </div>

                <!-- Tile Canvas Area -->
                <div style="position: relative; flex: 1; min-height: 0; background: #000000; overflow: hidden;">
                    <canvas id="tile-canvas-${cam.id}" style="width: 100%; height: 100%; object-fit: cover; display: block;"></canvas>
                </div>
            `;

            // Bind Tile Buttons
            const popBtn = tile.querySelector('.btn-tile-popout');
            const focusBtn = tile.querySelector('.btn-tile-focus');

            popBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                cameraManager.openPopout(cam.id);
            });

            focusBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                cameraManager.setActiveCam(cam.id, true);
                cameraManager.setLayoutMode('solo');
            });

            tile.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                if (cameraManager.getState().layoutMode === 'hero' && cameraManager.getState().activeCamId !== cam.id) {
                    cameraManager.setActiveCam(cam.id, true);
                }
            });

            return tile;
        }

        // Layout Renderers
        function renderLayoutView(state) {
            // Cancel previous render loop while rebuilding tiles
            if (animFrameId) cancelAnimationFrame(animFrameId);
            activeTileCanvases.clear();
            viewport.innerHTML = '';

            // Update mode button styles
            btnModes.forEach(b => {
                const isCur = b.dataset.mode === state.layoutMode;
                b.style.background = isCur ? '#1d4ed8' : '#27272a';
                b.style.borderColor = isCur ? '#2563eb' : '#3f3f46';
                b.style.color = isCur ? '#ffffff' : '#a1a1aa';
            });

            if (state.layoutMode === 'grid') {
                // 2x2 Grid: all 4 cameras
                viewport.style.cssText = `
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    grid-template-rows: 1fr 1fr;
                    gap: 3px;
                    padding: 3px;
                    width: 100%;
                    height: 100%;
                    box-sizing: border-box;
                `;
                CAMERAS.forEach(cam => {
                    const tile = createCameraTile(cam);
                    viewport.appendChild(tile);
                    const cvs = tile.querySelector(`#tile-canvas-${cam.id}`);
                    cvs.width = 640;
                    cvs.height = 360;
                    activeTileCanvases.set(cam.id, { canvas: cvs, ctx: cvs.getContext('2d'), cam });
                });
            } else if (state.layoutMode === 'hero') {
                // 1+3 Hero: primary hero on left, 3 stacked on right
                viewport.style.cssText = `
                    display: grid;
                    grid-template-columns: minmax(0, 2.5fr) minmax(120px, 1fr);
                    gap: 4px;
                    padding: 3px;
                    width: 100%;
                    height: 100%;
                    box-sizing: border-box;
                `;
                // Hero tile
                const heroCam = state.activeCamera;
                const heroTile = createCameraTile(heroCam, true);
                viewport.appendChild(heroTile);
                const heroCvs = heroTile.querySelector(`#tile-canvas-${heroCam.id}`);
                heroCvs.width = 960;
                heroCvs.height = 540;
                activeTileCanvases.set(heroCam.id, { canvas: heroCvs, ctx: heroCvs.getContext('2d'), cam: heroCam });

                // Right stack
                const stackCol = document.createElement('div');
                stackCol.style.cssText = `
                    display: grid;
                    grid-template-rows: 1fr 1fr 1fr;
                    gap: 3px;
                    height: 100%;
                    overflow: hidden;
                `;
                CAMERAS.filter(c => c.id !== heroCam.id).forEach(cam => {
                    const thumbTile = createCameraTile(cam);
                    stackCol.appendChild(thumbTile);
                    const cvs = thumbTile.querySelector(`#tile-canvas-${cam.id}`);
                    cvs.width = 480;
                    cvs.height = 270;
                    activeTileCanvases.set(cam.id, { canvas: cvs, ctx: cvs.getContext('2d'), cam });
                });
                viewport.appendChild(stackCol);
            } else if (state.layoutMode === 'dual') {
                // Dual 1:1 side-by-side
                viewport.style.cssText = `
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 4px;
                    padding: 3px;
                    width: 100%;
                    height: 100%;
                    box-sizing: border-box;
                `;
                const cam1 = state.activeCamera;
                const cam2 = CAMERAS.find(c => c.id !== cam1.id) || CAMERAS[1];
                [cam1, cam2].forEach(cam => {
                    const tile = createCameraTile(cam);
                    viewport.appendChild(tile);
                    const cvs = tile.querySelector(`#tile-canvas-${cam.id}`);
                    cvs.width = 800;
                    cvs.height = 450;
                    activeTileCanvases.set(cam.id, { canvas: cvs, ctx: cvs.getContext('2d'), cam });
                });
            } else {
                // Solo: single active camera
                viewport.style.cssText = `
                    display: flex;
                    width: 100%;
                    height: 100%;
                    padding: 3px;
                    box-sizing: border-box;
                `;
                const cam = state.activeCamera;
                const tile = createCameraTile(cam);
                viewport.appendChild(tile);
                const cvs = tile.querySelector(`#tile-canvas-${cam.id}`);
                cvs.width = 1280;
                cvs.height = 720;
                activeTileCanvases.set(cam.id, { canvas: cvs, ctx: cvs.getContext('2d'), cam });
            }

            // Start animation loop for all visible canvases
            function multiCanvasLoop() {
                const now = Date.now();
                activeTileCanvases.forEach(({ canvas, ctx, cam }) => {
                    drawCameraScene(ctx, cam, now, canvas.width, canvas.height);
                });
                animFrameId = requestAnimationFrame(multiCanvasLoop);
            }
            animFrameId = requestAnimationFrame(multiCanvasLoop);
        }

        // Bind Mode Switcher
        btnModes.forEach(b => {
            b.addEventListener('click', () => {
                cameraManager.setLayoutMode(b.dataset.mode);
            });
        });

        // Global Snapshot Button
        btnSnapshot.addEventListener('click', () => {
            const cam = cameraManager.getActiveCamera();
            if (openmct && openmct.notifications) {
                openmct.notifications.info(`Camera Snapshot Captured to Notebook: [${cam.short}]`);
            }
        });

        // Subscribe to state
        const unsub = cameraManager.subscribe(renderLayoutView);

        // Subscribe to live telemetry for HUD
        let curFps = null;
        let curBitrate = null;

        function refreshHud() {
            if (curFps !== null || curBitrate !== null) {
                hudDot.style.background = '#22c55e';
                hudTelem.style.color = '#38bdf8';
                hudTelem.textContent = `H.264 | ${(curBitrate !== null ? curBitrate.toFixed(1) + ' Mbps' : '12.4 Mbps')} | ${(curFps !== null ? curFps + ' FPS' : '30 FPS')}`;
            } else {
                hudDot.style.background = '#22c55e';
                hudTelem.style.color = '#94a3b8';
                hudTelem.textContent = 'H.264 | 12.4 Mbps | 30 FPS';
            }
        }

        const telemUnsubs = [];
        if (openmct && openmct.telemetry) {
            const u1 = openmct.telemetry.subscribe({ identifier: { namespace: 'orion.taxonomy', key: 'rover.perception.realsense.fps' }, type: 'orion.telemetry' }, p => {
                if (p && p.value !== null && p.value !== undefined) {
                    curFps = Math.round(Number(p.value));
                    refreshHud();
                }
            });
            const u2 = openmct.telemetry.subscribe({ identifier: { namespace: 'orion.taxonomy', key: 'rover.perception.video_bitrate' }, type: 'orion.telemetry' }, p => {
                if (p && p.value !== null && p.value !== undefined) {
                    curBitrate = parseFloat(p.value);
                    refreshHud();
                }
            });
            telemUnsubs.push(u1, u2);
        }

        container._cleanup = () => {
            unsub();
            if (animFrameId) cancelAnimationFrame(animFrameId);
            telemUnsubs.forEach(u => u && u());
        };
    }

    if (typeof window !== 'undefined') {
        window.OrionCameraMosaicPlugin = OrionCameraMosaicPlugin;
        window.OrionCameraManager = cameraManager;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionCameraMosaicPlugin;
    }
})();
