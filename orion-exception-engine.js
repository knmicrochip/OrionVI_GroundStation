/**
 * Orion VI Exception & State-of-Health Engine (ERC 2026)
 * Standards: NASA-STD-3001, ECSS-E-ST-70-41C, ECSS-E-ST-10-24C
 * 
 * Philosophy: Management by Exception ("Dark Cockpit")
 * - Nominal state is quiet, clean, and unobtrusive.
 * - Staged severity hierarchy: NOTICE (Advisory / Event), WARNING (Caution / Soft Limit), CRITICAL (Trip / Hard Limit).
 * - Missing telemetry is attributed to MQTT Transport Link timeout, NOT physical hardware failure.
 * - Integrates with openmct.notifications with stateful deduplication.
 */

(function () {
    const SUBSYSTEMS = [
        { id: 'power', name: 'Power System', critical: true },
        { id: 'drive', name: 'Chassis / Drive', critical: true },
        { id: 'compute_net', name: 'Compute & Net', critical: false },
        { id: 'perception', name: 'Perception', critical: false },
        { id: 'navigation', name: 'Navigation / SLAM', critical: true },
        { id: 'manipulator', name: 'Robotic Manipulator', critical: false },
        { id: 'science', name: 'Science Payload', critical: false },
        { id: 'safety', name: 'Safety / Interlocks', critical: true }
    ];

    class OrionExceptionEngine {
        constructor() {
            this.openmctInstance = null;
            this.listeners = new Set();
            this.telemetryValues = new Map();
            this.lastPacketTimes = new Map(); // subsystemId -> timestamp
            this.activeAlerts = new Map();     // alertId -> alertObj
            this.notifiedAlertIds = new Set();
            this.ws = null;
            this.reconnectTimer = null;

            // Start watchdog loop for limit and timeout evaluations
            this.watchdogInterval = setInterval(() => this.evaluateAll(), 1000);
        }

        setOpenMct(openmct) {
            this.openmctInstance = openmct;
        }

        connect(wsUrl) {
            if (!wsUrl && typeof window !== 'undefined' && window.location && window.location.origin) {
                wsUrl = window.location.origin.replace(/^http/, 'ws') + '/realtime';
            } else if (!wsUrl) {
                wsUrl = 'ws://localhost:8088/realtime';
            }
            if (typeof WebSocket === 'undefined') return;
            if (this.ws) {
                try { this.ws.close(); } catch (_) {}
            }

            try {
                this.ws = new WebSocket(wsUrl);
                this.ws.onopen = () => {
                    // Subscribe to wildcard or all channels
                    try {
                        this.ws.send(JSON.stringify({ action: 'subscribe', id: '*' }));
                    } catch (_) {}
                };

                this.ws.onmessage = (event) => {
                    try {
                        const point = JSON.parse(event.data);
                        if (point && point.id) {
                            this.handleTelemetryPoint(point.id, point.value, point.utc || Date.now());
                        }
                    } catch (_) {}
                };

                this.ws.onclose = () => {
                    if (!this.reconnectTimer) {
                        this.reconnectTimer = setTimeout(() => {
                            this.reconnectTimer = null;
                            this.connect(wsUrl);
                        }, 2000);
                    }
                };
            } catch (err) {
                console.warn('[ExceptionEngine] WebSocket error:', err);
            }
        }

        handleTelemetryPoint(id, value, utc) {
            utc = utc || Date.now();
            this.telemetryValues.set(id, value);

            // Mark subsystem activity
            const subId = this.getSubsystemFromId(id);
            if (subId) {
                this.lastPacketTimes.set(subId, utc);
            }

            this.evaluatePoint(id, value, utc);
        }

        getSubsystemFromId(id) {
            if (id.startsWith('rover.power.')) return 'power';
            if (id.startsWith('rover.drive.')) return 'drive';
            if (id.startsWith('rover.compute.') || id.startsWith('rover.net.')) return 'compute_net';
            if (id.startsWith('rover.perception.')) return 'perception';
            if (id.startsWith('rover.nav.')) return 'navigation';
            if (id.startsWith('rover.arm.')) return 'manipulator';
            if (id.startsWith('rover.science.')) return 'science';
            if (id.startsWith('rover.safety.')) return 'safety';
            return null;
        }

        evaluateAll() {
            const now = Date.now();

            // 1. Check Subsystem Telemetry Timeouts (> 5 seconds without packets)
            SUBSYSTEMS.forEach(sub => {
                const lastTime = this.lastPacketTimes.get(sub.id) || 0;
                const alertKey = `timeout_${sub.id}`;
                const age = now - lastTime;

                if (lastTime === 0 || age > 6000) {
                    // Attributed strictly to MQTT Transport Link
                    const severity = sub.critical ? 'critical' : (sub.id === 'compute_net' || sub.id === 'navigation' ? 'warning' : 'notice');
                    this.setAlert(alertKey, {
                        id: alertKey,
                        subsystem: sub.id,
                        subsystemName: sub.name,
                        severity: severity,
                        title: `MQTT Transport: No ${sub.name} telemetry received`,
                        explainer: `No MQTT telemetry packets received for > 5.0s (Mosquitto 192.168.1.1:1883). Telemetry link is offline; hardware status unknown.`,
                        recovery: `Verify Raspberry Pi Mosquitto service and Wi-Fi link.`,
                        timestamp: now,
                        isTimeout: true
                    });
                } else {
                    this.clearAlert(alertKey);
                }
            });

            // 2. Evaluate Specific Parameter Limits
            this.evaluateLimits(now);

            // 3. Notify UI Listeners
            this.notifyListeners();
        }

        evaluateLimits(now) {
            const getVal = (k) => this.telemetryValues.get(k);

            // Power Limits
            const busV = getVal('rover.power.bus.voltage');
            if (typeof busV === 'number' && busV > 0) {
                if (busV < 15.0) {
                    this.setAlert('pwr_uvlo', {
                        id: 'pwr_uvlo',
                        subsystem: 'power',
                        subsystemName: 'Power System',
                        severity: 'critical',
                        title: 'UVLO: Main 20V Bus Undervoltage Trip',
                        explainer: `Bus voltage dropped to ${busV.toFixed(2)}V (< 15.0V threshold). Risk of permanent Li-ion cell damage.`,
                        recovery: 'Disconnect heavy loads immediately; plug in charger or replace battery packs.',
                        timestamp: now
                    });
                } else if (busV < 16.5) {
                    this.clearAlert('pwr_uvlo');
                    this.setAlert('pwr_low', {
                        id: 'pwr_low',
                        subsystem: 'power',
                        subsystemName: 'Power System',
                        severity: 'warning',
                        title: 'Power: Battery Reserve Low (< 20% SoC)',
                        explainer: `Main bus voltage at ${busV.toFixed(2)}V (< 16.5V). Battery depletion approaching.`,
                        recovery: 'Return rover toward base station; shed non-essential loads.',
                        timestamp: now
                    });
                } else if (busV > 21.2) {
                    this.clearAlert('pwr_uvlo');
                    this.clearAlert('pwr_low');
                    this.setAlert('pwr_overv', {
                        id: 'pwr_overv',
                        subsystem: 'power',
                        subsystemName: 'Power System',
                        severity: 'warning',
                        title: 'Power: Bus Overvoltage Detected',
                        explainer: `Main bus voltage at ${busV.toFixed(2)}V (> 21.2V maximum 5S limit).`,
                        recovery: 'Check charger regulator and BMS balancing circuit.',
                        timestamp: now
                    });
                } else {
                    this.clearAlert('pwr_uvlo');
                    this.clearAlert('pwr_low');
                    this.clearAlert('pwr_overv');
                }
            }

            // Power Pack Imbalance
            const v1 = getVal('rover.power.battery.1.v');
            const v2 = getVal('rover.power.battery.2.v');
            const v3 = getVal('rover.power.battery.3.v');
            const v4 = getVal('rover.power.battery.4.v');
            const activeVs = [v1, v2, v3, v4].filter(v => typeof v === 'number' && v > 10);
            if (activeVs.length >= 2) {
                const minV = Math.min(...activeVs);
                const maxV = Math.max(...activeVs);
                if (maxV - minV > 1.2) {
                    this.setAlert('pwr_imbalance', {
                        id: 'pwr_imbalance',
                        subsystem: 'power',
                        subsystemName: 'Power System',
                        severity: 'warning',
                        title: 'Power: Parallel Battery Imbalance (> 1.2V delta)',
                        explainer: `Voltage delta between packs is ${(maxV - minV).toFixed(2)}V. Risk of cross-charging currents.`,
                        recovery: 'Check individual pack states; disconnect depleted module.',
                        timestamp: now
                    });
                } else {
                    this.clearAlert('pwr_imbalance');
                }
            }

            // Drive Overcurrent / Stall
            const wheels = ['fl', 'ml', 'rl', 'fr', 'mr', 'rr'];
            let maxCurrent = 0;
            let stallWheel = '';
            wheels.forEach(w => {
                const i = getVal(`rover.drive.current.${w}`);
                if (typeof i === 'number' && i > maxCurrent) {
                    maxCurrent = i;
                    stallWheel = w.toUpperCase();
                }
            });

            if (maxCurrent > 8.0) {
                this.setAlert('drv_stall', {
                    id: 'drv_stall',
                    subsystem: 'drive',
                    subsystemName: 'Chassis / Drive',
                    severity: 'critical',
                    title: `Drive: Motor Stall / Overcurrent on ${stallWheel} (${maxCurrent.toFixed(1)}A)`,
                    explainer: `Wheel current reached ${maxCurrent.toFixed(1)}A (> 8.0A stall limit). High risk of BLDC / ODrive thermal trip.`,
                    recovery: 'Stop rover traverse immediately; reverse slightly or dislodge obstacle.',
                    timestamp: now
                });
            } else if (maxCurrent > 5.5) {
                this.clearAlert('drv_stall');
                this.setAlert('drv_high_current', {
                    id: 'drv_high_current',
                    subsystem: 'drive',
                    subsystemName: 'Chassis / Drive',
                    severity: 'warning',
                    title: `Drive: High Motor Current on ${stallWheel} (${maxCurrent.toFixed(1)}A)`,
                    explainer: `Wheel motor drawing elevated current. Rover may be in deep sand or steep incline.`,
                    recovery: 'Reduce speed limit or steer to flatter terrain.',
                    timestamp: now
                });
            } else {
                this.clearAlert('drv_stall');
                this.clearAlert('drv_high_current');
            }

            // Compute & Net Limits
            const jetsonTemp = getVal('rover.compute.jetson.cpu_temp');
            if (typeof jetsonTemp === 'number') {
                if (jetsonTemp > 82) {
                    this.setAlert('comp_jetson_hot', {
                        id: 'comp_jetson_hot',
                        subsystem: 'compute_net',
                        subsystemName: 'Compute & Net',
                        severity: 'critical',
                        title: `Compute: Jetson CPU Thermal Throttling (${jetsonTemp.toFixed(1)}°C)`,
                        explainer: `Jetson Orin NX reached ${jetsonTemp.toFixed(1)}°C (> 82°C limit). Performance will throttle.`,
                        recovery: 'Reduce AI model resolution or idle camera pipeline; check cooling fan.',
                        timestamp: now
                    });
                } else if (jetsonTemp > 72) {
                    this.clearAlert('comp_jetson_hot');
                    this.setAlert('comp_jetson_warm', {
                        id: 'comp_jetson_warm',
                        subsystem: 'compute_net',
                        subsystemName: 'Compute & Net',
                        severity: 'warning',
                        title: `Compute: Jetson Temperature Elevated (${jetsonTemp.toFixed(1)}°C)`,
                        explainer: `Jetson Orin NX is warm. Ambient electronics enclosure may be heating up.`,
                        recovery: 'Monitor electronics bay airflow.',
                        timestamp: now
                    });
                } else {
                    this.clearAlert('comp_jetson_hot');
                    this.clearAlert('comp_jetson_warm');
                }
            }

            const rssi = getVal('rover.net.rssi');
            if (typeof rssi === 'number' && rssi < 0) {
                if (rssi < -78) {
                    this.setAlert('net_rssi_weak', {
                        id: 'net_rssi_weak',
                        subsystem: 'compute_net',
                        subsystemName: 'Compute & Net',
                        severity: 'warning',
                        title: `Network: 5GHz Ubiquiti Signal Weak (${rssi} dBm)`,
                        explainer: `Downlink RSSI is at ${rssi} dBm (<-78 dBm threshold). Video dropouts imminent.`,
                        recovery: 'Orient mast antenna towards base station or move rover closer to line of sight.',
                        timestamp: now
                    });
                } else {
                    this.clearAlert('net_rssi_weak');
                }
            }

            // Navigation Tilt Hazard
            const pitch = getVal('rover.nav.pitch');
            const roll = getVal('rover.nav.roll');
            const maxTilt = Math.max(Math.abs(Number(pitch) || 0), Math.abs(Number(roll) || 0));
            if (maxTilt > 30) {
                this.setAlert('nav_tilt_crit', {
                    id: 'nav_tilt_crit',
                    subsystem: 'navigation',
                    subsystemName: 'Navigation / SLAM',
                    severity: 'critical',
                    title: `Navigation: Severe Rollover Hazard (Tilt: ${maxTilt.toFixed(1)}°)`,
                    explainer: `Rover pitch/roll tilt is at ${maxTilt.toFixed(1)}° (> 30° tip-over limit).`,
                    recovery: 'Halt traverse immediately! Back out slowly down the slope gradient.',
                    timestamp: now
                });
            } else if (maxTilt > 20) {
                this.clearAlert('nav_tilt_crit');
                this.setAlert('nav_tilt_warn', {
                    id: 'nav_tilt_warn',
                    subsystem: 'navigation',
                    subsystemName: 'Navigation / SLAM',
                    severity: 'warning',
                    title: `Navigation: Terrain Tilt Angle Caution (${maxTilt.toFixed(1)}°)`,
                    explainer: `Rover traversing incline at ${maxTilt.toFixed(1)}° (> 20° caution margin).`,
                    recovery: 'Proceed at reduced speed limit (0.5 m/s).',
                    timestamp: now
                });
            } else {
                this.clearAlert('nav_tilt_crit');
                this.clearAlert('nav_tilt_warn');
            }

            // Manipulator Limits
            const shLoad = getVal('rover.arm.joint.load.shoulder');
            const elLoad = getVal('rover.arm.joint.load.elbow');
            const maxArmLoad = Math.max(Number(shLoad) || 0, Number(elLoad) || 0);
            if (maxArmLoad > 3.4) {
                this.setAlert('arm_stall', {
                    id: 'arm_stall',
                    subsystem: 'manipulator',
                    subsystemName: 'Robotic Manipulator',
                    severity: 'critical',
                    title: `Manipulator: Joint Motor Stall / Load Exceeded (${maxArmLoad.toFixed(1)}A)`,
                    explainer: `Servo load reached ${maxArmLoad.toFixed(1)}A (> 3.4A threshold). Risk of worm-gear damage.`,
                    recovery: 'Halt arm motion immediately; command STOW or back away from obstacle.',
                    timestamp: now
                });
            } else if (maxArmLoad > 2.5) {
                this.clearAlert('arm_stall');
                this.setAlert('arm_load_warn', {
                    id: 'arm_load_warn',
                    subsystem: 'manipulator',
                    subsystemName: 'Robotic Manipulator',
                    severity: 'warning',
                    title: `Manipulator: Elevated Joint Load (${maxArmLoad.toFixed(1)}A)`,
                    explainer: `Manipulator joint motor drawing elevated current.`,
                    recovery: 'Ensure arm payload is within 1.5kg rated capacity.',
                    timestamp: now
                });
            } else {
                this.clearAlert('arm_stall');
                this.clearAlert('arm_load_warn');
            }

            // Science Limits
            const weight = getVal('rover.science.tensometer_weight');
            if (typeof weight === 'number' && weight > 0) {
                if (weight > 180) {
                    this.setAlert('sci_overload', {
                        id: 'sci_overload',
                        subsystem: 'science',
                        subsystemName: 'Science Payload',
                        severity: 'critical',
                        title: `Science: Tensometer Weight Critical Overload (${weight.toFixed(1)}g)`,
                        explainer: `Sample collection weight exceeded 180g capacity. Strain gauge saturation.`,
                        recovery: 'Cease vacuum suction and stop sample ingestion.',
                        timestamp: now
                    });
                } else if (weight > 150) {
                    this.clearAlert('sci_overload');
                    this.setAlert('sci_capacity', {
                        id: 'sci_capacity',
                        subsystem: 'science',
                        subsystemName: 'Science Payload',
                        severity: 'warning',
                        title: `Science: Sample Capacity Approaching (${weight.toFixed(1)}g)`,
                        explainer: `Tensometer weight is at ${weight.toFixed(1)}g (> 150g warning threshold).`,
                        recovery: 'Prepare to seal sample chamber and end extraction sequence.',
                        timestamp: now
                    });
                } else {
                    this.clearAlert('sci_overload');
                    this.clearAlert('sci_capacity');
                }
            }

            // Safety System
            const estop = getVal('rover.safety.estop_hardware');
            if (estop === 1 || estop === 'DEPRESSED') {
                this.setAlert('saf_estop', {
                    id: 'saf_estop',
                    subsystem: 'safety',
                    subsystemName: 'Safety / Interlocks',
                    severity: 'critical',
                    title: 'SAFETY ALERT: ABB MEPY1-1042 Emergency Stop DEPRESSED',
                    explainer: 'Hardware emergency stop button is depressed. All actuator power is physically cut by relay.',
                    recovery: 'Rotate and pull physical E-stop button on rover chassis to release; then reset safety interlock.',
                    timestamp: now
                });
            } else {
                this.clearAlert('saf_estop');
            }

            const uvloTripped = getVal('rover.safety.uvlo_tripped');
            if (uvloTripped === 1) {
                this.setAlert('saf_uvlo', {
                    id: 'saf_uvlo',
                    subsystem: 'safety',
                    subsystemName: 'Safety / Interlocks',
                    severity: 'critical',
                    title: 'SAFETY ALERT: UVLO Hardware Interlock Tripped',
                    explainer: 'Main 20V power bus dropped below safe cutoff threshold; relay isolated actuators.',
                    recovery: 'Replace or recharge 5S Li-ion battery packs before re-arming.',
                    timestamp: now
                });
            } else {
                this.clearAlert('saf_uvlo');
            }
        }

        evaluatePoint(id, value, utc) {
            // Immediate trigger on critical safety keys
            if (id === 'rover.safety.estop_hardware' && (value === 1 || value === 'DEPRESSED')) {
                this.setAlert('saf_estop', {
                    id: 'saf_estop',
                    subsystem: 'safety',
                    subsystemName: 'Safety / Interlocks',
                    severity: 'critical',
                    title: 'SAFETY ALERT: ABB MEPY1-1042 Emergency Stop DEPRESSED',
                    explainer: 'Hardware emergency stop button is depressed. All actuator power is physically cut by relay.',
                    recovery: 'Rotate and pull physical E-stop button on rover chassis to release.',
                    timestamp: utc
                });
                this.notifyListeners();
            }
        }

        setAlert(key, alertObj) {
            this.activeAlerts.set(key, alertObj);

            // Deduplicated notification trigger
            if (!this.notifiedAlertIds.has(key)) {
                this.notifiedAlertIds.add(key);
                this.dispatchNotification(alertObj);
            }
        }

        clearAlert(key) {
            if (this.activeAlerts.has(key)) {
                this.activeAlerts.delete(key);
                this.notifiedAlertIds.delete(key);
            }
        }

        dispatchNotification(alert) {
            if (!this.openmctInstance || !this.openmctInstance.notifications) return;
            // Suppress sticky notification banners for missing MQTT telemetry / timeouts
            if (alert && alert.isTimeout) return;

            const sevUpper = alert.severity ? alert.severity.toUpperCase() : 'NOTICE';
            const msg = `[${sevUpper}] ${alert.title}: ${alert.explainer}`;

            try {
                if (alert.severity === 'critical') {
                    if (typeof this.openmctInstance.notifications.error === 'function') {
                        this.openmctInstance.notifications.error(msg);
                    }
                } else if (alert.severity === 'warning') {
                    if (typeof this.openmctInstance.notifications.alert === 'function') {
                        this.openmctInstance.notifications.alert(msg);
                    }
                } else {
                    if (typeof this.openmctInstance.notifications.info === 'function') {
                        this.openmctInstance.notifications.info(msg);
                    }
                }
            } catch (err) {
                console.warn('[ExceptionEngine] Notification error:', err);
            }
        }

        subscribe(callback) {
            this.listeners.add(callback);
            callback(this.getSummary());
            return () => this.listeners.delete(callback);
        }

        notifyListeners() {
            const summary = this.getSummary();
            this.listeners.forEach(cb => {
                try { cb(summary); } catch (_) {}
            });
        }

        getSummary() {
            const alertsList = Array.from(this.activeAlerts.values());
            const faultAlerts = alertsList.filter(a => !a.isTimeout);

            const hasCritical = faultAlerts.some(a => a.severity === 'critical');
            const hasWarning = faultAlerts.some(a => a.severity === 'warning');
            const hasNotice = faultAlerts.some(a => a.severity === 'notice');

            const totalPackets = Array.from(this.lastPacketTimes.values()).reduce((sum, t) => sum + (t > 0 ? 1 : 0), 0);
            const isAllDisconnected = (totalPackets === 0);

            let masterStatus = 'ALL SYSTEMS NOMINAL';
            let masterColor = '#10b981'; // Nominal green

            if (isAllDisconnected) {
                masterStatus = 'NOT CONNECTED';
                masterColor = '#64748b'; // Neutral grey for disconnected link
            } else if (hasCritical) {
                masterStatus = 'CRITICAL FAULT';
                masterColor = '#ef4444'; // Red
            } else if (hasWarning) {
                masterStatus = 'CAUTION';
                masterColor = '#f59e0b'; // Amber
            } else if (hasNotice) {
                masterStatus = 'ADVISORY';
                masterColor = '#38bdf8'; // Cyan
            }

            // Subsystem SoH states
            const subsystemStates = {};
            const now = Date.now();
            SUBSYSTEMS.forEach(sub => {
                const subAlerts = alertsList.filter(a => a.subsystem === sub.id);
                const subFaults = subAlerts.filter(a => !a.isTimeout);
                const isCrit = subFaults.some(a => a.severity === 'critical');
                const isWarn = subFaults.some(a => a.severity === 'warning');
                const lastTime = this.lastPacketTimes.get(sub.id) || 0;
                const isDisconnected = (lastTime === 0);
                const isStale = (!isDisconnected && (now - lastTime > 6000));

                let state = 'NOMINAL';
                let color = '#10b981';

                if (isDisconnected) {
                    state = 'DISCONNECTED';
                    color = '#64748b';
                } else if (isCrit) {
                    state = 'CRITICAL';
                    color = '#ef4444';
                } else if (isWarn) {
                    state = 'WARNING';
                    color = '#f59e0b';
                } else if (isStale) {
                    state = 'NO LINK';
                    color = '#f59e0b';
                }

                subsystemStates[sub.id] = {
                    id: sub.id,
                    name: sub.name,
                    state: state,
                    color: color,
                    alerts: subFaults
                };
            });

            return {
                masterStatus,
                masterColor,
                isDisconnected: isAllDisconnected,
                activeAlertsCount: faultAlerts.length,
                alerts: faultAlerts,
                subsystems: subsystemStates,
                telemetry: Object.fromEntries(this.telemetryValues)
            };
        }
    }

    const engine = new OrionExceptionEngine();

    if (typeof window !== 'undefined') {
        window.OrionExceptionEngine = engine;
        // Connect automatically when page loads
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => engine.connect());
        } else {
            engine.connect();
        }
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = engine;
    }
})();
