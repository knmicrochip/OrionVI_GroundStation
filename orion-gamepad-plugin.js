/**
 * Orion VI Gamepad Controller Plugin (ERC 2026)
 * 
 * Features:
 * - HTML5 Gamepad API polling
 * - Deadman switch interlock (LB button 4 or LT button 6)
 * - Zero twist on release
 * - Speed limit scaling setpoint
 * - Integration with Safety Inhibit Service
 * - Visual Gamepad Diagnostics Widget for Teleop mode
 */

(function () {
    class GamepadManager {
        constructor() {
            this.gamepadIndex = null;
            this.deadmanActive = false;
            this.linearVelocity = 0.0;
            this.angularVelocity = 0.0;
            this.speedLimit = 1.2; // m/s
            this.angularLimit = 1.5; // rad/s
            this.listeners = new Set();
            this.lastPublishTime = 0;
            this.wasDeadmanActive = false;

            window.addEventListener('gamepadconnected', (e) => {
                this.gamepadIndex = e.gamepad.index;
                console.log(`[Gamepad] Connected at index ${e.gamepad.index}: ${e.gamepad.id}`);
                this.notify();
            });

            window.addEventListener('gamepaddisconnected', (e) => {
                if (this.gamepadIndex === e.gamepad.index) {
                    this.gamepadIndex = null;
                    this.deadmanActive = false;
                    this.linearVelocity = 0.0;
                    this.angularVelocity = 0.0;
                    this.sendZeroTwist();
                    this.notify();
                }
            });

            // Polling loop
            this.poll = this.poll.bind(this);
            requestAnimationFrame(this.poll);
        }

        subscribe(cb) {
            this.listeners.add(cb);
            cb(this.getState());
            return () => this.listeners.delete(cb);
        }

        notify() {
            const state = this.getState();
            this.listeners.forEach(cb => {
                try { cb(state); } catch (_) {}
            });
        }

        getState() {
            return {
                connected: this.gamepadIndex !== null,
                id: this.getGamepadName(),
                deadmanActive: this.deadmanActive,
                linearVelocity: this.linearVelocity,
                angularVelocity: this.angularVelocity,
                speedLimit: this.speedLimit,
                angularLimit: this.angularLimit
            };
        }

        getGamepadName() {
            if (this.gamepadIndex === null) return 'No Gamepad Detected';
            const gp = navigator.getGamepads ? navigator.getGamepads()[this.gamepadIndex] : null;
            return gp ? gp.id.substring(0, 32) : 'Controller';
        }

        setSpeedLimit(limit) {
            this.speedLimit = Math.max(0.1, Math.min(3.0, parseFloat(limit) || 1.2));
            this.notify();
        }

        poll() {
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            const gp = this.gamepadIndex !== null ? gamepads[this.gamepadIndex] : null;

            if (gp && gp.connected) {
                // Deadman switch: Button 4 (LB) or Button 6 (LT)
                const lbPressed = gp.buttons[4] && gp.buttons[4].pressed;
                const ltPressed = gp.buttons[6] && (gp.buttons[6].pressed || gp.buttons[6].value > 0.5);
                this.deadmanActive = lbPressed || ltPressed;

                if (this.deadmanActive) {
                    // Check safety inhibit
                    const safety = window.OrionSafetyService;
                    if (safety && safety.getInhibitState().inhibited) {
                        this.linearVelocity = 0.0;
                        this.angularVelocity = 0.0;
                    } else {
                        // Left stick Y axis (axis 1): -1 (up/fwd) to 1 (down/rev) -> invert for forward
                        const rawY = gp.axes[1] !== undefined ? gp.axes[1] : 0;
                        // Deadband filtering
                        const deadband = 0.08;
                        const filteredY = Math.abs(rawY) > deadband ? (rawY > 0 ? rawY - deadband : rawY + deadband) : 0;
                        this.linearVelocity = parseFloat((-filteredY * this.speedLimit).toFixed(2));

                        // Right stick X axis (axis 2 or 0) for turning
                        const rawX = gp.axes[2] !== undefined && Math.abs(gp.axes[2]) > 0.01 ? gp.axes[2] : (gp.axes[0] || 0);
                        const filteredX = Math.abs(rawX) > deadband ? (rawX > 0 ? rawX - deadband : rawX + deadband) : 0;
                        this.angularVelocity = parseFloat((-filteredX * this.angularLimit).toFixed(2));
                    }

                    // Publish twist at 10 Hz
                    const now = Date.now();
                    if (now - this.lastPublishTime >= 100) {
                        this.publishTwist(this.linearVelocity, this.angularVelocity);
                        this.lastPublishTime = now;
                    }
                    this.wasDeadmanActive = true;
                } else {
                    // Deadman released
                    this.linearVelocity = 0.0;
                    this.angularVelocity = 0.0;
                    if (this.wasDeadmanActive) {
                        this.sendZeroTwist();
                        this.wasDeadmanActive = false;
                    }
                }
            } else {
                this.deadmanActive = false;
                this.linearVelocity = 0.0;
                this.angularVelocity = 0.0;
                if (this.wasDeadmanActive) {
                    this.sendZeroTwist();
                    this.wasDeadmanActive = false;
                }
            }

            this.notify();
            requestAnimationFrame(this.poll);
        }

        publishTwist(vx, wz) {
            fetch('/api/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'DRIVE_TWIST',
                    linear: vx,
                    angular: wz
                })
            }).catch(() => {});
        }

        sendZeroTwist() {
            this.publishTwist(0.0, 0.0);
        }
    }

    const gamepadManager = new GamepadManager();

    function OrionGamepadPlugin() {
        return function install(openmct) {
            openmct.types.addType('orion.gamepad_widget', {
                name: 'Drive Gamepad Control Pad',
                description: 'HTML5 Gamepad reader with deadman safety interlock',
                cssClass: 'icon-device'
            });

            openmct.objectViews.addProvider({
                key: 'orion-gamepad-view',
                name: 'Gamepad Control View',
                cssClass: 'icon-device',
                canView: function (domainObject) {
                    return domainObject.type === 'orion.gamepad_widget' ||
                           (domainObject.identifier && domainObject.identifier.key === 'gamepad_control');
                },
                view: function (domainObject) {
                    return {
                        show: function (container) {
                            renderGamepadWidget(container);
                        },
                        destroy: function () {}
                    };
                }
            });
        };
    }

    function renderGamepadWidget(container) {
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            background: #252526;
            border: 1px solid #3e3e42;
            border-radius: 6px;
            padding: 14px;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            gap: 12px;
            box-sizing: border-box;
            user-select: none;
        `;

        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #3e3e42; padding-bottom: 8px;">
                <span style="font-weight: 800; font-size: 13px; color: #f8fafc; letter-spacing: 0.5px;">GAMEPAD TELEOPERATION</span>
                <span id="gp-conn-badge" style="background: #3e3e42; color: #94a3b8; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 3px;">DISCONNECTED</span>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; background: #2d2d30; padding: 8px 12px; border-radius: 4px; border: 1px solid #3e3e42;">
                <span style="font-size: 11px; color: #94a3b8;">DEADMAN INTERLOCK (LB/LT):</span>
                <span id="gp-deadman-badge" style="background: #ef4444; color: #ffffff; font-weight: 800; font-size: 10px; padding: 2px 8px; border-radius: 3px;">RELEASED (ZERO TWIST)</span>
            </div>

            <!-- Axes Gauges -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div style="background: #2d2d30; padding: 10px; border-radius: 4px; border: 1px solid #3e3e42;">
                    <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-bottom: 4px;">
                        <span>LINEAR VELOCITY</span>
                        <span id="gp-val-linear" style="font-family: monospace; font-weight: 700; color: #38bdf8;">0.00 m/s</span>
                    </div>
                    <div style="width: 100%; height: 8px; background: #3e3e42; border-radius: 4px; overflow: hidden; position: relative;">
                        <div id="gp-bar-linear" style="width: 50%; height: 100%; background: #0284c7; margin: 0 auto; transition: width 0.05s;"></div>
                    </div>
                </div>

                <div style="background: #2d2d30; padding: 10px; border-radius: 4px; border: 1px solid #3e3e42;">
                    <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-bottom: 4px;">
                        <span>ANGULAR VELOCITY</span>
                        <span id="gp-val-angular" style="font-family: monospace; font-weight: 700; color: #38bdf8;">0.00 rad/s</span>
                    </div>
                    <div style="width: 100%; height: 8px; background: #3e3e42; border-radius: 4px; overflow: hidden; position: relative;">
                        <div id="gp-bar-angular" style="width: 50%; height: 100%; background: #0284c7; margin: 0 auto; transition: width 0.05s;"></div>
                    </div>
                </div>
            </div>

            <!-- Speed Limit Control -->
            <div style="display: flex; align-items: center; justify-content: space-between; background: #2d2d30; padding: 8px 12px; border-radius: 4px; border: 1px solid #3e3e42;">
                <span style="font-size: 11px; color: #94a3b8;">MAX SPEED LIMIT:</span>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input id="gp-slider-speed" type="range" min="0.2" max="2.5" step="0.1" value="1.2" style="width: 120px; cursor: pointer;">
                    <span id="gp-lbl-speed" style="font-family: monospace; font-size: 11px; font-weight: 700; color: #22c55e; min-width: 45px;">1.2 m/s</span>
                </div>
            </div>
        `;

        const connBadge = container.querySelector('#gp-conn-badge');
        const deadmanBadge = container.querySelector('#gp-deadman-badge');
        const valLinear = container.querySelector('#gp-val-linear');
        const valAngular = container.querySelector('#gp-val-angular');
        const sliderSpeed = container.querySelector('#gp-slider-speed');
        const lblSpeed = container.querySelector('#gp-lbl-speed');

        sliderSpeed.addEventListener('input', (e) => {
            gamepadManager.setSpeedLimit(e.target.value);
            lblSpeed.textContent = `${e.target.value} m/s`;
        });

        gamepadManager.subscribe((st) => {
            if (st.connected) {
                connBadge.textContent = 'CONNECTED';
                connBadge.style.background = '#16a34a';
                connBadge.style.color = '#ffffff';
            } else {
                connBadge.textContent = 'DISCONNECTED';
                connBadge.style.background = '#3e3e42';
                connBadge.style.color = '#94a3b8';
            }

            if (st.deadmanActive) {
                deadmanBadge.textContent = 'ACTIVE (DEADMAN HELD)';
                deadmanBadge.style.background = '#16a34a';
            } else {
                deadmanBadge.textContent = 'RELEASED (ZERO TWIST)';
                deadmanBadge.style.background = '#ef4444';
            }

            valLinear.textContent = `${st.linearVelocity.toFixed(2)} m/s`;
            valAngular.textContent = `${st.angularVelocity.toFixed(2)} rad/s`;
        });
    }

    if (typeof window !== 'undefined') {
        window.OrionGamepadPlugin = OrionGamepadPlugin;
        window.OrionGamepadManager = gamepadManager;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionGamepadPlugin;
    }
})();

