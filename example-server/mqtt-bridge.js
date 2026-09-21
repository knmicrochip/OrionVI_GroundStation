/**
 * MQTT Bridge for Orion Rover Open MCT Server
 * 
 * Bridges native TCP MQTT broker (e.g. mosquitto at 192.168.1.1:1883)
 * to browser clients via local WebSocket (/mqtt-bridge).
 */

const express = require('express');
const mqtt = require('mqtt');

function createMqttBridge(options) {
    options = options || {};
    const router = express.Router();

    let brokerUrl = options.brokerUrl || process.env.MQTT_BROKER_URL || 'mqtt://192.168.1.1:1883';
    const defaultTopics = ['Power/feedback', 'power/feedback', 'Power/#', 'power/#', 'rover/#', 'rover/power/#', 'rover/log', 'rover/logs', 'rover/logs/#', 'rover/syslog'];
    if (process.env.MQTT_LOG_TOPIC && !defaultTopics.includes(process.env.MQTT_LOG_TOPIC)) {
        defaultTopics.push(process.env.MQTT_LOG_TOPIC);
    }
    const topics = options.topics || defaultTopics;

    let mqttClient = null;
    let isConnected = false;
    let lastMessageTime = 0;
    let latestPacket = null;
    let clients = new Set();

    function connectMqtt() {
        if (mqttClient) {
            try { mqttClient.end(true); } catch (_) {}
        }

        console.log(`[MQTT Bridge] Connecting to TCP MQTT broker at ${brokerUrl}...`);
        mqttClient = mqtt.connect(brokerUrl, {
            keepalive: 30,
            reconnectPeriod: 3000,
            connectTimeout: 5000,
            clientId: 'openmct_bridge_' + Math.random().toString(16).substring(2, 8)
        });

        mqttClient.on('connect', () => {
            isConnected = true;
            console.log(`[MQTT Bridge] Successfully connected to ${brokerUrl}`);
            topics.forEach(t => {
                mqttClient.subscribe(t, (err) => {
                    if (err) console.error(`[MQTT Bridge] Failed to subscribe to ${t}:`, err);
                    else console.log(`[MQTT Bridge] Subscribed to topic: ${t}`);
                });
            });
            broadcastStatus();
        });

        mqttClient.on('message', (topic, payload) => {
            lastMessageTime = Date.now();
            const rawStr = payload.toString();
            let parsed = null;
            try {
                parsed = JSON.parse(rawStr);
            } catch (_) {
                // Non-JSON payload
            }

            const msgObj = {
                type: 'mqtt_message',
                topic: topic,
                payload: rawStr,
                data: parsed,
                timestamp: lastMessageTime
            };

            latestPacket = msgObj;

            if (typeof options.onMessage === 'function') {
                try {
                    options.onMessage(topic, rawStr, parsed);
                } catch (e) {
                    console.error('[MQTT Bridge] onMessage handler error:', e);
                }
            }

            // Broadcast to all connected WebSocket clients
            const jsonMsg = JSON.stringify(msgObj);
            clients.forEach(ws => {
                if (ws.readyState === 1 /* OPEN */) {
                    try { ws.send(jsonMsg); } catch (e) { /* ignore */ }
                }
            });
        });

        mqttClient.on('close', () => {
            if (isConnected) {
                console.log('[MQTT Bridge] Connection closed, will retry...');
            }
            isConnected = false;
            broadcastStatus();
        });

        let _lastMqttErrorLog = 0;
        mqttClient.on('error', (err) => {
            const now = Date.now();
            // Only log once per 30 seconds to avoid terminal spam when rover is offline
            if (now - _lastMqttErrorLog > 30000) {
                _lastMqttErrorLog = now;
                console.warn(`[MQTT Bridge] Broker unreachable (${brokerUrl}): ${err.message} — retrying...`);
            }
            isConnected = false;
            broadcastStatus();
        });
    }

    function broadcastStatus() {
        const statusMsg = JSON.stringify({
            type: 'mqtt_status',
            connected: isConnected,
            brokerUrl: brokerUrl,
            lastMessageTime: lastMessageTime
        });
        clients.forEach(ws => {
            if (ws.readyState === 1) {
                try { ws.send(statusMsg); } catch (_) {}
            }
        });
    }

    // WebSocket endpoint: /mqtt-bridge
    router.ws('/', (ws) => {
        clients.add(ws);

        // Send current connection status and latest packet immediately
        ws.send(JSON.stringify({
            type: 'mqtt_status',
            connected: isConnected,
            brokerUrl: brokerUrl,
            lastMessageTime: lastMessageTime
        }));

        if (latestPacket) {
            ws.send(JSON.stringify(latestPacket));
        }

        ws.on('message', (data) => {
            try {
                const req = JSON.parse(data);
                if (req.action === 'reconnect' && req.brokerUrl) {
                    brokerUrl = req.brokerUrl;
                    connectMqtt();
                } else if (req.action === 'publish' && isConnected && mqttClient) {
                    mqttClient.publish(req.topic, req.payload);
                }
            } catch (_) {}
        });

        ws.on('close', () => {
            clients.delete(ws);
        });
    });

    // REST API endpoints
    router.get('/status', (req, res) => {
        res.json({
            connected: isConnected,
            brokerUrl: brokerUrl,
            lastMessageTime: lastMessageTime,
            latestPacket: latestPacket
        });
    });

    router.post('/config', express.json(), (req, res) => {
        if (req.body && req.body.brokerUrl) {
            brokerUrl = req.body.brokerUrl;
            connectMqtt();
            return res.json({ success: true, brokerUrl: brokerUrl });
        }
        res.status(400).json({ error: 'Missing brokerUrl' });
    });

    // Start MQTT connection
    connectMqtt();

    return {
        router: router,
        getStatus: () => ({ isConnected, brokerUrl, lastMessageTime, latestPacket })
    };
}

module.exports = createMqttBridge;

