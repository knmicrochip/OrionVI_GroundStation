/**
 * Orion VI Safety Kill-Chain Plugin (ERC 2026)
 * 
 * Flowchart and status monitoring for the 2-Layer Safety System:
 * - Layer 1 (Software): Heartbeat Watchdog, Remote Cutoff, UVLO, Thermal
 * - Layer 2 (Hardware): ABB MEPY1-1042 Red Emergency Button + Relay Kill-Switch
 */

(function () {
    function OrionSafetyChainPlugin() {
        return function install(openmct) {
            openmct.types.addType('orion.safety_chain', {
                name: 'Safety Kill Chain Interlock',
                description: '2-layer safety system monitoring and emergency power control',
                cssClass: 'icon-alert-rect'
            });

            openmct.objectViews.addProvider({
                key: 'orion-safety-chain-view',
                name: 'Safety Kill Chain View',
                cssClass: 'icon-alert-rect',
                canView: function (domainObject) {
                    return domainObject.type === 'orion.safety_chain' ||
                           (domainObject.identifier && domainObject.identifier.key === 'safety_chain');
                },
                view: function (domainObject) {
                    let viewContainer = null;
                    return {
                        show: function (container) {
                            viewContainer = container;
                            renderSafetyChain(container, openmct);
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

    function renderSafetyChain(container, openmct) {
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            background: #252526;
            border: 1px solid #3e3e42;
            border-radius: 6px;
            padding: 16px;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
            gap: 16px;
            user-select: none;
        `;

        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #3e3e42; padding-bottom: 10px;">
                <div>
                    <div style="font-weight: 800; font-size: 14px; color: #f8fafc; letter-spacing: 0.5px;">EMERGENCY POWER CONTROL SYSTEM (EPCS)</div>
                    <div style="font-size: 11px; color: #94a3b8;">2-Layer Rover Protection Architecture (Software Inhibit + Hardware Relay)</div>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 11px; color: #94a3b8;">KILL-CHAIN:</span>
                    <span id="sc-chain-badge" style="background: #3e3e42; color: #94a3b8; font-weight: 800; font-size: 11px; padding: 3px 8px; border-radius: 3px;">AWAITING TELEMETRY</span>
                </div>
            </div>

            <!-- Flowchart Container -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                <!-- Layer 1: Software -->
                <div style="background: #2d2d30; border: 1px solid #3e3e42; border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="font-size: 11px; font-weight: 800; color: #38bdf8; border-bottom: 1px solid #3e3e42; padding-bottom: 4px;">LAYER 1: SOFTWARE SUPERVISION</div>
                    
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                        <span style="color: #cbd5e1;">5GHz Link Watchdog:</span>
                        <span id="sc-pill-heartbeat" style="font-family: monospace; font-weight: 700; color: #94a3b8;">--- (AWAITING INGRESS)</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                        <span style="color: #cbd5e1;">Under-Voltage Lock-Out (UVLO):</span>
                        <span id="sc-pill-uvlo" style="font-weight: 700; color: #94a3b8;">---</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                        <span style="color: #cbd5e1;">Enclosure Temperature:</span>
                        <span id="sc-pill-temp" style="font-family: monospace; font-weight: 700; color: #94a3b8;">---</span>
                    </div>
                </div>

                <!-- Layer 2: Hardware -->
                <div style="background: #2d2d30; border: 1px solid #3e3e42; border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="font-size: 11px; font-weight: 800; color: #f59e0b; border-bottom: 1px solid #3e3e42; padding-bottom: 4px;">LAYER 2: HARDWARE RELAY</div>
                    
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                        <span style="color: #cbd5e1;">ABB MEPY1-1042 Button:</span>
                        <span id="sc-pill-estop" style="font-weight: 700; color: #94a3b8;">---</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                        <span style="color: #cbd5e1;">Main Power Relay:</span>
                        <span id="sc-pill-relay" style="font-weight: 700; color: #94a3b8;">---</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                        <span style="color: #cbd5e1;">Last Trip Reason:</span>
                        <span id="sc-pill-reason" style="font-family: monospace; font-size: 10px; color: #94a3b8;">NONE</span>
                    </div>
                </div>
            </div>

            <!-- Emergency Actions Bar -->
            <div style="display: flex; align-items: center; justify-content: space-between; background: #2d2d30; border: 1px solid #3e3e42; padding: 10px 14px; border-radius: 4px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <button id="btn-trigger-estop" style="background: #dc2626; color: white; border: 2px solid #ef4444; padding: 8px 16px; border-radius: 4px; font-weight: 800; font-size: 12px; cursor: pointer; letter-spacing: 0.5px;">
                        EMERGENCY POWER CUT-OFF (E-STOP)
                    </button>
                    <button id="btn-reset-safety" style="background: #3e3e42; color: #cbd5e1; border: 1px solid #4f4f54; padding: 8px 14px; border-radius: 4px; font-weight: 700; font-size: 11px; cursor: pointer;">
                        RESET / RE-ARM SAFETY
                    </button>
                </div>
                <span id="sc-trip-msg" style="font-size: 11px; color: #94a3b8; font-style: italic;">Telemetry pipeline awaiting MQTT ingress.</span>
            </div>
        `;

        const badgeChain = container.querySelector('#sc-chain-badge');
        const pillHeartbeat = container.querySelector('#sc-pill-heartbeat');
        const pillUvlo = container.querySelector('#sc-pill-uvlo');
        const pillTemp = container.querySelector('#sc-pill-temp');
        const pillEstop = container.querySelector('#sc-pill-estop');
        const pillRelay = container.querySelector('#sc-pill-relay');
        const pillReason = container.querySelector('#sc-pill-reason');
        const tripMsg = container.querySelector('#sc-trip-msg');

        const btnEstop = container.querySelector('#btn-trigger-estop');
        const btnReset = container.querySelector('#btn-reset-safety');

        btnEstop.addEventListener('click', () => {
            if (window.confirm('TRIGGER EMERGENCY POWER CUT-OFF: This immediately disables all rover drives, manipulators, and science actuators. Continue?')) {
                if (window.OrionSafetyService) {
                    window.OrionSafetyService.safeSendCommand({ action: 'ESTOP_ACTIVATE' });
                    openmct.notifications.error('EMERGENCY STOP ACTIVATED: All actuators killed.');
                }
            }
        });

        btnReset.addEventListener('click', () => {
            if (window.confirm('RESET SAFETY INTERLOCK: Verify rover physical perimeter is clear before restoring power.')) {
                if (window.OrionSafetyService) {
                    window.OrionSafetyService.safeSendCommand({ action: 'RESET_SAFETY' });
                    openmct.notifications.info('Safety interlock reset.');
                }
            }
        });

        // Telemetry Subscriptions
        const unsubs = [];
        if (openmct && openmct.telemetry) {
            const u1 = openmct.telemetry.subscribe({ identifier: { namespace: 'orion.taxonomy', key: 'rover.safety.kill_chain_state' }, type: 'orion.telemetry' }, (p) => {
                const isInhibited = p.value === 'INHIBITED';
                if (isInhibited) {
                    badgeChain.textContent = 'INHIBITED (ACTUATORS LOCKED)';
                    badgeChain.style.background = '#dc2626';
                    pillRelay.textContent = 'OPEN / DE-ENERGIZED';
                    pillRelay.style.color = '#ef4444';
                    tripMsg.textContent = 'Actuator motion locked due to active safety condition.';
                    tripMsg.style.color = '#ef4444';
                } else {
                    badgeChain.textContent = 'CLEAR / ARMED';
                    badgeChain.style.background = '#16a34a';
                    pillRelay.textContent = 'ENERGIZED (CLOSED)';
                    pillRelay.style.color = '#22c55e';
                    tripMsg.textContent = 'All safety circuits currently nominal.';
                    tripMsg.style.color = '#94a3b8';
                }
            });

            const u2 = openmct.telemetry.subscribe({ identifier: { namespace: 'orion.taxonomy', key: 'rover.safety.heartbeat_timer' }, type: 'orion.telemetry' }, (p) => {
                const val = parseFloat(p.value) || 0.0;
                pillHeartbeat.textContent = `${val.toFixed(1)}s ${val > 2.0 ? '(NOMINAL)' : '(WARNING)'}`;
                pillHeartbeat.style.color = val > 2.0 ? '#22c55e' : (val > 0.5 ? '#f59e0b' : '#ef4444');
            });

            const u3 = openmct.telemetry.subscribe({ identifier: { namespace: 'orion.taxonomy', key: 'rover.safety.estop_hardware' }, type: 'orion.telemetry' }, (p) => {
                const isDepressed = parseInt(p.value, 10) === 1;
                pillEstop.textContent = isDepressed ? 'DEPRESSED (TRIPPED)' : 'NORMAL (UNTRIGGERED)';
                pillEstop.style.color = isDepressed ? '#ef4444' : '#22c55e';
            });

            const u4 = openmct.telemetry.subscribe({ identifier: { namespace: 'orion.taxonomy', key: 'rover.safety.last_trip_reason' }, type: 'orion.telemetry' }, (p) => {
                pillReason.textContent = String(p.value || 'NONE');
            });

            const u5 = openmct.telemetry.subscribe({ identifier: { namespace: 'orion.taxonomy', key: 'rover.safety.uvlo_tripped' }, type: 'orion.telemetry' }, (p) => {
                const uvlo = parseInt(p.value, 10) === 1;
                pillUvlo.textContent = uvlo ? 'TRIPPED (<15.0V)' : 'CLEAR (>15.0V)';
                pillUvlo.style.color = uvlo ? '#ef4444' : '#22c55e';
            });

            unsubs.push(u1, u2, u3, u4, u5);
        }

        container._cleanup = () => {
            unsubs.forEach(u => u && u());
        };
    }

    if (typeof window !== 'undefined') {
        window.OrionSafetyChainPlugin = OrionSafetyChainPlugin;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionSafetyChainPlugin;
    }
})();

