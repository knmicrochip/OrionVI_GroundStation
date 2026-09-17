/**
 * Orion VI Manipulator Control & Health Pad (ERC 2026)
 * Standards: NASA-STD-3001, ECSS-E-ST-70-41C
 * 
 * Management by Exception:
 * - Emphasizes joint stall protection (>3.4A), limit stops, and safety interlocks
 * - Dark grey cockpit theme (#1e1e1e, #252526, #2d2d30, #3e3e42)
 * - 4 Named preset poses + rapid arm emergency hold
 * - Exception feed displays active manipulator alarms
 */

(function () {
    function OrionManipulatorPadPlugin() {
        return function install(openmct) {
            openmct.types.addType('orion.manipulator_pad', {
                name: 'Robotic Manipulator Control & Health Pad',
                description: 'Joint angle readouts, presets, and worm gear stall monitoring for the Orion VI arm',
                cssClass: 'icon-gear'
            });

            openmct.objectViews.addProvider({
                key: 'orion-manipulator-pad-view',
                name: 'Manipulator Health View',
                cssClass: 'icon-gear',
                canView: function (domainObject) {
                    return domainObject.type === 'orion.manipulator_pad' ||
                           (domainObject.identifier && domainObject.identifier.key === 'widget_manipulator_pad') ||
                           (domainObject.identifier && domainObject.identifier.key === 'manipulator_pad');
                },
                view: function (domainObject) {
                    let viewContainer = null;
                    return {
                        show: function (container) {
                            viewContainer = container;
                            renderManipulatorPad(container, openmct);
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

    function renderManipulatorPad(container, openmct) {
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            background: #161616;
            border: 1px solid #282828;
            border-radius: 0px;
            padding: 6px 12px;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
            gap: 6px;
            height: 100%;
            overflow: hidden;
            user-select: none;
        `;

        container.innerHTML = `
            <!-- Row 1: Subsystem Title, Status & Preset Controls -->
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #282828; padding-bottom: 4px; flex-shrink: 0;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 8px; height: 8px; background: #f97316; border-radius: 0px;"></div>
                    <span style="font-weight: 800; font-size: 11px; color: #f8fafc; letter-spacing: 0.5px;">ROBOTIC MANIPULATOR (3-DOF + WRIST)</span>
                    <span id="arm-badge-interlock" style="font-weight: 800; font-size: 9px; font-family: monospace; background: #14532d33; border: 1px solid #166534; color: #22c55e; padding: 1px 6px; border-radius: 0px;">ARM READY</span>
                    <span id="arm-pill-stall" style="font-weight: 800; font-size: 9px; font-family: monospace; background: #14532d33; border: 1px solid #166534; color: #22c55e; padding: 1px 6px; border-radius: 0px;">NO STALL</span>
                    <span style="font-size: 9px; color: #71717a;">TOOL: <b id="arm-val-tool" style="color: #94a3b8;">STANDBY</b></span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <span style="font-size: 9px; font-family: monospace; color: #71717a; margin-right: 2px;">PRESETS:</span>
                    <button class="btn-arm-pose" data-pose="STOW" style="background: #27272a; color: #ffffff; border: 1px solid #3f3f46; padding: 2px 6px; border-radius: 0px; font-size: 9px; font-weight: 700; cursor: pointer; text-transform: uppercase;">STOW</button>
                    <button class="btn-arm-pose" data-pose="GROUND_PICK" style="background: #27272a; color: #ffffff; border: 1px solid #3f3f46; padding: 2px 6px; border-radius: 0px; font-size: 9px; font-weight: 700; cursor: pointer; text-transform: uppercase;">GROUND</button>
                    <button class="btn-arm-pose" data-pose="PANEL_REACH" style="background: #27272a; color: #ffffff; border: 1px solid #3f3f46; padding: 2px 6px; border-radius: 0px; font-size: 9px; font-weight: 700; cursor: pointer; text-transform: uppercase;">PANEL</button>
                    <button class="btn-arm-pose" data-pose="TRANSIT" style="background: #27272a; color: #ffffff; border: 1px solid #3f3f46; padding: 2px 6px; border-radius: 0px; font-size: 9px; font-weight: 700; cursor: pointer; text-transform: uppercase;">TRANSIT</button>
                </div>
            </div>

            <!-- Row 2: Compact Joint & Load Telemetry Strip -->
            <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-height: 0; font-family: monospace; font-size: 10px; overflow: hidden;">
                <div style="display: flex; align-items: center; gap: 4px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 6px; flex: 1; justify-content: space-between;">
                    <span style="color: #71717a; font-size: 9px;">BASE:</span>
                    <span id="arm-val-base" style="font-weight: 800; color: #f8fafc;">---°</span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 6px; flex: 1; justify-content: space-between;">
                    <span style="color: #71717a; font-size: 9px;">SHOULDER:</span>
                    <span id="arm-val-shoulder" style="font-weight: 800; color: #f8fafc;">---°</span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 6px; flex: 1; justify-content: space-between;">
                    <span style="color: #71717a; font-size: 9px;">ELBOW:</span>
                    <span id="arm-val-elbow" style="font-weight: 800; color: #f8fafc;">---°</span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 6px; flex: 1; justify-content: space-between;">
                    <span style="color: #71717a; font-size: 9px;">WRIST:</span>
                    <span id="arm-val-wpitch" style="font-weight: 800; color: #f8fafc;">---°</span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 6px; flex: 1; justify-content: space-between;">
                    <span style="color: #71717a; font-size: 9px;">GRIPPER:</span>
                    <span id="arm-val-gripper" style="font-weight: 800; color: #f8fafc;">--- %</span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 6px; flex: 1.2; justify-content: space-between;">
                    <span style="color: #71717a; font-size: 9px;">LOAD (SH/EL):</span>
                    <span style="font-weight: 700; color: #38bdf8;"><span id="arm-val-load-sh">--- A</span> / <span id="arm-val-load-el">--- A</span></span>
                </div>
            </div>

            <!-- Hidden container to preserve exception subscriber if present -->
            <div id="arm-anomaly-list" style="display: none;"></div>
        `;

        const valBase = container.querySelector('#arm-val-base');
        const valShoulder = container.querySelector('#arm-val-shoulder');
        const valElbow = container.querySelector('#arm-val-elbow');
        const valWpitch = container.querySelector('#arm-val-wpitch');
        const valGripper = container.querySelector('#arm-val-gripper');
        const valLoadSh = container.querySelector('#arm-val-load-sh');
        const valLoadEl = container.querySelector('#arm-val-load-el');
        const valTool = container.querySelector('#arm-val-tool');
        const badgeInterlock = container.querySelector('#arm-badge-interlock');
        const pillStall = container.querySelector('#arm-pill-stall');
        const anomalyList = container.querySelector('#arm-anomaly-list');

        // Pose buttons
        container.querySelectorAll('.btn-arm-pose').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pose = e.target.dataset.pose;
                if (window.OrionSafetyService) {
                    window.OrionSafetyService.safeSendCommand({ action: 'ARM_POSE', pose: pose });
                    openmct.notifications.info(`Arm commanded to preset pose: ${pose}`);
                }
            });
        });

        function updateFromEngine(summary) {
            if (!summary) return;
            const t = summary.telemetry || {};

            if (t['rover.arm.joint.base'] !== undefined) valBase.textContent = `${Number(t['rover.arm.joint.base']).toFixed(1)}°`;
            if (t['rover.arm.joint.shoulder'] !== undefined) valShoulder.textContent = `${Number(t['rover.arm.joint.shoulder']).toFixed(1)}°`;
            if (t['rover.arm.joint.elbow'] !== undefined) valElbow.textContent = `${Number(t['rover.arm.joint.elbow']).toFixed(1)}°`;
            if (t['rover.arm.joint.wrist_pitch'] !== undefined) valWpitch.textContent = `${Number(t['rover.arm.joint.wrist_pitch']).toFixed(1)}°`;
            if (t['rover.arm.joint.gripper'] !== undefined) valGripper.textContent = `${Number(t['rover.arm.joint.gripper']).toFixed(0)} %`;

            const shLoad = Number(t['rover.arm.joint.load.shoulder']) || 0;
            const elLoad = Number(t['rover.arm.joint.load.elbow']) || 0;
            valLoadSh.textContent = `${shLoad.toFixed(2)} A`;
            valLoadEl.textContent = `${elLoad.toFixed(2)} A`;

            const maxLoad = Math.max(shLoad, elLoad);
            if (maxLoad > 3.4) {
                pillStall.textContent = 'STALL DETECTED (> 3.4A)';
                pillStall.style.background = '#ef444422';
                pillStall.style.color = '#ef4444';
            } else if (maxLoad > 2.5) {
                pillStall.textContent = 'HIGH LOAD (> 2.5A)';
                pillStall.style.background = '#f59e0b22';
                pillStall.style.color = '#f59e0b';
            } else {
                pillStall.textContent = 'NO STALL (< 2.5A)';
                pillStall.style.background = '#10b98122';
                pillStall.style.color = '#10b981';
            }

            if (t['rover.arm.gripper_id']) {
                valTool.textContent = String(t['rover.arm.gripper_id']).toUpperCase();
                valTool.style.background = '#2563eb';
                valTool.style.color = '#ffffff';
            }

            // Inhibit state from OrionSafetyService
            if (window.OrionSafetyService) {
                const inh = window.OrionSafetyService.getInhibitState();
                if (inh && inh.inhibited) {
                    badgeInterlock.textContent = 'INHIBITED';
                    badgeInterlock.style.background = '#ef444422';
                    badgeInterlock.style.color = '#ef4444';
                } else {
                    badgeInterlock.textContent = 'ARM READY';
                    badgeInterlock.style.background = '#10b98122';
                    badgeInterlock.style.color = '#10b981';
                }
            }

            // Exceptions
            const armAlerts = summary.alerts.filter(a => a.subsystem === 'manipulator');
            anomalyList.innerHTML = '';
            if (armAlerts.length === 0) {
                anomalyList.innerHTML = `
                    <div style="background: #2d2d30; border: 1px dashed #3e3e42; border-radius: 4px; padding: 14px; text-align: center; color: #64748b; font-size: 11px;">
                        Manipulator nominal. Zero joint stalls or overload conditions detected.
                    </div>
                `;
            } else {
                armAlerts.forEach(a => {
                    const item = document.createElement('div');
                    const sevColor = a.severity === 'critical' ? '#ef4444' : (a.severity === 'warning' ? '#f59e0b' : '#38bdf8');
                    item.style.cssText = `
                        background: #2d2d30;
                        border-left: 3px solid ${sevColor};
                        border-radius: 3px;
                        padding: 8px 10px;
                        font-size: 11px;
                    `;
                    item.innerHTML = `
                        <div style="font-weight: 700; color: #f8fafc;">${a.title}</div>
                        <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">${a.explainer}</div>
                    `;
                    anomalyList.appendChild(item);
                });
            }
        }

        let unsub = null;
        if (window.OrionExceptionEngine) {
            unsub = window.OrionExceptionEngine.subscribe(updateFromEngine);
        }

        container._cleanup = () => {
            if (unsub) unsub();
        };
    }

    if (typeof window !== 'undefined') {
        window.OrionManipulatorPadPlugin = OrionManipulatorPadPlugin;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionManipulatorPadPlugin;
    }
})();
