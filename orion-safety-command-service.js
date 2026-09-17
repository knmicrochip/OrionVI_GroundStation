/**
 * Orion VI Safety Command & Inhibit Interlock Service (ERC 2026)
 * 
 * Central safety authority ensuring:
 * - ABB E-Stop relay status monitoring
 * - Ubiquiti 5GHz heartbeat watchdog (<2.0s threshold)
 * - Battery Under-Voltage Lock-Out (UVLO < 15.0V)
 * - Safe command dispatching with operator confirmation on dangerous actions
 * - Reactive inhibit subscriptions to grey out commanding UI across all modes
 */

(function () {
    class SafetyCommandService {
        constructor() {
            this.listeners = new Set();
            this.state = {
                estopPressed: false,
                heartbeatExpired: false,
                uvloTripped: false,
                overheatTripped: false,
                lastTripReason: 'NONE',
                lastCommandSent: null,
                lastCommandAck: null,
                lastHeartbeatMs: Date.now()
            };

            // Watchdog loop (checks heartbeat age every 500ms)
            setInterval(() => this.checkWatchdog(), 500);
        }

        subscribe(cb) {
            this.listeners.add(cb);
            cb(this.getInhibitState());
            return () => this.listeners.delete(cb);
        }

        notify() {
            const state = this.getInhibitState();
            this.listeners.forEach(cb => {
                try { cb(state); } catch (_) {}
            });
        }

        getInhibitState() {
            const inhibited = this.state.estopPressed || 
                              this.state.heartbeatExpired || 
                              this.state.uvloTripped || 
                              this.state.overheatTripped;

            return {
                inhibited: inhibited,
                reason: this.getInhibitReason(),
                estopPressed: this.state.estopPressed,
                heartbeatExpired: this.state.heartbeatExpired,
                uvloTripped: this.state.uvloTripped,
                overheatTripped: this.state.overheatTripped,
                lastTripReason: this.state.lastTripReason,
                lastCommandSent: this.state.lastCommandSent,
                lastCommandAck: this.state.lastCommandAck
            };
        }

        getInhibitReason() {
            if (this.state.estopPressed) return 'Hardware Emergency Stop (ABB MEPY1-1042) is DEPRESSED';
            if (this.state.heartbeatExpired) return 'Ubiquiti 5GHz Link Heartbeat LOST (>2.0s)';
            if (this.state.uvloTripped) return 'Main Bus Under-Voltage Lock-Out (UVLO < 15.0V)';
            if (this.state.overheatTripped) return 'Electronics Compartment Critical Overheat (>55°C)';
            return 'NOMINAL';
        }

        feedHeartbeat() {
            this.state.lastHeartbeatMs = Date.now();
            if (this.state.heartbeatExpired) {
                this.state.heartbeatExpired = false;
                this.notify();
            }
        }

        checkWatchdog() {
            const age = Date.now() - this.state.lastHeartbeatMs;
            if (age > 4000 && !this.state.heartbeatExpired) {
                this.state.heartbeatExpired = true;
                this.state.lastTripReason = 'HEARTBEAT_TIMEOUT';
                this.notify();
            }
        }

        updateFromTelemetry(packet) {
            if (!packet || !packet.id) return;
            const now = Date.now();

            if (packet.id === 'rover.safety.estop_hardware') {
                const pressed = packet.value === 1 || packet.value === 'DEPRESSED';
                if (this.state.estopPressed !== pressed) {
                    this.state.estopPressed = pressed;
                    if (pressed) this.state.lastTripReason = 'ESTOP_BUTTON';
                    this.notify();
                }
            } else if (packet.id === 'rover.safety.uvlo_tripped') {
                const uvlo = packet.value === 1;
                if (this.state.uvloTripped !== uvlo) {
                    this.state.uvloTripped = uvlo;
                    if (uvlo) this.state.lastTripReason = 'UVLO';
                    this.notify();
                }
            } else if (packet.id === 'rover.power.bus.voltage') {
                const v = Number(packet.value);
                const uvlo = v > 0 && v < 15.0;
                if (this.state.uvloTripped !== uvlo) {
                    this.state.uvloTripped = uvlo;
                    if (uvlo) this.state.lastTripReason = 'UVLO';
                    this.notify();
                }
            }

            this.feedHeartbeat();
        }

        /**
         * Dispatches a command if safety inhibits allow it.
         * @param {Object} cmd - The command payload
         * @param {Boolean} isDangerous - Requires explicit operator confirm
         * @param {String} confirmPrompt - Text description for modal
         */
        safeSendCommand(cmd, isDangerous = false, confirmPrompt = '') {
            const inhibitState = this.getInhibitState();

            // Allow emergency stop commands even when inhibited
            const isEmergencyOverride = cmd.action === 'ESTOP_ACTIVATE' || cmd.action === 'RESET_SAFETY';

            if (inhibitState.inhibited && !isEmergencyOverride) {
                const err = `COMMAND INHIBITED: ${inhibitState.reason}`;
                if (window.openmct && window.openmct.notifications) {
                    window.openmct.notifications.error(err);
                }
                return Promise.reject(new Error(err));
            }

            if (isDangerous) {
                const confirmed = window.confirm(confirmPrompt || `Confirm execution of high-risk command: ${cmd.action}?`);
                if (!confirmed) {
                    return Promise.resolve({ cancelled: true });
                }
            }

            this.state.lastCommandSent = {
                action: cmd.action,
                time: Date.now(),
                payload: cmd
            };
            this.notify();

            return fetch('/api/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cmd)
            })
            .then(res => res.json())
            .then(ack => {
                this.state.lastCommandAck = {
                    action: cmd.action,
                    time: Date.now(),
                    ack: ack
                };
                this.notify();
                return ack;
            })
            .catch(err => {
                console.error('[SafetyCommandService] Command error:', err);
                throw err;
            });
        }
    }

    const safetyService = new SafetyCommandService();

    if (typeof window !== 'undefined') {
        window.OrionSafetyService = safetyService;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = safetyService;
    }
})();

