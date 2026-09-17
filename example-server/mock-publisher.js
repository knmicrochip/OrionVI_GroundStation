/**
 * Orion VI Mock Telemetry Publisher (ERC 2026)
 * 
 * Injects or publishes realistic mock payloads for all 8 subsystems:
 * - Drive / Chassis (Speeds, Currents, State, Suspension)
 * - Power (4x 20V 4Ah packs, 20V bus, 6 rails)
 * - Compute / Net (Jetson, RPi5, 5GHz Wi-Fi link)
 * - Perception (RealSense, Video stream)
 * - Navigation (IMU, Pose, Waypoint, SLAM)
 * - Manipulator (Joint angles, loads, gripper)
 * - Science (Vacuum, nozzle, tensometer weight)
 * - Safety (E-Stop, Kill chain, UVLO, Heartbeat)
 * 
 * Usage:
 *   node example-server/mock-publisher.js --once
 *   node example-server/mock-publisher.js --loop --interval=1000
 *   node example-server/mock-publisher.js --mqtt (publishes to tcp://192.168.1.1:1883)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const payloadsFile = path.join(__dirname, 'mock-payloads.json');
const rawPayloads = JSON.parse(fs.readFileSync(payloadsFile, 'utf8'));

const args = process.argv.slice(2);
const isLoop = args.includes('--loop');
const isMqtt = args.includes('--mqtt');
const intervalArg = args.find(a => a.startsWith('--interval='));
const intervalMs = intervalArg ? parseInt(intervalArg.split('=')[1], 10) : 1000;
const port = process.env.PORT || 8080;

function injectViaHttp(payloads) {
    const data = JSON.stringify(payloads);
    const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/api/inject-telemetry',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            if (res.statusCode === 200) {
                console.log(`[Mock Publisher] Injected ${Object.keys(payloads).length} subsystem payloads to Gateway at localhost:${port}`);
            } else {
                console.error(`[Mock Publisher] Gateway returned status ${res.statusCode}: ${body}`);
            }
        });
    });

    req.on('error', (err) => {
        console.error(`[Mock Publisher] Error connecting to Gateway at localhost:${port}: ${err.message}`);
    });

    req.write(data);
    req.end();
}

function publishViaMqtt(payloads) {
    const mqtt = require('mqtt');
    const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://192.168.1.1:1883';
    console.log(`[Mock Publisher] Connecting to MQTT broker at ${brokerUrl}...`);
    const client = mqtt.connect(brokerUrl);

    client.on('connect', () => {
        console.log(`[Mock Publisher] Connected to ${brokerUrl}`);
        Object.keys(payloads).forEach(topic => {
            const msg = JSON.stringify(payloads[topic]);
            client.publish(topic, msg, { qos: 0 }, (err) => {
                if (!err) console.log(`[Mock Publisher] Published to ${topic}`);
            });
        });
        if (!isLoop) {
            setTimeout(() => client.end(), 500);
        }
    });

    client.on('error', (err) => {
        console.error(`[Mock Publisher] MQTT Error: ${err.message}`);
    });
}

function runOnce() {
    // Add small random noise to simulated values for realistic dynamics
    const noisyPayloads = JSON.parse(JSON.stringify(rawPayloads));
    const now = Date.now();
    const t = now / 1000;

    // Dynamics
    noisyPayloads['rover/navigation/telemetry'].pitch = parseFloat((1.2 + 0.3 * Math.sin(t * 0.5)).toFixed(2));
    noisyPayloads['rover/navigation/telemetry'].roll = parseFloat((-0.8 + 0.3 * Math.cos(t * 0.4)).toFixed(2));
    noisyPayloads['rover/power/telemetry'].bus_voltage = parseFloat((19.80 + 0.1 * Math.sin(t * 0.2)).toFixed(2));

    if (isMqtt) {
        publishViaMqtt(noisyPayloads);
    } else {
        injectViaHttp(noisyPayloads);
    }
}

console.log(`[Mock Publisher] Orion VI Telemetry Publisher (ERC 2026)`);
console.log(`[Mock Publisher] Mode: ${isMqtt ? 'MQTT (' + (process.env.MQTT_BROKER_URL || 'mqtt://192.168.1.1:1883') + ')' : 'HTTP (localhost:' + port + ')'}`);

runOnce();

if (isLoop) {
    console.log(`[Mock Publisher] Running in continuous loop every ${intervalMs}ms... (Press Ctrl+C to stop)`);
    setInterval(runOnce, intervalMs);
}

