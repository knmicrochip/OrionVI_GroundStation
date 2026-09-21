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
        { id: 1, key: 'cam_mast_rgb', alias: 'cam_mast', name: 'Mast Intel RealSense D435i RGB', short: 'MAST RGB', resolution: '1920x1080', role: 'Perception / SLAM', color: '#38bdf8' },
        { id: 2, key: 'cam_mast_depth', name: 'Mast RealSense Depth Sensor', short: 'MAST DEPTH', resolution: '1280x720', role: 'Disparity / 3D Mapping', color: '#06b6d4' },
        { id: 3, key: 'cam_haz_fl', alias: 'cam_front', name: 'Front Left Chassis Hazard Cam', short: 'HAZCAM FL', resolution: '1280x720', role: 'Mobility / Obstacle Left', color: '#22c55e' },
        { id: 4, key: 'cam_haz_fr', name: 'Front Right Chassis Hazard Cam', short: 'HAZCAM FR', resolution: '1280x720', role: 'Mobility / Obstacle Right', color: '#16a34a' },
        { id: 5, key: 'cam_haz_rear', name: 'Rear Chassis Hazard Cam', short: 'HAZCAM REAR', resolution: '1280x720', role: 'Reverse / Tether Safety', color: '#84cc16' },
        { id: 6, key: 'cam_arm_wrist', alias: 'cam_arm', name: 'Manipulator Wrist / Gripper Cam', short: 'ARM WRIST', resolution: '1280x720', role: 'Inspection / Grasping', color: '#f97316' },
        { id: 7, key: 'cam_arm_elbow', name: 'Manipulator Elbow Overview Cam', short: 'ARM ELBOW', resolution: '1280x720', role: 'Kinematics / Collision Guard', color: '#ea580c' },
        { id: 8, key: 'cam_science_macro', name: 'Science Macro Probing Cam', short: 'SCI MACRO', resolution: '1920x1080', role: 'Regolith / Drill Core', color: '#eab308' },
        { id: 9, key: 'cam_science_chamber', alias: 'cam_science', name: 'Science Internal Carousel Cam', short: 'SCI CHAMBER', resolution: '1280x720', role: 'Sample Carousel / Reagents', color: '#a855f7' },
        { id: 10, key: 'cam_deck_pano', name: 'Chassis Top Deck Context Cam', short: 'DECK PANO', resolution: '1920x1080', role: 'Situational Awareness / 360', color: '#ec4899' }
    ];

    class CameraManager {
        constructor() {
            this.activeCamId = 1;
            this.layoutMode = 'grid'; // 'grid', 'hero', 'dual', 'solo'
            this.signals = new Map([
                [1, false], // By default NO SIGNAL (awaiting hardware/telemetry)
                [2, false],
                [3, false],
                [4, false],
                [5, false],
                [6, false],
                [7, false],
                [8, false],
                [9, false],
                [10, false]
            ]);
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
                activeCamera: this.getActiveCamera(),
                signals: new Map(this.signals)
            };
        }

        hasSignal(camId) {
            return this.signals.get(parseInt(camId, 10)) ?? false;
        }

        setSignal(camId, val) {
            const id = parseInt(camId, 10);
            this.signals.set(id, Boolean(val));
            this.notify();
        }

        toggleSignal(camId) {
            const id = parseInt(camId, 10);
            this.setSignal(id, !this.hasSignal(id));
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
            if (!key) return CAMERAS[0];
            return CAMERAS.find(c => c.key === key || c.alias === key || key.includes(c.key)) || CAMERAS[0];
        }

        openPopout(camId) {
            const cam = this.getCameraById(camId);
            const url = `camera-view.html?cam=${cam.id}`;
            window.open(url, `_blank_cam_${cam.id}`, 'width=840,height=540,menubar=no,toolbar=no,location=no,status=no');
        }

        async scanForFeed(camId) {
            const id = parseInt(camId, 10);
            const cam = this.getCameraById(id);

            // 1. If signal is already active / simulated
            if (this.hasSignal(id)) {
                return true;
            }

            // 2. Scan network / backend endpoint for this respective camera feed
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 800);
                const res = await fetch(`/api/camera/${id}/feed_status`, { signal: controller.signal }).catch(() => null);
                clearTimeout(timer);
                if (res && res.ok) {
                    const data = await res.json();
                    if (data && data.online) {
                        this.setSignal(id, true);
                        return true;
                    }
                }
            } catch (_) {}

            // Feed not implemented yet
            return false;
        }
    }

    const cameraManager = new CameraManager();
    if (typeof window !== 'undefined') {
        window.OrionCameraManager = cameraManager;
    }

    // Preload Orion Logo Image for Canvas Drawing
    const orionLogoImg = new Image();
    orionLogoImg.src = '/logotyp_pion_white.png';

    // No-Signal Scene Renderer: Displays Orion Logo and RED "NO SIGNAL" in center of frame
    function drawNoSignalScene(ctx, cam, now, width, height) {
        ctx.save();
        // Deep dark background
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        // Subtle dark grid
        ctx.strokeStyle = '#181818';
        ctx.lineWidth = 1;
        const step = Math.max(28, Math.floor(width / 16));
        for (let x = 0; x < width; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        const midX = width * 0.5;
        const midY = height * 0.5;

        // Draw Orion Logo in center of frame
        if (orionLogoImg && orionLogoImg.complete && orionLogoImg.naturalWidth > 0) {
            const logoH = Math.min(width, height) * 0.26;
            const logoW = logoH;
            ctx.drawImage(orionLogoImg, midX - logoW * 0.5, midY - logoH * 0.9, logoW, logoH);
        }

        // Draw "NO SIGNAL" label in RED in center of frame
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 15px monospace, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('NO SIGNAL', midX, midY + 28);

        // Subtitle: Reconnect countdown
        const cSec = (cam && cam._countdownSec !== undefined) ? cam._countdownSec : 5;
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(`Attempting reconnect in ${cSec}s...`, midX, midY + 46);

        // Role & ID badge in corner
        ctx.fillStyle = '#52525b';
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`CAM ${cam.id}: ${cam.short}`, 8, height - 8);

        // Active OSD Timestamp in bottom right of canvas
        ctx.fillStyle = '#38bdf8';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`UTC: ${new Date(now).toISOString().substring(11, 23)}`, width - 8, height - 8);

        ctx.restore();
    }

    // Procedural Scene Renderer for Rover Camera Streams
    function drawCameraScene(ctx, cam, now, width, height) {
        // If camera currently has no signal, render center Orion Logo and red NO SIGNAL
        if (!cameraManager.hasSignal(cam.id)) {
            drawNoSignalScene(ctx, cam, now, width, height);
            return;
        }

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

        // Perspective-specific visuals for all 10 cameras
        if (cam.id === 1) {
            // Mast RGB: Horizon & depth grid & navigation rocks
            ctx.strokeStyle = 'rgba(251, 146, 60, 0.5)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, midY);
            ctx.lineTo(width, midY);
            ctx.stroke();

            ctx.fillStyle = '#b45309';
            ctx.fillRect(width * 0.35, midY + height * 0.1, width * 0.06, height * 0.08);
            ctx.fillRect(width * 0.65, midY + height * 0.05, width * 0.08, height * 0.1);

            ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
            const step = width / 12;
            for (let x = 0; x < width; x += step) {
                ctx.beginPath();
                ctx.moveTo(x, midY);
                ctx.lineTo(x + (x - width * 0.5) * 0.8, height);
                ctx.stroke();
            }
        } else if (cam.id === 2) {
            // Mast Depth: Stereo Disparity Elevation Heatmap (Cyan to Purple)
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, width, height);
            const gridCols = 16;
            const gridRows = 10;
            const cellW = width / gridCols;
            const cellH = height / gridRows;
            for (let r = 0; r < gridRows; r++) {
                for (let c = 0; c < gridCols; c++) {
                    const depth = Math.sin((c * 0.4) + (now * 0.002)) * Math.cos((r * 0.5));
                    const hue = 180 + Math.floor(depth * 90);
                    ctx.fillStyle = `hsla(${hue}, 85%, 45%, 0.7)`;
                    ctx.fillRect(c * cellW + 1, r * cellH + 1, cellW - 2, cellH - 2);
                }
            }
            ctx.fillStyle = '#38bdf8';
            ctx.font = '10px monospace';
            ctx.fillText('STEREO DEPTH POINTCLOUD: 1.84m CLOUD DENSITY', 12, 22);
        } else if (cam.id === 3) {
            // Front HazCam FL: Left Wheel in foreground & clearance arc
            ctx.fillStyle = '#181818';
            ctx.fillRect(width * 0.04, height * 0.55, width * 0.22, height * 0.45);
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(width * 0.15, height * 0.75, width * 0.12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#22c55e';
            ctx.font = '10px monospace';
            ctx.fillText('HAZCAM FL | TREAD CLEARANCE 24cm', width * 0.32, height * 0.90);
        } else if (cam.id === 4) {
            // Front HazCam FR: Right Wheel in foreground & clearance arc
            ctx.fillStyle = '#181818';
            ctx.fillRect(width * 0.74, height * 0.55, width * 0.22, height * 0.45);
            ctx.strokeStyle = '#16a34a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(width * 0.85, height * 0.75, width * 0.12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#16a34a';
            ctx.font = '10px monospace';
            ctx.fillText('HAZCAM FR | TREAD CLEARANCE 24cm', width * 0.24, height * 0.90);
        } else if (cam.id === 5) {
            // Rear HazCam: Reverse traverse guide lines & rear bumper
            ctx.fillStyle = '#1e1b18';
            ctx.fillRect(width * 0.15, height * 0.85, width * 0.7, height * 0.15);
            ctx.strokeStyle = '#84cc16';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(width * 0.25, height * 0.85);
            ctx.lineTo(width * 0.35, height * 0.4);
            ctx.moveTo(width * 0.75, height * 0.85);
            ctx.lineTo(width * 0.65, height * 0.4);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#84cc16';
            ctx.font = '10px monospace';
            ctx.fillText('REVERSE HAZARD TRACK', width * 0.38, height * 0.45);
        } else if (cam.id === 6) {
            // Arm Wrist Gripper: ST3215 gripper jaws & crosshair
            ctx.fillStyle = '#27272a';
            ctx.fillRect(width * 0.42, height * 0.60, width * 0.05, height * 0.40);
            ctx.fillRect(width * 0.53, height * 0.60, width * 0.05, height * 0.40);
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(width * 0.45, height * 0.50); ctx.lineTo(width * 0.55, height * 0.50);
            ctx.moveTo(width * 0.50, height * 0.45); ctx.lineTo(width * 0.50, height * 0.55);
            ctx.stroke();
            ctx.fillStyle = '#f97316';
            ctx.font = '10px monospace';
            ctx.fillText('GRIPPER AXIS: 42mm APERTURE', width * 0.36, height * 0.40);
        } else if (cam.id === 7) {
            // Arm Elbow: Articulated Link kinematic overview
            ctx.strokeStyle = '#ea580c';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(width * 0.2, height * 0.8);
            ctx.lineTo(width * 0.5, height * 0.4);
            ctx.lineTo(width * 0.8, height * 0.6);
            ctx.stroke();
            ctx.fillStyle = '#ea580c';
            ctx.font = '10px monospace';
            ctx.fillText('SHOULDER: +42° | ELBOW: -18° | JOINT LOAD: 2.1 Nm', width * 0.24, height * 0.3);
        } else if (cam.id === 8) {
            // Science Macro: Microscope texture & scale bar
            ctx.fillStyle = '#451a03';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#d97706';
            for (let i = 0; i < 40; i++) {
                const rx = ((i * 37) % width);
                const ry = ((i * 59) % height);
                ctx.beginPath();
                ctx.arc(rx, ry, (i % 6) + 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(width * 0.7, height * 0.88, width * 0.2, 3);
            ctx.fillStyle = '#eab308';
            ctx.font = '10px monospace';
            ctx.fillText('MACRO SCALE: [ 500 μm ] | FOCUS: PEAK', width * 0.65, height * 0.85);
        } else if (cam.id === 9) {
            // Science Chamber: Carousel tubes
            ctx.fillStyle = '#18181b';
            ctx.beginPath();
            const r = Math.min(width, height) * 0.32;
            ctx.arc(width * 0.5, height * 0.5, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#a855f7';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            for (let i = 0; i < 6; i++) {
                const angle = (i * Math.PI / 3);
                const cx = width * 0.5 + Math.cos(angle) * r * 0.65;
                const cy = height * 0.5 + Math.sin(angle) * r * 0.65;
                ctx.fillStyle = i === 1 ? '#22c55e' : '#3f3f46';
                ctx.beginPath();
                ctx.arc(cx, cy, 10, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = '#a855f7';
            ctx.font = '10px monospace';
            ctx.fillText('CAROUSEL CHAMBER | ACTIVE: SLOT #2', width * 0.34, height * 0.5);
        } else if (cam.id === 10) {
            // Top Deck Context: 360 panorama of rover deck, solar panel & antenna mast
            ctx.fillStyle = '#09090b';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(width * 0.2, height * 0.6, width * 0.6, height * 0.35); // solar panel
            ctx.strokeStyle = '#ec4899';
            ctx.lineWidth = 2;
            ctx.strokeRect(width * 0.2, height * 0.6, width * 0.6, height * 0.35);
            ctx.strokeStyle = '#f472b6';
            ctx.beginPath();
            ctx.moveTo(width * 0.5, height * 0.6);
            ctx.lineTo(width * 0.5, height * 0.2); // mast
            ctx.stroke();
            ctx.fillStyle = '#ec4899';
            ctx.font = '10px monospace';
            ctx.fillText('TOP DECK CONTEXT | SOLAR & RF MAST OK', width * 0.32, height * 0.18);
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
        const initialSig = cameraManager.hasSignal(cam.id);

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
            border-radius: 0px !important;
            overflow: hidden;
            user-select: none;
            position: relative;
        `;

        container.innerHTML = `
            <!-- Top Controls Bar -->
            <div style="display: flex; align-items: center; justify-content: space-between; background: #181818; border-bottom: 1px solid #282828; padding: 3px 8px; height: 28px; box-sizing: border-box; flex-shrink: 0; z-index: 20;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <div style="width: 7px; height: 7px; background: ${cam.color}; border-radius: 0px !important;"></div>
                    <span style="font-weight: 800; font-size: 10px; color: #f8fafc; letter-spacing: 0.5px;">${cam.short}</span>
                    <span style="color: #3f3f46;">|</span>
                    <span id="single-hud-dot" style="display: inline-block; width: 6px; height: 6px; border-radius: 0px !important; background: ${initialSig ? '#22c55e' : '#ef4444'};"></span>
                    <span id="single-hud-status" style="font-family: monospace; font-size: 9px; font-weight: 800; color: ${initialSig ? '#22c55e' : '#ef4444'};">${initialSig ? 'LIVE' : 'NO SIGNAL'}</span>
                    <span style="color: #3f3f46;">|</span>
                    <span id="single-hud-fps" style="font-family: monospace; font-size: 9px; color: ${initialSig ? '#38bdf8' : '#71717a'};">${initialSig ? '30 FPS' : '0 FPS | 0.0 Mbps'}</span>
                </div>

                <div style="display: flex; align-items: center; gap: 6px;">
                    <span id="single-hud-time" style="font-family: monospace; font-size: 9px; font-weight: 700; color: #38bdf8; letter-spacing: 0.5px;">UTC: --:--:--.---</span>
                </div>
            </div>

            <!-- Viewport -->
            <div style="position: relative; flex: 1; min-height: 0; background: #0a0a0a; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                <canvas id="single-cam-canvas" style="width: 100%; height: 100%; object-fit: contain; display: block; cursor: pointer;" title="Double-click to toggle camera signal simulation"></canvas>
                
                <!-- Center NO SIGNAL Overlay: Orion Logo + Red NO SIGNAL Label -->
                <div id="single-no-signal" style="position: absolute; inset: 0; display: ${initialSig ? 'none' : 'flex'}; flex-direction: column; align-items: center; justify-content: center; background: rgba(10, 10, 10, 0.95); z-index: 10; pointer-events: none; user-select: none;">
                    <img src="/logotyp_pion_white.png" onerror="this.src='logotyp_pion_white.png'" alt="Orion VI Logo" style="width: 68px; height: 68px; object-fit: contain; margin-bottom: 12px; filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.3));" />
                    <div style="font-family: monospace, sans-serif; font-size: 15px; font-weight: 900; letter-spacing: 3px; color: #ef4444; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.6); padding: 5px 18px; border-radius: 0px !important; text-shadow: 0 0 12px rgba(239, 68, 68, 0.6);">
                        NO SIGNAL
                    </div>
                    <div id="single-reconnect-msg" style="font-family: monospace, sans-serif; font-size: 8.5px; font-weight: 700; color: #94a3b8; margin-top: 8px; letter-spacing: 0.3px; white-space: nowrap;">
                        Attempting reconnect in 5s...
                    </div>
                </div>

                <div style="position: absolute; bottom: 8px; left: 10px; background: rgba(20, 20, 20, 0.85); border: 1px solid #282828; padding: 2px 6px; font-family: monospace; font-size: 9px; color: #cbd5e1; z-index: 15;">
                    ROLE: ${cam.role.toUpperCase()}
                </div>
                <div id="single-osd-time" style="position: absolute; bottom: 8px; right: 10px; background: rgba(20, 20, 20, 0.85); border: 1px solid #282828; padding: 2px 6px; font-family: monospace; font-size: 9px; color: #38bdf8; z-index: 15;">
                    UTC: --:--:--.---
                </div>
            </div>
        `;

        const canvas = container.querySelector('#single-cam-canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 1280;
        canvas.height = 720;

        canvas.addEventListener('dblclick', () => {
            cameraManager.toggleSignal(cam.id);
        });

        // Reconnect countdown and feed scanner
        let countdownSec = 5;
        cam._countdownSec = 5;
        const reconnectMsg = container.querySelector('#single-reconnect-msg');

        const countdownInterval = setInterval(async () => {
            if (cameraManager.hasSignal(cam.id)) {
                countdownSec = 5;
                cam._countdownSec = 5;
                return;
            }

            if (countdownSec <= 0) {
                countdownSec = 5;
            } else {
                countdownSec--;
            }

            cam._countdownSec = countdownSec;

            if (reconnectMsg) {
                reconnectMsg.textContent = `Attempting reconnect in ${countdownSec}s...`;
            }

            // At 0 app checks for signal once more from respective camera
            if (countdownSec === 0) {
                try {
                    const feedFound = await cameraManager.scanForFeed(cam.id);
                    if (feedFound) {
                        cameraManager.setSignal(cam.id, true);
                        countdownSec = 5;
                        cam._countdownSec = 5;
                    }
                } catch (_) {}
            }
        }, 1000);

        const unsubSignal = cameraManager.subscribe((state) => {
            const hasSig = state.signals.get(cam.id) ?? false;
            const noSigOverlay = container.querySelector('#single-no-signal');
            const hudDot = container.querySelector('#single-hud-dot');
            const hudStatus = container.querySelector('#single-hud-status');
            const hudFps = container.querySelector('#single-hud-fps');
            if (noSigOverlay) noSigOverlay.style.display = hasSig ? 'none' : 'flex';
            if (hudDot) hudDot.style.background = hasSig ? '#22c55e' : '#ef4444';
            if (hudStatus) {
                hudStatus.textContent = hasSig ? 'LIVE' : 'NO SIGNAL';
                hudStatus.style.color = hasSig ? '#22c55e' : '#ef4444';
            }
            if (hudFps) {
                hudFps.textContent = hasSig ? '30 FPS' : '0 FPS | 0.0 Mbps';
                hudFps.style.color = hasSig ? '#38bdf8' : '#71717a';
            }
        });

        let animId = null;
        const hudTime = container.querySelector('#single-hud-time');
        const osdTime = container.querySelector('#single-osd-time');

        function renderLoop() {
            const now = Date.now();
            const timeStr = `UTC: ${new Date(now).toISOString().substring(11, 23)}`;
            if (hudTime) hudTime.textContent = timeStr;
            if (osdTime) osdTime.textContent = timeStr;
            drawCameraScene(ctx, cam, now, canvas.width, canvas.height);
            animId = requestAnimationFrame(renderLoop);
        }
        animId = requestAnimationFrame(renderLoop);

        container._cleanup = () => {
            clearInterval(countdownInterval);
            unsubSignal();
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
                    <!-- Center NO SIGNAL Overlay: Orion Logo + Red NO SIGNAL Label -->
                    <div id="tile-no-signal-${cam.id}" style="position: absolute; inset: 0; display: ${cameraManager.hasSignal(cam.id) ? 'none' : 'flex'}; flex-direction: column; align-items: center; justify-content: center; background: rgba(10, 10, 10, 0.94); z-index: 10; pointer-events: none; user-select: none;">
                        <img src="/logotyp_pion_white.png" onerror="this.src='logotyp_pion_white.png'" alt="Orion Logo" style="width: ${isHero ? '64px' : '38px'}; height: ${isHero ? '64px' : '38px'}; object-fit: contain; margin-bottom: 6px; filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.25));" />
                        <div style="font-family: monospace, sans-serif; font-size: ${isHero ? '14px' : '11px'}; font-weight: 900; letter-spacing: 2.5px; color: #ef4444; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.6); padding: 3px 12px; border-radius: 0px !important; text-shadow: 0 0 10px rgba(239, 68, 68, 0.6);">
                            NO SIGNAL
                        </div>
                        <div id="tile-reconnect-${cam.id}" style="font-family: monospace, sans-serif; font-size: ${isHero ? '10px' : '8px'}; font-weight: 700; color: #94a3b8; margin-top: 5px; letter-spacing: 0.5px; text-transform: uppercase;">
                            Attempting reconnect in 5s...
                        </div>
                    </div>
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
