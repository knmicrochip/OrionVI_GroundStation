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
    function getCamerasList() {
        if (typeof window !== 'undefined' && window.OrionCameraConfig) {
            return window.OrionCameraConfig.getAllCameras();
        }
        return [
            { id: 1, key: 'cam_axis_1', alias: 'cam_mast_rgb', name: 'AXIS 1', short: 'AXIS 1', resolution: '1280x720', role: 'Camera 1', color: '#38bdf8', isAxis: true, axisChannel: 1 },
            { id: 2, key: 'cam_axis_2', alias: 'cam_mast_depth', name: 'AXIS 2', short: 'AXIS 2', resolution: '1280x720', role: 'Camera 2', color: '#06b6d4', isAxis: true, axisChannel: 2 },
            { id: 3, key: 'cam_axis_3', alias: 'cam_haz_fl', name: 'AXIS 3', short: 'AXIS 3', resolution: '1280x720', role: 'Camera 3', color: '#22c55e', isAxis: true, axisChannel: 3 },
            { id: 4, key: 'cam_axis_4', alias: 'cam_haz_fr', name: 'AXIS 4', short: 'AXIS 4', resolution: '1280x720', role: 'Camera 4', color: '#f59e0b', isAxis: true, axisChannel: 4 },
            { id: 5, key: 'cam_laptop_test', alias: 'cam_test', name: 'Laptop Webcam', short: 'LAPTOP CAM', resolution: '1280x720', role: 'Operator Test Feed / Webcam', color: '#10b981', isTestCam: true },
            { id: 6, key: 'cam_usb_test', alias: 'cam_usb', name: 'USB Camera', short: 'USB CAM', resolution: '1280x720', role: 'Operator Test Feed / USB', color: '#06b6d4', isTestCam: true }
        ];
    }
    const CAMERAS = getCamerasList();

    // =========================================================================
    // WEBCAM & USB CAMERA HARDWARE STREAM SERVICE (HTML5 getUserMedia Singleton)
    // =========================================================================
    // Helper functions to accurately identify camera hardware types without confusion
    function isUsbCamera(device) {
        if (!device) return false;
        const label = (device.label || '').toLowerCase();
        return /usb|logi|c270|c920|c922|c310|brio|streamcam|meet|external|uvc|camlink|capture|plug|obs/i.test(label);
    }

    function isLaptopCamera(device) {
        if (!device) return false;
        const label = (device.label || '').toLowerCase();
        if (isUsbCamera(device)) return false;
        return /integrated|internal|built-in|builtin|facetime|embedded/i.test(label) ||
               (/front|laptop/i.test(label) && !/usb|external|logi/i.test(label));
    }

    // Helper to query and resolve camera devices into distinct laptop and USB devices
    async function enumerateCameraDevices() {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            return { laptopDevice: null, usbDevice: null };
        }
        try {
            let devices = await navigator.mediaDevices.enumerateDevices();
            let videoInputs = devices.filter(d => d.kind === 'videoinput');

            // If labels are empty (happens before initial getUserMedia), probe briefly
            if (videoInputs.length > 0 && videoInputs.some(d => !d.label)) {
                try {
                    const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                    probe.getTracks().forEach(t => { try { t.stop(); } catch(_) {} });
                    devices = await navigator.mediaDevices.enumerateDevices();
                    videoInputs = devices.filter(d => d.kind === 'videoinput');
                } catch (_) {}
            }

            if (videoInputs.length === 0) {
                return { laptopDevice: null, usbDevice: null };
            }

            // Identify laptop candidates and USB candidates
            let laptop = videoInputs.find(d => isLaptopCamera(d)) || null;
            let usb = videoInputs.find(d => isUsbCamera(d)) || null;

            // If only one device is connected:
            if (videoInputs.length === 1) {
                const single = videoInputs[0];
                if (isUsbCamera(single)) {
                    return { laptopDevice: null, usbDevice: single };
                } else if (isLaptopCamera(single)) {
                    return { laptopDevice: single, usbDevice: null };
                } else {
                    return { laptopDevice: single, usbDevice: null };
                }
            }

            // If multiple devices are connected:
            if (!laptop && usb) {
                laptop = videoInputs.find(d => d.deviceId !== usb.deviceId) || null;
            } else if (laptop && !usb) {
                usb = videoInputs.find(d => d.deviceId !== laptop.deviceId) || null;
            } else if (!laptop && !usb && videoInputs.length >= 2) {
                laptop = videoInputs[0];
                usb = videoInputs[1];
            }

            // STRICT SAFETY INVARIANT: laptop and usb MUST NEVER be the same device!
            if (laptop && usb && laptop.deviceId === usb.deviceId) {
                usb = null;
            }

            return {
                laptopDevice: laptop || null,
                usbDevice: usb || null
            };
        } catch (e) {
            console.warn('[Camera Devices] Enumeration error:', e);
            return { laptopDevice: null, usbDevice: null };
        }
    }

    class DeviceVideoStreamService {
        constructor(deviceType = 'laptop') {
            this.deviceType = deviceType; // 'laptop' or 'usb'
            this.stream = null;
            this.video = null;
            this.isActive = false;
            this.isStarting = false;
            this.error = null;
            this.deviceId = null;
            this.deviceName = deviceType === 'usb' ? 'USB Camera' : 'Laptop Webcam';
            this.listeners = new Set();
        }

        hasLiveTrack() {
            if (!this.stream) return false;
            const tracks = this.stream.getVideoTracks();
            if (!tracks || tracks.length === 0) return false;
            return tracks.some(t => t.readyState === 'live' && t.enabled);
        }

        handleDisconnected() {
            console.warn(`[DeviceVideoStreamService:${this.deviceType}] Hardware disconnected or track ended`);
            this.stop();
            this.error = `${this.deviceName} disconnected`;
            if (window.OrionCameraManager) {
                const id = (this.deviceType === 'usb') ? 12 : 11;
                window.OrionCameraManager.setSignal(id, false);
            }
            this.notify();
        }

        subscribe(cb) {
            this.listeners.add(cb);
            cb({ isActive: this.isActive, error: this.error, deviceName: this.deviceName });
            return () => this.listeners.delete(cb);
        }

        notify() {
            const state = { isActive: this.isActive, error: this.error, deviceName: this.deviceName };
            this.listeners.forEach(cb => {
                try { cb(state); } catch (_) {}
            });
        }

        async start() {
            if (this.isActive && this.video && this.video.readyState >= 2 && this.hasLiveTrack()) return true;
            if (this.isStarting) return false;
            this.isStarting = true;
            this.error = null;

            try {
                if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error('Webcam mediaDevices API not available');
                }

                const { laptopDevice, usbDevice } = await enumerateCameraDevices();
                const targetDevice = (this.deviceType === 'usb') ? usbDevice : laptopDevice;

                if (!targetDevice || !targetDevice.deviceId) {
                    if (this.deviceType === 'usb') {
                        throw new Error('External USB camera not detected (connect USB camera)');
                    } else {
                        throw new Error('Laptop built-in webcam not detected');
                    }
                }

                // If currently running on another stream, stop first
                if (this.stream) {
                    this.stream.getTracks().forEach(t => { try { t.stop(); } catch(_) {} });
                    this.stream = null;
                }

                // STRICT CONSTRAINT: Require the EXACT target deviceId. Never fall back to another camera.
                const constraints = {
                    video: {
                        deviceId: { exact: targetDevice.deviceId },
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    },
                    audio: false
                };

                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                this.stream = stream;
                this.deviceId = targetDevice.deviceId;

                const track = stream.getVideoTracks()[0];
                if (track) {
                    if (track.label) this.deviceName = track.label;
                    const onTrackEnded = () => {
                        console.warn(`[DeviceVideoStreamService:${this.deviceType}] Video track ended (disconnected)`);
                        this.handleDisconnected();
                    };
                    track.onended = onTrackEnded;
                    track.addEventListener('ended', onTrackEnded);
                } else if (targetDevice.label) {
                    this.deviceName = targetDevice.label;
                }

                const video = document.createElement('video');
                video.setAttribute('playsinline', 'true');
                video.setAttribute('autoplay', 'true');
                video.muted = true;
                video.srcObject = stream;

                await new Promise((resolve) => {
                    let done = false;
                    const finish = () => {
                        if (!done) {
                            done = true;
                            resolve();
                        }
                    };
                    video.onloadedmetadata = () => {
                        video.play().then(finish).catch(finish);
                    };
                    setTimeout(finish, 1200);
                });

                this.video = video;
                this.isActive = true;
                this.isStarting = false;
                this.error = null;
                this.notify();
                return true;
            } catch (err) {
                console.warn(`[DeviceVideoStreamService:${this.deviceType}] Camera unavailable:`, err.message || err);
                this.error = err.message || 'Camera hardware unavailable';
                this.isActive = false;
                this.isStarting = false;
                if (this.stream) {
                    this.stream.getTracks().forEach(t => { try { t.stop(); } catch(_) {} });
                    this.stream = null;
                }
                this.video = null;
                this.notify();
                return false;
            }
        }

        stop() {
            if (this.stream) {
                this.stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
                this.stream = null;
            }
            if (this.video) {
                try {
                    this.video.pause();
                    this.video.srcObject = null;
                } catch (_) {}
                this.video = null;
            }
            this.isActive = false;
            this.deviceId = null;
            this.notify();
        }

        async toggle() {
            if (this.isActive) {
                this.stop();
                return false;
            } else {
                return await this.start();
            }
        }
    }

    const laptopWebcamService = new DeviceVideoStreamService('laptop');
    const usbCamService = new DeviceVideoStreamService('usb');
    const webcamService = laptopWebcamService; // Backward compatibility

    if (typeof window !== 'undefined') {
        window.OrionWebcamService = laptopWebcamService;
        window.OrionUsbCamService = usbCamService;
    }

    // =========================================================================
    // AXIS IP CAMERA HARDWARE STREAM CLIENT (Connects to /api/camera/axis/:id/stream)
    // =========================================================================
    class AxisCameraStreamService {
        constructor(channelId) {
            this.channelId = channelId;
            this.isActive = false;
            this.img = null;
            this.listeners = new Set();
            this.lastFrameTime = 0;
            this.error = null;
            this._initStream();
        }

        _initStream() {
            if (typeof Image === 'undefined') return;
            const img = new Image();
            img.crossOrigin = 'anonymous';

            img.onload = () => {
                this.isActive = true;
                this.lastFrameTime = Date.now();
                this.error = null;
                if (window.OrionCameraManager) {
                    window.OrionCameraManager.setSignal(this.channelId, true);
                }
                this.notify();
            };

            img.onerror = () => {
                this.isActive = false;
                this.error = `AXIS ${this.channelId} Offline`;
                if (window.OrionCameraManager) {
                    window.OrionCameraManager.setSignal(this.channelId, false);
                }
                this.notify();
            };

            img.src = `/api/camera/axis/${this.channelId}/stream`;
            this.img = img;
        }

        reconnect() {
            if (this.img) {
                this.img.src = `/api/camera/axis/${this.channelId}/stream?t=` + Date.now();
            } else {
                this._initStream();
            }
        }

        hasLiveFrame() {
            return Boolean(this.isActive && this.img && this.img.complete && this.img.naturalWidth > 0);
        }

        subscribe(cb) {
            this.listeners.add(cb);
            cb({ isActive: this.isActive, error: this.error });
            return () => this.listeners.delete(cb);
        }

        notify() {
            const state = { isActive: this.isActive, error: this.error };
            this.listeners.forEach(cb => {
                try { cb(state); } catch (_) {}
            });
        }
    }

    const axisStreams = new Map([
        [1, new AxisCameraStreamService(1)],
        [2, new AxisCameraStreamService(2)],
        [3, new AxisCameraStreamService(3)],
        [4, new AxisCameraStreamService(4)]
    ]);

    // Auto-listen to hardware connect / disconnect events
    if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', async () => {
            console.log('[Camera Hardware] USB/Webcam device change detected!');
            const { laptopDevice, usbDevice } = await enumerateCameraDevices();

            // USB Camera
            if (usbDevice) {
                if (!usbCamService.isActive || !usbCamService.hasLiveTrack()) {
                    console.log('[Camera Hardware] USB Camera attached. Starting stream...');
                    const ok = await usbCamService.start();
                    if (window.OrionCameraManager) {
                        window.OrionCameraManager.setSignal(6, ok);
                        window.OrionCameraManager.setSignal(12, ok);
                    }
                }
            } else {
                if (usbCamService.isActive) {
                    console.warn('[Camera Hardware] USB Camera detached.');
                    usbCamService.handleDisconnected();
                }
            }

            // Laptop Webcam
            if (laptopDevice) {
                if (!laptopWebcamService.isActive || !laptopWebcamService.hasLiveTrack()) {
                    console.log('[Camera Hardware] Laptop Webcam attached. Starting stream...');
                    const ok = await laptopWebcamService.start();
                    if (window.OrionCameraManager) {
                        window.OrionCameraManager.setSignal(5, ok);
                        window.OrionCameraManager.setSignal(11, ok);
                    }
                }
            } else {
                if (laptopWebcamService.isActive) {
                    console.warn('[Camera Hardware] Laptop Webcam detached.');
                    laptopWebcamService.handleDisconnected();
                }
            }
        });
    }

    class CameraManager {
        constructor() {
            this.activeCamId = 1;
            this.layoutMode = 'grid'; // 'grid', 'hero', 'dual', 'solo'
            this.streamVideos = new Map();
            this.signals = new Map([
                [1, false],
                [2, false],
                [3, false],
                [4, false],
                [5, false],
                [6, false],
                [11, false],
                [12, false]
            ]);
            this.countdowns = new Map();
            const cams = getCamerasList();
            cams.forEach(c => {
                this.countdowns.set(c.id, 5);
                c._countdownSec = 5;
            });
            this.listeners = new Set();
            this._startHeartbeat();

            // Auto-detect & synchronize hardware services with boolean active state
            laptopWebcamService.subscribe(state => {
                this.setSignal(5, state.isActive);
                this.setSignal(11, state.isActive);
            });
            usbCamService.subscribe(state => {
                this.setSignal(6, state.isActive);
                this.setSignal(12, state.isActive);
            });
        }

        _startHeartbeat() {
            setInterval(async () => {
                // Heartbeat liveness checks for hardware streams
                if (laptopWebcamService.isActive && !laptopWebcamService.hasLiveTrack()) {
                    console.warn('[CameraManager] Laptop webcam track ended in heartbeat check');
                    laptopWebcamService.handleDisconnected();
                }
                if (usbCamService.isActive && !usbCamService.hasLiveTrack()) {
                    console.warn('[CameraManager] USB camera track ended in heartbeat check');
                    usbCamService.handleDisconnected();
                }

                const cams = getCamerasList();
                for (const cam of cams) {
                    const id = cam.id;
                    const hasSig = this.hasSignal(id);
                    if (hasSig) {
                        this.countdowns.set(id, 5);
                        cam._countdownSec = 5;
                        continue;
                    }

                    let cur = this.countdowns.get(id) ?? 5;
                    if (cur <= 0) {
                        cur = 5;
                    } else {
                        cur--;
                    }
                    this.countdowns.set(id, cur);
                    cam._countdownSec = cur;

                    // Update DOM labels across all views (single view, deck tiles, etc.)
                    const recEls = document.querySelectorAll(`[data-reconnect-cam="${id}"], #tile-reconnect-${id}, #single-reconnect-${id}`);
                    recEls.forEach(el => {
                        el.textContent = `Attempting reconnect in ${cur}s...`;
                    });

                    // On countdown expiration, actively restart connection attempts
                    if (cur === 0) {
                        this._attemptReconnect(id);
                    }
                }
            }, 1000);
        }

        async _attemptReconnect(id) {
            try {
                if (id === 5 || id === 11) {
                    const ok = await laptopWebcamService.start();
                    this.setSignal(5, ok);
                    this.setSignal(11, ok);
                } else if (id === 6 || id === 12) {
                    const ok = await usbCamService.start();
                    this.setSignal(6, ok);
                    this.setSignal(12, ok);
                } else if (id >= 1 && id <= 4) {
                    const found = await this.scanForFeed(id);
                    this.setSignal(id, found);
                    if (found && axisStreams.has(id)) {
                        axisStreams.get(id).reconnect();
                    }
                } else {
                    const found = await this.scanForFeed(id);
                    this.setSignal(id, found);
                }
            } catch (_) {
                this.setSignal(id, false);
            }
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
            const id = parseInt(camId, 10);
            if (id === 5 || id === 11) {
                return !!(laptopWebcamService.isActive && laptopWebcamService.video && laptopWebcamService.video.readyState >= 2 && laptopWebcamService.hasLiveTrack());
            }
            if (id === 6 || id === 12) {
                return !!(usbCamService.isActive && usbCamService.video && usbCamService.video.readyState >= 2 && usbCamService.hasLiveTrack());
            }
            if (id >= 1 && id <= 4) {
                const stream = axisStreams.get(id);
                if (stream && stream.hasLiveFrame()) return true;
                return this.signals.get(id) ?? false;
            }
            const vid = this.streamVideos.get(id);
            if (vid && vid.readyState >= 2) return true;
            return this.signals.get(id) ?? false;
        }

        getStreamVideo(camId) {
            return this.streamVideos.get(parseInt(camId, 10)) || null;
        }

        setStreamVideo(camId, videoEl) {
            const id = parseInt(camId, 10);
            this.streamVideos.set(id, videoEl);
            this.setSignal(id, !!(videoEl && videoEl.readyState >= 2));
        }

        setSignal(camId, val) {
            const id = parseInt(camId, 10);
            const changed = (this.signals.get(id) !== Boolean(val));
            this.signals.set(id, Boolean(val));
            if (changed) {
                if (val) {
                    this.countdowns.set(id, 5);
                    const cam = this.getCameraById(id);
                    if (cam) cam._countdownSec = 5;
                }
                this.notify();
            }
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
            const cams = (typeof window !== 'undefined' && window.OrionCameraConfig) ? window.OrionCameraConfig.getAllCameras() : CAMERAS;
            return cams.find(c => c.id === this.activeCamId) || cams[0];
        }

        getCameraById(id) {
            const num = parseInt(id, 10);
            if (num === 11) return this.getCameraById(5);
            if (num === 12) return this.getCameraById(6);
            const cams = (typeof window !== 'undefined' && window.OrionCameraConfig) ? window.OrionCameraConfig.getAllCameras() : CAMERAS;
            return cams.find(c => c.id === num) || cams[0];
        }

        getCameraByKey(key) {
            const cams = (typeof window !== 'undefined' && window.OrionCameraConfig) ? window.OrionCameraConfig.getAllCameras() : CAMERAS;
            if (!key) return cams[0];
            return cams.find(c => c.key === key || c.alias === key || key.includes(c.key)) || cams[0];
        }

        openPopout(camId) {
            const cam = this.getCameraById(camId);
            const url = `camera-view.html?cam=${cam.id}`;
            window.open(url, `_blank_cam_${cam.id}`, 'width=840,height=540,menubar=no,toolbar=no,location=no,status=no');
        }

        captureCameraFrame(camId) {
            const cam = this.getCameraById(camId);
            if (!cam) return null;
            const exportCvs = document.createElement('canvas');
            exportCvs.width = 1280;
            exportCvs.height = 720;
            const ctx = exportCvs.getContext('2d');
            const now = Date.now();
            drawCameraScene(ctx, cam, now, 1280, 720);

            let dataUrl = null;
            try {
                dataUrl = exportCvs.toDataURL('image/png');
            } catch (_) {}

            const thumbCvs = document.createElement('canvas');
            thumbCvs.width = 60;
            thumbCvs.height = 34;
            const tCtx = thumbCvs.getContext('2d');
            tCtx.drawImage(exportCvs, 0, 0, 60, 34);
            let thumbUrl = null;
            try {
                thumbUrl = thumbCvs.toDataURL('image/png');
            } catch (_) {
                thumbUrl = dataUrl;
            }

            return { dataUrl, thumbUrl, width: 1280, height: 720 };
        }

        async scanForFeed(camId) {
            const id = parseInt(camId, 10);

            // If Laptop Webcam (5 or 11)
            if (id === 5 || id === 11) {
                if (laptopWebcamService.isActive && laptopWebcamService.video && laptopWebcamService.video.readyState >= 2) {
                    this.setSignal(5, true);
                    this.setSignal(11, true);
                    return true;
                }
                const started = await laptopWebcamService.start();
                this.setSignal(5, started);
                this.setSignal(11, started);
                return started;
            }

            // If USB Cam (6 or 12)
            if (id === 6 || id === 12) {
                if (usbCamService.isActive && usbCamService.video && usbCamService.video.readyState >= 2) {
                    this.setSignal(6, true);
                    this.setSignal(12, true);
                    return true;
                }
                const started = await usbCamService.start();
                this.setSignal(6, started);
                this.setSignal(12, started);
                return started;
            }

            // AXIS feeds (1 to 4): query /api/camera/axis/:id/feed_status
            if (id >= 1 && id <= 4) {
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 900);
                    const res = await fetch(`/api/camera/axis/${id}/feed_status`, { signal: controller.signal }).catch(() => null);
                    clearTimeout(timer);
                    if (res && res.ok) {
                        const data = await res.json();
                        if (data && data.online) {
                            this.setSignal(id, true);
                            return true;
                        }
                    }
                } catch (_) {}
                this.setSignal(id, false);
                return false;
            }

            // Fallback status check
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

            this.setSignal(id, false);
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

    // Aerospace HUD Overlay on top of live Camera Feed
    function drawWebcamHudOverlay(ctx, cam, now, width, height, service = laptopWebcamService, label = 'LIVE LAPTOP WEBCAM', color = '#10b981', textColor = '#6ee7b7') {
        ctx.save();
        const midX = width * 0.5;
        const midY = height * 0.5;

        // Subtle Reticle Crosshair in center
        ctx.strokeStyle = color === '#10b981' ? 'rgba(16, 185, 129, 0.45)' : 'rgba(6, 182, 212, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(midX - 24, midY); ctx.lineTo(midX - 6, midY);
        ctx.moveTo(midX + 6, midY); ctx.lineTo(midX + 24, midY);
        ctx.moveTo(midX, midY - 24); ctx.lineTo(midX, midY - 6);
        ctx.moveTo(midX, midY + 6); ctx.lineTo(midX, midY + 24);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(midX, midY, 14, 0, Math.PI * 2);
        ctx.stroke();

        // Top live pill badge
        const badgeW = 200;
        const badgeH = 20;
        ctx.fillStyle = color === '#10b981' ? 'rgba(6, 78, 59, 0.85)' : 'rgba(8, 51, 68, 0.85)';
        ctx.fillRect(midX - badgeW / 2, 8, badgeW, badgeH);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(midX - badgeW / 2, 8, badgeW, badgeH);

        ctx.fillStyle = textColor;
        ctx.font = 'bold 9.5px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`● ${label}`, midX, 18);

        // Bottom left pill: device info
        const devW = 250;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(8, height - 26, devW, 18);
        ctx.strokeStyle = '#334155';
        ctx.strokeRect(8, height - 26, devW, 18);

        const vW = (service && service.video) ? service.video.videoWidth : 1280;
        const vH = (service && service.video) ? service.video.videoHeight : 720;
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '8.5px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`CAM ${cam.id}: ${cam.short} | ${vW}x${vH} @ 30FPS`, 14, height - 17);

        // Bottom right: UTC Timestamp
        ctx.fillStyle = '#38bdf8';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`UTC: ${new Date(now).toISOString().substring(11, 23)}`, width - 8, height - 8);

        ctx.restore();
    }

    // Capture Real Camera Snapshot to OpenMCT Notebook Snapshots and Trigger File Download
    function captureCameraSnapshot(cam, targetCanvas, openmct) {
        if (!targetCanvas) return;
        let dataUrl;
        try {
            dataUrl = targetCanvas.toDataURL('image/png');
        } catch (e) {
            console.warn('[Snapshot Capture] Cannot export canvas data URL:', e);
            return;
        }

        // Generate a 60x34 thumbnail for OpenMCT notebook embed
        const thumbCvs = document.createElement('canvas');
        thumbCvs.width = 60;
        thumbCvs.height = 34;
        const tCtx = thumbCvs.getContext('2d');
        tCtx.drawImage(targetCanvas, 0, 0, 60, 34);
        let thumbUrl;
        try {
            thumbUrl = thumbCvs.toDataURL('image/png');
        } catch (_) {
            thumbUrl = dataUrl;
        }

        const uuid = 'snap-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
        const embedId = 'embed-' + Date.now();
        const now = Date.now();

        const snapItem = {
            notebookImageDomainObject: {
                name: `${cam.name} Snapshot`,
                type: 'notebookSnapshotImage',
                identifier: { key: uuid, namespace: '' },
                configuration: { fullSizeImageURL: dataUrl }
            },
            embedObject: {
                bounds: (openmct && openmct.time) ? openmct.time.bounds() : { start: now - 300000, end: now },
                createdOn: now,
                createdBy: null,
                cssClass: 'icon-imagery',
                domainObject: {
                    identifier: { namespace: 'orion.taxonomy', key: cam.key || `cam_${cam.id}` },
                    name: cam.name,
                    type: 'orion.camera_feed'
                },
                historicLink: window.location.hash || `#/browse/orion.taxonomy:${cam.key || 'cam_mast_rgb'}`,
                id: embedId,
                name: cam.name,
                snapshot: {
                    fullSizeImageObjectIdentifier: { key: uuid, namespace: '' },
                    thumbnailImage: { src: thumbUrl }
                },
                type: 'orion.camera_feed'
            }
        };

        let list = [];
        try {
            list = JSON.parse(localStorage.getItem('notebook-snapshot-storage') || '[]');
        } catch (_) {}
        list.unshift(snapItem);
        if (list.length > 10) list.pop();
        try {
            localStorage.setItem('notebook-snapshot-storage', JSON.stringify(list));
        } catch (e) {
            console.warn('[Snapshot Storage] LocalStorage write error:', e);
        }

        // Trigger immediate PNG download as user-facing file
        const a = document.createElement('a');
        a.download = `snapshot_${cam.short.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}.png`;
        a.href = dataUrl;
        document.body.appendChild(a);
        a.click();
        a.remove();

        if (openmct && openmct.notifications) {
            openmct.notifications.info(`Camera Snapshot Captured to Notebook: [${cam.short}]`);
        }
    }

    // HUD Overlay for Live Rover Camera Feeds
    function drawRoverFeedHudOverlay(ctx, cam, now, width, height) {
        ctx.save();
        const midX = width * 0.5;
        const midY = height * 0.5;
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(midX - 20, midY); ctx.lineTo(midX - 5, midY);
        ctx.moveTo(midX + 5, midY); ctx.lineTo(midX + 20, midY);
        ctx.moveTo(midX, midY - 20); ctx.lineTo(midX, midY - 5);
        ctx.moveTo(midX, midY + 5); ctx.lineTo(midX, midY + 20);
        ctx.stroke();

        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(8, 8, 220, 20);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.strokeRect(8, 8, 220, 20);
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`● CAM ${cam.id}: ${cam.short} | LIVE`, 14, 21);

        ctx.fillStyle = '#38bdf8';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`UTC: ${new Date(now).toISOString().substring(11, 23)}`, width - 8, height - 8);
        ctx.restore();
    }

    // Aerospace HUD Overlay for Live AXIS Network Camera Feeds
    function drawAxisFeedHudOverlay(ctx, cam, now, width, height, axisStream) {
        ctx.save();
        const midX = width * 0.5;
        const midY = height * 0.5;

        // Subtle Reticle Crosshair in center
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(midX - 24, midY); ctx.lineTo(midX - 6, midY);
        ctx.moveTo(midX + 6, midY); ctx.lineTo(midX + 24, midY);
        ctx.moveTo(midX, midY - 24); ctx.lineTo(midX, midY - 6);
        ctx.moveTo(midX, midY + 6); ctx.lineTo(midX, midY + 24);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(midX, midY, 14, 0, Math.PI * 2);
        ctx.stroke();

        // Top live pill badge
        const badgeW = 230;
        const badgeH = 20;
        ctx.fillStyle = 'rgba(8, 47, 73, 0.85)';
        ctx.fillRect(midX - badgeW / 2, 8, badgeW, badgeH);
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1;
        ctx.strokeRect(midX - badgeW / 2, 8, badgeW, badgeH);

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 9.5px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`● ${cam.name.toUpperCase()} (LIVE AXIS)`, midX, 18);

        // Bottom left pill: device info
        const devW = 270;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(8, height - 26, devW, 18);
        ctx.strokeStyle = '#334155';
        ctx.strokeRect(8, height - 26, devW, 18);

        const imgW = (axisStream && axisStream.img && axisStream.img.naturalWidth) || 1280;
        const imgH = (axisStream && axisStream.img && axisStream.img.naturalHeight) || 720;
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '8.5px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`CAM ${cam.id}: ${cam.short} | ${imgW}x${imgH} @ 30FPS`, 14, height - 17);

        // Bottom right: UTC Timestamp
        ctx.fillStyle = '#38bdf8';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`UTC: ${new Date(now).toISOString().substring(11, 23)}`, width - 8, height - 8);

        ctx.restore();
    }

    // Scene Renderer for Camera Streams: NO SIM MODES!
    function drawCameraScene(ctx, cam, now, width, height) {
        // 1. AXIS Cameras (1 to 4)
        if (cam.isAxis || (cam.id >= 1 && cam.id <= 4)) {
            const axisStream = axisStreams.get(cam.id);
            if (axisStream && axisStream.hasLiveFrame()) {
                ctx.save();
                ctx.drawImage(axisStream.img, 0, 0, width, height);
                drawAxisFeedHudOverlay(ctx, cam, now, width, height, axisStream);
                ctx.restore();
                return;
            }
            drawNoSignalScene(ctx, cam, now, width, height);
            return;
        }

        // 2. Laptop Webcam (id 5 or 11)
        if (cam.id === 5 || cam.id === 11) {
            if (laptopWebcamService.isActive && laptopWebcamService.video && laptopWebcamService.video.readyState >= 2) {
                ctx.save();
                ctx.drawImage(laptopWebcamService.video, 0, 0, width, height);
                drawWebcamHudOverlay(ctx, cam, now, width, height, laptopWebcamService, 'LIVE LAPTOP WEBCAM', '#10b981', '#6ee7b7');
                ctx.restore();
                return;
            }
            drawNoSignalScene(ctx, cam, now, width, height);
            return;
        }

        // 3. USB Camera (id 6 or 12)
        if (cam.id === 6 || cam.id === 12) {
            if (usbCamService.isActive && usbCamService.video && usbCamService.video.readyState >= 2) {
                ctx.save();
                ctx.drawImage(usbCamService.video, 0, 0, width, height);
                drawWebcamHudOverlay(ctx, cam, now, width, height, usbCamService, 'LIVE USB CAMERA', '#06b6d4', '#67e8f9');
                ctx.restore();
                return;
            }
            drawNoSignalScene(ctx, cam, now, width, height);
            return;
        }

        const realVideo = cameraManager.getStreamVideo(cam.id);
        if (realVideo && realVideo.readyState >= 2) {
            ctx.save();
            ctx.drawImage(realVideo, 0, 0, width, height);
            drawRoverFeedHudOverlay(ctx, cam, now, width, height);
            ctx.restore();
            return;
        }

        drawNoSignalScene(ctx, cam, now, width, height);
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
            // 5. Install Snapshot Aspect-Ratio Preservation Hook
            // Ensures that when any snapshot is saved to Open MCT Notebook for an orion camera feed,
            // the fullSizeImageURL is guaranteed to be authentic 16:9 widescreen format (1280x720)
            // even if captured from a narrow portrait flexible layout tile or large view.
            function tryInstallSnapshotPreservationHook() {
                const indicatorObj = openmct.indicators && openmct.indicators.indicatorObjects &&
                    openmct.indicators.indicatorObjects.find(i => i.key === 'notebook-snapshot-indicator');
                let sc = null;
                if (indicatorObj && indicatorObj.element && indicatorObj.element.__vue_app__) {
                    const app = indicatorObj.element.__vue_app__;
                    sc = app._instance && app._instance.provides && app._instance.provides.snapshotContainer;
                }
                if (!sc) {
                    const snapBtn = document.querySelector('.c-notebook-snapshot-menubutton');
                    if (snapBtn && snapBtn.__vueParentComponent && snapBtn.__vueParentComponent.proxy) {
                        const ns = snapBtn.__vueParentComponent.proxy.notebookSnapshot;
                        if (ns && ns.snapshotContainer) sc = ns.snapshotContainer;
                    }
                }
                if (sc && !sc._aspectRatioHookInstalled) {
                    sc._aspectRatioHookInstalled = true;
                    const origAdd = sc.addSnapshot.bind(sc);
                    sc.addSnapshot = function (notebookImageDomainObject, embedObject) {
                        try {
                            const domainObj = embedObject && embedObject.domainObject;
                            let camKey = (domainObj && domainObj.identifier && domainObj.identifier.key) ||
                                (embedObject && embedObject.historicLink && (embedObject.historicLink.match(/cam_\w+/) || [])[0]);
                            if (camKey) {
                                const cam = cameraManager.getCameraByKey(camKey);
                                if (cam) {
                                    const cleanFrame = cameraManager.captureCameraFrame(cam.id);
                                    if (cleanFrame) {
                                        if (notebookImageDomainObject && notebookImageDomainObject.configuration) {
                                            notebookImageDomainObject.configuration.fullSizeImageURL = cleanFrame.dataUrl;
                                        }
                                        if (embedObject.snapshot && embedObject.snapshot.thumbnailImage) {
                                            embedObject.snapshot.thumbnailImage.src = cleanFrame.thumbUrl;
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn('[Camera Snapshot Hook Error]', e);
                        }
                        return origAdd(notebookImageDomainObject, embedObject);
                    };
                }
            }

            setTimeout(tryInstallSnapshotPreservationHook, 800);
            setTimeout(tryInstallSnapshotPreservationHook, 2500);
            setTimeout(tryInstallSnapshotPreservationHook, 5000);
            openmct.on('start', () => {
                setTimeout(tryInstallSnapshotPreservationHook, 500);
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

        container.classList.add('orion-camera-feed-container');
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
                    <span id="single-hud-name" style="font-weight: 800; font-size: 10px; color: #f8fafc; letter-spacing: 0.5px;">${cam.short}</span>
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
                <canvas id="single-cam-canvas" style="width: 100%; height: 100%; object-fit: contain; display: block;"></canvas>
                
                <!-- Center NO SIGNAL Overlay: Orion Logo + Red NO SIGNAL Label -->
                <div id="single-no-signal" style="position: absolute; inset: 0; display: ${initialSig ? 'none' : 'flex'}; flex-direction: column; align-items: center; justify-content: center; background: rgba(10, 10, 10, 0.95); z-index: 10; pointer-events: none; user-select: none;">
                    <img src="/logotyp_pion_white.png" onerror="this.src='logotyp_pion_white.png'" alt="Orion VI Logo" style="width: 68px; height: 68px; object-fit: contain; margin-bottom: 12px; filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.3));" />
                    <div style="font-family: monospace, sans-serif; font-size: 15px; font-weight: 900; letter-spacing: 3px; color: #ef4444; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.6); padding: 5px 18px; border-radius: 0px !important; text-shadow: 0 0 12px rgba(239, 68, 68, 0.6);">
                        NO SIGNAL
                    </div>
                    <div id="single-reconnect-${cam.id}" class="single-reconnect-msg" data-reconnect-cam="${cam.id}" style="font-family: monospace, sans-serif; font-size: 8.5px; font-weight: 700; color: #94a3b8; margin-top: 8px; letter-spacing: 0.3px; white-space: nowrap;">
                        Attempting reconnect in ${cam._countdownSec ?? 5}s...
                    </div>
                </div>

                <div id="single-role-label" style="position: absolute; bottom: 8px; left: 10px; background: rgba(20, 20, 20, 0.85); border: 1px solid #282828; padding: 2px 6px; font-family: monospace; font-size: 9px; color: #cbd5e1; z-index: 15;">
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


        const onSingleCamRenamed = (e) => {
            if (e.detail && (e.detail.id === cam.id || e.detail.key === cam.key || e.detail.alias === cam.key)) {
                const hudName = container.querySelector('#single-hud-name');
                if (hudName) hudName.textContent = e.detail.short || e.detail.name;
                const roleLabel = container.querySelector('#single-role-label');
                if (roleLabel) roleLabel.textContent = `ROLE: ${e.detail.role.toUpperCase()}`;
            }
        };
        window.addEventListener('orion-camera-renamed', onSingleCamRenamed);

        // Auto-start hardware if Camera 11 or 12
        if (cam.id === 11) {
            laptopWebcamService.start().then(ok => {
                if (ok) cameraManager.setSignal(11, true);
            }).catch(() => {});
        } else if (cam.id === 12) {
            usbCamService.start().then(ok => {
                if (ok) cameraManager.setSignal(12, true);
            }).catch(() => {});
        }

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
            unsubSignal();
            window.removeEventListener('orion-camera-renamed', onSingleCamRenamed);
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
                </div>
            </div>

            <!-- Flexible Viewport Body -->
            <div id="deck-viewport" style="flex: 1; min-height: 0; position: relative; overflow: hidden; background: #0c0c0c;"></div>
        `;

        const viewport = container.querySelector('#deck-viewport');
        const btnModes = container.querySelectorAll('.btn-deck-mode');
        const hudTelem = container.querySelector('#deck-hud-telemetry');
        const hudDot = container.querySelector('#deck-hud-dot');

        let animFrameId = null;
        const activeTileCanvases = new Map(); // id -> { canvas, ctx }

        // Helper to create a camera tile DOM element
        function createCameraTile(cam, isHero = false) {
            const tile = document.createElement('div');
            tile.dataset.camId = cam.id;
            tile.classList.add('orion-camera-feed-container');
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
                        <span id="tile-cam-name-${cam.id}" style="font-weight: 800; font-size: 9px; color: #f8fafc;">${cam.short}</span>
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
                            Attempting reconnect in ${cam._countdownSec ?? 5}s...
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

        const onDeckCamRenamed = (e) => {
            if (e.detail && e.detail.id) {
                const nameEl = viewport.querySelector(`#tile-cam-name-${e.detail.id}`);
                if (nameEl) nameEl.textContent = e.detail.short || e.detail.name;
            }
        };
        window.addEventListener('orion-camera-renamed', onDeckCamRenamed);

        container._cleanup = () => {
            unsub();
            window.removeEventListener('orion-camera-renamed', onDeckCamRenamed);
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
