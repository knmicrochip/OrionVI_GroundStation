/**
 * AXIS Camera Gateway & Stream Proxy for Open MCT (ERC 2026 / Orion VI)
 * Standards: NASA-STD-3001, ECSS
 *
 * Connects Open MCT to AXIS network cameras (such as Axis F34 Multi-Sensor system)
 * Default IP: 192.168.11.150, Credentials: orion / orion
 *
 * Features:
 * - Direct HTTP MJPEG streaming proxy (/api/camera/axis/:id/stream)
 * - Single-frame snapshot fetch (/api/camera/axis/:id/frame)
 * - Hardware liveness status polling (/api/camera/axis/:id/feed_status)
 * - HTTP Digest and Basic Authentication handler
 * - WDR (Wide Dynamic Range) toggle API
 * - External vision service frame ingestion (accepts ArUco/QR processed frames from Python)
 * - Dynamic runtime configuration (IP, credentials, resolution)
 */

const http = require('http');
const crypto = require('crypto');
const url = require('url');
const dgram = require('dgram');

class AxisCameraProxy {
    constructor(options = {}) {
        this.config = {
            ip: process.env.AXIS_IP || options.ip || '169.254.186.98',
            port: parseInt(process.env.AXIS_PORT || options.port || 80, 10),
            user: process.env.AXIS_USER || options.user || 'orion',
            pass: process.env.AXIS_PASS || options.pass || 'orion',
            resolution: process.env.AXIS_RES || options.resolution || '960x540',
            timeoutMs: 2500
        };

        // Candidate IP addresses to probe if current IP is unreachable
        this.candidateIps = [
            process.env.AXIS_IP,
            this.config.ip,
            '169.254.186.98',
            '169.254.186.99',
            '169.254.39.168',
            '192.168.1.81',
            '192.168.11.150',
            '192.168.0.90'
        ].filter(Boolean);

        // Cache for latest frames pushed from Python vision service or snapshot poll
        this.latestFrames = new Map(); // camId -> { buffer: Buffer, timestamp: number }
        this.statusCache = new Map(); // camId -> { online: boolean, checkedAt: number }
        this.activeStreams = new Map(); // camId -> lastChunkTime
        this.subscribers = new Map(); // camId -> Set of express res objects for MJPEG push

        // WDR state per sensor (0 to 3)
        this.wdrState = [false, false, false, false];

        // Simulated test pattern generator when in explicit test mode
        this.simMode = process.env.SIM_AXIS === 'true';

        // Auto-discover camera on startup
        this.discoverCamera().catch(() => {});
    }

    /**
     * Fast host probe to check if an IP responds to AXIS HTTP requests
     */
    _probeHost(host) {
        return new Promise(resolve => {
            const req = http.request({
                hostname: host,
                port: this.config.port || 80,
                path: '/axis-cgi/param.cgi?action=list&group=Brand.ProdShortName',
                method: 'GET',
                timeout: 800
            }, res => {
                resolve(res.statusCode === 200 || res.statusCode === 401);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
            req.end();
        });
    }

    /**
     * Multicast SSDP M-SEARCH discovery for AXIS cameras
     */
    _discoverViaSsdp(timeoutMs = 1500) {
        return new Promise(resolve => {
            let socket;
            try {
                socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            } catch (_) {
                return resolve(null);
            }
            let resolved = false;

            socket.on('message', (msg, rinfo) => {
                const str = msg.toString();
                if (str.includes('AXIS') || str.includes('ACCC8E') || str.includes('axis-com') || str.includes('rootdesc')) {
                    if (!resolved) {
                        resolved = true;
                        try { socket.close(); } catch (_) {}
                        resolve(rinfo.address);
                    }
                }
            });

            socket.on('error', () => {
                if (!resolved) {
                    resolved = true;
                    try { socket.close(); } catch (_) {}
                    resolve(null);
                }
            });

            socket.bind(0, () => {
                try {
                    socket.setBroadcast(true);
                    socket.setMulticastTTL(2);
                } catch (_) {}

                const query = Buffer.from(
                    'M-SEARCH * HTTP/1.1\r\n' +
                    'HOST: 239.255.255.250:1900\r\n' +
                    'MAN: "ssdp:discover"\r\n' +
                    'MX: 1\r\n' +
                    'ST: ssdp:all\r\n\r\n'
                );

                socket.send(query, 0, query.length, 1900, '239.255.255.250', () => {});
                socket.send(query, 0, query.length, 1900, '169.254.255.255', () => {});
                socket.send(query, 0, query.length, 1900, '255.255.255.255', () => {});
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    try { socket.close(); } catch (_) {}
                    resolve(null);
                }
            }, timeoutMs);
        });
    }

    /**
     * Automatically discover and select the active AXIS camera IP
     */
    async discoverCamera() {
        for (const candidate of this.candidateIps) {
            try {
                const isAlive = await this._probeHost(candidate);
                if (isAlive) {
                    if (this.config.ip !== candidate) {
                        console.log(`[AxisCameraProxy] Discovered active AXIS camera host: ${candidate}`);
                        this.config.ip = candidate;
                        this.statusCache.clear();
                    }
                    return candidate;
                }
            } catch (_) {}
        }

        try {
            const ssdpIp = await this._discoverViaSsdp(1200);
            if (ssdpIp) {
                console.log(`[AxisCameraProxy] SSDP discovered AXIS camera at: ${ssdpIp}`);
                this.config.ip = ssdpIp;
                if (!this.candidateIps.includes(ssdpIp)) {
                    this.candidateIps.unshift(ssdpIp);
                }
                this.statusCache.clear();
                return ssdpIp;
            }
        } catch (_) {}

        return this.config.ip;
    }

    /**
     * Compute HTTP Digest Authentication header
     */
    generateDigestHeader(method, path, authHeader) {
        const params = {};
        const parts = authHeader.replace(/^Digest\s+/i, '').split(/,\s*/);
        parts.forEach(part => {
            const m = part.match(/^([^=]+)=(?:"([^"]+)"|([^,]+))$/);
            if (m) params[m[1]] = m[2] || m[3];
        });

        const realm = params.realm || '';
        const nonce = params.nonce || '';
        const qop = params.qop || '';
        const opaque = params.opaque || '';
        const cnonce = crypto.randomBytes(8).toString('hex');
        const nc = '00000001';

        const ha1 = crypto.createHash('md5')
            .update(`${this.config.user}:${realm}:${this.config.pass}`)
            .digest('hex');

        const ha2 = crypto.createHash('md5')
            .update(`${method}:${path}`)
            .digest('hex');

        let response;
        if (qop && qop.includes('auth')) {
            response = crypto.createHash('md5')
                .update(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`)
                .digest('hex');
        } else {
            response = crypto.createHash('md5')
                .update(`${ha1}:${nonce}:${ha2}`)
                .digest('hex');
        }

        let header = `Digest username="${this.config.user}", realm="${realm}", nonce="${nonce}", uri="${path}", response="${response}"`;
        if (qop) header += `, qop="auth", nc=${nc}, cnonce="${cnonce}"`;
        if (opaque) header += `, opaque="${opaque}"`;
        return header;
    }

    /**
     * Make an HTTP request with automatic Basic / Digest authentication handling
     */
    makeRequest(path, method = 'GET', customHeaders = {}) {
        return new Promise((resolve, reject) => {
            const base64Auth = Buffer.from(`${this.config.user}:${this.config.pass}`).toString('base64');
            const options = {
                hostname: this.config.ip,
                port: this.config.port,
                path: path,
                method: method,
                timeout: this.config.timeoutMs,
                headers: {
                    'Authorization': `Basic ${base64Auth}`,
                    'User-Agent': 'Orion-OpenMCT-Gateway/2.0',
                    ...customHeaders
                }
            };

            const req = http.request(options, (res) => {
                if (res.statusCode === 401 && res.headers['www-authenticate']) {
                    const authHeader = res.headers['www-authenticate'];
                    res.resume(); // Discard first response

                    if (/^Digest/i.test(authHeader)) {
                        const digestAuth = this.generateDigestHeader(method, path, authHeader);
                        const retryOptions = {
                            ...options,
                            headers: {
                                ...options.headers,
                                'Authorization': digestAuth
                            }
                        };
                        const retryReq = http.request(retryOptions, (retryRes) => {
                            resolve(retryRes);
                        });
                        retryReq.on('error', reject);
                        retryReq.on('timeout', () => {
                            retryReq.destroy(new Error('AXIS request timed out'));
                        });
                        retryReq.end();
                        return;
                    }
                }
                resolve(res);
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy(new Error('AXIS request timed out'));
            });
            req.end();
        });
    }

    /**
     * Check if a camera channel is online
     */
    async isCameraOnline(camId, force = false) {
        if (force) {
            this.statusCache.delete(camId);
        }

        // Fast check: If MJPEG stream is actively receiving frames from AXIS, return true immediately!
        // This avoids hammering the AXIS camera hardware with redundant param.cgi / image.cgi polling.
        const lastStreamChunk = this.activeStreams.get(camId);
        if (!force && lastStreamChunk && (Date.now() - lastStreamChunk) < 4500) {
            return true;
        }

        // If Python vision service pushed a frame in the last 4 seconds, consider online
        const lastPush = this.latestFrames.get(camId);
        if (lastPush && (Date.now() - lastPush.timestamp) < 4000) {
            return true;
        }

        // Check cached status (2.0s TTL) unless force requested
        const cached = this.statusCache.get(camId);
        if (!force && cached && (Date.now() - cached.checkedAt) < 2000) {
            return cached.online;
        }

        if (this.simMode) {
            this.statusCache.set(camId, { online: true, checkedAt: Date.now() });
            return true;
        }

        try {
            // Verify current host is responding; if not, discover
            let alive = await this._probeHost(this.config.ip);
            if (!alive) {
                await this.discoverCamera();
            }

            const idx = camId - 1;
            const probePath = `/axis-cgi/param.cgi?action=list&group=ImageSource.I${idx}`;
            const res = await this.makeRequest(probePath, 'GET');
            let isOk = res.statusCode >= 200 && res.statusCode < 400;
            res.resume();

            // On multi-sensor AXIS F34, verify physical sensor is connected
            // Connected sensors return real JPEG data (>2500 bytes for 320x180)
            // Empty ports return static ~2217-byte "No video" placeholders
            if (isOk) {
                try {
                    const snapRes = await this.makeRequest(`/axis-cgi/jpg/image.cgi?camera=${camId}&resolution=320x180`, 'GET');
                    if (snapRes.statusCode === 200) {
                        const chunks = [];
                        await new Promise(r => {
                            snapRes.on('data', c => chunks.push(c));
                            snapRes.on('end', r);
                        });
                        const totalBytes = Buffer.concat(chunks).length;
                        isOk = (totalBytes > 2500);
                    }
                } catch (_) {}
            }

            this.statusCache.set(camId, { online: isOk, checkedAt: Date.now() });
            return isOk;
        } catch (_) {
            this.statusCache.set(camId, { online: false, checkedAt: Date.now() });
            return false;
        }
    }

    /**
     * Register Express routes
     */
    registerRoutes(app) {
        // 1. Camera Feed Status
        app.get('/api/camera/axis/:id/feed_status', async (req, res) => {
            const camId = parseInt(req.params.id, 10) || 1;
            const force = req.query.force === 'true';
            const online = await this.isCameraOnline(camId, force);
            res.json({
                id: camId,
                name: `AXIS ${camId}`,
                online: online,
                status: online ? 'LIVE' : 'NO_SIGNAL',
                ip: this.config.ip,
                resolution: this.config.resolution,
                message: online ? 'Axis hardware stream active' : `No signal from camera at ${this.config.ip}`,
                timestamp: Date.now()
            });
        });

        // 2. Fetch single JPEG snapshot frame
        app.get('/api/camera/axis/:id/frame', async (req, res) => {
            const camId = parseInt(req.params.id, 10) || 1;

            // If Python vision service pushed a frame, serve it directly
            const pushed = this.latestFrames.get(camId);
            if (pushed && pushed.buffer && (Date.now() - pushed.timestamp) < 3000) {
                res.writeHead(200, {
                    'Content-Type': 'image/jpeg',
                    'Content-Length': pushed.buffer.length,
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                });
                return res.end(pushed.buffer);
            }

            try {
                const imgPath = `/axis-cgi/jpg/image.cgi?camera=${camId}&resolution=${this.config.resolution}`;
                const upstream = await this.makeRequest(imgPath, 'GET');
                if (upstream.statusCode !== 200) {
                    upstream.resume();
                    return res.status(upstream.statusCode).json({ error: 'Failed to fetch camera frame' });
                }

                res.writeHead(200, {
                    'Content-Type': 'image/jpeg',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                });
                upstream.pipe(res);
            } catch (err) {
                res.status(503).json({ error: 'AXIS camera offline', details: err.message });
            }
        });

        // 3. Proxy live MJPEG Stream directly to browser/OpenMCT
        // 3. MJPEG Video Stream Proxy (Direct stream to <img> or canvas in Open MCT)
        app.get('/api/camera/axis/:id/stream', async (req, res) => {
            const camId = parseInt(req.params.id, 10) || 1;
            const isForce = req.query.force === 'true' || Boolean(req.query.reconnect);
            if (isForce) {
                this.statusCache.delete(camId);
            }

            const lastFrame = this.latestFrames.get(camId);
            const hasRecentFrame = lastFrame && (Date.now() - lastFrame.timestamp) < 3000;
            const isOnline = hasRecentFrame || (await this.isCameraOnline(camId, isForce));

            if (!isOnline && !hasRecentFrame) {
                return res.status(503).json({ error: 'AXIS camera offline', camId });
            }

            // Case A: Python Vision Service is actively pushing processed frames
            if (hasRecentFrame) {
                const boundary = 'orion_mjpeg_boundary';
                res.writeHead(200, {
                    'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Connection': 'close',
                    'Pragma': 'no-cache'
                });

                if (!this.subscribers.has(camId)) {
                    this.subscribers.set(camId, new Set());
                }
                const clientSet = this.subscribers.get(camId);
                clientSet.add(res);

                if (lastFrame && lastFrame.buffer) {
                    this._sendMjpegFrame(res, lastFrame.buffer, boundary);
                }

                req.on('close', () => {
                    clientSet.delete(res);
                });
                return;
            }

            // Case B: Direct streaming from AXIS camera MJPEG feed with 4.5s freeze watchdog
            try {
                const mjpgPath = `/axis-cgi/mjpg/video.cgi?camera=${camId}&resolution=${this.config.resolution}`;
                const upstream = await this.makeRequest(mjpgPath, 'GET');
                if (upstream.statusCode === 200) {
                    const contentType = upstream.headers['content-type'] || 'multipart/x-mixed-replace; boundary=myboundary';
                    res.writeHead(200, {
                        'Content-Type': contentType,
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        'Connection': 'close',
                        'Pragma': 'no-cache'
                    });

                    let lastChunkTime = Date.now();
                    this.activeStreams.set(camId, lastChunkTime);

                    const streamWatchdog = setInterval(() => {
                        const elapsed = Date.now() - lastChunkTime;
                        if (elapsed > 4500) {
                            console.warn(`[AxisCameraProxy] Camera ${camId} stream data FROZEN (${elapsed}ms without frames) - terminating stream to force reset`);
                            clearInterval(streamWatchdog);
                            this.activeStreams.delete(camId);
                            this.statusCache.set(camId, { online: false, checkedAt: Date.now() });
                            try { upstream.destroy(new Error('Stream frozen')); } catch (_) {}
                            try { res.destroy(); } catch (_) {}
                        }
                    }, 1000);

                    upstream.on('data', () => {
                        lastChunkTime = Date.now();
                        this.activeStreams.set(camId, lastChunkTime);
                    });

                    const cleanup = () => {
                        clearInterval(streamWatchdog);
                        this.activeStreams.delete(camId);
                        try { upstream.destroy(); } catch (_) {}
                    };

                    upstream.on('close', cleanup);
                    upstream.on('end', cleanup);
                    upstream.on('error', cleanup);
                    res.on('close', cleanup);

                    upstream.pipe(res);
                } else {
                    res.status(upstream.statusCode).json({ error: 'Upstream AXIS camera returned non-200', code: upstream.statusCode });
                }
            } catch (err) {
                if (!res.headersSent) {
                    res.status(502).json({ error: 'Failed to connect to AXIS MJPEG stream', details: err.message });
                } else {
                    try { res.end(); } catch (_) {}
                }
            }
        });

        // 4. Ingest frame from Python Vision Service (ArUco & QR Detection)
        app.post('/api/camera/axis/:id/frame', (req, res) => {
            const camId = parseInt(req.params.id, 10) || 1;
            const chunks = [];

            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                const buffer = Buffer.concat(chunks);
                if (buffer.length > 0) {
                    this.latestFrames.set(camId, { buffer, timestamp: Date.now() });
                    this.statusCache.set(camId, { online: true, checkedAt: Date.now() });

                    // Broadcast to any MJPEG stream subscribers
                    const clients = this.subscribers.get(camId);
                    if (clients && clients.size > 0) {
                        const boundary = 'orion_mjpeg_boundary';
                        clients.forEach(client => {
                            this._sendMjpegFrame(client, buffer, boundary);
                        });
                    }
                }
                res.json({ success: true, size: buffer.length });
            });
        });

        // 5. WDR Mode Toggle API (Matching kamery_axis.py)
        app.post('/api/camera/axis/:id/wdr', async (req, res) => {
            const camId = parseInt(req.params.id, 10) || 1;
            const idx = camId - 1;
            const targetState = req.body && req.body.enabled !== undefined
                ? Boolean(req.body.enabled)
                : !this.wdrState[idx];

            const stateStr = targetState ? 'on' : 'off';
            try {
                const path = `/axis-cgi/param.cgi?action=update&ImageSource.I${idx}.Sensor.WDR=${stateStr}`;
                const upstream = await this.makeRequest(path, 'GET');
                upstream.resume();
                if (upstream.statusCode === 200) {
                    this.wdrState[idx] = targetState;
                    return res.json({ success: true, camId, wdr: targetState });
                }
                res.status(upstream.statusCode).json({ error: 'Failed to update WDR', code: upstream.statusCode });
            } catch (err) {
                res.status(500).json({ error: 'Network error updating WDR', details: err.message });
            }
        });

        // 6. Runtime Configuration (Query & Update)
        app.get('/api/camera/axis/config', (req, res) => {
            res.json({
                ip: this.config.ip,
                port: this.config.port,
                user: this.config.user,
                resolution: this.config.resolution,
                wdrState: this.wdrState
            });
        });

        app.post('/api/camera/axis/config', (req, res) => {
            if (req.body.ip) this.config.ip = req.body.ip;
            if (req.body.port) this.config.port = parseInt(req.body.port, 10);
            if (req.body.user) this.config.user = req.body.user;
            if (req.body.pass) this.config.pass = req.body.pass;
            if (req.body.resolution) this.config.resolution = req.body.resolution;
            this.statusCache.clear();
            res.json({ success: true, config: this.config });
        });
    }

    _sendMjpegFrame(res, buffer, boundary) {
        try {
            res.write(`--${boundary}\r\n`);
            res.write('Content-Type: image/jpeg\r\n');
            res.write(`Content-Length: ${buffer.length}\r\n\r\n`);
            res.write(buffer);
            res.write('\r\n');
        } catch (_) {}
    }
}

module.exports = AxisCameraProxy;
