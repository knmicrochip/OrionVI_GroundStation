var express = require('express');

function RealtimeServer(spacecraft, gateway) {
    var router = express.Router();

    router.ws('/', function (ws) {
        var subscribed = {}; // Active subscriptions for this connection
        var unlistenSpacecraft = spacecraft ? spacecraft.listen(notifySpacecraft) : function () {};
        var unlistenGateway = gateway ? gateway.subscribe(notifyGateway) : function () {};

        function notifySpacecraft(point) {
            if (subscribed[point.id] || subscribed['*'] || subscribed['all']) {
                if (ws.readyState === 1) {
                    try { ws.send(JSON.stringify(point)); } catch (_) {}
                }
            }
        }

        function notifyGateway(point) {
            if (subscribed[point.id] || subscribed['*'] || subscribed['all'] || point.type === 'rover_log') {
                if (ws.readyState === 1) {
                    try { ws.send(JSON.stringify(point)); } catch (_) {}
                }
            }
        }

        // Listen for requests
        ws.on('message', function (message) {
            try {
                if (typeof message !== 'string') message = message.toString();

                function handleSub(targetId) {
                    subscribed[targetId] = true;
                    if (gateway) {
                        if (targetId === '*' || targetId === 'all') {
                            var allState = gateway.getAllState();
                            Object.keys(allState).forEach(function (k) {
                                var val = allState[k];
                                if (val !== null && val !== undefined) {
                                    if (ws.readyState === 1) {
                                        try { ws.send(JSON.stringify({ id: k, utc: Date.now(), value: val })); } catch (_) {}
                                    }
                                }
                            });
                        } else {
                            var val = gateway.getState(targetId);
                            if (val !== null && val !== undefined) {
                                if (ws.readyState === 1) {
                                    try { ws.send(JSON.stringify({ id: targetId, utc: Date.now(), value: val })); } catch (_) {}
                                }
                            }
                        }
                    }
                }

                if (message.startsWith('{')) {
                    var parsed = JSON.parse(message);
                    if (parsed.action === 'subscribe' || parsed.sub) {
                        var targetId = parsed.id || parsed.sub;
                        handleSub(targetId);
                    } else if (parsed.action === 'unsubscribe') {
                        delete subscribed[parsed.id];
                    } else if (parsed.action === 'command' && gateway) {
                        var result = gateway.executeCommand(parsed.command);
                        if (ws.readyState === 1) {
                            ws.send(JSON.stringify({ type: 'command_ack', result: result }));
                        }
                    }
                } else {
                    var parts = message.split(' ');
                    var cmd = parts[0];
                    var id = parts[1];
                    if (cmd === 'subscribe') {
                        handleSub(id);
                    } else if (cmd === 'unsubscribe') {
                        delete subscribed[id];
                    }
                }
            } catch (e) {
                console.error('[Realtime WS] Message processing error:', e);
            }
        });

        // Cleanup on connection close
        ws.on('close', function () {
            unlistenSpacecraft();
            unlistenGateway();
        });
    });

    return router;
}

module.exports = RealtimeServer;
