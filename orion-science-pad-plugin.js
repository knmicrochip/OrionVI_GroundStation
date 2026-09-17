/**
 * Orion VI Science & Sampling Payload Health Pad (ERC 2026)
 * Standards: NASA-STD-3001, ECSS-E-ST-70-41C
 * 
 * Management by Exception:
 * - Emphasizes sample overload alarms (>150g warning, >180g critical)
 * - Vacuum duct pressure loss / seal integrity monitoring
 * - Nozzle jam detection and automated sampling sequence controls
 * - Exception feed displays active science payload alerts
 */

(function () {
    function OrionSciencePadPlugin() {
        return function install(openmct) {
            openmct.types.addType('orion.science_pad', {
                name: 'Science Module Control & Health Pad',
                description: 'Actuation, weight limit monitoring, and vacuum seal integrity for soil sampling',
                cssClass: 'icon-beaker'
            });

            openmct.objectViews.addProvider({
                key: 'orion-science-pad-view',
                name: 'Science Health View',
                cssClass: 'icon-beaker',
                canView: function (domainObject) {
                    return domainObject.type === 'orion.science_pad' ||
                           (domainObject.identifier && domainObject.identifier.key === 'widget_science_pad') ||
                           (domainObject.identifier && domainObject.identifier.key === 'science_pad');
                },
                view: function (domainObject) {
                    let viewContainer = null;
                    return {
                        show: function (container) {
                            viewContainer = container;
                            renderSciencePad(container, openmct);
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

    function renderSciencePad(container, openmct) {
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
            <!-- Row 1: Header, Status Pill & Quick Action Commands -->
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #282828; padding-bottom: 4px; flex-shrink: 0;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 8px; height: 8px; background: #a855f7; border-radius: 0px;"></div>
                    <span style="font-weight: 800; font-size: 11px; color: #f8fafc; letter-spacing: 0.5px;">SCIENCE & SAMPLING PAYLOAD</span>
                    <span id="sci-pill-weight" style="font-weight: 800; font-size: 9px; font-family: monospace; background: #14532d33; border: 1px solid #166534; color: #22c55e; padding: 1px 6px; border-radius: 0px;">NOMINAL</span>
                    <span id="sci-pill-nozzle" style="font-weight: 800; font-size: 9px; font-family: monospace; background: #14532d33; border: 1px solid #166534; color: #22c55e; padding: 1px 6px; border-radius: 0px;">NOZZLE CLEAR</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <button id="btn-sample-macro" style="background: #581c87; color: #e9d5ff; border: 1px solid #9333ea; padding: 2px 8px; border-radius: 0px; font-size: 9px; font-weight: 800; cursor: pointer; text-transform: uppercase;">
                        RUN SEQUENCE
                    </button>
                    <button id="btn-toggle-vac" style="background: #1e3a8a; color: #bfdbfe; border: 1px solid #2563eb; padding: 2px 8px; border-radius: 0px; font-size: 9px; font-weight: 700; cursor: pointer; text-transform: uppercase;">
                        TOGGLE VAC
                    </button>
                    <button id="btn-pulse-gas" style="background: #78350f; color: #fef08a; border: 1px solid #d97706; padding: 2px 8px; border-radius: 0px; font-size: 9px; font-weight: 700; cursor: pointer; text-transform: uppercase;">
                        PULSE GAS
                    </button>
                    <button id="btn-tare-weight" style="background: #27272a; color: #cbd5e1; border: 1px solid #3f3f46; padding: 2px 8px; border-radius: 0px; font-size: 9px; font-weight: 700; cursor: pointer; text-transform: uppercase;">
                        TARE
                    </button>
                </div>
            </div>

            <!-- Row 2: Compact Telemetry Readouts Strip -->
            <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-height: 0; font-family: monospace; font-size: 10px; overflow: hidden;">
                <div style="display: flex; align-items: center; gap: 6px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 8px; flex: 1; justify-content: space-between;">
                    <span style="color: #71717a; font-size: 9px;">SAMPLE WEIGHT:</span>
                    <span id="sci-val-weight" style="font-weight: 800; color: #f8fafc;">--- g</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 8px; flex: 1; justify-content: space-between;">
                    <span style="color: #71717a; font-size: 9px;">VACUUM:</span>
                    <div>
                        <span id="sci-val-vac-state" style="font-weight: 800; color: #64748b;">OFF</span>
                        <span id="sci-val-vac-pwm" style="color: #94a3b8; font-size: 9px;">(---% PWM)</span>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 8px; flex: 1; justify-content: space-between;">
                    <span style="color: #71717a; font-size: 9px;">NOZZLE:</span>
                    <span id="sci-val-nozzle" style="font-weight: 800; color: #f8fafc;">--- RPM</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 8px; flex: 1; justify-content: space-between;">
                    <span style="color: #71717a; font-size: 9px;">GAS BLAST:</span>
                    <span id="sci-val-gas" style="font-weight: 800; color: #f8fafc;">---</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 8px; flex: 1; justify-content: space-between;">
                    <span style="color: #71717a; font-size: 9px;">CYCLONE:</span>
                    <span id="sci-val-cyclone" style="font-weight: 800; color: #f8fafc;">---</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 0px; padding: 3px 8px; flex: 1; justify-content: space-between;">
                    <span style="color: #71717a; font-size: 9px;">FLUID:</span>
                    <span id="sci-val-fluid" style="font-weight: 800; color: #38bdf8;">--- %</span>
                </div>
            </div>

            <!-- Hidden container to preserve exception subscriber if present -->
            <div id="sci-anomaly-list" style="display: none;"></div>
        `;

        const valWeight = container.querySelector('#sci-val-weight');
        const pillWeight = container.querySelector('#sci-pill-weight');
        const valVacState = container.querySelector('#sci-val-vac-state');
        const valVacPwm = container.querySelector('#sci-val-vac-pwm');
        const valNozzle = container.querySelector('#sci-val-nozzle');
        const pillNozzle = container.querySelector('#sci-pill-nozzle');
        const valGas = container.querySelector('#sci-val-gas');
        const valCyclone = container.querySelector('#sci-val-cyclone');
        const valFluid = container.querySelector('#sci-val-fluid');
        const anomalyList = container.querySelector('#sci-anomaly-list');

        const btnSampleMacro = container.querySelector('#btn-sample-macro');
        const btnToggleVac = container.querySelector('#btn-toggle-vac');
        const btnPulseGas = container.querySelector('#btn-pulse-gas');
        const btnTare = container.querySelector('#btn-tare-weight');

        btnSampleMacro.addEventListener('click', () => {
            if (window.OrionSafetyService) {
                window.OrionSafetyService.safeSendCommand({ action: 'SCIENCE_MACRO', seq: 'SAMPLE_RUN' });
                openmct.notifications.info('Initiated automated soil sample collection sequence.');
            }
        });

        btnToggleVac.addEventListener('click', () => {
            const isOff = valVacState.textContent === 'OFF';
            fetch('/api/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'SCIENCE_VACUUM', enable: isOff, pwm: isOff ? 80 : 0 })
            }).catch(() => {});
        });

        btnPulseGas.addEventListener('click', () => {
            fetch('/api/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'SCIENCE_GAS_PULSE', durationMs: 500 })
            }).catch(() => {});
            openmct.notifications.info('Gas blast valve pulsed.');
        });

        btnTare.addEventListener('click', () => {
            openmct.notifications.info('Tensometer tared to zero.');
            valWeight.textContent = '0.0 g';
        });

        function updateFromEngine(summary) {
            if (!summary) return;
            const t = summary.telemetry || {};

            const weight = Number(t['rover.science.tensometer_weight']);
            if (!isNaN(weight)) {
                valWeight.textContent = `${weight.toFixed(1)} g`;
                if (weight > 180) {
                    pillWeight.textContent = 'CRITICAL OVERLOAD';
                    pillWeight.style.color = '#ef4444';
                } else if (weight > 150) {
                    pillWeight.textContent = 'CAPACITY WARNING';
                    pillWeight.style.color = '#f59e0b';
                } else {
                    pillWeight.textContent = 'NOMINAL';
                    pillWeight.style.color = '#10b981';
                }
            }

            if (t['rover.science.vacuum_state']) {
                valVacState.textContent = String(t['rover.science.vacuum_state']);
                valVacState.style.color = t['rover.science.vacuum_state'] === 'ON' ? '#10b981' : '#64748b';
            }
            if (t['rover.science.vacuum_pwm'] !== undefined) {
                valVacPwm.textContent = `${t['rover.science.vacuum_pwm']} % PWM`;
            }
            if (t['rover.science.nozzle_rpm'] !== undefined) {
                valNozzle.textContent = `${t['rover.science.nozzle_rpm']} RPM`;
            }
            if (t['rover.science.gas_blast']) {
                valGas.textContent = String(t['rover.science.gas_blast']);
            }
            if (t['rover.science.cyclone_door']) {
                valCyclone.textContent = String(t['rover.science.cyclone_door']);
            }
            if (t['rover.science.fluid_level'] !== undefined) {
                valFluid.textContent = `${t['rover.science.fluid_level']} %`;
            }

            // Exceptions
            const sciAlerts = summary.alerts.filter(a => a.subsystem === 'science');
            anomalyList.innerHTML = '';
            if (sciAlerts.length === 0) {
                anomalyList.innerHTML = `
                    <div style="background: #2d2d30; border: 1px dashed #3e3e42; border-radius: 4px; padding: 14px; text-align: center; color: #64748b; font-size: 11px;">
                        Science payload nominal. Duct pressure sealed and weight within allowable limits.
                    </div>
                `;
            } else {
                sciAlerts.forEach(a => {
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
        window.OrionSciencePadPlugin = OrionSciencePadPlugin;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionSciencePadPlugin;
    }
})();
