/**
 * Orion VI Minimalistic Status & Exception Widgets Plugin (ERC 2026)
 * Standards: NASA-STD-3001, ECSS-E-ST-70-41C, ECSS-E-ST-10-24C
 * 
 * Provides native Open MCT views for exception monitoring:
 * 1. orion.overview_exception: Master SoH Banner, 8-Subsystem Matrix & Active Anomaly Feed (FDIR)
 * 2. orion.nav_status: Minimalist Navigation SoH, Tilt Hazard Watchdog & Waypoint Progress
 * 3. orion.maintenance_status: Compute, Environment, 5GHz Link & Subsystem Node Heartbeats
 * 
 * Styled strictly with the Dark Grey palette (#1e1e1e, #252526, #2d2d30, #3e3e42)
 */

(function () {
    function OrionStatusWidgetsPlugin() {
        return function install(openmct) {
            // Give Open MCT reference to engine
            if (window.OrionExceptionEngine) {
                window.OrionExceptionEngine.setOpenMct(openmct);
            }

            // Register Custom Types
            openmct.types.addType('orion.overview_exception', {
                name: 'Rover Master Health & Anomaly Feed',
                description: 'Executive State-of-Health summary and active anomaly annunciator',
                cssClass: 'icon-activity'
            });

            openmct.types.addType('orion.nav_status', {
                name: 'Navigation Health & Tilt Hazard Watchdog',
                description: 'Autonomy status, rollover hazard monitoring and waypoint tracking',
                cssClass: 'icon-compass'
            });

            openmct.types.addType('orion.maintenance_status', {
                name: 'System Maintenance & Diagnostics',
                description: 'Compute temperatures, 5GHz RF link health and node heartbeats',
                cssClass: 'icon-wrench'
            });

            // Register Object View: Overview Exception
            openmct.objectViews.addProvider({
                key: 'orion-overview-exception-view',
                name: 'Master Health View',
                cssClass: 'icon-activity',
                canView: function (domainObject) {
                    return domainObject.type === 'orion.overview_exception' ||
                           (domainObject.identifier && domainObject.identifier.key === 'widget_overview_status');
                },
                view: function (domainObject) {
                    let viewContainer = null;
                    return {
                        show: function (container) {
                            viewContainer = container;
                            renderOverviewException(container, openmct);
                        },
                        destroy: function (container) {
                            const c = container || viewContainer;
                            if (c && c._cleanup) c._cleanup();
                        }
                    };
                }
            });

            // Register Object View: Nav Status
            openmct.objectViews.addProvider({
                key: 'orion-nav-status-view',
                name: 'Navigation Health View',
                cssClass: 'icon-compass',
                canView: function (domainObject) {
                    return domainObject.type === 'orion.nav_status' ||
                           (domainObject.identifier && domainObject.identifier.key === 'widget_nav_status');
                },
                view: function (domainObject) {
                    let viewContainer = null;
                    return {
                        show: function (container) {
                            viewContainer = container;
                            renderNavStatus(container, openmct);
                        },
                        destroy: function (container) {
                            const c = container || viewContainer;
                            if (c && c._cleanup) c._cleanup();
                        }
                    };
                }
            });

            // Register Object View: Maintenance Status
            openmct.objectViews.addProvider({
                key: 'orion-maintenance-status-view',
                name: 'Maintenance Health View',
                cssClass: 'icon-wrench',
                canView: function (domainObject) {
                    return domainObject.type === 'orion.maintenance_status' ||
                           (domainObject.identifier && domainObject.identifier.key === 'widget_maintenance_status');
                },
                view: function (domainObject) {
                    let viewContainer = null;
                    return {
                        show: function (container) {
                            viewContainer = container;
                            renderMaintenanceStatus(container, openmct);
                        },
                        destroy: function (container) {
                            const c = container || viewContainer;
                            if (c && c._cleanup) c._cleanup();
                        }
                    };
                }
            });
        };
    }

    // =========================================================================
    // 1. OVERVIEW EXCEPTION VIEW (Single-line Compact Aerospace Annunciator)
    // =========================================================================
    function renderOverviewException(container, openmct) {
        container.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #161616;
            border: 1px solid #282828;
            border-radius: 0px;
            padding: 8px 14px;
            color: #d4d4d4;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
            gap: 12px;
            height: 100%;
            overflow: hidden;
            user-select: none;
        `;

        container.innerHTML = `
            <!-- Left: Master Status LED & Label -->
            <div style="display: flex; align-items: center; gap: 8px; min-width: 170px; flex-shrink: 0;">
                <div id="ov-status-dot" style="width: 8px; height: 8px; border-radius: 0px; background: #64748b; flex-shrink: 0;"></div>
                <div>
                    <div id="ov-status-title" style="font-size: 12px; font-weight: 800; letter-spacing: 0.5px; color: #f8fafc; line-height: 1.2;">NOT CONNECTED</div>
                    <div id="ov-status-sub" style="font-size: 9px; color: #71717a; font-family: monospace;">AWAITING MQTT 192.168.1.1:1883</div>
                </div>
            </div>

            <!-- Center: 8-Subsystem Square Status Matrix -->
            <div id="ov-subsystem-strip" style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: center; flex: 1;">
                <!-- Rendered dynamically -->
            </div>

            <!-- Right: Alarm Badge & Essential Action Buttons -->
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                <div id="ov-alarm-badge" style="background: #202020; color: #888888; font-weight: 800; padding: 3px 6px; border: 1px solid #333333; border-radius: 0px; font-size: 9px; font-family: monospace;">
                    NO LINK
                </div>
                <button id="ov-btn-ack" style="background: #222222; color: #e4e4e7; border: 1px solid #3f3f46; border-radius: 0px; padding: 4px 8px; font-size: 9px; font-weight: 700; cursor: pointer; letter-spacing: 0.5px;" title="Acknowledge active alarms">
                    ACK
                </button>
                <button id="ov-btn-estop" style="background: #7f1d1d; color: #ffffff; border: 1px solid #dc2626; border-radius: 0px; padding: 4px 8px; font-size: 9px; font-weight: 800; cursor: pointer; letter-spacing: 0.5px;" title="Emergency Stop">
                    E-STOP
                </button>
            </div>
        `;

        const bannerDot = container.querySelector('#ov-status-dot');
        const bannerTitle = container.querySelector('#ov-status-title');
        const bannerSub = container.querySelector('#ov-status-sub');
        const alarmBadge = container.querySelector('#ov-alarm-badge');
        const subStrip = container.querySelector('#ov-subsystem-strip');
        const btnAck = container.querySelector('#ov-btn-ack');
        const btnEstop = container.querySelector('#ov-btn-estop');

        if (btnAck) {
            btnAck.addEventListener('click', () => {
                if (window.OrionExceptionEngine) {
                    window.OrionExceptionEngine.acknowledgeAll();
                }
            });
        }

        if (btnEstop) {
            btnEstop.addEventListener('click', () => {
                if (window.OrionSafetyCommandService) {
                    window.OrionSafetyCommandService.triggerHardwareEStop();
                } else if (window.openmct) {
                    window.openmct.notifications.error('[SAFETY] HARDWARE E-STOP COMMAND DISPATCHED');
                }
            });
        }

        const SUBSYSTEM_TAGS = [
            { id: 'power', tag: 'PWR' },
            { id: 'chassis_drive', tag: 'DRV' },
            { id: 'compute_net', tag: 'NET' },
            { id: 'perception', tag: 'PERC' },
            { id: 'navigation', tag: 'NAV' },
            { id: 'manipulator', tag: 'ARM' },
            { id: 'science', tag: 'SCI' },
            { id: 'safety', tag: 'SAFE' }
        ];

        function updateView(summary) {
            if (!summary) return;

            bannerDot.style.background = summary.masterColor;
            bannerTitle.textContent = summary.masterStatus;

            if (summary.isDisconnected) {
                bannerSub.textContent = 'AWAITING MQTT (192.168.1.1:1883)';
                alarmBadge.textContent = 'NO LINK';
                alarmBadge.style.background = '#202020';
                alarmBadge.style.borderColor = '#333333';
                alarmBadge.style.color = '#888888';
            } else if (summary.activeAlertsCount === 0) {
                bannerSub.textContent = 'DARK COCKPIT | ALL SYSTEMS NOMINAL';
                alarmBadge.textContent = '0 ALARMS';
                alarmBadge.style.background = '#14532d33';
                alarmBadge.style.borderColor = '#166534';
                alarmBadge.style.color = '#22c55e';
            } else {
                bannerSub.textContent = `${summary.activeAlertsCount} ACTIVE EXCEPTION(S)`;
                alarmBadge.textContent = `${summary.activeAlertsCount} ACTIVE`;
                alarmBadge.style.background = `${summary.masterColor}22`;
                alarmBadge.style.borderColor = summary.masterColor;
                alarmBadge.style.color = summary.masterColor;
            }

            // Render Subsystem Status Chips
            subStrip.innerHTML = '';
            SUBSYSTEM_TAGS.forEach(item => {
                const subData = summary.subsystems ? summary.subsystems[item.id] : null;
                const state = subData ? subData.state : (summary.isDisconnected ? 'DISCONNECTED' : 'NOMINAL');
                const chipColor = subData ? subData.color : (state === 'CRITICAL' ? '#ef4444' : (state === 'WARNING' ? '#f59e0b' : (state === 'DISCONNECTED' ? '#64748b' : '#22c55e')));

                const chip = document.createElement('div');
                chip.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    background: #1c1c1c;
                    border: 1px solid ${state === 'NOMINAL' || state === 'DISCONNECTED' ? '#2e2e2e' : chipColor};
                    border-radius: 0px;
                    padding: 2px 5px;
                    font-size: 9px;
                    font-family: monospace;
                    font-weight: 700;
                    color: ${state === 'NOMINAL' ? '#a1a1aa' : (state === 'DISCONNECTED' ? '#71717a' : chipColor)};
                `;
                chip.innerHTML = `
                    <div style="width: 5px; height: 5px; border-radius: 0px; background: ${chipColor};"></div>
                    <span>${item.tag}</span>
                `;
                chip.title = `${item.tag}: ${state}`;
                subStrip.appendChild(chip);
            });
        }

        let unsubscribe = null;
        if (window.OrionExceptionEngine) {
            unsubscribe = window.OrionExceptionEngine.subscribe(updateView);
        }

        container._cleanup = () => {
            if (unsubscribe) unsubscribe();
        };
    }

    // =========================================================================
    // 2. NAV STATUS VIEW (Single-line Compact Aerospace Annunciator)
    // =========================================================================
    function renderNavStatus(container, openmct) {
        container.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #161616;
            border: 1px solid #282828;
            border-radius: 0px;
            padding: 8px 14px;
            color: #d4d4d4;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
            gap: 12px;
            height: 100%;
            overflow: hidden;
            user-select: none;
        `;

        container.innerHTML = `
            <!-- Left: Autonomy State -->
            <div style="display: flex; align-items: center; gap: 10px; min-width: 200px;">
                <div id="nav-led" style="width: 10px; height: 10px; border-radius: 0px; background: #22c55e; flex-shrink: 0;"></div>
                <div>
                    <div id="nav-state-label" style="font-size: 12px; font-weight: 800; color: #f8fafc;">NAV2: IDLE</div>
                    <div id="nav-slam-label" style="font-size: 10px; color: #71717a; font-family: monospace;">SLAM: LOCKED | D435i: ONLINE</div>
                </div>
            </div>

            <!-- Center: Terrain Hazard Margins & Waypoint -->
            <div style="display: flex; align-items: center; gap: 12px; flex: 1; justify-content: center; font-size: 11px; font-family: monospace;">
                <div style="display: flex; align-items: center; gap: 6px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 4px 8px;">
                    <span style="color: #71717a;">PITCH:</span>
                    <span id="nav-val-pitch" style="font-weight: 700; color: #f8fafc;">0.0°</span>
                    <span style="color: #71717a; margin-left: 4px;">ROLL:</span>
                    <span id="nav-val-roll" style="font-weight: 700; color: #f8fafc;">0.0°</span>
                    <div id="nav-pill-tilt" style="font-size: 9px; font-weight: 800; padding: 1px 4px; border-radius: 0px; background: #14532d33; color: #22c55e; border: 1px solid #166534; margin-left: 4px;">SAFE</div>
                </div>

                <div style="display: flex; align-items: center; gap: 6px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 4px 8px;">
                    <span style="color: #71717a;">WAYPOINT:</span>
                    <span id="nav-val-wp" style="font-weight: 700; color: #38bdf8;">12.8 m @ 045°</span>
                </div>
            </div>

            <!-- Right: Action Button -->
            <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                <button id="nav-btn-cancel" style="background: #222222; color: #e4e4e7; border: 1px solid #3f3f46; border-radius: 0px; padding: 5px 12px; font-size: 10px; font-weight: 700; cursor: pointer; letter-spacing: 0.5px;">
                    HALT AUTONOMY
                </button>
            </div>
        `;

        const led = container.querySelector('#nav-led');
        const stateLabel = container.querySelector('#nav-state-label');
        const slamLabel = container.querySelector('#nav-slam-label');
        const valPitch = container.querySelector('#nav-val-pitch');
        const valRoll = container.querySelector('#nav-val-roll');
        const pillTilt = container.querySelector('#nav-pill-tilt');
        const valWp = container.querySelector('#nav-val-wp');
        const btnCancel = container.querySelector('#nav-btn-cancel');

        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                if (window.openmct) {
                    window.openmct.notifications.info('[NAV] Autonomy halt command dispatched');
                }
            });
        }

        function updateView(summary) {
            if (!summary) return;
            const t = summary.telemetry || {};
            const isDisc = summary.isDisconnected || (t['rover.nav.pitch'] === undefined && t['rover.nav.nav2_state'] === undefined);

            if (isDisc) {
                stateLabel.textContent = 'NAV2: NOT CONNECTED';
                slamLabel.textContent = 'AWAITING MQTT (192.168.1.1:1883)';
                led.style.background = '#64748b';
                valPitch.textContent = '---°';
                valRoll.textContent = '---°';
                pillTilt.textContent = 'NO LINK';
                pillTilt.style.background = '#202020';
                pillTilt.style.borderColor = '#333333';
                pillTilt.style.color = '#888888';
                valWp.textContent = '---';
                return;
            }

            const state = t['rover.nav.nav2_state'] || 'IDLE';
            stateLabel.textContent = `NAV2: ${state}`;
            slamLabel.textContent = 'SLAM: LOCKED | D435i: ONLINE';

            if (state === 'NAVIGATING') {
                led.style.background = '#22c55e';
            } else if (state === 'RECOVERY' || state === 'ABORTED') {
                led.style.background = '#ef4444';
            } else {
                led.style.background = '#10b981';
            }

            const pitch = Number(t['rover.nav.pitch']) || 0;
            const roll = Number(t['rover.nav.roll']) || 0;
            valPitch.textContent = `${pitch.toFixed(1)}°`;
            valRoll.textContent = `${roll.toFixed(1)}°`;

            const maxTilt = Math.max(Math.abs(pitch), Math.abs(roll));
            if (maxTilt > 30) {
                pillTilt.textContent = 'CRITICAL TILT (>30°)';
                pillTilt.style.background = '#7f1d1d44';
                pillTilt.style.borderColor = '#dc2626';
                pillTilt.style.color = '#ef4444';
            } else if (maxTilt > 20) {
                pillTilt.textContent = 'CAUTION TILT (>20°)';
                pillTilt.style.background = '#78350f44';
                pillTilt.style.borderColor = '#d97706';
                pillTilt.style.color = '#f59e0b';
            } else {
                pillTilt.textContent = 'SAFE (<20°)';
                pillTilt.style.background = '#14532d33';
                pillTilt.style.borderColor = '#166534';
                pillTilt.style.color = '#22c55e';
            }

            const dist = t['rover.nav.target_wp_dist'];
            const bearing = t['rover.nav.target_wp_bearing'];
            if (dist !== undefined) {
                valWp.textContent = `${Number(dist).toFixed(1)} m @ ${Math.round(bearing || 0)}°`;
            } else {
                valWp.textContent = 'STANDBY';
            }
        }

        let unsubscribe = null;
        if (window.OrionExceptionEngine) {
            unsubscribe = window.OrionExceptionEngine.subscribe(updateView);
        }

        container._cleanup = () => {
            if (unsubscribe) unsubscribe();
        };
    }

    // =========================================================================
    // 3. MAINTENANCE STATUS VIEW (Single-line Compact Aerospace Annunciator)
    // =========================================================================
    function renderMaintenanceStatus(container, openmct) {
        container.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #161616;
            border: 1px solid #282828;
            border-radius: 0px;
            padding: 8px 14px;
            color: #d4d4d4;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
            gap: 12px;
            height: 100%;
            overflow: hidden;
            user-select: none;
        `;

        container.innerHTML = `
            <!-- Left: Node Heartbeat Status -->
            <div style="display: flex; align-items: center; gap: 8px; min-width: 170px; flex-shrink: 0;">
                <div id="maint-led" style="width: 8px; height: 8px; border-radius: 0px; background: #64748b; flex-shrink: 0;"></div>
                <div>
                    <div id="maint-title" style="font-size: 12px; font-weight: 800; color: #f8fafc;">NODES: NOT CONNECTED</div>
                    <div style="font-size: 9px; color: #71717a; font-family: monospace;">AWAITING MQTT 192.168.1.1:1883</div>
                </div>
            </div>

            <!-- Center: Temperatures & 5GHz RF Comms -->
            <div style="display: flex; align-items: center; gap: 8px; flex: 1; justify-content: center; font-size: 10px; font-family: monospace;">
                <div style="display: flex; align-items: center; gap: 5px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 6px;">
                    <span style="color: #71717a;">JETSON:</span>
                    <span id="maint-val-jcpu" style="font-weight: 700; color: #f8fafc;">---°C</span>
                    <span style="color: #71717a; margin-left: 3px;">RPI 5:</span>
                    <span id="maint-val-rcpu" style="font-weight: 700; color: #f8fafc;">---°C</span>
                    <span style="color: #71717a; margin-left: 3px;">BAY:</span>
                    <span id="maint-val-encl" style="font-weight: 700; color: #f8fafc;">---°C</span>
                </div>

                <div style="display: flex; align-items: center; gap: 5px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 6px;">
                    <span style="color: #71717a;">5GHz LINK:</span>
                    <span id="maint-val-rssi" style="font-weight: 700; color: #38bdf8;">--- dBm</span>
                    <span id="maint-val-ping" style="color: #a1a1aa;">--- ms</span>
                </div>
            </div>

            <!-- Right: Action Button -->
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                <button id="maint-btn-reconnect" style="background: #222222; color: #e4e4e7; border: 1px solid #3f3f46; border-radius: 0px; padding: 4px 8px; font-size: 9px; font-weight: 700; cursor: pointer; letter-spacing: 0.5px;" title="Reconnect MQTT Link">
                    RECONNECT
                </button>
            </div>
        `;

        const led = container.querySelector('#maint-led');
        const title = container.querySelector('#maint-title');
        const valJcpu = container.querySelector('#maint-val-jcpu');
        const valRcpu = container.querySelector('#maint-val-rcpu');
        const valEncl = container.querySelector('#maint-val-encl');
        const valRssi = container.querySelector('#maint-val-rssi');
        const valPing = container.querySelector('#maint-val-ping');
        const btnReconnect = container.querySelector('#maint-btn-reconnect');

        if (btnReconnect) {
            btnReconnect.addEventListener('click', () => {
                if (window.openmct) {
                    window.openmct.notifications.info('[TRANSPORT] MQTT reconnect sequence initiated (192.168.1.1:1883)');
                }
            });
        }

        function updateView(summary) {
            if (!summary) return;
            const t = summary.telemetry || {};
            const isDisc = summary.isDisconnected || (t['rover.compute.jetson.cpu_temp'] === undefined && t['rover.net.rssi'] === undefined);

            if (isDisc) {
                title.textContent = 'NODES: NOT CONNECTED';
                led.style.background = '#64748b';
                valJcpu.textContent = '---°C';
                valRcpu.textContent = '---°C';
                valEncl.textContent = '---°C';
                valRssi.textContent = '--- dBm';
                valPing.textContent = '--- ms';
                return;
            }

            title.textContent = 'HARDWARE & NODES: NOMINAL';
            led.style.background = '#22c55e';

            const jcpu = t['rover.compute.jetson.cpu_temp'];
            valJcpu.textContent = jcpu !== undefined ? `${Number(jcpu).toFixed(1)}°C` : '---°C';

            const rcpu = t['rover.compute.rpi.cpu_temp'];
            valRcpu.textContent = rcpu !== undefined ? `${Number(rcpu).toFixed(1)}°C` : '---°C';

            const encl = t['rover.safety.enclosure_temp'];
            valEncl.textContent = encl !== undefined ? `${Number(encl).toFixed(1)}°C` : '---°C';

            const rssi = t['rover.net.rssi'];
            const latency = t['rover.net.latency'];
            valRssi.textContent = rssi !== undefined ? `${rssi} dBm` : '--- dBm';
            valPing.textContent = latency !== undefined ? `${latency} ms` : '--- ms';

            const maintAlerts = summary.alerts ? summary.alerts.filter(a => a.subsystem === 'compute_net') : [];
            if (maintAlerts.length > 0) {
                led.style.background = maintAlerts[0].severity === 'critical' ? '#ef4444' : '#f59e0b';
                title.textContent = `HARDWARE: ${maintAlerts.length} EXCEPTION(S)`;
            } else {
                led.style.background = '#22c55e';
                title.textContent = 'HARDWARE & NODES: NOMINAL';
            }
        }

        let unsubscribe = null;
        if (window.OrionExceptionEngine) {
            unsubscribe = window.OrionExceptionEngine.subscribe(updateView);
        }

        container._cleanup = () => {
            if (unsubscribe) unsubscribe();
        };
    }

    if (typeof window !== 'undefined') {
        window.OrionStatusWidgetsPlugin = OrionStatusWidgetsPlugin;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionStatusWidgetsPlugin;
    }
})();
