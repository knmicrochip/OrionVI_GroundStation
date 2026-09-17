/**
 * Open MCT Plugin: Orion Rover 4-Battery MQTT Telemetry & Live Diagnostics
 * 
 * Features:
 * 1. 20V 4Ah Li-ion Accumulator Health Monitoring & Error Notifications:
 *    - Off-nominal detection: Low Charge (< 20% SOC), Critical Undervoltage (< 15.0V),
 *      Overvoltage (> 21.2V), Module Disconnect (0.00V), Parallel Imbalance (> 1.5V),
 *      and Temperature Anomalies (-127°C open-circuit / > 50°C overheat).
 *    - Detailed engineering explainer provided for each condition detailing the physical chemistry risk.
 *    - Open MCT notification integration (openmct.notifications) + non-intrusive HUD toast alerts.
 * 2. Strict Separation of Actual and Simulated Telemetry:
 *    - ACTUAL and SIMULATED maintain completely independent data stores, graphs, and history ring buffers.
 *    - Simulator timer does NOT run unless explicitly activated by the user.
 * 3. Real MQTT Ingestion for "Power/feedback":
 *    - Connects to Mosquitto broker (mqtt://192.168.1.1:1883) via backend TCP bridge.
 *    - Evaluates 5S Li-ion SOC % (16.0V = 0%, 21.0V = 100%).
 * 4. Upper Panel Indicator & Mode Switcher:
 *    - Clean professional indicator with battery SVG, % readout, and mode badge (ACTUAL / SIMULATED).
 *    - Reliable click handling to open secondary diagnostics window (battery-details.html).
 *    - Modal confirmation dialog before switching modes.
 * 5. Separate Open MCT Telemetry Trees:
 *    - "Actual Telemetry (MQTT 192.168.1.1)" folder with actual channels and overlay plot.
 *    - "Simulated Telemetry (Offline)" folder with simulated channels and overlay plot.
 * 6. Multi-window synchronization via BroadcastChannel ("orion-battery-sync").
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.OrionBatteryPlugin = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const NAMESPACE = 'orion.battery';
    const MAX_HISTORY = 600;

    // Battery channel definitions
    const ACTUAL_DEFINITIONS = [
        { key: 'b1_actual', name: 'Battery 1 Actual Charge', unit: '%', color: '#06b6d4', packKey: 'b1' },
        { key: 'b2_actual', name: 'Battery 2 Actual Charge', unit: '%', color: '#10b981', packKey: 'b2' },
        { key: 'b3_actual', name: 'Battery 3 Actual Charge', unit: '%', color: '#f59e0b', packKey: 'b3' },
        { key: 'b4_actual', name: 'Battery 4 Actual Charge', unit: '%', color: '#a855f7', packKey: 'b4' },
        { key: 'system_actual', name: 'Rover System Actual Charge', unit: '%', color: '#fbbf24', packKey: 'system' }
    ];

    const SIMULATED_DEFINITIONS = [
        { key: 'b1_sim', name: 'Battery 1 Simulated Charge', unit: '%', color: '#06b6d4', packKey: 'b1' },
        { key: 'b2_sim', name: 'Battery 2 Simulated Charge', unit: '%', color: '#10b981', packKey: 'b2' },
        { key: 'b3_sim', name: 'Battery 3 Simulated Charge', unit: '%', color: '#f59e0b', packKey: 'b3' },
        { key: 'b4_sim', name: 'Battery 4 Simulated Charge', unit: '%', color: '#a855f7', packKey: 'b4' },
        { key: 'system_sim', name: 'Rover System Simulated Charge', unit: '%', color: '#fbbf24', packKey: 'system' }
    ];

    // Voltage to SOC formula for 5S Li-ion (Nominal 20V: 16.0V empty -> 21.0V full)
    function voltageToSoc(volts) {
        if (typeof volts !== 'number' || isNaN(volts) || volts < 5.0) {
            return 0.0;
        }
        const soc = ((volts - 16.0) / (21.0 - 16.0)) * 100.0;
        return Math.max(0.0, Math.min(100.0, Math.round(soc * 10) / 10));
    }

    return function OrionBatteryPlugin(options) {
        options = options || {};

        const brokerUrl = options.brokerUrl || 'ws://localhost:9001';
        const topic = options.topic || 'Power/#';
        const customParser = typeof options.parseMessage === 'function' ? options.parseMessage : null;

        // Current Telemetry Mode: 'actual' (default) or 'simulated'
        let telemetryMode = 'actual';
        if (typeof localStorage !== 'undefined') {
            const savedMode = localStorage.getItem('orion_battery_telemetry_mode');
            if (savedMode === 'simulated' || savedMode === 'actual') {
                telemetryMode = savedMode;
            }
        }

        // -------------------------------------------------------------
        // Completely Independent Data Stores
        // -------------------------------------------------------------

        // 1. Actual State & History (Populated strictly by real MQTT packets)
        const actualState = {
            v1: 0.0,
            v2: 0.0,
            v3: 0.0,
            v4: 0.0,
            temp_c: -127,
            adcs: {
                wl: 0,
                wr: 0,
                ram: 0,
                elek: 0,
                sci: 0,
                inne: 0
            },
            soc: {
                b1: 0.0,
                b2: 0.0,
                b3: 0.0,
                b4: 0.0,
                system: 0.0
            },
            rawPayload: '',
            lastReceivedTime: 0,
            packetCount: 0,
            brokerHost: '192.168.1.1:1883'
        };

        const actualHistory = {
            b1: [],
            b2: [],
            b3: [],
            b4: [],
            system: []
        };

        // 2. Simulated State & History (Generated strictly when simulation is turned ON)
        const simulatedState = {
            b1: 91.5,
            b2: 89.2,
            b3: 93.0,
            b4: 88.4,
            system: 90.5
        };

        const simulatedHistory = {
            b1: [],
            b2: [],
            b3: [],
            b4: [],
            system: []
        };

        // Subscribers for Open MCT telemetry
        const subscribers = {
            actual: {
                b1: new Set(),
                b2: new Set(),
                b3: new Set(),
                b4: new Set(),
                system: new Set()
            },
            simulated: {
                b1: new Set(),
                b2: new Set(),
                b3: new Set(),
                b4: new Set(),
                system: new Set()
            }
        };

        const indicatorCallbacks = [];
        let openmctInstance = null;

        // Active Alerts & Health Monitoring Engine
        let activeAlerts = [];
        const notifiedAlertIds = new Set();

        // BroadcastChannel to synchronize secondary details window
        let syncChannel = null;
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                syncChannel = new BroadcastChannel('orion-battery-sync');
                syncChannel.onmessage = function (event) {
                    const msg = event.data;
                    if (msg && msg.action === 'switch_mode' && msg.mode) {
                        setTelemetryMode(msg.mode, false);
                    }
                };
            } catch (e) {
                console.warn('[Orion Battery] BroadcastChannel error:', e);
            }
        }

        let isBridgeConnected = false;
        let isMqttBrokerConnected = false;
        let lastMqttMessageTime = 0;
        let simulatorInterval = null;

        function getConnectionStatus() {
            if (telemetryMode === 'simulated') {
                return { label: 'MODE: SIMULATED', color: '#c084fc', active: false, mode: 'simulated' };
            }

            const recentPacket = (Date.now() - lastMqttMessageTime < 5000);
            if (isMqttBrokerConnected && recentPacket) {
                return { label: 'LIVE MQTT (192.168.1.1)', color: '#10b981', active: true, mode: 'actual' };
            }
            if (isMqttBrokerConnected) {
                return { label: 'MQTT CONNECTED (IDLE)', color: '#38bdf8', active: true, mode: 'actual' };
            }
            if (isBridgeConnected) {
                return { label: 'BRIDGE ACTIVE (WAITING 192.168.1.1)', color: '#f59e0b', active: false, mode: 'actual' };
            }
            return { label: 'ACTUAL (WAITING DATA)', color: '#ef4444', active: false, mode: 'actual' };
        }

        // -------------------------------------------------------------
        // 20V 4Ah Battery Health & 3-Stage Notification Engine
        // Stages: 'notice' (info), 'warning' (amber), 'critical' (red)
        // -------------------------------------------------------------

        function triggerOpenMctNotification(alert) {
            const sevUpper = alert.severity ? alert.severity.toUpperCase() : 'NOTICE';
            console.warn(`[Battery Alert] [${sevUpper}] ${alert.title}: ${alert.explainer}`);

            // Suppress intrusive notification banners for transport / initial offline state
            if (alert.id === 'mqtt_broker_disconnected' || alert.id === 'mqtt_awaiting_ingress' || alert.id === 'mqtt_telemetry_timeout') {
                return;
            }

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
                    console.warn('[Orion Battery] Notification error:', e);
                }
            }
        }

        function evaluateBatteryHealth() {
            const currentAlerts = [];
            const isActual = (telemetryMode === 'actual');

            if (isActual) {
                const now = Date.now();
                const hasPackets = (actualState.packetCount > 0);
                const isRecent = hasPackets && ((now - actualState.lastReceivedTime) < 6000);

                if (!isMqttBrokerConnected) {
                    // MQTT Broker Offline / Transport Down
                    currentAlerts.push({
                        id: 'mqtt_broker_disconnected',
                        target: 'MQTT Transport',
                        severity: 'critical',
                        title: 'MQTT Broker Offline (192.168.1.1:1883)',
                        explainer: 'Native TCP connection to Mosquitto broker at 192.168.1.1:1883 is offline. Telemetry pipeline is unavailable; individual battery module states cannot be determined.'
                    });
                } else if (!hasPackets) {
                    // Broker reached, but awaiting first packet
                    currentAlerts.push({
                        id: 'mqtt_awaiting_ingress',
                        target: 'MQTT Ingress',
                        severity: 'warning',
                        title: 'Awaiting Telemetry Ingress (Power/feedback)',
                        explainer: 'Connected to Mosquitto broker at 192.168.1.1:1883. Awaiting first telemetry packet on topic Power/feedback. Accumulator metrics are pending.'
                    });
                } else if (!isRecent) {
                    // Telemetry timed out
                    const lapsedSec = Math.round((now - actualState.lastReceivedTime) / 1000);
                    currentAlerts.push({
                        id: 'mqtt_telemetry_timeout',
                        target: 'MQTT Telemetry',
                        severity: 'critical',
                        title: `Telemetry Ingress Timeout (${lapsedSec}s Stale)`,
                        explainer: `No telemetry packets received on topic Power/feedback for ${lapsedSec} seconds. Telemetry stream is interrupted; rover power subsystem states cannot be reliably confirmed.`
                    });
                } else {
                    // Telemetry is verified LIVE and active!
                    // Notice alert when live ingress is active
                    currentAlerts.push({
                        id: 'mqtt_ingress_nominal',
                        target: 'MQTT Ingress',
                        severity: 'notice',
                        title: 'Telemetry Ingress Live (Power/feedback)',
                        explainer: 'Active packet stream verified from 192.168.1.1:1883. Ingress telemetry is synchronized with rover power bus.'
                    });

                    // Evaluate physical pack parameters from confirmed incoming data
                    const packs = [
                        { id: '1', key: 'b1', name: 'Battery 1', volts: actualState.v1, soc: actualState.soc.b1 },
                        { id: '2', key: 'b2', name: 'Battery 2', volts: actualState.v2, soc: actualState.soc.b2 },
                        { id: '3', key: 'b3', name: 'Battery 3', volts: actualState.v3, soc: actualState.soc.b3 },
                        { id: '4', key: 'b4', name: 'Battery 4', volts: actualState.v4, soc: actualState.soc.b4 }
                    ];

                    packs.forEach(p => {
                        // Disconnected check (confirmed 0.00V reported by rover MCU during active comms)
                        if (p.volts < 1.0) {
                            currentAlerts.push({
                                id: `pack_${p.id}_disconnected`,
                                target: p.name,
                                severity: 'warning',
                                title: `${p.name} Disconnected (0.00V)`,
                                explainer: `Confirmed 0.00V reported on ${p.name} during active telemetry. The 20V 4Ah accumulator module is unseated, module fuse blown, or internal BMS safety switch tripped.`
                            });
                        } else {
                            // Critical undervoltage (< 15.0V)
                            if (p.volts < 15.0) {
                                currentAlerts.push({
                                    id: `pack_${p.id}_undervolt`,
                                    target: p.name,
                                    severity: 'critical',
                                    title: `${p.name} Critical Undervoltage (${p.volts.toFixed(2)}V)`,
                                    explainer: `Measured voltage ${p.volts.toFixed(2)}V is below the critical 5S Li-ion threshold (3.0V/cell). Discharging below this point risks copper dissolution from anode current collectors, causing permanent cell damage and short-circuit hazard.`
                                });
                            } else if (p.soc < 10.0) {
                                // Deep discharge (< 10% SOC)
                                currentAlerts.push({
                                    id: `pack_${p.id}_deep_discharge`,
                                    target: p.name,
                                    severity: 'critical',
                                    title: `${p.name} Deep Discharge (${p.soc.toFixed(1)}%)`,
                                    explainer: `Accumulator reserve is critically depleted below 10%. Emergency load shedding or immediate recharge required to prevent irreversible cell damage.`
                                });
                            } else if (p.soc < 20.0) {
                                // Low Reserve (10% - 20% SOC)
                                currentAlerts.push({
                                    id: `pack_${p.id}_low_soc`,
                                    target: p.name,
                                    severity: 'warning',
                                    title: `${p.name} Low Reserve (${p.soc.toFixed(1)}%)`,
                                    explainer: `20V 4Ah pack reserve depleted below 20% (${p.soc.toFixed(1)}% / ${p.volts.toFixed(2)}V). Continued discharge below 16.0V (3.2V/cell cut-off) causes accelerated cell degradation and capacity loss.`
                                });
                            }

                            // Overvoltage (> 21.2V)
                            if (p.volts > 21.2) {
                                currentAlerts.push({
                                    id: `pack_${p.id}_overvolt`,
                                    target: p.name,
                                    severity: 'critical',
                                    title: `${p.name} Overvoltage (${p.volts.toFixed(2)}V)`,
                                    explainer: `Terminal voltage ${p.volts.toFixed(2)}V exceeds the maximum 5S charge limit (21.0V / 4.2V/cell). Cell overcharge accelerates electrolyte breakdown and risks thermal stress.`
                                });
                            }
                        }
                    });

                    // Parallel voltage imbalance (> 1.5V)
                    const activePacks = packs.filter(p => p.volts >= 5.0);
                    if (activePacks.length >= 2) {
                        let minV = Infinity;
                        let maxV = -Infinity;
                        activePacks.forEach(p => {
                            if (p.volts < minV) minV = p.volts;
                            if (p.volts > maxV) maxV = p.volts;
                        });
                        const diff = maxV - minV;
                        if (diff > 1.5) {
                            currentAlerts.push({
                                id: 'parallel_imbalance',
                                target: 'Parallel Bus',
                                severity: 'warning',
                                title: `Parallel Pack Imbalance (${diff.toFixed(2)}V Delta)`,
                                explainer: `Voltage difference between active parallel packs is ${diff.toFixed(2)}V (> 1.5V limit). High voltage differentials cause uncontrolled cross-charging currents between batteries when tied to the shared 20V bus.`
                            });
                        }
                    }

                    // Temperature checks
                    if (actualState.temp_c <= -100) {
                        currentAlerts.push({
                            id: 'temp_sensor_open',
                            target: 'Temp Sensor',
                            severity: 'warning',
                            title: 'Battery Temperature Sensor Open-Circuit (-127°C)',
                            explainer: `Board temperature reading of -127°C indicates an open-circuit / disconnected NTC thermistor wire on the power monitoring harness. Thermal runaway protection monitoring is unavailable.`
                        });
                    } else if (actualState.temp_c > 50) {
                        currentAlerts.push({
                            id: 'temp_overheat',
                            target: 'Thermal Protection',
                            severity: 'critical',
                            title: `Battery Over-Temperature (${actualState.temp_c}°C)`,
                            explainer: `Battery/board temperature (${actualState.temp_c}°C) exceeds the 45°C maximum continuous threshold for 5S Li-ion cells. Reduce rover drive load immediately to prevent thermal damage.`
                        });
                    }

                    // Rover System low charge
                    if (activePacks.length > 0 && actualState.soc.system < 20.0 && actualState.soc.system > 0) {
                        const isCrit = actualState.soc.system < 10.0;
                        currentAlerts.push({
                            id: 'system_low_soc',
                            target: 'Rover System',
                            severity: isCrit ? 'critical' : 'warning',
                            title: `Rover System Charge ${isCrit ? 'Critical' : 'Low'} (${actualState.soc.system.toFixed(1)}%)`,
                            explainer: `Total parallel bus energy is below ${isCrit ? '10%' : '20%'}. Return rover to base station or switch off non-essential sub-systems to preserve battery health.`
                        });
                    }
                }
            } else {
                // Simulated Mode checks
                currentAlerts.push({
                    id: 'sim_mode_active',
                    target: 'Simulator',
                    severity: 'notice',
                    title: 'Synthetic Simulation Active',
                    explainer: 'Running isolated offline benchmark telemetry generator for 4x 20V 4Ah battery packs.'
                });

                ['b1', 'b2', 'b3', 'b4'].forEach((k, idx) => {
                    const soc = simulatedState[k];
                    if (soc < 10.0) {
                        currentAlerts.push({
                            id: `sim_pack_${idx + 1}_deep_discharge`,
                            target: `Battery ${idx + 1}`,
                            severity: 'critical',
                            title: `Battery ${idx + 1} Deep Discharge (${soc.toFixed(1)}%) [SIM]`,
                            explainer: `Simulated 20V 4Ah pack ${idx + 1} depleted below 10%. Emergency low-voltage shutdown simulated.`
                        });
                    } else if (soc < 20.0) {
                        currentAlerts.push({
                            id: `sim_pack_${idx + 1}_low_soc`,
                            target: `Battery ${idx + 1}`,
                            severity: 'warning',
                            title: `Battery ${idx + 1} Low Reserve (${soc.toFixed(1)}%) [SIM]`,
                            explainer: `Simulated 20V 4Ah pack ${idx + 1} has depleted below 20%. Simulated Li-ion reserve warning triggered.`
                        });
                    }
                });

                if (simulatedState.system < 10.0) {
                    currentAlerts.push({
                        id: 'sim_system_deep_discharge',
                        target: 'Rover System',
                        severity: 'critical',
                        title: `Rover System Charge Critical (${simulatedState.system.toFixed(1)}%) [SIM]`,
                        explainer: `Simulated total bus power dropped below 10%.`
                    });
                } else if (simulatedState.system < 20.0) {
                    currentAlerts.push({
                        id: 'sim_system_low_soc',
                        target: 'Rover System',
                        severity: 'warning',
                        title: `Rover System Low Reserve (${simulatedState.system.toFixed(1)}%) [SIM]`,
                        explainer: `Simulated total system power dropped below 20%.`
                    });
                }
            }

            // Detect new alerts and trigger notifications
            currentAlerts.forEach(a => {
                if (!notifiedAlertIds.has(a.id)) {
                    notifiedAlertIds.add(a.id);
                    triggerOpenMctNotification(a);
                }
            });

            // Remove cleared alerts from notified set
            const currentIds = new Set(currentAlerts.map(a => a.id));
            notifiedAlertIds.forEach(id => {
                if (!currentIds.has(id)) {
                    notifiedAlertIds.delete(id);
                }
            });

            activeAlerts = currentAlerts;
        }

        function broadcastSync() {
            const now = Date.now();
            const isIngressActive = (telemetryMode === 'simulated') || 
                (isMqttBrokerConnected && actualState.packetCount > 0 && ((now - actualState.lastReceivedTime) < 6000));

            if (syncChannel) {
                try {
                    syncChannel.postMessage({
                        telemetryMode: telemetryMode,
                        actualState: actualState,
                        simulatedState: simulatedState,
                        actualHistory: actualHistory,
                        simulatedHistory: simulatedHistory,
                        activeAlerts: activeAlerts,
                        isIngressActive: isIngressActive,
                        status: getConnectionStatus()
                    });
                } catch (e) {
                    console.warn('[Orion Battery] Broadcast sync error:', e);
                }
            }
        }

        // Push point strictly to Actual history
        function recordActualPoint(key, value, timestamp) {
            value = Math.max(0, Math.min(100, Number(value)));
            value = Math.round(value * 10) / 10;
            actualState.soc[key] = value;

            const point = { id: key, timestamp: timestamp, value: value };
            const hist = actualHistory[key];
            if (hist) {
                hist.push(point);
                if (hist.length > MAX_HISTORY) hist.shift();
            }

            if (subscribers.actual[key]) {
                subscribers.actual[key].forEach(cb => {
                    try { cb(point); } catch (_) {}
                });
            }
        }

        // Push point strictly to Simulated history
        function recordSimulatedPoint(key, value, timestamp) {
            value = Math.max(0, Math.min(100, Number(value)));
            value = Math.round(value * 10) / 10;
            simulatedState[key] = value;

            const point = { id: key, timestamp: timestamp, value: value };
            const hist = simulatedHistory[key];
            if (hist) {
                hist.push(point);
                if (hist.length > MAX_HISTORY) hist.shift();
            }

            if (subscribers.simulated[key]) {
                subscribers.simulated[key].forEach(cb => {
                    try { cb(point); } catch (_) {}
                });
            }
        }

        // Parse incoming real MQTT packets from Power/feedback
        function parseMqttMessage(msgTopic, messageStr, parsedData) {
            lastMqttMessageTime = Date.now();

            let data = parsedData;
            if (!data && typeof messageStr === 'string') {
                try { data = JSON.parse(messageStr); } catch (_) {}
            }

            if (data && typeof data === 'object') {
                const hasVoltages = (data.bat_1_v !== undefined || data.bat_2_v !== undefined || 
                                     data.bat_3_v !== undefined || data.bat_4_v !== undefined);

                if (hasVoltages || msgTopic.toLowerCase().includes('power') || msgTopic.toLowerCase().includes('feedback')) {
                    actualState.lastReceivedTime = lastMqttMessageTime;
                    actualState.packetCount++;
                    actualState.rawPayload = typeof messageStr === 'string' ? messageStr : JSON.stringify(data);

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

                    if (v1 !== undefined) actualState.v1 = v1;
                    if (v2 !== undefined) actualState.v2 = v2;
                    if (v3 !== undefined) actualState.v3 = v3;
                    if (v4 !== undefined) actualState.v4 = v4;
                    if (temp !== undefined) actualState.temp_c = temp;

                    if (data.adc_wl !== undefined) actualState.adcs.wl = data.adc_wl;
                    if (data.adc_wr !== undefined) actualState.adcs.wr = data.adc_wr;
                    if (data.adc_ram !== undefined) actualState.adcs.ram = data.adc_ram;
                    if (data.adc_elek !== undefined) actualState.adcs.elek = data.adc_elek;
                    if (data.adc_sci !== undefined) actualState.adcs.sci = data.adc_sci;
                    if (data.adc_inne !== undefined) actualState.adcs.inne = data.adc_inne;

                    // Calculate SOC % from actual voltages
                    const s1 = voltageToSoc(actualState.v1);
                    const s2 = voltageToSoc(actualState.v2);
                    const s3 = voltageToSoc(actualState.v3);
                    const s4 = voltageToSoc(actualState.v4);

                    const activeVolts = [actualState.v1, actualState.v2, actualState.v3, actualState.v4].filter(v => v >= 5.0);
                    let sysSoc = 0.0;
                    if (activeVolts.length > 0) {
                        sysSoc = activeVolts.reduce((sum, v) => sum + voltageToSoc(v), 0) / activeVolts.length;
                    }

                    // Record points ONLY to Actual history
                    recordActualPoint('b1', s1, lastMqttMessageTime);
                    recordActualPoint('b2', s2, lastMqttMessageTime);
                    recordActualPoint('b3', s3, lastMqttMessageTime);
                    recordActualPoint('b4', s4, lastMqttMessageTime);
                    recordActualPoint('system', sysSoc, lastMqttMessageTime);

                    evaluateBatteryHealth();
                    indicatorCallbacks.forEach(cb => { try { cb(); } catch (_) {} });
                    broadcastSync();
                    return true;
                }
            }

            if (customParser) {
                try {
                    const res = customParser(msgTopic, messageStr);
                    if (res) {
                        const ts = Date.now();
                        if (typeof res.b1 === 'number') recordActualPoint('b1', res.b1, ts);
                        if (typeof res.b2 === 'number') recordActualPoint('b2', res.b2, ts);
                        if (typeof res.b3 === 'number') recordActualPoint('b3', res.b3, ts);
                        if (typeof res.b4 === 'number') recordActualPoint('b4', res.b4, ts);
                        const avg = (actualState.soc.b1 + actualState.soc.b2 + actualState.soc.b3 + actualState.soc.b4) / 4;
                        recordActualPoint('system', avg, ts);
                        evaluateBatteryHealth();
                        indicatorCallbacks.forEach(cb => { try { cb(); } catch (_) {} });
                        broadcastSync();
                        return true;
                    }
                } catch (e) {
                    console.warn('[Orion Battery] Custom parser error:', e);
                }
            }

            return false;
        }

        // Connect to backend TCP MQTT bridge via WebSocket
        function initBridgeWebSocket() {
            if (typeof window === 'undefined') return;

            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = proto + '//' + window.location.host + '/mqtt-bridge';

            function connect() {
                try {
                    const ws = new WebSocket(wsUrl);

                    ws.onopen = function () {
                        isBridgeConnected = true;
                        console.log('[Orion Battery] Connected to backend MQTT Bridge WebSocket');
                        broadcastSync();
                    };

                    ws.onmessage = function (evt) {
                        try {
                            const msg = JSON.parse(evt.data);
                            if (msg.type === 'mqtt_status') {
                                isMqttBrokerConnected = msg.connected;
                                if (msg.brokerUrl) actualState.brokerHost = msg.brokerUrl;
                                if (msg.lastMessageTime) lastMqttMessageTime = msg.lastMessageTime;
                                broadcastSync();
                            } else if (msg.type === 'mqtt_message') {
                                isMqttBrokerConnected = true;
                                parseMqttMessage(msg.topic, msg.payload, msg.data);
                            }
                        } catch (err) {
                            console.warn('[Orion Battery] Bridge message error:', err);
                        }
                    };

                    ws.onclose = function () {
                        isBridgeConnected = false;
                        isMqttBrokerConnected = false;
                        broadcastSync();
                        setTimeout(connect, 3000);
                    };

                    ws.onerror = function () {
                        ws.close();
                    };
                } catch (e) {
                    setTimeout(connect, 5000);
                }
            }

            connect();
        }

        // Simulator controls: strictly starts only when mode is 'simulated'
        function startSimulator() {
            if (simulatorInterval) return;

            // Seed initial points for simulation if empty
            if (simulatedHistory.system.length === 0) {
                const now = Date.now();
                for (let i = 60; i >= 0; i--) {
                    const t = now - i * 1000;
                    const noise = Math.sin(i * 0.2) * 0.15;
                    recordSimulatedPoint('b1', 92.0 - i * 0.01 + noise, t);
                    recordSimulatedPoint('b2', 89.5 - i * 0.008 - noise, t);
                    recordSimulatedPoint('b3', 93.2 - i * 0.012 + noise * 0.5, t);
                    recordSimulatedPoint('b4', 88.8 - i * 0.009 - noise * 0.8, t);
                    recordSimulatedPoint('system', 90.8 - i * 0.01, t);
                }
            }

            let simStep = 0;
            simulatorInterval = setInterval(function () {
                if (telemetryMode !== 'simulated') {
                    stopSimulator();
                    return;
                }

                simStep++;
                const t = Date.now();
                const jitter1 = (Math.sin(simStep * 0.3) * 0.08) - 0.02;
                const jitter2 = (Math.cos(simStep * 0.25) * 0.06) - 0.02;
                const jitter3 = (Math.sin(simStep * 0.4 + 1) * 0.07) - 0.02;
                const jitter4 = (Math.cos(simStep * 0.35 + 2) * 0.09) - 0.02;

                let nb1 = simulatedState.b1 + jitter1;
                let nb2 = simulatedState.b2 + jitter2;
                let nb3 = simulatedState.b3 + jitter3;
                let nb4 = simulatedState.b4 + jitter4;

                if (nb1 < 15) nb1 = 98;
                if (nb2 < 15) nb2 = 96;
                if (nb3 < 15) nb3 = 99;
                if (nb4 < 15) nb4 = 95;

                recordSimulatedPoint('b1', nb1, t);
                recordSimulatedPoint('b2', nb2, t);
                recordSimulatedPoint('b3', nb3, t);
                recordSimulatedPoint('b4', nb4, t);
                const avg = (nb1 + nb2 + nb3 + nb4) / 4;
                recordSimulatedPoint('system', avg, t);

                evaluateBatteryHealth();
                indicatorCallbacks.forEach(cb => { try { cb(); } catch (_) {} });
                broadcastSync();
            }, 1000);
        }

        function stopSimulator() {
            if (simulatorInterval) {
                clearInterval(simulatorInterval);
                simulatorInterval = null;
            }
        }

        // Switch Telemetry Mode
        function setTelemetryMode(newMode, broadcast) {
            if (newMode !== 'actual' && newMode !== 'simulated') return;
            telemetryMode = newMode;

            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('orion_battery_telemetry_mode', newMode);
            }

            console.log(`[Orion Battery] Mode switched to: ${newMode.toUpperCase()}`);

            if (telemetryMode === 'simulated') {
                startSimulator();
            } else {
                stopSimulator();
            }

            evaluateBatteryHealth();

            if (broadcast !== false && syncChannel) {
                try {
                    syncChannel.postMessage({
                        action: 'switch_mode',
                        mode: newMode
                    });
                } catch (_) {}
            }

            indicatorCallbacks.forEach(cb => { try { cb(); } catch (_) {} });
            broadcastSync();
        }

        // UI Confirmation Modal for Mode Switching (NO emojis)
        function showModeConfirmationModal(targetMode) {
            if (typeof document === 'undefined') return;

            const oldModal = document.getElementById('orion-mode-switch-modal');
            if (oldModal) oldModal.remove();

            const isSwitchingToActual = targetMode === 'actual';

            const backdrop = document.createElement('div');
            backdrop.id = 'orion-mode-switch-modal';
            backdrop.style.position = 'fixed';
            backdrop.style.inset = '0';
            backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
            backdrop.style.backdropFilter = 'blur(6px)';
            backdrop.style.zIndex = '999999';
            backdrop.style.display = 'flex';
            backdrop.style.alignItems = 'center';
            backdrop.style.justifyContent = 'center';
            backdrop.style.padding = '20px';

            backdrop.innerHTML = `
                <div style="background: #252526; border: 1px solid #3e3e42; border-radius: 12px; width: 100%; max-width: 460px; padding: 22px 24px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #f8fafc;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 10px;">
                        <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #f8fafc;">Confirm Telemetry Source Switch</div>
                        <span style="font-size: 10px; font-family: monospace; padding: 2px 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.08); color: #94a3b8;">SAFETY INTERLOCK</span>
                    </div>

                    <div style="font-size: 13px; color: #cbd5e1; line-height: 1.5; margin-bottom: 16px;">
                        Switch battery telemetry stream from
                        <strong style="color: ${telemetryMode === 'actual' ? '#38bdf8' : '#c084fc'};">${telemetryMode.toUpperCase()}</strong> to
                        <strong style="color: ${isSwitchingToActual ? '#38bdf8' : '#c084fc'};">${targetMode.toUpperCase()}</strong>?
                    </div>

                    <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px 14px; font-size: 11px; color: #94a3b8; line-height: 1.6; margin-bottom: 20px;">
                        ${isSwitchingToActual ? `
                            <div style="color: #38bdf8; font-weight: 700; margin-bottom: 4px;">ACTUAL MQTT MODE:</div>
                            - Ingests strictly live telemetry from <code>mqtt://192.168.1.1:1883</code> (topic: <code>Power/feedback</code>).<br>
                            - Evaluates real 20V 4Ah accumulator voltages and health rules.<br>
                            - Synthetic telemetry simulator is completely disabled.<br>
                            - Actual and Simulated graphs remain strictly separate.
                        ` : `
                            <div style="color: #c084fc; font-weight: 700; margin-bottom: 4px;">SIMULATED MODE:</div>
                            - Activates synthetic benchmark telemetry curves.<br>
                            - Simulated points are stored in an isolated buffer and do not alter actual flight telemetry tables.
                        `}
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button id="orion-modal-cancel" style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); color: #cbd5e1; font-size: 12px; font-weight: 600; padding: 8px 16px; border-radius: 6px; cursor: pointer;">
                            Cancel
                        </button>
                        <button id="orion-modal-confirm" style="background: ${isSwitchingToActual ? '#0284c7' : '#7c3aed'}; border: none; color: #ffffff; font-size: 12px; font-weight: 700; padding: 8px 18px; border-radius: 6px; cursor: pointer;">
                            Confirm Switch to ${targetMode.toUpperCase()}
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(backdrop);

            function closeModal() {
                backdrop.remove();
            }

            backdrop.querySelector('#orion-modal-cancel').addEventListener('click', closeModal);
            backdrop.addEventListener('click', function (e) {
                if (e.target === backdrop) closeModal();
            });

            backdrop.querySelector('#orion-modal-confirm').addEventListener('click', function () {
                setTelemetryMode(targetMode, true);
                closeModal();
            });
        }

        // Initialize: only start simulator if mode is explicitly simulated
        if (telemetryMode === 'simulated') {
            startSimulator();
        } else {
            stopSimulator();
        }
        initBridgeWebSocket();
        evaluateBatteryHealth();

        // -------------------------------------------------------------
        // Open MCT Plugin Installation
        // -------------------------------------------------------------
        return function install(openmct) {
            console.log('[Orion Battery] Installing Orion Rover 4-Battery MQTT Plugin...');
            openmctInstance = openmct;

            // 1. Register Separate Root Objects for Actual and Simulated
            openmct.objects.addRoot({
                namespace: NAMESPACE,
                key: 'actual_root'
            });

            openmct.objects.addRoot({
                namespace: NAMESPACE,
                key: 'simulated_root'
            });

            // 2. Object Provider
            const objectProvider = {
                get: function (identifier) {
                    if (identifier.key === 'actual_root') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Actual Telemetry (MQTT 192.168.1.1)',
                            type: 'folder',
                            location: 'ROOT'
                        });
                    }

                    if (identifier.key === 'simulated_root') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Simulated Telemetry (Offline)',
                            type: 'folder',
                            location: 'ROOT'
                        });
                    }

                    if (identifier.key === 'actual_plot') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Actual Power Overview Plot',
                            type: 'telemetry.plot.overlay',
                            location: `${NAMESPACE}:actual_root`,
                            composition: ACTUAL_DEFINITIONS.map(d => ({ namespace: NAMESPACE, key: d.key }))
                        });
                    }

                    if (identifier.key === 'simulated_plot') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Simulated Overview Plot',
                            type: 'telemetry.plot.overlay',
                            location: `${NAMESPACE}:simulated_root`,
                            composition: SIMULATED_DEFINITIONS.map(d => ({ namespace: NAMESPACE, key: d.key }))
                        });
                    }

                    const actDef = ACTUAL_DEFINITIONS.find(d => d.key === identifier.key);
                    if (actDef) {
                        return Promise.resolve({
                            identifier: identifier,
                            name: actDef.name,
                            type: 'orion.battery.telemetry.actual',
                            telemetry: {
                                values: [
                                    { key: 'value', name: 'Charge (%)', unit: '%', format: 'float', min: 0, max: 100, hints: { range: 1 } },
                                    { key: 'utc', source: 'timestamp', name: 'Timestamp', format: 'utc', hints: { domain: 1 } }
                                ]
                            },
                            location: `${NAMESPACE}:actual_root`
                        });
                    }

                    const simDef = SIMULATED_DEFINITIONS.find(d => d.key === identifier.key);
                    if (simDef) {
                        return Promise.resolve({
                            identifier: identifier,
                            name: simDef.name,
                            type: 'orion.battery.telemetry.simulated',
                            telemetry: {
                                values: [
                                    { key: 'value', name: 'Charge (%)', unit: '%', format: 'float', min: 0, max: 100, hints: { range: 1 } },
                                    { key: 'utc', source: 'timestamp', name: 'Timestamp', format: 'utc', hints: { domain: 1 } }
                                ]
                            },
                            location: `${NAMESPACE}:simulated_root`
                        });
                    }

                    if (identifier.key === 'system') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Battery System',
                            type: 'folder',
                            location: 'ROOT'
                        });
                    }

                    return Promise.resolve(null);
                }
            };
            openmct.objects.addProvider(NAMESPACE, objectProvider);

            // 3. Composition Provider
            const compositionProvider = {
                appliesTo: function (domainObject) {
                    return domainObject.identifier.namespace === NAMESPACE &&
                           ['actual_root', 'simulated_root', 'actual_plot', 'simulated_plot'].includes(domainObject.identifier.key);
                },
                load: function (domainObject) {
                    if (domainObject.identifier.key === 'actual_root') {
                        const items = ACTUAL_DEFINITIONS.map(d => ({ namespace: NAMESPACE, key: d.key }));
                        items.push({ namespace: NAMESPACE, key: 'actual_plot' });
                        return Promise.resolve(items);
                    }
                    if (domainObject.identifier.key === 'simulated_root') {
                        const items = SIMULATED_DEFINITIONS.map(d => ({ namespace: NAMESPACE, key: d.key }));
                        items.push({ namespace: NAMESPACE, key: 'simulated_plot' });
                        return Promise.resolve(items);
                    }
                    if (domainObject.identifier.key === 'actual_plot') {
                        return Promise.resolve(ACTUAL_DEFINITIONS.map(d => ({ namespace: NAMESPACE, key: d.key })));
                    }
                    if (domainObject.identifier.key === 'simulated_plot') {
                        return Promise.resolve(SIMULATED_DEFINITIONS.map(d => ({ namespace: NAMESPACE, key: d.key })));
                    }
                    return Promise.resolve([]);
                }
            };
            openmct.composition.addProvider(compositionProvider);

            // 4. Custom Telemetry Types
            openmct.types.addType('orion.battery.telemetry.actual', {
                name: 'Actual Battery Telemetry Point',
                description: 'Telemetry point directly from MQTT 192.168.1.1 (Power/feedback).',
                cssClass: 'icon-telemetry'
            });

            openmct.types.addType('orion.battery.telemetry.simulated', {
                name: 'Simulated Battery Telemetry Point',
                description: 'Synthetic benchmark telemetry point.',
                cssClass: 'icon-telemetry'
            });

            // 5. Real-Time Telemetry Provider
            const realtimeProvider = {
                supportsSubscribe: function (domainObject) {
                    if (domainObject.identifier.namespace !== NAMESPACE) return false;
                    return ACTUAL_DEFINITIONS.some(d => d.key === domainObject.identifier.key) ||
                           SIMULATED_DEFINITIONS.some(d => d.key === domainObject.identifier.key);
                },
                subscribe: function (domainObject, callback) {
                    const key = domainObject.identifier.key;
                    const actDef = ACTUAL_DEFINITIONS.find(d => d.key === key);
                    if (actDef) {
                        const pk = actDef.packKey;
                        subscribers.actual[pk].add(callback);
                        const hist = actualHistory[pk];
                        if (hist && hist.length > 0) {
                            callback(hist[hist.length - 1]);
                        }
                        return function unsubscribe() {
                            subscribers.actual[pk].delete(callback);
                        };
                    }

                    const simDef = SIMULATED_DEFINITIONS.find(d => d.key === key);
                    if (simDef) {
                        const pk = simDef.packKey;
                        subscribers.simulated[pk].add(callback);
                        const hist = simulatedHistory[pk];
                        if (hist && hist.length > 0) {
                            callback(hist[hist.length - 1]);
                        }
                        return function unsubscribe() {
                            subscribers.simulated[pk].delete(callback);
                        };
                    }

                    return function () {};
                }
            };
            openmct.telemetry.addProvider(realtimeProvider);

            // 6. Historical Telemetry Provider
            const historicalProvider = {
                supportsRequest: function (domainObject) {
                    if (domainObject.identifier.namespace !== NAMESPACE) return false;
                    return ACTUAL_DEFINITIONS.some(d => d.key === domainObject.identifier.key) ||
                           SIMULATED_DEFINITIONS.some(d => d.key === domainObject.identifier.key);
                },
                request: function (domainObject, reqOptions) {
                    const key = domainObject.identifier.key;
                    const start = reqOptions.start || 0;
                    const end = reqOptions.end || Infinity;

                    const actDef = ACTUAL_DEFINITIONS.find(d => d.key === key);
                    if (actDef) {
                        const hist = actualHistory[actDef.packKey] || [];
                        return Promise.resolve(hist.filter(p => p.timestamp >= start && p.timestamp <= end));
                    }

                    const simDef = SIMULATED_DEFINITIONS.find(d => d.key === key);
                    if (simDef) {
                        const hist = simulatedHistory[simDef.packKey] || [];
                        return Promise.resolve(hist.filter(p => p.timestamp >= start && p.timestamp <= end));
                    }

                    return Promise.resolve([]);
                }
            };
            openmct.telemetry.addProvider(historicalProvider);

            // 7. Upper Panel Battery Indicator
            if (openmct.indicators && typeof document !== 'undefined') {
                const indicatorEl = document.createElement('div');
                indicatorEl.className = 'c-indicator c-indicator--clickable orion-battery-indicator';
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
                indicatorEl.title = 'Orion Rover Battery System. Click to open detailed Diagnostics window.';

                indicatorEl.innerHTML = `
                    <div id="ind-batt-clickable" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <div id="ind-batt-led" style="width: 7px; height: 7px; border-radius: 0px; background: #64748b; flex-shrink: 0;"></div>
                        <span id="ind-batt-text" style="font-size: 11px; font-weight: 700; font-family: monospace; letter-spacing: -0.2px; color: #f8fafc; pointer-events: none;">BATT: NO LINK</span>
                    </div>
                    <button id="ind-batt-mode-btn" style="border: 1px solid #38bdf8; border-radius: 0px; background: #222222; color: #38bdf8; padding: 1px 5px; font-size: 9px; font-weight: 800; font-family: monospace; cursor: pointer;" title="Click to switch between Actual and Simulated telemetry">
                        ACTUAL
                    </button>
                `;

                function openDetailsWindow() {
                    console.log('[Orion Battery] Opening battery-details.html window...');
                    window.open('/battery-details.html', 'OrionBatteryDetailsWindow', 'width=960,height=680,resizable=yes');
                }

                indicatorEl.addEventListener('click', function (e) {
                    if (e.target && (e.target.id === 'ind-batt-mode-btn' || e.target.closest('#ind-batt-mode-btn'))) {
                        return;
                    }
                    openDetailsWindow();
                });

                const clickablePart = indicatorEl.querySelector('#ind-batt-clickable');
                if (clickablePart) {
                    clickablePart.addEventListener('click', function (e) {
                        e.stopPropagation();
                        openDetailsWindow();
                    });
                }

                const modeBtn = indicatorEl.querySelector('#ind-batt-mode-btn');
                if (modeBtn) {
                    modeBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        const targetMode = telemetryMode === 'actual' ? 'simulated' : 'actual';
                        showModeConfirmationModal(targetMode);
                    });
                }

                openmct.indicators.add({
                    element: indicatorEl,
                    priority: openmct.priority.HIGH || 100
                });

                const ledEl = indicatorEl.querySelector('#ind-batt-led');
                const textEl = indicatorEl.querySelector('#ind-batt-text');

                function updateIndicatorView() {
                    const isActual = telemetryMode === 'actual';
                    const hasPackets = (actualState.packetCount > 0);

                    if (isActual && !hasPackets) {
                        if (textEl) textEl.innerText = 'BATT: NO LINK';
                        if (ledEl) ledEl.style.background = '#64748b';
                        indicatorEl.style.borderColor = '#282828';
                        indicatorEl.style.background = '#161616';
                        indicatorEl.title = '20V 4Ah Battery System\nSTATUS: NOT CONNECTED (Awaiting MQTT 192.168.1.1:1883)\nClick to open Diagnostics window.';
                        if (modeBtn) {
                            modeBtn.innerText = 'ACTUAL';
                            modeBtn.style.background = 'rgba(2, 132, 199, 0.25)';
                            modeBtn.style.color = '#38bdf8';
                            modeBtn.style.border = '1px solid rgba(56, 189, 248, 0.4)';
                        }
                        return;
                    }

                    const currentSoc = (isActual && actualState.soc && typeof actualState.soc.system === 'number')
                        ? actualState.soc.system
                        : (isActual ? 0.0 : (simulatedState.system || 90.5));
                    const busV = (isActual && typeof actualState.voltage_bus === 'number')
                        ? actualState.voltage_bus
                        : (isActual ? ((actualState.v1 || 0) + (actualState.v2 || 0) + (actualState.v3 || 0) + (actualState.v4 || 0)) : 20.1);

                    if (textEl) textEl.innerText = `BATT: ${Number(busV || 0).toFixed(1)}V | ${Number(currentSoc || 0).toFixed(0)}%`;

                    // Alert check
                    const hasError = activeAlerts.some(a => a.severity === 'error');
                    const hasWarning = activeAlerts.length > 0;

                    if (ledEl) {
                        if (currentSoc <= 20 || hasError) {
                            ledEl.style.background = '#ef4444';
                        } else if (currentSoc <= 50 || hasWarning) {
                            ledEl.style.background = '#f59e0b';
                        } else {
                            ledEl.style.background = '#22c55e';
                        }
                    }

                    // Indicator frame alert coloring
                    if (hasError) {
                        indicatorEl.style.borderColor = '#ef4444';
                        indicatorEl.style.background = '#7f1d1d33';
                    } else if (hasWarning) {
                        indicatorEl.style.borderColor = '#f59e0b';
                        indicatorEl.style.background = '#78350f33';
                    } else {
                        indicatorEl.style.borderColor = '#282828';
                        indicatorEl.style.background = '#161616';
                    }

                    // Mode Button Styling
                    if (modeBtn) {
                        if (isActual) {
                            modeBtn.innerText = 'ACTUAL';
                            modeBtn.style.background = 'rgba(2, 132, 199, 0.25)';
                            modeBtn.style.color = '#38bdf8';
                            modeBtn.style.border = '1px solid rgba(56, 189, 248, 0.4)';
                            modeBtn.title = 'Mode: ACTUAL (192.168.1.1: Power/feedback). Click to switch to Simulated.';
                        } else {
                            modeBtn.innerText = 'SIMULATED';
                            modeBtn.style.background = 'rgba(124, 58, 237, 0.25)';
                            modeBtn.style.color = '#c084fc';
                            modeBtn.style.border = '1px solid rgba(192, 132, 252, 0.4)';
                            modeBtn.title = 'Mode: SIMULATED. Click to switch to Actual.';
                        }
                    }

                    // Rich Tooltip with active alerts & explainers
                    let tooltip = `20V 4Ah Accumulator System: ${currentSoc.toFixed(1)}% [MODE: ${telemetryMode.toUpperCase()}]\n`;
                    if (isActual) {
                        const activeCount = [actualState.v1, actualState.v2, actualState.v3, actualState.v4].filter(v => v >= 5.0).length;
                        tooltip += `Bat 1: ${actualState.v1.toFixed(2)}V | Bat 2: ${actualState.v2.toFixed(2)}V | ` +
                                   `Bat 3: ${actualState.v3.toFixed(2)}V | Bat 4: ${actualState.v4.toFixed(2)}V\n` +
                                   `Active Packs: ${activeCount}/4 | Temp: ${actualState.temp_c}°C\n`;
                    }

                    if (activeAlerts.length > 0) {
                        tooltip += `\nACTIVE ALERTS (${activeAlerts.length}):\n`;
                        activeAlerts.forEach(a => {
                            tooltip += `• [${a.severity.toUpperCase()}] ${a.title}\n  ${a.explainer}\n`;
                        });
                    } else {
                        tooltip += `Status: ALL SYSTEMS NOMINAL\n`;
                    }
                    tooltip += `Click battery to open Diagnostics. Click badge to switch mode.`;

                    indicatorEl.title = tooltip;
                }

                indicatorCallbacks.push(updateIndicatorView);
                updateIndicatorView();
            }

            console.log('[Orion Battery] Plugin installed successfully.');
        };
    };
}));
