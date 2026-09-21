/**
 * Orion VI Task Clock & Timeline Plugin (ERC 2026)
 * 
 * Manages competition tasks:
 * - Science (~40 min)
 * - Navigation Traverse (~35 min)
 * - Maintenance (~30 min)
 * - Probing (~32 min)
 * 
 * Features:
 * - Top persistent banner (Judge countdown, NOW step, NEXT step, % budget)
 * - Controls: START, HOLD, RESUME, STOP, MARK STEP DONE, SKIP
 * - Operator judge limit input
 * - Time Conductor bounds locking [t0, t0 + limit_s * 1000]
 * - Time List (DONE / NOW / NEXT / LATER with overdue detection)
 * - Active Step Card (Goal, pass criteria, action commands, proving telemetry)
 * - Plan Object Materializer for Open MCT Timeline / Gantt
 * - Telemetry-assisted auto-completion cues (operator override)
 * - LocalStorage + REST/WS sync
 */

(function () {
    const TASK_TEMPLATES = {
        science: {
            id: 'science',
            name: 'Science Task',
            defaultDurationS: 2400, // 40 min
            steps: [
                { id: 'sci_safety_link', name: 'Safety & Link Verification', durationM: 2, swimlane: 'Safety', color: '#ef4444', goal: 'Confirm 5GHz RF ping < 30ms, E-Stop clear, 20V bus nominal.', passCriteria: 'Link latency < 30ms, UVLO clear, bus > 18.5V.' },
                { id: 'sci_drive_site_a', name: 'Drive to Site A', durationM: 6, swimlane: 'Drive', color: '#22c55e', goal: 'Navigate through Mars Yard terrain to outcrop Site A.', passCriteria: 'Rover within 0.8m of target outcrop coordinates.' },
                { id: 'sci_sample_1', name: 'Surface Sample 1 Acquisition', durationM: 5, swimlane: 'Science', color: '#a855f7', goal: 'Deploy vacuum nozzle, agitate loose aggregate, collect >= 30g.', passCriteria: 'Tensometer weight increase >= 30g, sample photo logged.' },
                { id: 'sci_drive_site_b', name: 'Drive to Site B', durationM: 5, swimlane: 'Drive', color: '#22c55e', goal: 'Traverse from Site A to secondary crater Site B.', passCriteria: 'Rover within 0.8m of target Site B coordinates.' },
                { id: 'sci_sample_2', name: 'Surface Sample 2 Acquisition', durationM: 5, swimlane: 'Science', color: '#a855f7', goal: 'Collect second surface sample into container slot 2.', passCriteria: 'Tensometer delta >= 25g, carousel rotated.' },
                { id: 'sci_deep_sample', name: 'Deep Stratum Sample Collection', durationM: 8, swimlane: 'Science', color: '#a855f7', goal: 'Activate high-pressure gas blast and vacuum rotating nozzle.', passCriteria: 'Tensometer weight >= 40g, cyclone separation verified.' },
                { id: 'sci_photos', name: 'On-Board Laboratory Inspection Photos', durationM: 4, swimlane: 'Science', color: '#a855f7', goal: 'Capture macro camera inspection photos of collected samples.', passCriteria: '3 high-res images stamped and stored in Notebook.' },
                { id: 'sci_stow', name: 'Arm & Science Tool Stow', durationM: 3, swimlane: 'Arm', color: '#f97316', goal: 'Return syringe arm and manipulator to STOW transit configuration.', passCriteria: 'All joint encoders match STOW setpoint +- 2 deg.' },
                { id: 'sci_slack', name: 'Contingency Slack & Debrief', durationM: 2, swimlane: 'Safety', color: '#64748b', goal: 'Safely halt rover, confirm telemetry logs saved.', passCriteria: 'Drive disabled, mission logs exported.' }
            ]
        },
        navigation: {
            id: 'navigation',
            name: 'Navigation Traverse',
            defaultDurationS: 2100, // 35 min
            steps: [
                { id: 'nav_arm_gnss_init', name: 'Arm Transit Stow & RTAB-Map Init', durationM: 2, swimlane: 'Safety', color: '#ef4444', goal: 'Stow arm to clear mast RealSense D435i FOV and initialize SLAM.', passCriteria: 'RTAB-Map status NOMINAL, keyframes > 50.' },
                { id: 'nav_wp1', name: 'Waypoint 1 (Traverse & Tag)', durationM: 5, swimlane: 'Drive', color: '#22c55e', goal: 'Traverse to GNSS Waypoint 1 over uneven sand dunes.', passCriteria: 'Waypoint distance < 1.0m, ArUco tag detected.' },
                { id: 'nav_wp2', name: 'Waypoint 2 (Obstacle Avoidance)', durationM: 5, swimlane: 'Drive', color: '#22c55e', goal: 'NAV2 autonomous path planning around rocky outcrop.', passCriteria: 'Waypoint distance < 1.0m, zero collision events.' },
                { id: 'nav_wp3', name: 'Waypoint 3 (Rocker Compliance Test)', durationM: 5, swimlane: 'Drive', color: '#22c55e', goal: 'Ascend 20-deg slope using Rocker Differencing suspension.', passCriteria: 'Waypoint distance < 1.0m, roll/pitch within +- 25 deg.' },
                { id: 'nav_wp4', name: 'Waypoint 4 (Crater Rim)', durationM: 5, swimlane: 'Drive', color: '#22c55e', goal: 'Traverse along crater rim to northern perimeter.', passCriteria: 'Waypoint distance < 1.0m, ArUco tag logged.' },
                { id: 'nav_wp5', name: 'Waypoint 5 (Final Target)', durationM: 5, swimlane: 'Drive', color: '#22c55e', goal: 'Approach final navigation marker coordinates.', passCriteria: 'Waypoint distance < 1.0m, autonomous stop.' },
                { id: 'nav_recovery_reserve', name: 'Recovery Reserve Window', durationM: 5, swimlane: 'Safety', color: '#f59e0b', goal: 'Reserve time for potential unstuck maneuvers or SLAM re-init.', passCriteria: 'Zero time penalties from judges.' },
                { id: 'nav_slack', name: 'Mission Halt & Parking', durationM: 3, swimlane: 'Safety', color: '#64748b', goal: 'Lock brakes, power down drive motors.', passCriteria: 'Drive disabled, telemetry confirmed.' }
            ]
        },
        maintenance: {
            id: 'maintenance',
            name: 'Maintenance Task',
            defaultDurationS: 1800, // 30 min
            steps: [
                { id: 'maint_approach', name: 'Approach ERC Maintenance Panel', durationM: 4, swimlane: 'Drive', color: '#22c55e', goal: 'Drive rover within arm reaching distance (~0.6m) of task panel.', passCriteria: 'Panel clearly visible in Front and Arm cameras.' },
                { id: 'maint_switches', name: 'Toggle Power & Safety Switches', durationM: 6, swimlane: 'Arm', color: '#f97316', goal: 'Manipulator toggles target switches 1, 3, and 5 per judge sequence.', passCriteria: 'Switches visually confirmed in ON position.' },
                { id: 'maint_electrical', name: 'Electrical Voltage Measurement', durationM: 5, swimlane: 'Arm', color: '#f97316', goal: 'Insert voltage probe into measurement terminals and log reading.', passCriteria: 'Voltage measurement logged and confirmed.' },
                { id: 'maint_em_lock', name: 'Release Electro-Magnetic Lock', durationM: 4, swimlane: 'Arm', color: '#f97316', goal: 'Actuate bypass toggle to disengage panel EM safety lock.', passCriteria: 'Indicator LED illuminated on panel.' },
                { id: 'maint_rj45', name: 'Connect RJ-45 Ethernet Cable', durationM: 6, swimlane: 'Arm', color: '#f97316', goal: 'Grasp RJ-45 connector and insert into designated socket.', passCriteria: 'RJ-45 latch clicked and link LED blinking.' },
                { id: 'maint_photos', name: 'Document Completed Panel State', durationM: 3, swimlane: 'Science', color: '#a855f7', goal: 'Capture high-resolution evidence photo of panel.', passCriteria: 'Photo stored in Open MCT Notebook.' },
                { id: 'maint_backoff', name: 'Back Off & Stow Manipulator', durationM: 2, swimlane: 'Drive', color: '#22c55e', goal: 'Stow arm and reverse rover 1.5m away from panel.', passCriteria: 'Rover clear of panel boundary.' }
            ]
        },
        probing: {
            id: 'probing',
            name: 'Probing Task',
            defaultDurationS: 1920, // 32 min
            steps: [
                { id: 'probe_search_1', name: 'Search & Locate Probe 1', durationM: 6, swimlane: 'Drive', color: '#22c55e', goal: 'Search designated zone for target geological probe 1.', passCriteria: 'Probe 1 located in mast camera view.' },
                { id: 'probe_stow_1', name: 'Pick & Stow Probe 1', durationM: 4, swimlane: 'Arm', color: '#f97316', goal: 'Grasp probe 1 with universal gripper and deposit into container slot 1.', passCriteria: 'Probe securely positioned in slot 1.' },
                { id: 'probe_search_2', name: 'Search & Locate Probe 2', durationM: 6, swimlane: 'Drive', color: '#22c55e', goal: 'Search secondary sector for probe 2.', passCriteria: 'Probe 2 located in camera view.' },
                { id: 'probe_stow_2', name: 'Pick & Stow Probe 2', durationM: 4, swimlane: 'Arm', color: '#f97316', goal: 'Pick probe 2 and deposit into container slot 2.', passCriteria: 'Probe securely positioned in slot 2.' },
                { id: 'probe_search_3', name: 'Search & Locate Probe 3', durationM: 6, swimlane: 'Drive', color: '#22c55e', goal: 'Locate final probe 3 near terrain obstacle.', passCriteria: 'Probe 3 located.' },
                { id: 'probe_stow_3', name: 'Pick & Stow Probe 3', durationM: 4, swimlane: 'Arm', color: '#f97316', goal: 'Retrieve and deposit probe 3 into container slot 3.', passCriteria: 'Probe securely positioned in slot 3.' },
                { id: 'probe_confirm', name: 'Confirm 3 Probes Aboard', durationM: 2, swimlane: 'Science', color: '#a855f7', goal: 'Capture container verification photo showing all 3 probes aboard.', passCriteria: '3/3 probes logged, Notebook note created.' }
            ]
        }
    };

    class TaskClockManager {
        constructor() {
            this.listeners = new Set();
            this.state = this.loadState();
            this.timer = setInterval(() => this.tick(), 1000);
        }

        loadState() {
            try {
                const saved = localStorage.getItem('orion_task_clock');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    // If previously saved as RUNNING, check if run expired or uninitiated
                    if (parsed.state === 'RUNNING') {
                        const elapsedMs = parsed.t0 ? (Date.now() - parsed.t0) : Infinity;
                        if (elapsedMs > (parsed.limit_s || 2400) * 1000 || !parsed.t0) {
                            parsed.state = 'IDLE';
                            parsed.t0 = null;
                            parsed.stepIndex = 0;
                            parsed.stepStartTime = null;
                        }
                    }
                    return parsed;
                }
            } catch (_) {}

            return {
                task: 'navigation',
                state: 'IDLE', // 'IDLE', 'RUNNING', 'HELD', 'STOPPED'
                t0: null,
                limit_s: 2100,
                hold_s: 0,
                stepIndex: 0,
                stepStartTime: null,
                steps: {}
            };
        }

        saveState() {
            try {
                localStorage.setItem('orion_task_clock', JSON.stringify(this.state));
            } catch (_) {}

            // Broadcast over BroadcastChannel
            try {
                const bc = new BroadcastChannel('orion-task-clock-sync');
                bc.postMessage(this.state);
            } catch (_) {}

            // Sync to Gateway via API
            try {
                fetch('/api/command', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'TASK_STATE_SYNC', taskState: this.state })
                }).catch(() => {});
            } catch (_) {}

            this.notify();
        }

        subscribe(cb) {
            this.listeners.add(cb);
            cb(this.state);
            return () => this.listeners.delete(cb);
        }

        notify() {
            this.listeners.forEach(cb => {
                try { cb(this.state); } catch (_) {}
            });
        }

        getTemplate() {
            if (typeof window !== 'undefined' && window.OrionTimelineStore) {
                return window.OrionTimelineStore.getPlan(this.state.task);
            }
            return TASK_TEMPLATES[this.state.task] || TASK_TEMPLATES.science;
        }

        getCurrentStep() {
            const tpl = this.getTemplate();
            return tpl.steps[this.state.stepIndex] || null;
        }

        getNextStep() {
            const tpl = this.getTemplate();
            return tpl.steps[this.state.stepIndex + 1] || null;
        }

        getRemainingSeconds() {
            if (this.state.state === 'IDLE' || !this.state.t0) {
                return this.state.limit_s;
            }
            if (this.state.state === 'HELD' || this.state.state === 'STOPPED') {
                const elapsed = Math.floor((this.state.hold_t - this.state.t0) / 1000) - this.state.hold_s;
                return Math.max(0, this.state.limit_s - elapsed);
            }
            const now = Date.now();
            const elapsed = Math.floor((now - this.state.t0) / 1000) - this.state.hold_s;
            return Math.max(0, this.state.limit_s - elapsed);
        }

        getElapsedSeconds() {
            if (!this.state.t0) return 0;
            return Math.max(0, this.state.limit_s - this.getRemainingSeconds());
        }

        getBudgetUsedPercent() {
            if (!this.state.limit_s || this.state.limit_s <= 0) return 0;
            return Math.min(100, Math.max(0, (this.getElapsedSeconds() / this.state.limit_s) * 100));
        }

        tick() {
            if (this.state.state === 'RUNNING') {
                this.notify();
            }
        }

        setTask(taskKey) {
            const normKey = (typeof window !== 'undefined' && window.OrionTimelineStore)
                ? window.OrionTimelineStore.normalizeKey(taskKey)
                : taskKey;
            if (this.state.state === 'RUNNING') return; // Don't change active running task

            this.state.task = normKey;
            const tpl = this.getTemplate();
            this.state.limit_s = tpl.defaultDurationS || 2100;
            this.state.stepIndex = 0;
            this.state.steps = {};
            this.saveState();
        }

        setJudgeLimitSeconds(seconds) {
            this.state.limit_s = Math.max(60, parseInt(seconds, 10) || 2400);
            this.saveState();
        }

        start(openmct) {
            const now = Date.now();
            this.state.state = 'RUNNING';
            this.state.t0 = now;
            this.state.hold_s = 0;
            this.state.hold_t = null;
            this.state.stepIndex = 0;
            this.state.stepStartTime = now;
            this.state.steps = {};

            const tpl = this.getTemplate();
            tpl.steps.forEach((s, idx) => {
                this.state.steps[s.id] = {
                    state: idx === 0 ? 'active' : 'pending',
                    startTime: idx === 0 ? now : null,
                    endTime: null
                };
            });

            this.saveState();

            // Lock Open MCT Time Conductor bounds to [t0 - 60s, t0 + limit_s * 1000 + 60s]
            if (openmct && openmct.time) {
                try {
                    const leadMs = 60 * 1000;
                    const startMs = now - leadMs;
                    const endMs = now + (this.state.limit_s * 1000) + leadMs;
                    openmct.time.setMode('fixed', { start: startMs, end: endMs });
                } catch (e) {
                    console.warn('[Task Clock] Conductor lock warning:', e);
                }
            }

            // Re-anchor Open MCT plan bodies with the new t0
            if (typeof window !== 'undefined' && window.OrionTimelineStore) {
                window.OrionTimelineStore.reanchorAllPlans(openmct, now);
            }
        }

        hold() {
            if (this.state.state !== 'RUNNING') return;
            this.state.state = 'HELD';
            this.state.hold_t = Date.now();
            this.saveState();
        }

        resume() {
            if (this.state.state !== 'HELD') return;
            const now = Date.now();
            const pauseDuration = Math.floor((now - this.state.hold_t) / 1000);
            this.state.hold_s += pauseDuration;
            this.state.hold_t = null;
            this.state.state = 'RUNNING';
            this.saveState();
        }

        stop() {
            this.state.state = 'STOPPED';
            this.state.hold_t = Date.now();
            this.saveState();
        }

        reset(openmct) {
            this.state.state = 'IDLE';
            this.state.t0 = null;
            this.state.hold_s = 0;
            this.state.hold_t = null;
            this.state.stepIndex = 0;
            this.state.stepStartTime = null;
            this.state.steps = {};
            this.saveState();

            if (typeof window !== 'undefined' && window.OrionTimelineStore && openmct) {
                window.OrionTimelineStore.reanchorAllPlans(openmct, Date.now() + 60 * 1000);
            }
        }

        markStepDone() {
            const tpl = this.getTemplate();
            const current = tpl.steps[this.state.stepIndex];
            if (!current) return;

            const now = Date.now();
            if (!this.state.steps[current.id]) this.state.steps[current.id] = {};
            this.state.steps[current.id].state = 'done';
            this.state.steps[current.id].endTime = now;

            if (this.state.stepIndex + 1 < tpl.steps.length) {
                this.state.stepIndex++;
                const next = tpl.steps[this.state.stepIndex];
                this.state.stepStartTime = now;
                if (!this.state.steps[next.id]) this.state.steps[next.id] = {};
                this.state.steps[next.id].state = 'active';
                this.state.steps[next.id].startTime = now;
            } else {
                this.state.state = 'STOPPED';
            }

            this.saveState();
        }

        skipStep() {
            const tpl = this.getTemplate();
            const current = tpl.steps[this.state.stepIndex];
            if (!current) return;

            const now = Date.now();
            if (!this.state.steps[current.id]) this.state.steps[current.id] = {};
            this.state.steps[current.id].state = 'skipped';
            this.state.steps[current.id].endTime = now;

            if (this.state.stepIndex + 1 < tpl.steps.length) {
                this.state.stepIndex++;
                const next = tpl.steps[this.state.stepIndex];
                this.state.stepStartTime = now;
                if (!this.state.steps[next.id]) this.state.steps[next.id] = {};
                this.state.steps[next.id].state = 'active';
                this.state.steps[next.id].startTime = now;
            }

            this.saveState();
        }
    }

    const taskManager = new TaskClockManager();

    function formatTimeRemaining(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    // Build the Top Persistent Banner HTML & Behavior
    function installTopBanner(openmct) {
        const bannerId = 'orion-top-task-banner';
        if (document.getElementById(bannerId)) return;

        const banner = document.createElement('div');
        banner.id = bannerId;
        banner.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #141414;
            border-bottom: 1px solid #282828;
            color: #f8fafc;
            padding: 4px 12px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 11px;
            z-index: 100;
            box-shadow: 0 2px 6px rgba(0,0,0,0.4);
            user-select: none;
            border-radius: 0px;
        `;

        banner.innerHTML = `
            <!-- Left: Task Selection & Status -->
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;">TASK:</span>
                <select id="orion-task-select" style="background: #1c1c1c; color: #f8fafc; border: 1px solid #333333; border-radius: 0px; padding: 2px 6px; font-size: 11px; outline: none; cursor: pointer;">
                    <option value="science">SCIENCE (~40M)</option>
                    <option value="navigation">NAVIGATION (~35M)</option>
                    <option value="maintenance">MAINTENANCE (~30M)</option>
                    <option value="probing">PROBING (~32M)</option>
                </select>
                <span id="orion-task-state-badge" style="background: #27272a; border: 1px solid #3f3f46; color: #a1a1aa; padding: 2px 6px; border-radius: 0px; font-weight: 700; font-size: 10px; font-family: monospace;">IDLE</span>
            </div>

            <!-- Middle-Left: Large Judge Countdown Clock -->
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <div style="display: flex; align-items: baseline; gap: 4px;">
                        <span style="font-size: 9px; color: #64748b; font-weight: 600;">JUDGE TIME:</span>
                        <span id="orion-judge-countdown" style="font-size: 18px; font-weight: 800; font-family: monospace; color: #22c55e; letter-spacing: 1px;">40:00</span>
                    </div>
                </div>
                <div style="width: 80px; height: 6px; background: #1c1c1c; border-radius: 0px; overflow: hidden; border: 1px solid #2e2e2e;">
                    <div id="orion-budget-progress" style="width: 0%; height: 100%; background: #38bdf8; transition: width 0.3s; border-radius: 0px;"></div>
                </div>
                <span id="orion-budget-pct" style="font-family: monospace; font-size: 10px; color: #94a3b8;">0%</span>
            </div>

            <!-- Middle: Active Step & Next Step -->
            <div style="display: flex; align-items: center; gap: 14px; max-width: 450px;">
                <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <span style="background: #2563eb; color: #ffffff; padding: 1px 5px; border-radius: 0px; font-weight: 800; font-size: 9px;">NOW</span>
                    <span id="orion-step-now" style="font-weight: 700; color: #e2e8f0; max-width: 180px; overflow: hidden; text-overflow: ellipsis;">--</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <span style="background: #27272a; border: 1px solid #3f3f46; color: #cbd5e1; padding: 1px 5px; border-radius: 0px; font-weight: 700; font-size: 9px;">NEXT</span>
                    <span id="orion-step-next" style="color: #94a3b8; max-width: 150px; overflow: hidden; text-overflow: ellipsis;">--</span>
                </div>
            </div>

            <!-- Right: Controls -->
            <div style="display: flex; align-items: center; gap: 6px;">
                <button id="btn-task-start" style="background: #15803d; color: #ffffff; border: 1px solid #16a34a; padding: 3px 8px; border-radius: 0px; font-size: 10px; font-weight: 700; cursor: pointer;">START</button>
                <button id="btn-task-hold" style="background: #b45309; color: #ffffff; border: 1px solid #d97706; padding: 3px 8px; border-radius: 0px; font-size: 10px; font-weight: 700; cursor: pointer; display: none;">HOLD</button>
                <button id="btn-task-resume" style="background: #1d4ed8; color: #ffffff; border: 1px solid #2563eb; padding: 3px 8px; border-radius: 0px; font-size: 10px; font-weight: 700; cursor: pointer; display: none;">RESUME</button>
                <button id="btn-task-done" style="background: #0369a1; color: #ffffff; border: 1px solid #0284c7; padding: 3px 8px; border-radius: 0px; font-size: 10px; font-weight: 700; cursor: pointer;">DONE</button>
                <button id="btn-task-skip" style="background: #27272a; color: #cbd5e1; border: 1px solid #3f3f46; padding: 3px 6px; border-radius: 0px; font-size: 10px; font-weight: 600; cursor: pointer;">SKIP</button>
                <button id="btn-task-stop" style="background: #7f1d1d; color: #fca5a5; border: 1px solid #991b1b; padding: 3px 8px; border-radius: 0px; font-size: 10px; font-weight: 700; cursor: pointer;">STOP</button>
                <button id="btn-task-edit" style="background: #1e293b; color: #38bdf8; border: 1px solid #38bdf8; padding: 3px 8px; border-radius: 0px; font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase;">⚙ EDIT</button>
            </div>
        `;

        // Mount at top of document body, before Open MCT shell
        document.body.prepend(banner);

        // Bind Controls
        const select = document.getElementById('orion-task-select');
        const stateBadge = document.getElementById('orion-task-state-badge');
        const countdown = document.getElementById('orion-judge-countdown');
        const budgetBar = document.getElementById('orion-budget-progress');
        const budgetPct = document.getElementById('orion-budget-pct');
        const stepNow = document.getElementById('orion-step-now');
        const stepNext = document.getElementById('orion-step-next');

        const btnStart = document.getElementById('btn-task-start');
        const btnHold = document.getElementById('btn-task-hold');
        const btnResume = document.getElementById('btn-task-resume');
        const btnDone = document.getElementById('btn-task-done');
        const btnSkip = document.getElementById('btn-task-skip');
        const btnStop = document.getElementById('btn-task-stop');
        const btnEdit = document.getElementById('btn-task-edit');

        if (btnEdit) {
            btnEdit.addEventListener('click', () => {
                if (typeof window.openOrionTimelineEditor === 'function') {
                    window.openOrionTimelineEditor(taskManager.state.task);
                }
            });
        }

        select.addEventListener('change', (e) => {
            taskManager.setTask(e.target.value);
            const baseT = taskManager.state.t0 || (Date.now() + 60 * 1000);
            if (typeof window !== 'undefined' && window.OrionTimelineStore) {
                window.OrionTimelineStore.reanchorAllPlans(openmct, baseT);
            }
        });

        btnStart.addEventListener('click', () => {
            taskManager.start(openmct);
            openmct.notifications.info(`Task Started: ${taskManager.getTemplate().name}`);
        });

        btnHold.addEventListener('click', () => {
            taskManager.hold();
            openmct.notifications.alert('Task execution paused on judge HOLD.');
        });

        btnResume.addEventListener('click', () => {
            taskManager.resume();
            openmct.notifications.info('Task execution resumed.');
        });

        btnDone.addEventListener('click', () => {
            const curr = taskManager.getCurrentStep();
            taskManager.markStepDone();
            if (curr) {
                openmct.notifications.info(`Completed step: ${curr.name}`);
            }
        });

        btnSkip.addEventListener('click', () => {
            const curr = taskManager.getCurrentStep();
            taskManager.skipStep();
            if (curr) {
                openmct.notifications.alert(`Skipped step: ${curr.name}`);
            }
        });

        btnStop.addEventListener('click', () => {
            taskManager.stop();
            openmct.notifications.alert('Task stopped.');
        });

        // Update banner UI on state changes
        taskManager.subscribe((state) => {
            select.value = state.task;
            select.disabled = state.state === 'RUNNING' || state.state === 'HELD';

            const remaining = taskManager.getRemainingSeconds();
            countdown.textContent = formatTimeRemaining(remaining);

            // Color coding for urgency: yellow at <=25%, red at <=10%
            const pctLeft = state.limit_s > 0 ? (remaining / state.limit_s) : 1;
            if (pctLeft <= 0.10) {
                countdown.style.color = '#ef4444'; // Red
            } else if (pctLeft <= 0.25) {
                countdown.style.color = '#f59e0b'; // Amber
            } else {
                countdown.style.color = '#22c55e'; // Green
            }

            const usedPct = taskManager.getBudgetUsedPercent();
            budgetBar.style.width = `${usedPct.toFixed(1)}%`;
            budgetPct.textContent = `${usedPct.toFixed(0)}%`;

            stateBadge.textContent = state.state;
            if (state.state === 'RUNNING') {
                stateBadge.style.background = '#16a34a';
                stateBadge.style.color = '#ffffff';
                btnStart.style.display = 'none';
                btnHold.style.display = 'inline-block';
                btnResume.style.display = 'none';
            } else if (state.state === 'HELD') {
                stateBadge.style.background = '#d97706';
                stateBadge.style.color = '#ffffff';
                btnStart.style.display = 'none';
                btnHold.style.display = 'none';
                btnResume.style.display = 'inline-block';
            } else {
                stateBadge.style.background = '#3e3e42';
                stateBadge.style.color = '#cbd5e1';
                btnStart.style.display = 'inline-block';
                btnHold.style.display = 'none';
                btnResume.style.display = 'none';
            }

            const curr = taskManager.getCurrentStep();
            const next = taskManager.getNextStep();
            if (state.state === 'IDLE') {
                stepNow.textContent = 'Awaiting Start (Click ▶ START)';
                stepNext.textContent = curr ? `${curr.name} (${curr.durationM}m)` : '(None)';
            } else {
                stepNow.textContent = curr ? curr.name : '(Mission Complete)';
                stepNext.textContent = next ? next.name : '(None)';
            }
        });
    }

    function installTimelineInteractiveView(openmct) {
        openmct.objectViews.addProvider({
            key: 'orion.timeline.interactive',
            name: 'Timeline Controls & View',
            cssClass: 'icon-timeline',
            priority: function () {
                return 1000;
            },
            canView: function (domainObject) {
                return domainObject.type === 'plan' || domainObject.type === 'time-strip' || domainObject.type === 'timelist';
            },
            view: function (domainObject, objectPath) {
                let nativeViewInstance = null;
                let cleanupSub = null;

                return {
                    show: function (element) {
                        element.style.display = 'flex';
                        element.style.flexDirection = 'column';
                        element.style.height = '100%';
                        element.style.width = '100%';
                        element.style.overflow = 'hidden';

                        // Map domain object key to task preset
                        let currentTask = 'navigation';
                        if (domainObject.identifier && domainObject.identifier.key) {
                            const k = domainObject.identifier.key;
                            if (k.includes('sci')) currentTask = 'science';
                            else if (k.includes('maint')) currentTask = 'maintenance';
                            else if (k.includes('prob')) currentTask = 'probing';
                            else if (k.includes('nav')) currentTask = 'navigation';
                        }

                        // Create Top Timeline Control Toolbar
                        const toolbar = document.createElement('div');
                        toolbar.className = 'orion-in-timeline-toolbar';
                        toolbar.style.cssText = `
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            background: #181818;
                            border-bottom: 1px solid #282828;
                            padding: 6px 12px;
                            box-sizing: border-box;
                            flex-shrink: 0;
                            height: 38px;
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
                            z-index: 10;
                            user-select: none;
                        `;

                        toolbar.innerHTML = `
                            <!-- Left: Timeline Name & Status -->
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <div style="width: 8px; height: 8px; background: #64748b; border-radius: 0px;" id="tb-state-led"></div>
                                <span style="font-size: 11px; font-weight: 800; color: #f8fafc; text-transform: uppercase; letter-spacing: 0.5px;">
                                    ${domainObject.name || 'MISSION TIMELINE'}
                                </span>
                                <span id="tb-state-badge" style="background: #27272a; border: 1px solid #3f3f46; color: #a1a1aa; padding: 2px 6px; font-size: 9px; font-family: monospace; font-weight: 800;">IDLE</span>
                                <span id="tb-time-met" style="font-family: monospace; font-size: 11px; color: #38bdf8; font-weight: 700;">MET T+00:00</span>
                                <span id="tb-time-rem" style="font-family: monospace; font-size: 10px; color: #94a3b8;">REM: --:--</span>
                            </div>

                            <!-- Middle: Active Milestone Indicator -->
                            <div style="display: flex; align-items: center; gap: 8px; max-width: 360px; overflow: hidden;">
                                <span style="background: #2563eb; color: #ffffff; padding: 1px 5px; font-weight: 800; font-size: 9px; border-radius: 0px;">ACTIVE STEP</span>
                                <span id="tb-step-name" style="font-size: 11px; color: #e2e8f0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">--</span>
                            </div>

                            <!-- Right: Controls, Switcher & Edit Button -->
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <button id="tb-btn-start" style="background: #15803d; color: #ffffff; border: 1px solid #16a34a; padding: 3px 10px; font-size: 10px; font-weight: 800; cursor: pointer; text-transform: uppercase;">▶ START</button>
                                <button id="tb-btn-hold" style="background: #b45309; color: #ffffff; border: 1px solid #d97706; padding: 3px 10px; font-size: 10px; font-weight: 800; cursor: pointer; display: none; text-transform: uppercase;">⏸ HOLD</button>
                                <button id="tb-btn-resume" style="background: #1d4ed8; color: #ffffff; border: 1px solid #2563eb; padding: 3px 10px; font-size: 10px; font-weight: 800; cursor: pointer; display: none; text-transform: uppercase;">▶ RESUME</button>
                                <button id="tb-btn-done" style="background: #0369a1; color: #ffffff; border: 1px solid #0284c7; padding: 3px 8px; font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase;">✓ DONE</button>
                                <button id="tb-btn-skip" style="background: #27272a; color: #cbd5e1; border: 1px solid #3f3f46; padding: 3px 6px; font-size: 10px; font-weight: 600; cursor: pointer; text-transform: uppercase;">SKIP</button>
                                <button id="tb-btn-stop" style="background: #7f1d1d; color: #fca5a5; border: 1px solid #991b1b; padding: 3px 10px; font-size: 10px; font-weight: 800; cursor: pointer; text-transform: uppercase;">⏹ STOP</button>
                                
                                <select id="tb-task-select" style="background: #141414; color: #ffffff; border: 1px solid #333333; padding: 2px 6px; font-size: 10px; outline: none; cursor: pointer; margin-left: 4px;">
                                    <option value="navigation">🧭 Navigation</option>
                                    <option value="science">🔬 Science</option>
                                    <option value="maintenance">🔧 Maintenance</option>
                                    <option value="probing">🎯 Probing</option>
                                </select>

                                <button id="tb-btn-edit" style="background: #1e293b; color: #38bdf8; border: 1px solid #38bdf8; padding: 3px 8px; font-size: 10px; font-weight: 800; cursor: pointer; margin-left: 4px; text-transform: uppercase;">⚙ EDIT</button>
                            </div>
                        `;

                        element.appendChild(toolbar);

                        // Body Container for Native Open MCT View
                        const bodyDiv = document.createElement('div');
                        bodyDiv.className = 'orion-in-timeline-body';
                        bodyDiv.style.cssText = `
                            flex: 1;
                            min-height: 0;
                            width: 100%;
                            position: relative;
                            overflow: hidden;
                        `;
                        element.appendChild(bodyDiv);

                        // Render native Open MCT view in bodyDiv
                        const nativeProviders = openmct.objectViews.get(domainObject, objectPath)
                            .filter(p => p.key !== 'orion.timeline.interactive');
                        if (nativeProviders.length > 0) {
                            nativeViewInstance = nativeProviders[0].view(domainObject, objectPath);
                            nativeViewInstance.show(bodyDiv);
                        }

                        // Wire controls
                        const led = toolbar.querySelector('#tb-state-led');
                        const badge = toolbar.querySelector('#tb-state-badge');
                        const met = toolbar.querySelector('#tb-time-met');
                        const rem = toolbar.querySelector('#tb-time-rem');
                        const stepName = toolbar.querySelector('#tb-step-name');

                        const btnStart = toolbar.querySelector('#tb-btn-start');
                        const btnHold = toolbar.querySelector('#tb-btn-hold');
                        const btnResume = toolbar.querySelector('#tb-btn-resume');
                        const btnDone = toolbar.querySelector('#tb-btn-done');
                        const btnSkip = toolbar.querySelector('#tb-btn-skip');
                        const btnStop = toolbar.querySelector('#tb-btn-stop');
                        const selectTask = toolbar.querySelector('#tb-task-select');
                        const btnEdit = toolbar.querySelector('#tb-btn-edit');

                        selectTask.value = taskManager.state.task || currentTask;

                        selectTask.addEventListener('change', (e) => {
                            taskManager.setTask(e.target.value);
                            const targetKey = `plan_${e.target.value === 'navigation' ? 'nav' : e.target.value}`;
                            if (window.location.hash.includes('plan_')) {
                                window.location.hash = `#/browse/orion.taxonomy:${targetKey}`;
                            }
                        });

                        btnStart.addEventListener('click', () => {
                            taskManager.start(openmct);
                            if (openmct && openmct.notifications) {
                                openmct.notifications.info(`Mission Timeline Started: ${taskManager.getTemplate().name}`);
                            }
                        });

                        btnHold.addEventListener('click', () => {
                            taskManager.hold();
                            if (openmct && openmct.notifications) {
                                openmct.notifications.alert('Timeline paused on judge HOLD.');
                            }
                        });

                        btnResume.addEventListener('click', () => {
                            taskManager.resume();
                            if (openmct && openmct.notifications) {
                                openmct.notifications.info('Timeline resumed.');
                            }
                        });

                        btnDone.addEventListener('click', () => {
                            const curr = taskManager.getCurrentStep();
                            taskManager.markStepDone();
                            if (curr && openmct && openmct.notifications) {
                                openmct.notifications.info(`Step completed: ${curr.name}`);
                            }
                        });

                        btnSkip.addEventListener('click', () => {
                            const curr = taskManager.getCurrentStep();
                            taskManager.skipStep();
                            if (curr && openmct && openmct.notifications) {
                                openmct.notifications.info(`Step skipped: ${curr.name}`);
                            }
                        });

                        btnStop.addEventListener('click', () => {
                            taskManager.stop();
                            if (openmct && openmct.notifications) {
                                openmct.notifications.alert('Mission timeline stopped.');
                            }
                        });

                        btnEdit.addEventListener('click', () => {
                            if (typeof window.openOrionTimelineEditor === 'function') {
                                window.openOrionTimelineEditor(selectTask.value || taskManager.state.task);
                            }
                        });

                        function updateToolbar(state) {
                            const isRunning = state.state === 'RUNNING';
                            const isHeld = state.state === 'HELD';
                            const isStopped = state.state === 'STOPPED';

                            if (isRunning) {
                                badge.textContent = 'RUNNING';
                                badge.style.background = '#14532d';
                                badge.style.borderColor = '#166534';
                                badge.style.color = '#86efac';
                                led.style.background = '#22c55e';
                                btnStart.style.display = 'none';
                                btnHold.style.display = 'inline-block';
                                btnResume.style.display = 'none';
                            } else if (isHeld) {
                                badge.textContent = 'HELD';
                                badge.style.background = '#78350f';
                                badge.style.borderColor = '#d97706';
                                badge.style.color = '#fde68a';
                                led.style.background = '#f59e0b';
                                btnStart.style.display = 'none';
                                btnHold.style.display = 'none';
                                btnResume.style.display = 'inline-block';
                            } else if (isStopped) {
                                badge.textContent = 'STOPPED';
                                badge.style.background = '#3f1a1a';
                                badge.style.borderColor = '#7f1d1d';
                                badge.style.color = '#fca5a5';
                                led.style.background = '#ef4444';
                                btnStart.style.display = 'inline-block';
                                btnHold.style.display = 'none';
                                btnResume.style.display = 'none';
                            } else {
                                badge.textContent = 'IDLE';
                                badge.style.background = '#27272a';
                                badge.style.borderColor = '#3f3f46';
                                badge.style.color = '#a1a1aa';
                                led.style.background = '#64748b';
                                btnStart.style.display = 'inline-block';
                                btnHold.style.display = 'none';
                                btnResume.style.display = 'none';
                            }

                            if (isRunning || isHeld || isStopped) {
                                const elapsed = taskManager.getElapsedSeconds();
                                const remS = taskManager.getRemainingSeconds();
                                const elM = Math.floor(elapsed / 60);
                                const elS = elapsed % 60;
                                met.textContent = `MET T+${String(elM).padStart(2, '0')}:${String(elS).padStart(2, '0')}`;
                                rem.textContent = `REM: ${formatTimeRemaining(remS)}`;
                            } else {
                                met.textContent = 'MET T+00:00';
                                rem.textContent = `REM: ${formatTimeRemaining(taskManager.getTemplate().defaultDurationS)}`;
                            }

                            const curr = taskManager.getCurrentStep();
                            if (!isRunning && !isHeld && !isStopped) {
                                stepName.textContent = 'Awaiting Initiation (Click ▶ START)';
                            } else {
                                stepName.textContent = curr ? `${curr.name} (${curr.durationM}m)` : '(Complete / Planned)';
                            }
                            if (selectTask.value !== state.task) {
                                selectTask.value = state.task;
                            }
                        }

                        cleanupSub = taskManager.subscribe(updateToolbar);
                    },
                    destroy: function () {
                        if (cleanupSub) cleanupSub();
                        if (nativeViewInstance && typeof nativeViewInstance.destroy === 'function') {
                            nativeViewInstance.destroy();
                        }
                    }
                };
            }
        });
    }

    function installTimelineActions(openmct) {
        openmct.actions.register({
            key: 'orion.timeline.start',
            name: 'Start Mission Timeline',
            cssClass: 'icon-play',
            description: 'Start and anchor active timeline to current time',
            group: 'action',
            priority: 1,
            appliesTo: (objectPath) => {
                const obj = objectPath[0];
                return obj && (obj.type === 'plan' || obj.type === 'time-strip' || obj.type === 'timelist');
            },
            invoke: () => {
                taskManager.start(openmct);
                if (openmct.notifications) {
                    openmct.notifications.info(`Started timeline: ${taskManager.getTemplate().name}`);
                }
            }
        });

        openmct.actions.register({
            key: 'orion.timeline.stop',
            name: 'Stop Mission Timeline',
            cssClass: 'icon-pause',
            description: 'Halt active mission timeline execution',
            group: 'action',
            priority: 2,
            appliesTo: (objectPath) => {
                const obj = objectPath[0];
                return obj && (obj.type === 'plan' || obj.type === 'time-strip' || obj.type === 'timelist');
            },
            invoke: () => {
                taskManager.stop();
                if (openmct.notifications) {
                    openmct.notifications.alert('Mission timeline stopped.');
                }
            }
        });

        openmct.actions.register({
            key: 'orion.timeline.edit',
            name: 'Edit Timeline Milestones',
            cssClass: 'icon-pencil',
            description: 'Customize timeline steps, durations, and swimlanes',
            group: 'action',
            priority: 3,
            appliesTo: (objectPath) => {
                const obj = objectPath[0];
                return obj && (obj.type === 'plan' || obj.type === 'time-strip' || obj.type === 'timelist');
            },
            invoke: (objectPath) => {
                const obj = objectPath[0];
                let k = 'navigation';
                if (obj.identifier && obj.identifier.key) {
                    if (obj.identifier.key.includes('sci')) k = 'science';
                    else if (obj.identifier.key.includes('maint')) k = 'maintenance';
                    else if (obj.identifier.key.includes('prob')) k = 'probing';
                }
                if (typeof window.openOrionTimelineEditor === 'function') {
                    window.openOrionTimelineEditor(k);
                }
            }
        });
    }

    // Orion Task Clock Plugin export
    function OrionTaskClockPlugin() {
        return function install(openmct) {
            installTopBanner(openmct);
            installTimelineInteractiveView(openmct);
            installTimelineActions(openmct);
        };
    }

    function renderGanttView(container, domainObject, openmct) {
        // Map domainObject key to task template
        let taskKey = 'science';
        if (domainObject && domainObject.identifier && domainObject.identifier.key) {
            const k = domainObject.identifier.key;
            if (k.includes('nav')) taskKey = 'navigation';
            else if (k.includes('maint')) taskKey = 'maintenance';
            else if (k.includes('prob')) taskKey = 'probing';
            else if (k.includes('sci')) taskKey = 'science';
        }

        const tpl = TASK_TEMPLATES[taskKey] || TASK_TEMPLATES.science;

        // Cumulative minutes calculation
        let totalDurationM = 0;
        const computedSteps = tpl.steps.map((step, idx) => {
            const startM = totalDurationM;
            const endM = startM + step.durationM;
            totalDurationM += step.durationM;
            return {
                ...step,
                index: idx,
                startM,
                endM
            };
        });

        // Determine unique swimlanes in order
        const swimlanes = [];
        computedSteps.forEach(s => {
            if (!swimlanes.includes(s.swimlane)) {
                swimlanes.push(s.swimlane);
            }
        });

        // Palette for swimlanes (ECSS / NASA aerospace colors)
        const SWIMLANE_COLORS = {
            'Safety': { border: '#dc2626', bg: '#450a0a44', tagBg: '#7f1d1d', text: '#fca5a5' },
            'Drive': { border: '#16a34a', bg: '#052e1644', tagBg: '#14532d', text: '#86efac' },
            'Science': { border: '#9333ea', bg: '#3b076444', tagBg: '#581c87', text: '#d8b4fe' },
            'Arm': { border: '#ea580c', bg: '#43140744', tagBg: '#7c2d12', text: '#fdba74' }
        };

        container.style.cssText = `
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            background: #141414;
            color: #d4d4d4;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
            box-sizing: border-box;
            border: 1px solid #282828;
            border-radius: 0px;
            overflow: hidden;
            user-select: none;
        `;

        // Generate 5-minute ticks
        const ticks = [];
        for (let m = 0; m <= totalDurationM; m += 5) {
            ticks.push(m);
        }
        if (ticks[ticks.length - 1] < totalDurationM) {
            ticks.push(totalDurationM);
        }

        // Build HTML shell
        container.innerHTML = `
            <!-- Top Header & Action Controls Bar -->
            <div style="display: flex; align-items: center; justify-content: space-between; background: #181818; border-bottom: 1px solid #282828; padding: 4px 10px; height: 28px; box-sizing: border-box; flex-shrink: 0;">
                <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; white-space: nowrap;">
                    <div id="gantt-state-led" style="width: 8px; height: 8px; border-radius: 0px; background: #64748b; flex-shrink: 0;"></div>
                    <span style="font-weight: 800; font-size: 11px; color: #f8fafc; letter-spacing: 0.5px;">${tpl.name.toUpperCase()} (GANTT)</span>
                    <span id="gantt-state-badge" style="background: #27272a; border: 1px solid #3f3f46; color: #a1a1aa; padding: 1px 6px; font-size: 9px; font-family: monospace; font-weight: 700; border-radius: 0px;">IDLE</span>
                    <span id="gantt-time-met" style="font-family: monospace; font-size: 11px; color: #38bdf8; font-weight: 700;">MET T+00:00</span>
                    <span id="gantt-time-rem" style="font-family: monospace; font-size: 10px; color: #94a3b8;">REM: ${formatTimeRemaining(tpl.defaultDurationS)}</span>
                </div>

                <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                    <button id="gantt-btn-start" style="background: #15803d; color: #ffffff; border: 1px solid #16a34a; padding: 2px 8px; font-size: 9px; font-weight: 800; border-radius: 0px; cursor: pointer; text-transform: uppercase;">START</button>
                    <button id="gantt-btn-hold" style="background: #b45309; color: #ffffff; border: 1px solid #d97706; padding: 2px 8px; font-size: 9px; font-weight: 800; border-radius: 0px; cursor: pointer; display: none; text-transform: uppercase;">HOLD</button>
                    <button id="gantt-btn-resume" style="background: #1d4ed8; color: #ffffff; border: 1px solid #2563eb; padding: 2px 8px; font-size: 9px; font-weight: 800; border-radius: 0px; cursor: pointer; display: none; text-transform: uppercase;">RESUME</button>
                    <button id="gantt-btn-done" style="background: #0369a1; color: #ffffff; border: 1px solid #0284c7; padding: 2px 8px; font-size: 9px; font-weight: 800; border-radius: 0px; cursor: pointer; text-transform: uppercase;">DONE</button>
                    <button id="gantt-btn-skip" style="background: #27272a; color: #cbd5e1; border: 1px solid #3f3f46; padding: 2px 6px; font-size: 9px; font-weight: 700; border-radius: 0px; cursor: pointer; text-transform: uppercase;">SKIP</button>
                    <button id="gantt-btn-reset" style="background: #3f1a1a; color: #fca5a5; border: 1px solid #7f1d1d; padding: 2px 6px; font-size: 9px; font-weight: 700; border-radius: 0px; cursor: pointer; text-transform: uppercase;">RESET</button>
                </div>
            </div>

            <!-- Gantt Chart Body (Ruler + Swimlanes) -->
            <div style="display: flex; flex-direction: column; flex: 1; min-height: 0; background: #121212; position: relative; overflow: hidden;">
                <!-- Time Scale Ruler Axis -->
                <div style="display: flex; height: 18px; border-bottom: 1px solid #282828; background: #161616; flex-shrink: 0; position: relative;">
                    <div style="width: 64px; flex-shrink: 0; border-right: 1px solid #282828; display: flex; align-items: center; justify-content: center; font-size: 8px; font-family: monospace; color: #71717a; font-weight: 700; background: #141414;">
                        SWIMLANE
                    </div>
                    <div style="position: relative; flex: 1; height: 100%;">
                        ${ticks.map(tick => {
                            const pct = (tick / totalDurationM) * 100;
                            const isEdge = tick === totalDurationM;
                            return `
                                <div style="position: absolute; left: ${pct}%; top: 0; bottom: 0; transform: ${isEdge ? 'translateX(-100%)' : 'none'}; display: flex; align-items: center; padding-left: 2px; font-family: monospace; font-size: 8px; color: #71717a; border-left: 1px solid #333333;">
                                    T+${String(tick).padStart(2, '0')}:00
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <!-- Swimlane Container -->
                <div id="gantt-swimlanes" style="display: flex; flex-direction: column; flex: 1; min-height: 0; position: relative; overflow: hidden;">
                    <!-- Vertical Grid Lines -->
                    <div style="position: absolute; left: 64px; right: 0; top: 0; bottom: 0; pointer-events: none; z-index: 1;">
                        ${ticks.map(tick => {
                            const pct = (tick / totalDurationM) * 100;
                            return `<div style="position: absolute; left: ${pct}%; top: 0; bottom: 0; width: 1px; background: #222222;"></div>`;
                        }).join('')}
                    </div>

                    <!-- Vertical Moving MET Needle -->
                    <div id="gantt-met-needle" style="position: absolute; left: 64px; top: 0; bottom: 0; width: 2px; background: #38bdf8; box-shadow: 0 0 8px rgba(56, 189, 248, 0.9); z-index: 10; pointer-events: none; display: none;">
                        <div style="position: absolute; top: 0; left: 50%; transform: translateX(-50%); background: #38bdf8; color: #000000; font-family: monospace; font-size: 7px; font-weight: 900; padding: 0 2px; line-height: 10px; border-radius: 0px; white-space: nowrap;">MET</div>
                    </div>

                    <!-- Swimlane Rows -->
                    ${swimlanes.map((lane) => {
                        const styleConfig = SWIMLANE_COLORS[lane] || { border: '#52525b', bg: '#27272a33', tagBg: '#3f3f46', text: '#e4e4e7' };
                        const laneSteps = computedSteps.filter(s => s.swimlane === lane);

                        return `
                            <div style="display: flex; flex: 1; min-height: 22px; border-bottom: 1px solid #1e1e1e; position: relative; z-index: 2;">
                                <!-- Swimlane Label -->
                                <div style="width: 64px; flex-shrink: 0; background: #161616; border-right: 1px solid #282828; display: flex; align-items: center; justify-content: space-between; padding: 0 4px; box-sizing: border-box;">
                                    <span style="font-size: 8px; font-family: monospace; font-weight: 800; color: ${styleConfig.text}; letter-spacing: 0.5px;">${lane.toUpperCase()}</span>
                                    <div style="width: 4px; height: 12px; background: ${styleConfig.border}; border-radius: 0px;"></div>
                                </div>

                                <!-- Swimlane Task Track -->
                                <div style="position: relative; flex: 1; height: 100%;">
                                    ${laneSteps.map(step => {
                                        const leftPct = (step.startM / totalDurationM) * 100;
                                        const widthPct = (step.durationM / totalDurationM) * 100;
                                        return `
                                            <div id="gantt-step-${step.id}" data-step-id="${step.id}" class="gantt-step-bar" style="
                                                position: absolute;
                                                left: ${leftPct}%;
                                                width: calc(${widthPct}% - 2px);
                                                top: 2px;
                                                bottom: 2px;
                                                background: ${styleConfig.bg};
                                                border: 1px solid ${styleConfig.border};
                                                border-radius: 0px;
                                                display: flex;
                                                align-items: center;
                                                padding: 0 4px;
                                                box-sizing: border-box;
                                                cursor: pointer;
                                                overflow: hidden;
                                                white-space: nowrap;
                                                text-overflow: ellipsis;
                                                transition: all 0.2s ease;
                                                z-index: 3;
                                            " title="${step.name} (${step.durationM}m) - Click to inspect">
                                                <span class="step-label" style="font-size: 9px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 700; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                                    ${step.name} <b style="font-family: monospace; opacity: 0.8;">(${step.durationM}m)</b>
                                                </span>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- Bottom Active Step & Pass Criteria Bar (Management by Exception) -->
            <div id="gantt-info-bar" style="display: flex; align-items: center; justify-content: space-between; background: #141414; border-top: 1px solid #282828; padding: 2px 10px; height: 22px; font-size: 9px; box-sizing: border-box; flex-shrink: 0; color: #a1a1aa; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
                <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <span id="gantt-info-badge" style="background: #2563eb; color: #ffffff; font-weight: 800; padding: 1px 4px; border-radius: 0px; font-size: 8px;">ACTIVE</span>
                    <span id="gantt-info-name" style="font-weight: 700; color: #f8fafc;">--</span>
                    <span style="color: #52525b;">|</span>
                    <span id="gantt-info-goal" style="color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; max-width: 600px;">--</span>
                </div>
                <div id="gantt-info-criteria" style="font-family: monospace; color: #22c55e; font-weight: 600; flex-shrink: 0; margin-left: 8px;">
                    --
                </div>
            </div>
        `;

        // Controls
        const btnStart = container.querySelector('#gantt-btn-start');
        const btnHold = container.querySelector('#gantt-btn-hold');
        const btnResume = container.querySelector('#gantt-btn-resume');
        const btnDone = container.querySelector('#gantt-btn-done');
        const btnSkip = container.querySelector('#gantt-btn-skip');
        const btnReset = container.querySelector('#gantt-btn-reset');

        const stateLed = container.querySelector('#gantt-state-led');
        const stateBadge = container.querySelector('#gantt-state-badge');
        const timeMet = container.querySelector('#gantt-time-met');
        const timeRem = container.querySelector('#gantt-time-rem');
        const needle = container.querySelector('#gantt-met-needle');

        const infoBadge = container.querySelector('#gantt-info-badge');
        const infoName = container.querySelector('#gantt-info-name');
        const infoGoal = container.querySelector('#gantt-info-goal');
        const infoCriteria = container.querySelector('#gantt-info-criteria');

        let selectedStepId = null;

        // Add click listener on step bars to view in info bar
        container.querySelectorAll('.gantt-step-bar').forEach(el => {
            el.addEventListener('click', () => {
                const sId = el.getAttribute('data-step-id');
                const s = computedSteps.find(item => item.id === sId);
                if (s) {
                    selectedStepId = sId;
                    infoBadge.textContent = 'STEP';
                    infoBadge.style.background = s.color || '#3b82f6';
                    infoName.textContent = `${s.name} (${s.durationM}m)`;
                    infoGoal.textContent = `GOAL: ${s.goal}`;
                    infoCriteria.textContent = `PASS: ${s.passCriteria}`;
                }
            });
        });

        btnStart.addEventListener('click', () => {
            if (taskManager.state.state === 'RUNNING' && taskManager.state.task !== taskKey) {
                if (openmct && openmct.notifications) {
                    openmct.notifications.alert(`Another task (${taskManager.state.task.toUpperCase()}) is currently RUNNING.`);
                }
                return;
            }
            taskManager.setTask(taskKey);
            taskManager.start(openmct);
            if (openmct && openmct.notifications) {
                openmct.notifications.info(`Task Started: ${tpl.name}`);
            }
        });

        btnHold.addEventListener('click', () => {
            if (taskManager.state.task === taskKey) {
                taskManager.hold();
            }
        });

        btnResume.addEventListener('click', () => {
            if (taskManager.state.task === taskKey) {
                taskManager.resume();
            }
        });

        btnDone.addEventListener('click', () => {
            if (taskManager.state.task === taskKey) {
                taskManager.markStepDone();
            }
        });

        btnSkip.addEventListener('click', () => {
            if (taskManager.state.task === taskKey) {
                taskManager.skipStep();
            }
        });

        btnReset.addEventListener('click', () => {
            if (taskManager.state.task === taskKey || taskManager.state.state !== 'RUNNING') {
                taskManager.setTask(taskKey);
                taskManager.reset();
            }
        });

        function updateGantt() {
            const state = taskManager.state;
            const isThisTask = state.task === taskKey;
            const isRunning = isThisTask && state.state === 'RUNNING';
            const isHeld = isThisTask && state.state === 'HELD';
            const isStopped = isThisTask && state.state === 'STOPPED';

            // State Badge & Buttons
            if (!isThisTask && state.state === 'RUNNING') {
                stateBadge.textContent = `BUSY (${state.task.toUpperCase()})`;
                stateBadge.style.background = '#27272a';
                stateBadge.style.borderColor = '#3f3f46';
                stateBadge.style.color = '#71717a';
                stateLed.style.background = '#64748b';
                btnStart.style.display = 'inline-block';
                btnHold.style.display = 'none';
                btnResume.style.display = 'none';
            } else if (isRunning) {
                stateBadge.textContent = 'RUNNING';
                stateBadge.style.background = '#14532d';
                stateBadge.style.borderColor = '#166534';
                stateBadge.style.color = '#86efac';
                stateLed.style.background = '#22c55e';
                btnStart.style.display = 'none';
                btnHold.style.display = 'inline-block';
                btnResume.style.display = 'none';
            } else if (isHeld) {
                stateBadge.textContent = 'HELD';
                stateBadge.style.background = '#78350f';
                stateBadge.style.borderColor = '#d97706';
                stateBadge.style.color = '#fde68a';
                stateLed.style.background = '#f59e0b';
                btnStart.style.display = 'none';
                btnHold.style.display = 'none';
                btnResume.style.display = 'inline-block';
            } else if (isStopped) {
                stateBadge.textContent = 'STOPPED';
                stateBadge.style.background = '#3f1a1a';
                stateBadge.style.borderColor = '#7f1d1d';
                stateBadge.style.color = '#fca5a5';
                stateLed.style.background = '#ef4444';
                btnStart.style.display = 'inline-block';
                btnHold.style.display = 'none';
                btnResume.style.display = 'none';
            } else {
                stateBadge.textContent = 'IDLE';
                stateBadge.style.background = '#27272a';
                stateBadge.style.borderColor = '#3f3f46';
                stateBadge.style.color = '#a1a1aa';
                stateLed.style.background = '#64748b';
                btnStart.style.display = 'inline-block';
                btnHold.style.display = 'none';
                btnResume.style.display = 'none';
            }

            // Time Readouts
            if (isThisTask && (isRunning || isHeld || isStopped)) {
                const elapsedS = taskManager.getElapsedSeconds();
                const remS = taskManager.getRemainingSeconds();
                const elM = Math.floor(elapsedS / 60);
                const elS = elapsedS % 60;
                timeMet.textContent = `MET T+${String(elM).padStart(2, '0')}:${String(elS).padStart(2, '0')}`;
                timeRem.textContent = `REM: ${formatTimeRemaining(remS)}`;

                // Time Needle
                needle.style.display = 'block';
                const frac = Math.min(1, Math.max(0, elapsedS / (totalDurationM * 60)));
                needle.style.left = `calc(64px + (100% - 64px) * ${frac})`;
            } else {
                timeMet.textContent = 'MET T+00:00';
                timeRem.textContent = `REM: ${formatTimeRemaining(tpl.defaultDurationS)}`;
                needle.style.display = 'none';
            }

            // Step states
            const activeStepIdx = isThisTask ? state.stepIndex : -1;
            const currentStep = isThisTask ? taskManager.getCurrentStep() : null;

            computedSteps.forEach((step, idx) => {
                const bar = container.querySelector(`#gantt-step-${step.id}`);
                if (!bar) return;

                const stepData = (isThisTask && state.steps && state.steps[step.id]) || {};
                let status = 'pending';
                if (isThisTask) {
                    if (stepData.state) status = stepData.state;
                    else if (idx < activeStepIdx) status = 'done';
                    else if (idx === activeStepIdx) status = 'active';
                }

                const styleConfig = SWIMLANE_COLORS[step.swimlane] || { border: '#52525b', bg: '#27272a33', text: '#e4e4e7' };
                const labelSpan = bar.querySelector('.step-label');

                if (status === 'done') {
                    bar.style.background = '#181818';
                    bar.style.border = '1px solid #166534';
                    bar.style.boxShadow = 'none';
                    bar.style.opacity = '0.65';
                    if (labelSpan) {
                        labelSpan.innerHTML = `✓ ${step.name} <b style="font-family: monospace; opacity: 0.6;">(${step.durationM}m)</b>`;
                        labelSpan.style.color = '#86efac';
                    }
                } else if (status === 'active') {
                    bar.style.background = `${styleConfig.border}44`;
                    bar.style.border = '2px solid #38bdf8';
                    bar.style.boxShadow = '0 0 10px rgba(56, 189, 248, 0.4)';
                    bar.style.opacity = '1';
                    if (labelSpan) {
                        labelSpan.innerHTML = `▶ <b>${step.name}</b> <b style="font-family: monospace; color: #38bdf8;">(${step.durationM}m)</b>`;
                        labelSpan.style.color = '#ffffff';
                    }
                } else if (status === 'skipped') {
                    bar.style.background = '#141414';
                    bar.style.border = '1px dashed #52525b';
                    bar.style.boxShadow = 'none';
                    bar.style.opacity = '0.4';
                    if (labelSpan) {
                        labelSpan.innerHTML = `[SKIP] ${step.name}`;
                        labelSpan.style.color = '#71717a';
                    }
                } else {
                    // Pending
                    bar.style.background = styleConfig.bg;
                    bar.style.border = `1px solid ${styleConfig.border}`;
                    bar.style.boxShadow = 'none';
                    bar.style.opacity = '0.85';
                    if (labelSpan) {
                        labelSpan.innerHTML = `${step.name} <b style="font-family: monospace; opacity: 0.8;">(${step.durationM}m)</b>`;
                        labelSpan.style.color = '#f8fafc';
                    }
                }
            });

            // Update bottom info bar if not manually inspecting another step
            if (!selectedStepId) {
                if (currentStep) {
                    infoBadge.textContent = 'ACTIVE';
                    infoBadge.style.background = '#2563eb';
                    infoName.textContent = `${currentStep.name} (${currentStep.durationM}m)`;
                    infoGoal.textContent = `GOAL: ${currentStep.goal}`;
                    infoCriteria.textContent = `CRITERIA: ${currentStep.passCriteria}`;
                } else if (isThisTask && activeStepIdx >= computedSteps.length) {
                    infoBadge.textContent = 'COMPLETE';
                    infoBadge.style.background = '#16a34a';
                    infoName.textContent = 'All planned mission steps completed.';
                    infoGoal.textContent = 'Telemetry verified. Ready to export log.';
                    infoCriteria.textContent = 'MISSION PASS';
                } else {
                    const firstStep = computedSteps[0];
                    infoBadge.textContent = 'PLANNED';
                    infoBadge.style.background = '#3f3f46';
                    infoName.textContent = firstStep ? `${firstStep.name} (${firstStep.durationM}m)` : '--';
                    infoGoal.textContent = firstStep ? `GOAL: ${firstStep.goal}` : '--';
                    infoCriteria.textContent = firstStep ? `CRITERIA: ${firstStep.passCriteria}` : '--';
                }
            }
        }

        const unsub = taskManager.subscribe(updateGantt);
        container._cleanup = unsub;
    }

    if (typeof window !== 'undefined') {
        window.OrionTaskClockPlugin = OrionTaskClockPlugin;
        window.OrionTaskManager = taskManager;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionTaskClockPlugin;
    }
})();

