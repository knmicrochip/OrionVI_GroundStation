/**
 * Orion VI 6-Rail Power Distribution Strip Plugin (ERC 2026)
 * 
 * Displays and controls the 6 independent power rails:
 * 1. Drive System (20V, 6x BLDC + ODrive)
 * 2. Jetson Orin NX (12V)
 * 3. RPi5 + ESP32 (5V)
 * 4. Manipulator Servos (12V)
 * 5. Science Module (5V)
 * 6. Network / Comms (12V)
 */

(function () {
    const RAILS = [
        { key: 'drive', name: 'Drive System', nominalV: '20V', maxA: 12.0, critical: false },
        { key: 'jetson', name: 'Jetson Orin NX', nominalV: '12V', maxA: 3.5, critical: true },
        { key: 'rpi_esp', name: 'RPi 5 & ESP32 Hub', nominalV: '5V', maxA: 6.0, critical: true },
        { key: 'arm', name: 'Manipulator Servos', nominalV: '12V', maxA: 3.5, critical: false },
        { key: 'science', name: 'Science Payload', nominalV: '5V', maxA: 2.5, critical: false },
        { key: 'comms', name: 'Network & Comms', nominalV: '12V', maxA: 2.0, critical: true }
    ];

    function OrionPowerStripPlugin() {
        return function install(openmct) {
            openmct.types.addType('orion.power_strip', {
                name: '6-Rail Power Distribution Strip',
                description: 'Power distribution board with current monitoring and software shut-off',
                cssClass: 'icon-database'
            });

            openmct.objectViews.addProvider({
                key: 'orion-power-strip-view',
                name: 'Power Distribution View',
                cssClass: 'icon-database',
                canView: function (domainObject) {
                    return domainObject.type === 'orion.power_strip' ||
                           (domainObject.identifier && domainObject.identifier.key === 'power_strip');
                },
                view: function (domainObject) {
                    let viewContainer = null;
                    return {
                        show: function (container) {
                            viewContainer = container;
                            renderPowerStrip(container, openmct);
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

    function renderPowerStrip(container, openmct) {
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            background: #252526;
            border: 1px solid #3e3e42;
            border-radius: 6px;
            padding: 14px;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
            gap: 12px;
            user-select: none;
        `;

        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #3e3e42; padding-bottom: 8px;">
                <div>
                    <div style="font-weight: 800; font-size: 13px; color: #f8fafc; letter-spacing: 0.5px;">6-RAIL POWER DISTRIBUTION BOARD</div>
                    <div style="font-size: 10px; color: #94a3b8;">Main Bus Input: 20V (4x 4Ah 5S Li-ion) | Individual Software Shut-off</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button id="btn-shed-load" style="background: #e11d48; color: white; border: none; padding: 4px 8px; border-radius: 3px; font-size: 10px; font-weight: 700; cursor: pointer;">
                        SHED NON-ESSENTIAL
                    </button>
                </div>
            </div>

            <!-- Rail Cards Grid -->
            <div id="rails-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;"></div>
        `;

        const grid = container.querySelector('#rails-grid');
        const railStateMap = new Map();

        RAILS.forEach(r => {
            const card = document.createElement('div');
            card.style.cssText = `
                background: #2d2d30;
                border: 1px solid #3e3e42;
                border-radius: 4px;
                padding: 10px;
                display: flex;
                flex-direction: column;
                gap: 6px;
            `;

            card.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 11px; font-weight: 700; color: #f8fafc;">${r.name}</span>
                    <span id="rail-state-${r.key}" style="font-size: 9px; font-weight: 800; padding: 1px 5px; border-radius: 2px; background: #3e3e42; color: #94a3b8;">NO TELEMETRY</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; font-family: monospace;">
                    <span>Nominal: ${r.nominalV}</span>
                    <span>Max: ${r.maxA}A</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; font-family: monospace; color: #38bdf8;">
                    <span id="rail-v-${r.key}">-- V</span>
                    <span id="rail-i-${r.key}">-- A</span>
                    <span id="rail-w-${r.key}" style="color: #f59e0b;">-- W</span>
                </div>
                <button id="btn-toggle-${r.key}" style="background: #3e3e42; color: #e2e8f0; border: 1px solid #4f4f54; padding: 4px; border-radius: 3px; font-size: 10px; font-weight: 700; cursor: pointer; margin-top: 4px;">
                    TOGGLE SHUT-OFF
                </button>
            `;

            grid.appendChild(card);

            const btn = card.querySelector(`#btn-toggle-${r.key}`);
            btn.addEventListener('click', () => {
                const cur = railStateMap.get(r.key) !== 0;
                const next = !cur;

                if (window.OrionSafetyService) {
                    window.OrionSafetyService.safeSendCommand(
                        { action: 'POWER_RAIL_TOGGLE', rail: r.key, enable: next },
                        r.critical,
                        `WARNING: You are about to shut off ${r.name} (${r.nominalV}). This may cause loss of compute or comms. Proceed?`
                    ).then(res => {
                        if (res && res.success) {
                            openmct.notifications.alert(`Power rail ${r.name}: ${next ? 'ENABLED' : 'DISABLED'}`);
                        }
                    }).catch(() => {});
                }
            });
        });

        // Telemetry updates
        const unsubs = [];
        RAILS.forEach(r => {
            const vElem = container.querySelector(`#rail-v-${r.key}`);
            const iElem = container.querySelector(`#rail-i-${r.key}`);
            const wElem = container.querySelector(`#rail-w-${r.key}`);
            const stElem = container.querySelector(`#rail-state-${r.key}`);
            const btn = container.querySelector(`#btn-toggle-${r.key}`);

            let curV = 0.0;
            let curI = 0.0;

            if (openmct && openmct.telemetry) {
                const u1 = openmct.telemetry.subscribe({ identifier: { namespace: 'orion.taxonomy', key: `rover.power.rail.${r.key}.v` }, type: 'orion.telemetry' }, (p) => {
                    curV = parseFloat(p.value) || 0.0;
                    vElem.textContent = `${curV.toFixed(2)}V`;
                    wElem.textContent = `${(curV * curI).toFixed(1)}W`;
                });
                const u2 = openmct.telemetry.subscribe({ identifier: { namespace: 'orion.taxonomy', key: `rover.power.rail.${r.key}.i` }, type: 'orion.telemetry' }, (p) => {
                    curI = parseFloat(p.value) || 0.0;
                    iElem.textContent = `${curI.toFixed(2)}A`;
                    wElem.textContent = `${(curV * curI).toFixed(1)}W`;
                });
                const u3 = openmct.telemetry.subscribe({ identifier: { namespace: 'orion.taxonomy', key: `rover.power.rail.${r.key}.state` }, type: 'orion.telemetry' }, (p) => {
                    const st = parseInt(p.value, 10);
                    railStateMap.set(r.key, st);
                    if (st === 1) {
                        stElem.textContent = 'ENABLED';
                        stElem.style.background = '#16a34a';
                        btn.textContent = 'SHUT OFF';
                        btn.style.background = '#475569';
                    } else {
                        stElem.textContent = 'OFF';
                        stElem.style.background = '#ef4444';
                        btn.textContent = 'RESTORE POWER';
                        btn.style.background = '#16a34a';
                    }
                });
                unsubs.push(u1, u2, u3);
            }
        });

        // Load shedding button
        const btnShed = container.querySelector('#btn-shed-load');
        btnShed.addEventListener('click', () => {
            if (window.confirm('Shed all non-essential loads (Manipulator and Science)?')) {
                if (window.OrionSafetyService) {
                    window.OrionSafetyService.safeSendCommand({ action: 'POWER_RAIL_TOGGLE', rail: 'arm', enable: false });
                    window.OrionSafetyService.safeSendCommand({ action: 'POWER_RAIL_TOGGLE', rail: 'science', enable: false });
                    openmct.notifications.alert('Non-essential loads shedded.');
                }
            }
        });

        container._cleanup = () => {
            unsubs.forEach(u => u && u());
        };
    }

    if (typeof window !== 'undefined') {
        window.OrionPowerStripPlugin = OrionPowerStripPlugin;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionPowerStripPlugin;
    }
})();

