var express = require('express');

function HistoryServer(spacecraft, gateway) {
    var router = express.Router();

    router.get('/:pointId', function (req, res) {
        var start = +req.query.start;
        var end = +req.query.end;
        var ids = req.params.pointId.split(',');

        var response = ids.reduce(function (resp, id) {
            // First check TelemetryGateway
            if (gateway && gateway.history.has(id)) {
                return resp.concat(gateway.getHistory(id, start, end));
            }
            // Fallback to legacy spacecraft if present
            if (spacecraft && spacecraft.history[id]) {
                return resp.concat(spacecraft.history[id].filter(function (p) {
                    return p.timestamp > start && p.timestamp < end;
                }));
            }
            return resp;
        }, []);
        res.status(200).json(response).end();
    });

    return router;
}

module.exports = HistoryServer;
