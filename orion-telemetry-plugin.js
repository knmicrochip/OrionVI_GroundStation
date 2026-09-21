/**
 * Orion VI Telemetry Provider Plugin (ERC 2026)
 * Integrates Open MCT with the Orion GS Gateway:
 * - Realtime streaming over WebSocket (/realtime)
 * - Historical range queries over REST (/history/:pointId)
 */

(function () {
    function OrionTelemetryPlugin(options) {
        options = options || {};
        const wsUrl = options.wsUrl || (window.location.origin.replace(/^http/, 'ws') + '/realtime');
        const historyBaseUrl = options.historyBaseUrl || '/history';

        return function install(openmct) {
            let socket = null;
            let isConnected = false;
            const listeners = new Map(); // id -> Set<Function>
            let reconnectTimer = null;

            function connectWs() {
                if (socket) {
                    try { socket.close(); } catch (_) {}
                }

                socket = new WebSocket(wsUrl);

                socket.onopen = function () {
                    isConnected = true;
                    // Resubscribe to all active telemetry keys
                    listeners.forEach((_, key) => {
                        try {
                            socket.send(JSON.stringify({ action: 'subscribe', id: key }));
                        } catch (_) {}
                    });
                };

                socket.onmessage = function (event) {
                    try {
                        const point = JSON.parse(event.data);
                        if (!point || !point.id) return;
                        if (point.met === undefined && typeof window !== 'undefined' && window.OrionTaskManager) {
                            point.met = window.OrionTaskManager.getMETMilliseconds();
                        }

                        const set = listeners.get(point.id);
                        if (set) {
                            set.forEach(cb => cb(point));
                        }
                    } catch (e) {
                        // ignore malformed packets
                    }
                };

                socket.onclose = function () {
                    isConnected = false;
                    if (!reconnectTimer) {
                        reconnectTimer = setTimeout(() => {
                            reconnectTimer = null;
                            connectWs();
                        }, 2000);
                    }
                };

                socket.onerror = function () {
                    try { socket.close(); } catch (_) {}
                };
            }

            connectWs();

            // Register Realtime Provider
            openmct.telemetry.addProvider({
                supportsSubscribe: function (domainObject) {
                    return domainObject.type === 'orion.telemetry';
                },
                subscribe: function (domainObject, callback) {
                    const key = domainObject.identifier.key;
                    if (!listeners.has(key)) {
                        listeners.set(key, new Set());
                    }
                    listeners.get(key).add(callback);

                    if (isConnected && socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ action: 'subscribe', id: key }));
                    }

                    return function unsubscribe() {
                        const set = listeners.get(key);
                        if (set) {
                            set.delete(callback);
                            if (set.size === 0) {
                                listeners.delete(key);
                                if (isConnected && socket && socket.readyState === WebSocket.OPEN) {
                                    socket.send(JSON.stringify({ action: 'unsubscribe', id: key }));
                                }
                            }
                        }
                    };
                }
            });

            // Register Historical Provider
            openmct.telemetry.addProvider({
                supportsRequest: function (domainObject) {
                    return domainObject.type === 'orion.telemetry';
                },
                request: function (domainObject, reqOptions) {
                    const key = domainObject.identifier.key;
                    const url = `${historyBaseUrl}/${key}?start=${reqOptions.start}&end=${reqOptions.end}`;

                    return fetch(url)
                        .then(res => res.json())
                        .then(data => {
                            if (!Array.isArray(data)) return [];
                            return data.map(item => ({
                                id: item.id || key,
                                utc: item.utc || item.timestamp,
                                met: item.met !== undefined ? item.met : (typeof window !== 'undefined' && window.OrionTaskManager ? window.OrionTaskManager.getMETMilliseconds() : 0),
                                value: item.value
                            }));
                        })
                        .catch(err => {
                            console.warn(`[Orion Telemetry] History request error for ${key}:`, err);
                            return [];
                        });
                }
            });
        };
    }

    if (typeof window !== 'undefined') {
        window.OrionTelemetryPlugin = OrionTelemetryPlugin;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionTelemetryPlugin;
    }
})();

