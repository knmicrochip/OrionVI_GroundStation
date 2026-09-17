/**
 * Open MCT Plugin: Orion Rover 5GHz Wi-Fi Antenna RF Comms Telemetry & Live Diagnostics
 * 
 * Features:
 * 1. Tracks 5GHz Wi-Fi RF Comms Telemetry:
 *    - Uplink Rate (Tx Throughput, Mbps)
 *    - Downlink Rate (Rx Throughput, Mbps)
 *    - Signal Strength RSSI (dBm)
 *    - Signal-to-Noise Ratio SNR (dB)
 *    - Link Quality (%)
 *    - Round-Trip Latency / Ping (ms)
 *    - Packet Loss (%)
 * 2. High-Priority Upper Panel Indicator:
 *    - Placed in top header alongside battery indicator
 *    - 5GHz Wi-Fi antenna icon with dynamic signal bars
 *    - Live Uplink (▲) and Downlink (▼) throughput readouts
 *    - Color-coded RF link state (Green > -65 dBm, Amber -65 to -80 dBm, Red < -80 dBm)
 *    - Click opens secondary dedicated diagnostics window (`antenna-details.html`)
 * 3. Open MCT Telemetry Providers:
 *    - Registers "Orion Rover RF Comms (5GHz)" folder
 *    - Individual telemetry domain objects + pre-configured Overlay Plot
 * 4. Zero-Config Smart Simulator / Placeholder:
 *    - Generates realistic stochastic 5GHz Wi-Fi fluctuations when MQTT is offline/undecided
 * 5. Real-Time BroadcastChannel:
 *    - Streams live comms telemetry at 1 Hz to secondary window via `orion-antenna-sync`
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.OrionAntennaPlugin = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const NAMESPACE = 'orion.antenna';

    const ANTENNA_DEFINITIONS = [
        { key: 'uplink', name: 'Uplink Rate (Tx)', unit: 'Mbps', color: '#06b6d4', shortName: 'UPLINK', min: 0, max: 150 },
        { key: 'downlink', name: 'Downlink Rate (Rx)', unit: 'Mbps', color: '#10b981', shortName: 'DOWNLINK', min: 0, max: 300 },
        { key: 'rssi', name: 'Signal Strength (RSSI)', unit: 'dBm', color: '#f59e0b', shortName: 'RSSI', min: -100, max: -30 },
        { key: 'snr', name: 'Signal-to-Noise Ratio (SNR)', unit: 'dB', color: '#38bdf8', shortName: 'SNR', min: 0, max: 50 },
        { key: 'quality', name: 'Link Quality', unit: '%', color: '#a855f7', shortName: 'QUALITY', min: 0, max: 100 },
        { key: 'latency', name: 'Latency (RTT)', unit: 'ms', color: '#ec4899', shortName: 'LATENCY', min: 0, max: 100 },
        { key: 'packet_loss', name: 'Packet Loss', unit: '%', color: '#ef4444', shortName: 'LOSS', min: 0, max: 10 }
    ];

    return function OrionAntennaPlugin(options) {
        options = options || {};

        const brokerUrl = options.brokerUrl || 'ws://localhost:9001';
        const topic = options.topic || 'rover/antenna/#';
        const customParser = typeof options.parseMessage === 'function' ? options.parseMessage : null;

        // Current telemetry state (starts unpopulated / waiting for MQTT ingress)
        const currentState = {
            uplink: null,       // Mbps
            downlink: null,     // Mbps
            rssi: null,         // dBm
            snr: null,          // dB
            quality: null,      // %
            latency: null,      // ms
            packet_loss: null   // %
        };

        // Ring buffer history for telemetry objects and chart (empty until data arrives)
        const historyData = {
            uplink: [],
            downlink: [],
            rssi: [],
            snr: [],
            quality: [],
            latency: [],
            packet_loss: []
        };
        const MAX_HISTORY_POINTS = 600;

        // BroadcastChannel to synchronize secondary details window
        let broadcastChan = null;
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                broadcastChan = new BroadcastChannel('orion-antenna-sync');
            } catch (e) {
                console.warn('[Orion Antenna] BroadcastChannel unavailable:', e);
            }
        }

        // Subscribers for Open MCT real-time telemetry
        const subscribers = {
            uplink: new Set(),
            downlink: new Set(),
            rssi: new Set(),
            snr: new Set(),
            quality: new Set(),
            latency: new Set(),
            packet_loss: new Set()
        };

        const indicatorCallbacks = [];
        let isMqttConnected = false;
        let lastMqttMessageTime = 0;
        let mqttClient = null;

        function updateReading(key, value, timestamp) {
            timestamp = timestamp || Date.now();
            currentState[key] = value;

            const point = { timestamp: timestamp, value: value };
            const hist = historyData[key];
            if (hist) {
                hist.push(point);
                if (hist.length > MAX_HISTORY_POINTS) {
                    hist.shift();
                }
            }

            if (subscribers[key]) {
                subscribers[key].forEach(function (cb) {
                    try { cb(point); } catch (e) { console.error(e); }
                });
            }
        }

        let openmctInstance = null;
        let activeAlerts = [];
        const notifiedAlertIds = new Set();

        function triggerOpenMctNotification(alert) {
            const sevUpper = alert.severity ? alert.severity.toUpperCase() : 'NOTICE';
            console.warn(`[Antenna Alert] [${sevUpper}] ${alert.title}: ${alert.explainer}`);

            if (openmctInstance && openmctInstance.notifications) {
                const fullMsg = `[${sevUpper}] ${alert.title}: ${alert.explainer}`;
                try {
                    if (alert.severity === 'critical' || alert.severity === 'error') {
                        if (typeof openmctInstance.notifications.error === 'function') {
                            openmctInstance.notifications.error(fullMsg);
                        }
                    } else if (alert.severity === 'warning') {
                        if (typeof openmctInstance.notifications.alert === 'function') {
                            openmctInstance.notifications.alert(fullMsg);
                        }
                    } else if (alert.severity === 'notice' || alert.severity === 'info') {
                        if (typeof openmctInstance.notifications.info === 'function') {
                            openmctInstance.notifications.info(fullMsg);
                        }
                    }
                } catch (e) {
                    console.warn('[Orion Antenna] Notification error:', e);
                }
            }
        }

        function evaluateAntennaHealth() {
            const currentAlerts = [];
            const now = Date.now();

            if (!isMqttConnected) {
                currentAlerts.push({
                    id: 'rf_mqtt_offline',
                    target: 'MQTT Transport',
                    severity: 'critical',
                    title: 'MQTT Broker Offline (192.168.1.1:1883)',
                    explainer: 'Native TCP bridge to Mosquitto broker at 192.168.1.1:1883 is offline. 5GHz RF Comms telemetry pipeline is unavailable.'
                });
            } else if (lastMqttMessageTime === 0) {
                currentAlerts.push({
                    id: 'rf_mqtt_awaiting',
                    target: 'MQTT Ingress',
                    severity: 'warning',
                    title: 'Awaiting Telemetry Ingress (rover/antenna/#)',
                    explainer: 'Connected to Mosquitto broker at 192.168.1.1:1883. Awaiting first RF link telemetry packet on rover/antenna/# or rover/compute/telemetry.'
                });
            } else {
                const isRecent = (now - lastMqttMessageTime) < 6000;
                if (!isRecent) {
                    const lapsedSec = Math.round((now - lastMqttMessageTime) / 1000);
                    currentAlerts.push({
                        id: 'rf_mqtt_telemetry_timeout',
                        target: 'RF Telemetry',
                        severity: 'critical',
                        title: `5GHz Telemetry Loss (${lapsedSec}s Stale)`,
                        explainer: `No RF comms telemetry packets received on topic ${topic} for ${lapsedSec} seconds. Carrier link status cannot be verified.`
                    });
                }
            }

            // Only evaluate RF Link Quality metrics if we have received real data
            const rssi = currentState.rssi;
            const qual = currentState.quality;
            const loss = currentState.packet_loss;
            const lat = currentState.latency;

            if (rssi !== null && qual !== null) {
                if (rssi < -82.0 || qual < 30.0) {
                    currentAlerts.push({
                        id: 'rf_carrier_critical',
                        target: '5GHz Link',
                        severity: 'critical',
                        title: `5GHz Carrier Link Critical (${rssi.toFixed(1)} dBm / ${qual.toFixed(0)}%)`,
                        explainer: `Signal attenuation is near the IEEE 802.11ac demodulation floor. Severe packet drops or imminent loss of telecommand uplink expected.`
                    });
                } else if (rssi < -72.0 || qual < 65.0) {
                    currentAlerts.push({
                        id: 'rf_carrier_degraded',
                        target: '5GHz Link',
                        severity: 'warning',
                        title: `5GHz Signal Margin Degraded (${rssi.toFixed(1)} dBm / ${qual.toFixed(0)}%)`,
                        explainer: `RF link margin is degraded below 65%. Check rover distance, mast elevation, or multi-path interference on Channel 36.`
                    });
                } else {
                    currentAlerts.push({
                        id: 'rf_carrier_nominal',
                        target: '5GHz Link',
                        severity: 'notice',
                        title: `5GHz RF Link Nominal (${rssi.toFixed(1)} dBm / ${qual.toFixed(0)}%)`,
                        explainer: `Dual-stream IEEE 802.11ac link established. Uplink: ${(currentState.uplink || 0).toFixed(1)} Mbps, Downlink: ${(currentState.downlink || 0).toFixed(1)} Mbps.`
                    });
                }

                if (loss !== null && loss > 3.0) {
                    currentAlerts.push({
                        id: 'rf_loss_critical',
                        target: 'RF Interface',
                        severity: 'critical',
                        title: `Excessive Packet Loss (${loss.toFixed(2)}%)`,
                        explainer: `Frame error rate exceeds 3.0% on UNII-1 band. Telemetry frames are being dropped.`
                    });
                } else if (loss !== null && loss >= 1.0) {
                    currentAlerts.push({
                        id: 'rf_loss_warning',
                        target: 'RF Interface',
                        severity: 'warning',
                        title: `Elevated Packet Loss (${loss.toFixed(2)}%)`,
                        explainer: `Packet retransmissions detected on 5GHz antenna array. Throughput jitter likely.`
                    });
                }

                if (lat !== null && lat > 60.0) {
                    currentAlerts.push({
                        id: 'rf_latency_critical',
                        target: 'RF Interface',
                        severity: 'critical',
                        title: `Severe Ping Latency Spike (${lat.toFixed(1)} ms)`,
                        explainer: `Round-trip time exceeds 60ms threshold. Teleoperation commands may experience delay.`
                    });
                } else if (lat !== null && lat >= 35.0) {
                    currentAlerts.push({
                        id: 'rf_latency_warning',
                        target: 'RF Interface',
                        severity: 'warning',
                        title: `Elevated RTT Latency (${lat.toFixed(1)} ms)`,
                        explainer: `Round-trip latency is higher than 35ms nominal budget.`
                    });
                }
            }

            // Trigger notifications for new alerts
            currentAlerts.forEach(a => {
                if (!notifiedAlertIds.has(a.id)) {
                    notifiedAlertIds.add(a.id);
                    triggerOpenMctNotification(a);
                }
            });

            // Clean up cleared alerts
            const currentIds = new Set(currentAlerts.map(a => a.id));
            notifiedAlertIds.forEach(id => {
                if (!currentIds.has(id)) {
                    notifiedAlertIds.delete(id);
                }
            });

            activeAlerts = currentAlerts;
        }

        function broadcastSync() {
            evaluateAntennaHealth();

            if (broadcastChan) {
                try {
                    broadcastChan.postMessage({
                        state: Object.assign({}, currentState),
                        history: historyData,
                        alerts: activeAlerts,
                        status: {
                            connected: isMqttConnected && (Date.now() - lastMqttMessageTime < 5000),
                            active: isMqttConnected,
                            label: (isMqttConnected && (Date.now() - lastMqttMessageTime < 5000))
                                ? '5GHz LINK ACTIVE (MQTT)'
                                : '5GHz LINK (SIMULATED / PLACEHOLDER)'
                        }
                    });
                } catch (e) {
                    // Ignore transient channel errors
                }
            }

            indicatorCallbacks.forEach(function (cb) {
                try { cb(); } catch (e) { console.error(e); }
            });
        }

        // MQTT payload parser
        function parseMqttMessage(msgTopic, messageStr) {
            if (customParser) {
                try {
                    const res = customParser(msgTopic, messageStr);
                    if (res) {
                        const ts = Date.now();
                        if (typeof res.uplink === 'number') updateReading('uplink', res.uplink, ts);
                        if (typeof res.downlink === 'number') updateReading('downlink', res.downlink, ts);
                        if (typeof res.rssi === 'number') updateReading('rssi', res.rssi, ts);
                        if (typeof res.snr === 'number') updateReading('snr', res.snr, ts);
                        if (typeof res.quality === 'number') updateReading('quality', res.quality, ts);
                        if (typeof res.latency === 'number') updateReading('latency', res.latency, ts);
                        if (typeof res.packet_loss === 'number') updateReading('packet_loss', res.packet_loss, ts);
                        broadcastSync();
                        return true;
                    }
                } catch (e) {
                    console.warn('[Orion Antenna] Custom parser error:', e);
                }
            }

            let parsed = null;
            try {
                parsed = JSON.parse(messageStr);
            } catch (_) {
                const num = parseFloat(messageStr);
                if (!isNaN(num)) {
                    if (msgTopic.includes('uplink') || msgTopic.includes('tx')) updateReading('uplink', num);
                    else if (msgTopic.includes('downlink') || msgTopic.includes('rx')) updateReading('downlink', num);
                    else if (msgTopic.includes('rssi')) updateReading('rssi', num);
                    else if (msgTopic.includes('quality')) updateReading('quality', num);
                    broadcastSync();
                    return true;
                }
            }

            if (parsed && typeof parsed === 'object') {
                const ts = Date.now();
                if (typeof parsed.uplink === 'number') updateReading('uplink', parsed.uplink, ts);
                if (typeof parsed.downlink === 'number') updateReading('downlink', parsed.downlink, ts);
                if (typeof parsed.rssi === 'number') updateReading('rssi', parsed.rssi, ts);
                if (typeof parsed.snr === 'number') updateReading('snr', parsed.snr, ts);
                if (typeof parsed.quality === 'number') updateReading('quality', parsed.quality, ts);
                if (typeof parsed.latency === 'number') updateReading('latency', parsed.latency, ts);
                if (typeof parsed.packet_loss === 'number') updateReading('packet_loss', parsed.packet_loss, ts);
                broadcastSync();
                return true;
            }

            return false;
        }

        function initMQTT() {
            const mqttLib = (typeof window !== 'undefined' && window.mqtt) ? window.mqtt : null;
            if (!mqttLib) {
                console.log('[Orion Antenna] mqtt.js not loaded in window, running in smart simulation mode.');
                return;
            }

            try {
                mqttClient = mqttLib.connect(brokerUrl, {
                    keepalive: 30,
                    reconnectPeriod: 5000,
                    connectTimeout: 4000
                });

                mqttClient.on('connect', function () {
                    isMqttConnected = true;
                    console.log(`[Orion Antenna] Connected to MQTT broker: ${brokerUrl}`);
                    mqttClient.subscribe(topic, function (err) {
                        if (err) console.error('[Orion Antenna] MQTT subscribe error:', err);
                        else console.log(`[Orion Antenna] Subscribed to topic: ${topic}`);
                    });
                });

                mqttClient.on('message', function (msgTopic, payload) {
                    lastMqttMessageTime = Date.now();
                    try {
                        parseMqttMessage(msgTopic, payload.toString());
                    } catch (e) {
                        console.warn('[Orion Antenna] Error processing message:', e);
                    }
                });

                mqttClient.on('close', function () { isMqttConnected = false; });
                mqttClient.on('error', function (err) { console.warn('[Orion Antenna] MQTT error:', err.message); });
            } catch (err) {
                console.warn('[Orion Antenna] MQTT init failed:', err.message);
            }
        }

        // Smart Stochastic Simulator / Placeholder (5GHz Wi-Fi Link Dynamics)
        let simInterval = null;
        function startSimulator() {
            if (simInterval) clearInterval(simInterval);

            simInterval = setInterval(function () {
                // If real MQTT packets received within last 5s, pause simulator
                if (isMqttConnected && (Date.now() - lastMqttMessageTime < 5000)) {
                    return;
                }

                const ts = Date.now();
                const tSec = ts / 1000;

                // 5GHz RF fluctuations: path fading, multipath, slight throughput jitter
                const jitterUp = (Math.random() - 0.5) * 4.0;
                const jitterDown = (Math.random() - 0.5) * 12.0;
                const waveRssi = Math.sin(tSec / 12) * 2.5 + (Math.random() - 0.5) * 1.5;

                const newRssi = Math.max(-88, Math.min(-42, -58.0 + waveRssi));
                const newSnr = Math.max(14, Math.min(45, (newRssi + 92.0) * 0.95 + (Math.random() - 0.5)));

                // Link quality derived from RSSI & SNR
                const normQuality = Math.max(20, Math.min(100, ((newRssi + 85) / 45) * 100));

                // Throughput scales with link quality with random packet bursts
                const burst = Math.sin(tSec / 6) > 0.6 ? 12 : 0;
                const newUp = Math.max(15, Math.min(95, 48.0 * (normQuality / 100) + burst + jitterUp));
                const newDown = Math.max(40, Math.min(260, 130.0 * (normQuality / 100) + burst * 2.5 + jitterDown));

                // Latency increases when RSSI drops
                const newLatency = Math.max(8, Math.min(65, 12.0 + ((-newRssi - 50) * 0.5) + (Math.random() * 3)));
                const newLoss = Math.max(0, Math.min(1.5, newRssi < -75 ? (Math.random() * 0.8) : 0.05));

                updateReading('uplink', parseFloat(newUp.toFixed(1)), ts);
                updateReading('downlink', parseFloat(newDown.toFixed(1)), ts);
                updateReading('rssi', parseFloat(newRssi.toFixed(1)), ts);
                updateReading('snr', parseFloat(newSnr.toFixed(1)), ts);
                updateReading('quality', parseFloat(normQuality.toFixed(1)), ts);
                updateReading('latency', parseFloat(newLatency.toFixed(1)), ts);
                updateReading('packet_loss', parseFloat(newLoss.toFixed(2)), ts);

                broadcastSync();
            }, 1000);
        }

        initMQTT();
        if (options.enableSimulator) {
            startSimulator();
        }

        // Main Plugin Installation function for Open MCT
        return function install(openmct) {
            openmctInstance = openmct;
            console.log('[Orion Antenna] Installing 5GHz Wi-Fi Antenna RF Comms Telemetry Plugin...');

            // 1. Root Folder in Telemetry Tree
            openmct.objects.addRoot({
                namespace: NAMESPACE,
                key: 'root'
            });

            // 2. Object Provider
            const objectProvider = {
                get: function (identifier) {
                    if (identifier.key === 'root') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Orion Rover RF Comms (5GHz)',
                            type: 'folder',
                            location: 'ROOT'
                        });
                    }

                    if (identifier.key === 'overlay_plot') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'RF Comms Throughput & Signal Plot',
                            type: 'telemetry.plot.overlay',
                            location: `${NAMESPACE}:root`
                        });
                    }

                    const def = ANTENNA_DEFINITIONS.find(function (d) { return d.key === identifier.key; });
                    if (def) {
                        return Promise.resolve({
                            identifier: identifier,
                            name: def.name,
                            type: 'orion.antenna.telemetry',
                            telemetry: {
                                values: [
                                    {
                                        key: 'value',
                                        name: 'Value',
                                        unit: def.unit,
                                        format: 'number',
                                        hints: {
                                            range: 1
                                        }
                                    },
                                    {
                                        key: 'utc',
                                        source: 'timestamp',
                                        name: 'Timestamp',
                                        format: 'utc',
                                        hints: {
                                            domain: 1
                                        }
                                    }
                                ]
                            },
                            location: `${NAMESPACE}:root`
                        });
                    }

                    return Promise.reject(new Error(`Antenna object not found: ${identifier.key}`));
                }
            };
            openmct.objects.addProvider(NAMESPACE, objectProvider);

            // 3. Composition Provider
            const compositionProvider = {
                appliesTo: function (domainObject) {
                    return domainObject.identifier.namespace === NAMESPACE &&
                           (domainObject.identifier.key === 'root' || domainObject.identifier.key === 'overlay_plot');
                },
                load: function (domainObject) {
                    if (domainObject.identifier.key === 'root') {
                        const items = ANTENNA_DEFINITIONS.map(function (d) {
                            return { namespace: NAMESPACE, key: d.key };
                        });
                        items.push({ namespace: NAMESPACE, key: 'overlay_plot' });
                        return Promise.resolve(items);
                    }
                    if (domainObject.identifier.key === 'overlay_plot') {
                        return Promise.resolve(
                            ANTENNA_DEFINITIONS.filter(function (d) {
                                return ['uplink', 'downlink', 'quality'].includes(d.key);
                            }).map(function (d) {
                                return { namespace: NAMESPACE, key: d.key };
                            })
                        );
                    }
                    return Promise.resolve([]);
                }
            };
            openmct.composition.addProvider(compositionProvider);

            // 4. Custom Telemetry Type
            openmct.types.addType('orion.antenna.telemetry', {
                name: 'RF Comms Point (5GHz)',
                description: 'Telemetry point for Orion Rover 5GHz Wi-Fi uplink/downlink and link quality.',
                cssClass: 'icon-telemetry'
            });

            // 5. Real-Time Telemetry Provider
            const realtimeProvider = {
                supportsSubscribe: function (domainObject) {
                    return domainObject.identifier.namespace === NAMESPACE &&
                           ANTENNA_DEFINITIONS.some(function (d) { return d.key === domainObject.identifier.key; });
                },
                subscribe: function (domainObject, callback) {
                    const key = domainObject.identifier.key;
                    if (subscribers[key]) {
                        subscribers[key].add(callback);
                        if (historyData[key] && historyData[key].length > 0) {
                            callback(historyData[key][historyData[key].length - 1]);
                        }
                    }
                    return function unsubscribe() {
                        if (subscribers[key]) {
                            subscribers[key].delete(callback);
                        }
                    };
                }
            };
            openmct.telemetry.addProvider(realtimeProvider);

            // 6. Historical Telemetry Provider
            const historicalProvider = {
                supportsRequest: function (domainObject) {
                    return domainObject.identifier.namespace === NAMESPACE &&
                           ANTENNA_DEFINITIONS.some(function (d) { return d.key === domainObject.identifier.key; });
                },
                request: function (domainObject, reqOptions) {
                    const key = domainObject.identifier.key;
                    const hist = historyData[key] || [];
                    const start = reqOptions.start || 0;
                    const end = reqOptions.end || Infinity;

                    const filtered = hist.filter(function (p) {
                        return p.timestamp >= start && p.timestamp <= end;
                    });

                    return Promise.resolve(filtered);
                }
            };
            openmct.telemetry.addProvider(historicalProvider);

            // 7. Upper Panel Antenna Indicator (Wi-Fi 5GHz Link Icon + Uplink/Downlink Rates + Click to Open Window)
            if (openmct.indicators && typeof document !== 'undefined') {
                const indicatorEl = document.createElement('div');
                indicatorEl.className = 'c-indicator c-indicator--clickable orion-antenna-indicator';
                indicatorEl.style.display = 'inline-flex';
                indicatorEl.style.alignItems = 'center';
                indicatorEl.style.gap = '8px';
                indicatorEl.style.padding = '0 8px';
                indicatorEl.style.margin = '0 4px';
                indicatorEl.style.height = '24px';
                indicatorEl.style.borderRadius = '0px';
                indicatorEl.style.cursor = 'pointer';
                indicatorEl.style.userSelect = 'none';
                indicatorEl.style.background = '#161616';
                indicatorEl.style.border = '1px solid #282828';
                indicatorEl.title = '5GHz Wi-Fi Antenna Link. Click to open detailed RF Comms Diagnostics window.';

                indicatorEl.innerHTML = `
                    <div id="ind-ant-led" style="width: 7px; height: 7px; border-radius: 0px; background: #64748b; flex-shrink: 0;"></div>
                    <span id="ind-ant-text" style="font-size: 11px; font-weight: 700; font-family: monospace; letter-spacing: -0.2px; color: #f8fafc; pointer-events: none;">5GHz: NO LINK</span>
                `;

                indicatorEl.addEventListener('mouseenter', function () {
                    indicatorEl.style.background = '#222222';
                    indicatorEl.style.borderColor = '#38bdf8';
                });
                indicatorEl.addEventListener('mouseleave', function () {
                    indicatorEl.style.background = '#161616';
                    indicatorEl.style.borderColor = '#282828';
                });

                // Click opens secondary detailed RF window
                indicatorEl.addEventListener('click', function () {
                    window.open('/antenna-details.html', 'OrionAntennaDetailsWindow', 'width=960,height=680,resizable=yes');
                });

                // Register with Open MCT indicators (priority 95, just beside battery at 100)
                openmct.indicators.add({
                    element: indicatorEl,
                    priority: 95
                });

                const ledEl = indicatorEl.querySelector('#ind-ant-led');
                const textEl = indicatorEl.querySelector('#ind-ant-text');

                function updateIndicatorView() {
                    const up = currentState.uplink;
                    const down = currentState.downlink;
                    const rssi = currentState.rssi;
                    const qual = currentState.quality;

                    if (up === null || down === null || rssi === null) {
                        if (textEl) textEl.innerText = '5GHz: NO LINK';
                        if (ledEl) ledEl.style.background = '#64748b';
                        indicatorEl.style.borderColor = '#282828';
                        indicatorEl.style.background = '#161616';
                        indicatorEl.title = '5GHz Wi-Fi Antenna Link\nSTATUS: NOT CONNECTED (Awaiting MQTT 192.168.1.1:1883)\nClick to open detailed RF Comms Diagnostics window.';
                        return;
                    }

                    if (textEl) {
                        textEl.innerText = `5GHz: ${rssi.toFixed(0)} dBm | ${Math.round(down)}M`;
                    }

                    // Color code based on signal strength
                    let color = '#22c55e'; // Green (good)
                    if (rssi < -80 || qual < 40) {
                        color = '#ef4444'; // Red (poor)
                    } else if (rssi < -65 || qual < 70) {
                        color = '#f59e0b'; // Amber (fair)
                    }

                    if (ledEl) ledEl.style.background = color;

                    if (color === '#ef4444') {
                        indicatorEl.style.borderColor = '#ef4444';
                        indicatorEl.style.background = '#7f1d1d33';
                    } else if (color === '#f59e0b') {
                        indicatorEl.style.borderColor = '#f59e0b';
                        indicatorEl.style.background = '#78350f33';
                    } else {
                        indicatorEl.style.borderColor = '#282828';
                        indicatorEl.style.background = '#161616';
                    }

                    indicatorEl.title = `Orion Rover 5GHz Wi-Fi Antenna Link\nUplink: ${up.toFixed(1)} Mbps | Downlink: ${down.toFixed(1)} Mbps\nRSSI: ${rssi.toFixed(1)} dBm | SNR: ${(currentState.snr || 0).toFixed(1)} dB | Quality: ${(qual || 0).toFixed(1)}%\nClick to open detailed RF Comms Diagnostics window.`;
                }

                indicatorCallbacks.push(updateIndicatorView);
                updateIndicatorView();
            }

            console.log('[Orion Antenna] Plugin installed successfully.');
        };
    };
}));

