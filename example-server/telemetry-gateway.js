/**
 * Orion VI Rover Telemetry Gateway (ERC 2026)
 * 
 * Normalizes all telemetry into:
 *   { id: "rover.<subsystem>.<metric>", utc: <timestamp_ms>, value: <val> }
 * 
 * Manages:
 * - 45-minute in-memory rolling history buffer for fast Open MCT range queries
 * - Subsystem telemetry ingestion from MQTT topics and mock injections
 * - When MQTT is empty / offline, telemetry points default to null (no data / disconnected)
 * - Bidirectional command dispatching with safety inhibit checks
 */

const RETENTION_MS = 45 * 60 * 1000; // 45 minutes retention

class TelemetryGateway {
    constructor(options = {}) {
        this.options = options;
        this.isSimMode = options.isSimMode !== undefined ? options.isSimMode : false;
        this.history = new Map(); // id -> Array<{ utc, value, id }>
        this.subscribers = new Set(); // (point) => void
        this.lastTelemetryTime = 0;
        this.lastHeartbeatTime = 0;
        this.estopActive = false;
        this.activeTaskState = {
            task: 'science',
            state: 'IDLE',
            t0: null,
            limit_s: 2400,
            elapsed_s: 0,
            hold_s: 0,
            stepIndex: 0,
            steps: {}
        };

        // Rover MQTT Live Text Log Buffer
        this.roverLogs = [];
        this.logIdCounter = 0;

        // Telemetry state store: keys exist but values start unpopulated (null)
        this.state = {};

        if (this.isSimMode) {
            this.seedSimulatedHistory();
        }
        this.tickInterval = setInterval(() => {
            if (this.isSimMode) {
                this.simulateTick(Date.now());
            } else {
                this.checkTelemetryWatchdog();
            }
        }, 1000);
    }

    checkTelemetryWatchdog() {
        const now = Date.now();
        if (this.lastTelemetryTime > 0) {
            const ageMs = now - this.lastTelemetryTime;
            const remaining = Math.max(0, parseFloat((5.0 - (ageMs / 1000)).toFixed(1)));
            this.updateTelemetryPoint('rover.safety.heartbeat_timer', remaining, now);
            if (remaining <= 0) {
                this.updateTelemetryPoint('rover.safety.kill_chain_state', 'INHIBITED', now);
                this.updateTelemetryPoint('rover.safety.last_trip_reason', 'HEARTBEAT_TIMEOUT', now);
            }
        }
    }

    seedSimulatedHistory() {
        const now = Date.now();
        const stepMs = 5000;
        const seedPoints = Math.floor((15 * 60 * 1000) / stepMs);
        const keys = [
            'rover.power.bus.voltage', 'rover.power.battery.1.v', 'rover.power.battery.2.v',
            'rover.power.battery.3.v', 'rover.power.battery.4.v', 'rover.nav.pitch', 'rover.nav.roll'
        ];

        keys.forEach(k => {
            const arr = [];
            for (let i = seedPoints; i >= 0; i--) {
                const t = now - (i * stepMs);
                arr.push({ id: k, utc: t, value: 20.16 });
            }
            this.history.set(k, arr);
        });
    }

    simulateTick(now) {
        // High-fidelity simulation for offline testing
        const tSec = now / 1000;
        const pitch = parseFloat((1.2 * Math.sin(tSec * 0.2)).toFixed(2));
        const roll = parseFloat((-0.8 * Math.cos(tSec * 0.25)).toFixed(2));
        this.updateTelemetryPoint('rover.nav.pitch', pitch, now);
        this.updateTelemetryPoint('rover.nav.roll', roll, now);

        // Calibrated 5S Li-ion nominal operating voltage (~20.16V bus, individual batteries 20.12V - 20.21V)
        const busV = parseFloat((20.16 + 0.04 * Math.sin(tSec * 0.1)).toFixed(2));
        this.updateTelemetryPoint('rover.power.bus.voltage', busV, now);
        this.updateTelemetryPoint('rover.power.bus.current', 12.50, now);
        this.updateTelemetryPoint('rover.power.battery.1.v', parseFloat((busV + 0.02).toFixed(2)), now);
        this.updateTelemetryPoint('rover.power.battery.2.v', parseFloat((busV - 0.04).toFixed(2)), now);
        this.updateTelemetryPoint('rover.power.battery.3.v', parseFloat((busV + 0.05).toFixed(2)), now);
        this.updateTelemetryPoint('rover.power.battery.4.v', parseFloat((busV - 0.01).toFixed(2)), now);

        for (let i = 1; i <= 4; i++) {
            this.updateTelemetryPoint(`rover.power.battery.${i}.soc`, 83.2, now);
            this.updateTelemetryPoint(`rover.power.battery.${i}.i`, 3.12, now);
            this.updateTelemetryPoint(`rover.power.battery.${i}.temp`, 28.0, now);
        }
    }

    updateTelemetryPoint(id, value, utc) {
        utc = utc || Date.now();
        this.state[id] = value;

        const packet = { id, utc, value };

        let arr = this.history.get(id);
        if (!arr) {
            arr = [];
            this.history.set(id, arr);
        }
        arr.push(packet);

        const cutoff = utc - RETENTION_MS;
        while (arr.length > 0 && arr[0].utc < cutoff) {
            arr.shift();
        }

        this.notifySubscribers(packet);
    }

    notifySubscribers(packet) {
        this.subscribers.forEach(cb => {
            try {
                cb(packet);
            } catch (err) {
                console.error('[Gateway] Subscriber notification error:', err);
            }
        });
    }

    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    getHistory(id, start, end) {
        start = Number(start) || 0;
        end = Number(end) || Date.now();
        const arr = this.history.get(id);
        if (!arr || arr.length === 0) return [];

        return arr.filter(p => p.utc >= start && p.utc <= end);
    }

    getState(id) {
        return this.state[id];
    }

    getAllState() {
        return { ...this.state };
    }

    setSimMode(enable) {
        this.isSimMode = !!enable;
        if (this.isSimMode && (!this.history.get('rover.power.bus.voltage') || this.history.get('rover.power.bus.voltage').length === 0)) {
            this.seedSimulatedHistory();
        }
        console.log(`[Gateway] Simulation mode: ${this.isSimMode ? 'ENABLED' : 'DISABLED (ACTUAL)'}`);
    }

    // Ingest structured JSON payload for a subsystem topic
    ingestSubsystemPayload(topic, data) {
        const now = Date.now();
        this.lastTelemetryTime = now;

        if (!data || typeof data !== 'object') return;

        // 1. Power / Battery Topic: Power/feedback or rover/power/telemetry
        if (topic === 'Power/feedback') {
            const parseVal = (v) => {
                if (v === undefined || v === null) return undefined;
                const num = Number(v);
                return isNaN(num) ? undefined : num;
            };

            const v1 = parseVal(data.bat_1_v !== undefined ? data.bat_1_v : data.Battery1);
            const v2 = parseVal(data.bat_2_v !== undefined ? data.bat_2_v : data.Battery2);
            const v3 = parseVal(data.bat_3_v !== undefined ? data.bat_3_v : data.Battery3);
            const v4 = parseVal(data.bat_4_v !== undefined ? data.bat_4_v : data.Battery4);
            const temp = parseVal(data.temp_c !== undefined ? data.temp_c : data.Temp1);

            if (v1 !== undefined) this.updateTelemetryPoint('rover.power.battery.1.v', v1, now);
            if (v2 !== undefined) this.updateTelemetryPoint('rover.power.battery.2.v', v2, now);
            if (v3 !== undefined) this.updateTelemetryPoint('rover.power.battery.3.v', v3, now);
            if (v4 !== undefined) this.updateTelemetryPoint('rover.power.battery.4.v', v4, now);

            if (temp !== undefined) {
                this.updateTelemetryPoint('rover.power.battery.1.temp', temp, now);
                this.updateTelemetryPoint('rover.power.battery.2.temp', temp, now);
                this.updateTelemetryPoint('rover.power.battery.3.temp', temp, now);
                this.updateTelemetryPoint('rover.power.battery.4.temp', temp, now);
            }

            // SoC calculation (5S Li-ion: 16.0V = 0%, 21.0V = 100%, nominal ~20.16V = ~83.2%)
            const calcSoc = (v) => {
                if (v === undefined || v < 5.0) return 0.0;
                return Math.max(0.0, Math.min(100.0, ((v - 16.0) / (21.0 - 16.0)) * 100.0));
            };
            if (v1 !== undefined) this.updateTelemetryPoint('rover.power.battery.1.soc', parseFloat(calcSoc(v1).toFixed(1)), now);
            if (v2 !== undefined) this.updateTelemetryPoint('rover.power.battery.2.soc', parseFloat(calcSoc(v2).toFixed(1)), now);
            if (v3 !== undefined) this.updateTelemetryPoint('rover.power.battery.3.soc', parseFloat(calcSoc(v3).toFixed(1)), now);
            if (v4 !== undefined) this.updateTelemetryPoint('rover.power.battery.4.soc', parseFloat(calcSoc(v4).toFixed(1)), now);

            // Compute bus voltage from active batteries (> 5.0V)
            const activeVs = [v1, v2, v3, v4].filter(v => v !== undefined && v > 5.0);
            if (activeVs.length > 0) {
                const busV = parseFloat((activeVs.reduce((a, b) => a + b, 0) / activeVs.length).toFixed(2));
                this.updateTelemetryPoint('rover.power.bus.voltage', busV, now);
            }
        } else if (topic === 'rover/power/telemetry') {
            if (data.bus_voltage !== undefined) this.updateTelemetryPoint('rover.power.bus.voltage', Number(data.bus_voltage), now);
            if (data.bus_current !== undefined) this.updateTelemetryPoint('rover.power.bus.current', Number(data.bus_current), now);
            if (Array.isArray(data.batteries)) {
                data.batteries.forEach(b => {
                    if (b.voltage !== undefined) this.updateTelemetryPoint(`rover.power.battery.${b.id}.v`, Number(b.voltage), now);
                    if (b.current !== undefined) this.updateTelemetryPoint(`rover.power.battery.${b.id}.i`, Number(b.current), now);
                    if (b.temp !== undefined) this.updateTelemetryPoint(`rover.power.battery.${b.id}.temp`, Number(b.temp), now);
                    if (b.soc !== undefined) this.updateTelemetryPoint(`rover.power.battery.${b.id}.soc`, Number(b.soc), now);
                });
            }
            if (data.rails) {
                Object.keys(data.rails).forEach(rk => {
                    const r = data.rails[rk];
                    if (r.v !== undefined) this.updateTelemetryPoint(`rover.power.rail.${rk}.v`, Number(r.v), now);
                    if (r.i !== undefined) this.updateTelemetryPoint(`rover.power.rail.${rk}.i`, Number(r.i), now);
                    if (r.state !== undefined) this.updateTelemetryPoint(`rover.power.rail.${rk}.state`, Number(r.state), now);
                });
            }
        }

        // 2. Drive / Chassis: rover/drive/telemetry
        if (topic === 'rover/drive/telemetry') {
            if (data.state !== undefined) this.updateTelemetryPoint('rover.drive.state', String(data.state), now);
            if (data.speed_limit !== undefined) this.updateTelemetryPoint('rover.drive.speed_limit', Number(data.speed_limit), now);
            if (data.suspension_angle !== undefined) this.updateTelemetryPoint('rover.drive.suspension_angle', Number(data.suspension_angle), now);
            if (data.speeds) {
                ['fl', 'ml', 'rl', 'fr', 'mr', 'rr'].forEach(w => {
                    if (data.speeds[w] !== undefined) this.updateTelemetryPoint(`rover.drive.speed.${w}`, Number(data.speeds[w]), now);
                });
            }
            if (data.currents) {
                ['fl', 'ml', 'rl', 'fr', 'mr', 'rr'].forEach(w => {
                    if (data.currents[w] !== undefined) this.updateTelemetryPoint(`rover.drive.current.${w}`, Number(data.currents[w]), now);
                });
            }
        }

        // 3. Compute & Net: rover/compute/telemetry
        if (topic === 'rover/compute/telemetry') {
            if (data.jetson) {
                if (data.jetson.cpu_temp !== undefined) this.updateTelemetryPoint('rover.compute.jetson.cpu_temp', Number(data.jetson.cpu_temp), now);
                if (data.jetson.gpu_temp !== undefined) this.updateTelemetryPoint('rover.compute.jetson.gpu_temp', Number(data.jetson.gpu_temp), now);
                if (data.jetson.ram_pct !== undefined) this.updateTelemetryPoint('rover.compute.jetson.ram_pct', Number(data.jetson.ram_pct), now);
                if (data.jetson.cpu_pct !== undefined) this.updateTelemetryPoint('rover.compute.jetson.cpu_pct', Number(data.jetson.cpu_pct), now);
                if (data.jetson.disk_pct !== undefined) this.updateTelemetryPoint('rover.compute.jetson.disk_pct', Number(data.jetson.disk_pct), now);
            }
            if (data.rpi) {
                if (data.rpi.cpu_temp !== undefined) this.updateTelemetryPoint('rover.compute.rpi.cpu_temp', Number(data.rpi.cpu_temp), now);
                if (data.rpi.ram_pct !== undefined) this.updateTelemetryPoint('rover.compute.rpi.ram_pct', Number(data.rpi.ram_pct), now);
                if (data.rpi.load !== undefined) this.updateTelemetryPoint('rover.compute.rpi.load', Number(data.rpi.load), now);
            }
            if (data.network) {
                if (data.network.latency !== undefined) this.updateTelemetryPoint('rover.net.latency', Number(data.network.latency), now);
                if (data.network.rssi !== undefined) this.updateTelemetryPoint('rover.net.rssi', Number(data.network.rssi), now);
                if (data.network.bitrate_up !== undefined) this.updateTelemetryPoint('rover.net.bitrate_up', Number(data.network.bitrate_up), now);
                if (data.network.bitrate_down !== undefined) this.updateTelemetryPoint('rover.net.bitrate_down', Number(data.network.bitrate_down), now);
                if (data.network.packet_loss !== undefined) this.updateTelemetryPoint('rover.net.packet_loss', Number(data.network.packet_loss), now);
            }
        }

        // 4. Perception: rover/perception/telemetry
        if (topic === 'rover/perception/telemetry') {
            if (data.realsense) {
                if (data.realsense.alive !== undefined) this.updateTelemetryPoint('rover.perception.realsense.alive', Number(data.realsense.alive), now);
                if (data.realsense.fps !== undefined) this.updateTelemetryPoint('rover.perception.realsense.fps', Number(data.realsense.fps), now);
                if (data.realsense.temp !== undefined) this.updateTelemetryPoint('rover.perception.realsense.temp', Number(data.realsense.temp), now);
            }
            if (data.active_cam !== undefined) this.updateTelemetryPoint('rover.perception.active_cam', Number(data.active_cam), now);
            if (data.video_bitrate !== undefined) this.updateTelemetryPoint('rover.perception.video_bitrate', Number(data.video_bitrate), now);
        }

        // 5. Navigation: rover/navigation/telemetry
        if (topic === 'rover/navigation/telemetry') {
            if (data.pitch !== undefined) this.updateTelemetryPoint('rover.nav.pitch', Number(data.pitch), now);
            if (data.roll !== undefined) this.updateTelemetryPoint('rover.nav.roll', Number(data.roll), now);
            if (data.yaw !== undefined) this.updateTelemetryPoint('rover.nav.yaw', Number(data.yaw), now);
            if (data.pose_x !== undefined) this.updateTelemetryPoint('rover.nav.pose_x', Number(data.pose_x), now);
            if (data.pose_y !== undefined) this.updateTelemetryPoint('rover.nav.pose_y', Number(data.pose_y), now);
            if (data.heading !== undefined) this.updateTelemetryPoint('rover.nav.heading', Number(data.heading), now);
            if (data.nav2_state !== undefined) this.updateTelemetryPoint('rover.nav.nav2_state', String(data.nav2_state), now);
            if (data.slam_health !== undefined) this.updateTelemetryPoint('rover.nav.slam_health', String(data.slam_health), now);
            if (data.slam_keyframes !== undefined) this.updateTelemetryPoint('rover.nav.slam_keyframes', Number(data.slam_keyframes), now);
            if (data.target_wp_id !== undefined) this.updateTelemetryPoint('rover.nav.target_wp_id', Number(data.target_wp_id), now);
            if (data.target_wp_dist !== undefined) this.updateTelemetryPoint('rover.nav.target_wp_dist', Number(data.target_wp_dist), now);
            if (data.target_wp_bearing !== undefined) this.updateTelemetryPoint('rover.nav.target_wp_bearing', Number(data.target_wp_bearing), now);
            if (data.autonomy_mode !== undefined) this.updateTelemetryPoint('rover.nav.autonomy_mode', String(data.autonomy_mode), now);
        }

        // 6. Manipulator: rover/manipulator/telemetry
        if (topic === 'rover/manipulator/telemetry') {
            if (data.gripper_id !== undefined) this.updateTelemetryPoint('rover.arm.gripper_id', String(data.gripper_id), now);
            if (data.pose !== undefined) this.updateTelemetryPoint('rover.arm.pose', String(data.pose), now);
            if (data.joints) {
                Object.keys(data.joints).forEach(j => {
                    this.updateTelemetryPoint(`rover.arm.joint.${j}`, Number(data.joints[j]), now);
                });
            }
            if (data.loads) {
                Object.keys(data.loads).forEach(j => {
                    this.updateTelemetryPoint(`rover.arm.joint.load.${j}`, Number(data.loads[j]), now);
                });
            }
        }

        // 7. Science: rover/science/telemetry
        if (topic === 'rover/science/telemetry') {
            if (data.vacuum_state !== undefined) this.updateTelemetryPoint('rover.science.vacuum_state', String(data.vacuum_state), now);
            if (data.vacuum_pwm !== undefined) this.updateTelemetryPoint('rover.science.vacuum_pwm', Number(data.vacuum_pwm), now);
            if (data.nozzle_rpm !== undefined) this.updateTelemetryPoint('rover.science.nozzle_rpm', Number(data.nozzle_rpm), now);
            if (data.gas_blast !== undefined) this.updateTelemetryPoint('rover.science.gas_blast', String(data.gas_blast), now);
            if (data.cyclone_door !== undefined) this.updateTelemetryPoint('rover.science.cyclone_door', String(data.cyclone_door), now);
            if (data.tensometer_weight !== undefined) this.updateTelemetryPoint('rover.science.tensometer_weight', Number(data.tensometer_weight), now);
            if (data.fluid_level !== undefined) this.updateTelemetryPoint('rover.science.fluid_level', Number(data.fluid_level), now);
            if (data.sample_count !== undefined) this.updateTelemetryPoint('rover.science.sample_count', Number(data.sample_count), now);
            if (data.pressure !== undefined) this.updateTelemetryPoint('rover.science.pressure', Number(data.pressure), now);
        }

        // 8. Safety: rover/safety/telemetry
        if (topic === 'rover/safety/telemetry') {
            if (data.estop_hardware !== undefined) this.updateTelemetryPoint('rover.safety.estop_hardware', Number(data.estop_hardware), now);
            if (data.kill_chain_state !== undefined) this.updateTelemetryPoint('rover.safety.kill_chain_state', String(data.kill_chain_state), now);
            if (data.heartbeat_timer !== undefined) this.updateTelemetryPoint('rover.safety.heartbeat_timer', Number(data.heartbeat_timer), now);
            if (data.uvlo_tripped !== undefined) this.updateTelemetryPoint('rover.safety.uvlo_tripped', Number(data.uvlo_tripped), now);
            if (data.enclosure_temp !== undefined) this.updateTelemetryPoint('rover.safety.enclosure_temp', Number(data.enclosure_temp), now);
            if (data.last_trip_reason !== undefined) this.updateTelemetryPoint('rover.safety.last_trip_reason', String(data.last_trip_reason), now);
        }

        // 9. RF Comms / Antenna: rover/antenna/telemetry
        if (topic === 'rover/antenna/telemetry' || topic === 'rover/antenna/state') {
            if (data.uplink !== undefined) this.updateTelemetryPoint('rover.net.bitrate_up', Number(data.uplink), now);
            if (data.downlink !== undefined) this.updateTelemetryPoint('rover.net.bitrate_down', Number(data.downlink), now);
            if (data.rssi !== undefined) this.updateTelemetryPoint('rover.net.rssi', Number(data.rssi), now);
            if (data.latency !== undefined) this.updateTelemetryPoint('rover.net.latency', Number(data.latency), now);
            if (data.packet_loss !== undefined) this.updateTelemetryPoint('rover.net.packet_loss', Number(data.packet_loss), now);
        }
    }

    // Ingest actual telemetry packet from MQTT bridge
    ingestMqttMessage(topic, payloadStr, parsedObj) {
        // Detect Rover MQTT Log messages
        const lowerTopic = String(topic || '').toLowerCase();
        const customTopic = process.env.MQTT_LOG_TOPIC ? process.env.MQTT_LOG_TOPIC.toLowerCase() : null;
        const isLogTopic = lowerTopic.includes('log') || lowerTopic.includes('syslog') || (customTopic && lowerTopic === customTopic);

        if (isLogTopic || (parsedObj && (parsedObj.type === 'log' || parsedObj.log !== undefined))) {
            this.ingestRoverLog(topic, payloadStr, parsedObj);
        }

        if (parsedObj && typeof parsedObj === 'object') {
            this.ingestSubsystemPayload(topic, parsedObj);
        }
    }

    // Ingest Rover MQTT Text / JSON Log Entry
    ingestRoverLog(topic, rawStr, parsedObj) {
        const now = Date.now();
        this.lastTelemetryTime = now;

        let timestamp = now;
        let level = 'INFO';
        let source = 'ROVER';
        let message = '';

        if (parsedObj && typeof parsedObj === 'object') {
            if (parsedObj.timestamp) timestamp = Number(parsedObj.timestamp) || now;
            else if (parsedObj.utc) timestamp = Number(parsedObj.utc) || now;
            else if (parsedObj.time) timestamp = Number(parsedObj.time) || now;

            if (parsedObj.level) level = String(parsedObj.level).toUpperCase();
            if (parsedObj.source) source = String(parsedObj.source).toUpperCase();
            else if (parsedObj.subsystem) source = String(parsedObj.subsystem).toUpperCase();

            message = parsedObj.message || parsedObj.msg || parsedObj.text || parsedObj.log || JSON.stringify(parsedObj);
        } else {
            message = String(rawStr || '').trim();
        }

        // Auto-detect log level if not explicitly provided
        if (!parsedObj || !parsedObj.level) {
            const upperMsg = message.toUpperCase();
            if (upperMsg.includes('[ERROR]') || upperMsg.includes('[ERR]') || upperMsg.includes('[FATAL]') || upperMsg.includes('[CRIT]') || upperMsg.includes('ERROR:') || upperMsg.includes('FATAL:')) {
                level = 'ERROR';
            } else if (upperMsg.includes('[WARN]') || upperMsg.includes('[WARNING]') || upperMsg.includes('WARN:') || upperMsg.includes('WARNING:')) {
                level = 'WARN';
            } else if (upperMsg.includes('[DEBUG]') || upperMsg.includes('DEBUG:')) {
                level = 'DEBUG';
            } else {
                level = 'INFO';
            }
        }

        // Auto-detect source subsystem from topic if not explicitly set
        if (!parsedObj || (!parsedObj.source && !parsedObj.subsystem)) {
            const topicParts = topic.split('/');
            if (topicParts.length > 2) {
                source = topicParts[topicParts.length - 1].toUpperCase();
                if (source.includes('LOG')) {
                    source = topicParts[topicParts.length - 2].toUpperCase();
                }
            }
        }

        const isoTime = new Date(timestamp).toISOString().split('T')[1].replace('Z', '');
        const logEntry = {
            id: ++this.logIdCounter,
            utc: timestamp,
            isoTime: isoTime,
            level: level,
            source: source,
            message: message,
            topic: topic
        };

        this.roverLogs.push(logEntry);
        if (this.roverLogs.length > 500) {
            this.roverLogs.shift();
        }

        // Update Open MCT telemetry metrics
        this.updateTelemetryPoint('rover.logs.latest', message, timestamp);
        this.updateTelemetryPoint('rover.logs.count', this.roverLogs.length, timestamp);
        this.updateTelemetryPoint('rover.logs.level', level, timestamp);

        // Notify realtime subscribers
        this.subscribers.forEach(cb => {
            try {
                cb({
                    type: 'rover_log',
                    id: 'rover.logs.stream',
                    log: logEntry,
                    point: {
                        id: 'rover.logs.latest',
                        utc: timestamp,
                        value: message
                    }
                });
            } catch (_) {}
        });

        return logEntry;
    }

    // Execute operator command
    executeCommand(cmd) {
        const now = Date.now();
        console.log('[Gateway] Executing command:', cmd);

        const isEStop = this.state['rover.safety.estop_hardware'] === 1;
        const isTripped = this.state['rover.safety.kill_chain_state'] === 'INHIBITED';

        if ((isEStop || isTripped) && cmd.action !== 'RESET_SAFETY' && cmd.action !== 'ESTOP_RELEASE') {
            return {
                success: false,
                inhibited: true,
                reason: 'Command blocked: Safety Kill-Chain is INHIBITED'
            };
        }

        switch (cmd.action) {
            case 'ESTOP_ACTIVATE':
                this.updateTelemetryPoint('rover.safety.estop_hardware', 1, now);
                this.updateTelemetryPoint('rover.safety.kill_chain_state', 'INHIBITED', now);
                this.updateTelemetryPoint('rover.safety.last_trip_reason', 'OPERATOR_ESTOP', now);
                this.updateTelemetryPoint('rover.drive.state', 'ESTOP', now);
                return { success: true, state: 'ESTOP_ACTIVATED' };

            case 'RESET_SAFETY':
                this.updateTelemetryPoint('rover.safety.estop_hardware', 0, now);
                this.updateTelemetryPoint('rover.safety.kill_chain_state', 'CLEAR', now);
                this.updateTelemetryPoint('rover.safety.last_trip_reason', 'NONE', now);
                this.updateTelemetryPoint('rover.drive.state', 'ENABLED', now);
                return { success: true, state: 'SAFETY_CLEARED' };

            case 'POWER_RAIL_TOGGLE':
                const railKey = `rover.power.rail.${cmd.rail}.state`;
                const nextState = cmd.enable ? 1 : 0;
                this.updateTelemetryPoint(railKey, nextState, now);
                return { success: true, rail: cmd.rail, state: nextState };

            case 'CAMERA_SWITCH':
                const camId = parseInt(cmd.camId, 10) || 1;
                this.updateTelemetryPoint('rover.perception.active_cam', camId, now);
                return { success: true, activeCam: camId };

            case 'TASK_STATE_SYNC':
                this.activeTaskState = { ...this.activeTaskState, ...cmd.taskState };
                return { success: true, taskState: this.activeTaskState };

            default:
                return { success: true, message: 'Command processed' };
        }
    }
}

module.exports = TelemetryGateway;
