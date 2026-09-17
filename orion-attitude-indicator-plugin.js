/**
 * Orion VI Pitch / Roll Attitude Indicator Plugin (ERC 2026)
 * Artificial Horizon with pitch ladder and roll dial for rover navigation
 */

(function () {
    function OrionAttitudeIndicatorPlugin() {
        return function install(openmct) {
            openmct.types.addType('orion.attitude_indicator', {
                name: 'Pitch / Roll Attitude Indicator',
                description: 'Real-time artificial horizon showing rover pitch and roll angles',
                cssClass: 'icon-compass'
            });

            openmct.objectViews.addProvider({
                key: 'orion-attitude-indicator-view',
                name: 'Attitude Indicator View',
                cssClass: 'icon-compass',
                canView: function (domainObject) {
                    return domainObject.type === 'orion.attitude_indicator' ||
                           (domainObject.identifier && domainObject.identifier.key === 'widget_attitude_indicator');
                },
                view: function (domainObject) {
                    let viewContainer = null;
                    return {
                        show: function (container) {
                            viewContainer = container;
                            renderAttitudeIndicator(container, openmct);
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

    function renderAttitudeIndicator(container, openmct) {
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: #252526;
            border: 1px solid #3e3e42;
            border-radius: 6px;
            padding: 12px;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
            user-select: none;
            height: 100%;
            min-height: 220px;
        `;

        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; border-bottom: 1px solid #3e3e42; padding-bottom: 6px; margin-bottom: 8px;">
                <span style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; color: #94a3b8;">IMU ATTITUDE (PITCH / ROLL)</span>
                <div style="display: flex; gap: 12px; font-family: monospace; font-size: 11px;">
                    <span>PITCH: <b id="att-val-pitch" style="color: #94a3b8;">---</b></span>
                    <span>ROLL: <b id="att-val-roll" style="color: #94a3b8;">---</b></span>
                </div>
            </div>
            <div style="position: relative; width: 180px; height: 180px; border-radius: 50%; overflow: hidden; border: 3px solid #3e3e42; box-shadow: inset 0 0 10px rgba(0,0,0,0.6);">
                <canvas id="att-canvas" width="240" height="240" style="position: absolute; top: -30px; left: -30px;"></canvas>
                <!-- Fixed Center Crosshair -->
                <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none; display: flex; align-items: center; justify-content: center;">
                    <div style="width: 40px; height: 2px; background: #eab308;"></div>
                    <div style="width: 6px; height: 6px; border-radius: 50%; background: #eab308; margin: 0 4px;"></div>
                    <div style="width: 40px; height: 2px; background: #eab308;"></div>
                </div>
                <!-- Standby overlay if no telemetry -->
                <div id="att-standby-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.75); display: flex; align-items: center; justify-content: center; text-align: center; padding: 12px; box-sizing: border-box;">
                    <span style="font-size: 10px; font-weight: 700; color: #94a3b8; font-family: monospace; letter-spacing: 0.5px;">NO TELEMETRY<br><span style="font-size: 9px; color: #64748b;">(AWAITING INGRESS)</span></span>
                </div>
            </div>
        `;

        const canvas = container.querySelector('#att-canvas');
        const ctx = canvas.getContext('2d');
        const valPitch = container.querySelector('#att-val-pitch');
        const valRoll = container.querySelector('#att-val-roll');
        const standbyOverlay = container.querySelector('#att-standby-overlay');

        let pitch = 0.0;
        let roll = 0.0;
        let hasData = false;

        function draw() {
            ctx.clearRect(0, 0, 240, 240);
            ctx.save();

            ctx.translate(120, 120);
            ctx.rotate((-roll * Math.PI) / 180);

            const pitchOffset = pitch * 1.5;

            // Sky gradient
            const sky = ctx.createLinearGradient(0, -120 + pitchOffset, 0, pitchOffset);
            sky.addColorStop(0, '#0284c7');
            sky.addColorStop(1, '#38bdf8');
            ctx.fillStyle = sky;
            ctx.fillRect(-150, -200 + pitchOffset, 300, 200);

            // Ground gradient
            const ground = ctx.createLinearGradient(0, pitchOffset, 0, 120 + pitchOffset);
            ground.addColorStop(0, '#78350f');
            ground.addColorStop(1, '#451a03');
            ctx.fillStyle = ground;
            ctx.fillRect(-150, pitchOffset, 300, 200);

            // Horizon line
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-120, pitchOffset);
            ctx.lineTo(120, pitchOffset);
            ctx.stroke();

            // Pitch ladder lines
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';

            [-30, -20, -10, 10, 20, 30].forEach(deg => {
                const y = pitchOffset - (deg * 1.5);
                const width = Math.abs(deg) === 20 ? 36 : 24;
                ctx.beginPath();
                ctx.moveTo(-width / 2, y);
                ctx.lineTo(width / 2, y);
                ctx.stroke();
                ctx.fillText(`${deg}°`, (width / 2) + 12, y + 3);
            });

            ctx.restore();
        }

        draw();

        // Telemetry subscription
        let unsubPitch = null;
        let unsubRoll = null;

        if (openmct && openmct.telemetry) {
            unsubPitch = openmct.telemetry.subscribe({ identifier: { namespace: 'orion.taxonomy', key: 'rover.nav.pitch' }, type: 'orion.telemetry' }, (p) => {
                if (p && p.value !== null && p.value !== undefined) {
                    pitch = parseFloat(p.value) || 0.0;
                    valPitch.textContent = `${pitch.toFixed(1)}°`;
                    valPitch.style.color = '#38bdf8';
                    hasData = true;
                    standbyOverlay.style.display = 'none';
                    draw();
                }
            });

            unsubRoll = openmct.telemetry.subscribe({ identifier: { namespace: 'orion.taxonomy', key: 'rover.nav.roll' }, type: 'orion.telemetry' }, (p) => {
                if (p && p.value !== null && p.value !== undefined) {
                    roll = parseFloat(p.value) || 0.0;
                    valRoll.textContent = `${roll.toFixed(1)}°`;
                    valRoll.style.color = '#38bdf8';
                    hasData = true;
                    standbyOverlay.style.display = 'none';
                    draw();
                }
            });
        }

        container._cleanup = () => {
            if (unsubPitch) unsubPitch();
            if (unsubRoll) unsubRoll();
        };
    }

    if (typeof window !== 'undefined') {
        window.OrionAttitudeIndicatorPlugin = OrionAttitudeIndicatorPlugin;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionAttitudeIndicatorPlugin;
    }
})();
