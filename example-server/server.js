/**
 * Orion VI Ground Station Gateway Server (ERC 2026)
 * Express + WebSocket + MQTT Bridge + Telemetry Gateway
 */

var http = require('http');
var express = require('express');
var expressWs = require('express-ws');
var Spacecraft = require('./spacecraft');
var RealtimeServer = require('./realtime-server');
var HistoryServer = require('./history-server');
var StaticServer = require('./static-server');
var createMqttBridge = require('./mqtt-bridge');
var TelemetryGateway = require('./telemetry-gateway');

function createServer() {
    var app = express();
    var server = http.createServer(app);
    expressWs(app, server);

    // Support JSON body parsing
    app.use(express.json());

    // By default, do NOT simulate data unless explicitly requested
    var isSimMode = process.env.ORION_SIM_MODE === 'true';

    var gateway = new TelemetryGateway({
        isSimMode: isSimMode
    });

    var spacecraft = new Spacecraft();
    var realtimeServer = new RealtimeServer(spacecraft, gateway);
    var historyServer = new HistoryServer(spacecraft, gateway);
    var staticServer = new StaticServer();

    var mqttBridge = createMqttBridge({
        brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://192.168.1.1:1883',
        onMessage: function (topic, rawStr, parsed) {
            gateway.ingestMqttMessage(topic, rawStr, parsed);
        }
    });

    // Core Telemetry & Static Routes
    app.use('/realtime', realtimeServer);
    app.use('/history', historyServer);
    app.use('/mqtt-bridge', mqttBridge.router);

    // REST API for Orion Commanding & Gateway Control
    app.post('/api/command', function (req, res) {
        if (!req.body || !req.body.action) {
            return res.status(400).json({ error: 'Missing action in command body' });
        }
        var result = gateway.executeCommand(req.body);
        res.json(result);
    });

    // Ingest mock telemetry payloads for testing
    app.post('/api/inject-telemetry', function (req, res) {
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid JSON payload' });
        }
        var count = 0;
        Object.keys(req.body).forEach(function (topic) {
            gateway.ingestSubsystemPayload(topic, req.body[topic]);
            count++;
        });
        res.json({ success: true, topicsUpdated: count });
    });

    app.get('/api/gateway/status', function (req, res) {
        res.json({
            isSimMode: gateway.isSimMode,
            historyPointsCount: gateway.history.size,
            subscribersCount: gateway.subscribers.size,
            estopActive: gateway.estopActive,
            activeTaskState: gateway.activeTaskState,
            lastTelemetryTime: gateway.lastTelemetryTime,
            mqttStatus: mqttBridge.getStatus()
        });
    });

    app.post('/api/gateway/mode', function (req, res) {
        if (req.body && req.body.simMode !== undefined) {
            gateway.setSimMode(req.body.simMode);
            return res.json({ success: true, isSimMode: gateway.isSimMode });
        }
        res.status(400).json({ error: 'Missing simMode boolean parameter' });
    });

    // Static Server (mounted last)
    app.use('/', staticServer);

    return { app: app, server: server, gateway: gateway, mqttBridge: mqttBridge };
}

function startServer(port) {
    port = port !== undefined ? port : (process.env.PORT || 8088);
    var bundle = createServer();
    var server = bundle.server;

    return new Promise(function (resolve, reject) {
        server.on('error', function (err) {
            reject(err);
        });

        server.listen(port, function () {
            var actualPort = server.address().port;
            console.log('[Orion Gateway] Hosted at http://localhost:' + actualPort);
            console.log('[Orion Gateway] History at http://localhost:' + actualPort + '/history');
            console.log('[Orion Gateway] Realtime WS at ws://localhost:' + actualPort + '/realtime');
            console.log('[Orion Gateway] Simulation Mode: ' + (bundle.gateway.isSimMode ? 'ACTIVE' : 'OFF (AWAITING MQTT)'));
            resolve({ server: server, port: actualPort, gateway: bundle.gateway });
        });
    });
}

if (require.main === module) {
    startServer();
}

module.exports = {
    createServer: createServer,
    startServer: startServer
};
