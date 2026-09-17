const { startServer } = require('../example-server/server');
const fs = require('fs');
const path = require('path');
const http = require('http');

async function test() {
    const { server, port, gateway } = await startServer(8083);
    console.log(`Test server running on port ${port}`);

    // Load mock payloads
    const payloadsFile = path.join(__dirname, '../example-server/mock-payloads.json');
    const payloads = JSON.parse(fs.readFileSync(payloadsFile, 'utf8'));

    // Inject via HTTP endpoint
    const postData = JSON.stringify(payloads);
    const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/api/inject-telemetry',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            console.log(`Inject response: [${res.statusCode}] ${body}`);

            // Inspect gateway state
            const allState = gateway.getAllState();
            const keys = Object.keys(allState);
            console.log(`Gateway now tracks ${keys.length} populated telemetry points.`);
            console.log('Sample telemetry points:');
            [
                'rover.power.bus.voltage',
                'rover.power.battery.1.v',
                'rover.drive.state',
                'rover.drive.speed.fl',
                'rover.compute.jetson.cpu_temp',
                'rover.perception.active_cam',
                'rover.nav.pitch',
                'rover.arm.joint.shoulder',
                'rover.science.tensometer_weight',
                'rover.safety.kill_chain_state',
                'rover.net.bitrate_down'
            ].forEach(k => {
                console.log(`  - ${k}: ${allState[k]}`);
            });

            server.close(() => {
                console.log('Test completed successfully. Server closed.');
                process.exit(0);
            });
        });
    });

    req.on('error', (err) => {
        console.error('Test error:', err);
        server.close();
        process.exit(1);
    });

    req.write(postData);
    req.end();
}

test().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

