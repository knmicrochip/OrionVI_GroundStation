/**
 * Orion VI Camera Configuration & Name Customization Service
 * Standards: NASA-STD-3001, ECSS
 *
 * Defines primary AXIS cameras and operator test feeds.
 * Enables operators to easily rename any camera (e.g. AXIS 1 -> Mast Cam)
 * either by modifying this file or interactively via the Open MCT UI.
 * Custom names persist across sessions in localStorage.
 */

(function () {
    const STORAGE_KEY = 'orion-camera-custom-names';

    const BASE_CAMERAS = [
        {
            id: 1,
            key: 'cam_axis_1',
            alias: 'cam_mast_rgb',
            defaultName: 'AXIS 1',
            defaultShort: 'AXIS 1',
            defaultRole: 'Camera 1',
            resolution: '1280x720',
            color: '#38bdf8',
            isAxis: true,
            axisChannel: 1
        },
        {
            id: 2,
            key: 'cam_axis_2',
            alias: 'cam_mast_depth',
            defaultName: 'AXIS 2',
            defaultShort: 'AXIS 2',
            defaultRole: 'Camera 2',
            resolution: '1280x720',
            color: '#06b6d4',
            isAxis: true,
            axisChannel: 2
        },
        {
            id: 3,
            key: 'cam_axis_3',
            alias: 'cam_haz_fl',
            defaultName: 'AXIS 3',
            defaultShort: 'AXIS 3',
            defaultRole: 'Camera 3',
            resolution: '1280x720',
            color: '#22c55e',
            isAxis: true,
            axisChannel: 3
        },
        {
            id: 4,
            key: 'cam_axis_4',
            alias: 'cam_haz_fr',
            defaultName: 'AXIS 4',
            defaultShort: 'AXIS 4',
            defaultRole: 'Camera 4',
            resolution: '1280x720',
            color: '#f59e0b',
            isAxis: true,
            axisChannel: 4
        },
        {
            id: 5,
            key: 'cam_laptop_test',
            alias: 'cam_test',
            defaultName: 'Laptop Webcam',
            defaultShort: 'LAPTOP CAM',
            defaultRole: 'Operator Test Feed / Webcam',
            resolution: '1280x720',
            color: '#10b981',
            isTestCam: true
        },
        {
            id: 6,
            key: 'cam_usb_test',
            alias: 'cam_usb',
            defaultName: 'USB Camera',
            defaultShort: 'USB CAM',
            defaultRole: 'Operator Test Feed / USB',
            resolution: '1280x720',
            color: '#06b6d4',
            isTestCam: true
        }
    ];

    function getCustomStore() {
        if (typeof localStorage === 'undefined') return {};
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch (_) {
            return {};
        }
    }

    function saveCustomStore(store) {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        } catch (_) {}
    }

    class OrionCameraConfigService {
        constructor() {
            this.cameras = BASE_CAMERAS.map(cam => {
                const store = getCustomStore();
                const custom = store[cam.key] || store[cam.id] || {};
                return {
                    ...cam,
                    name: custom.name || cam.defaultName,
                    short: custom.short || (custom.name ? custom.name.toUpperCase() : cam.defaultShort),
                    role: custom.role || cam.defaultRole
                };
            });
            this.listeners = new Set();
        }

        getAllCameras() {
            return this.cameras;
        }

        getCameraByKey(key) {
            if (!key) return this.cameras[0];
            return this.cameras.find(c => c.key === key || c.alias === key || key.includes(c.key)) || this.cameras[0];
        }

        getCameraById(id) {
            const num = parseInt(id, 10);
            return this.cameras.find(c => c.id === num) || this.cameras[0];
        }

        /**
         * Rename camera and optionally update role. Persists to localStorage.
         */
        renameCamera(keyOrId, newName, newRole) {
            const cam = (typeof keyOrId === 'number' || !isNaN(parseInt(keyOrId, 10)))
                ? this.getCameraById(keyOrId)
                : this.getCameraByKey(keyOrId);

            if (!cam) return false;

            const name = (newName && newName.trim()) ? newName.trim() : cam.defaultName;
            const short = name.length <= 12 ? name.toUpperCase() : name.substring(0, 12).toUpperCase();
            const role = (newRole && newRole.trim()) ? newRole.trim() : cam.role;

            cam.name = name;
            cam.short = short;
            cam.role = role;

            const store = getCustomStore();
            store[cam.key] = { name, short, role };
            saveCustomStore(store);

            // Notify listeners & dispatch global event
            this.listeners.forEach(cb => {
                try { cb(cam); } catch (_) {}
            });
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('orion-camera-renamed', { detail: cam }));
            }
            return true;
        }

        /**
         * Reset a camera or all cameras back to default names
         */
        resetToDefaults(keyOrId) {
            if (keyOrId) {
                const cam = this.getCameraByKey(keyOrId) || this.getCameraById(keyOrId);
                if (cam) {
                    const store = getCustomStore();
                    delete store[cam.key];
                    delete store[cam.id];
                    saveCustomStore(store);
                    cam.name = cam.defaultName;
                    cam.short = cam.defaultShort;
                    cam.role = cam.defaultRole;
                    this.listeners.forEach(cb => cb(cam));
                }
            } else {
                if (typeof localStorage !== 'undefined') {
                    localStorage.removeItem(STORAGE_KEY);
                }
                this.cameras.forEach(cam => {
                    cam.name = cam.defaultName;
                    cam.short = cam.defaultShort;
                    cam.role = cam.defaultRole;
                });
                this.listeners.forEach(cb => cb(null));
            }
        }

        subscribe(cb) {
            this.listeners.add(cb);
            return () => this.listeners.delete(cb);
        }
    }

    const configService = new OrionCameraConfigService();

    if (typeof window !== 'undefined') {
        window.OrionCameraConfig = configService;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = configService;
    }
})();

