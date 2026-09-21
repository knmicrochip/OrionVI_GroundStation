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

    const DEFAULT_TASK_DURATIONS = {
        navigation: 2100,
        science: 2400,
        maintenance: 1800,
        probing: 1920
    };

    function createDefaultTaskState(taskKey) {
        return {
            state: 'IDLE', // 'IDLE', 'RUNNING', 'HELD', 'STOPPED'
            t0: null,
            limit_s: DEFAULT_TASK_DURATIONS[taskKey] || 2100,
            hold_s: 0,
            hold_t: null,
            stepIndex: 0,
            stepStartTime: null,
            steps: {}
        };
    }

    class TaskClockManager {
        constructor() {
            this.listeners = new Set();
            this.state = this.loadState();
            this.syncActiveProperties();
            this.timer = setInterval(() => this.tick(), 1000);
        }

        loadState() {
            const defaultTasks = {
                navigation: createDefaultTaskState('navigation'),
                science: createDefaultTaskState('science'),
                maintenance: createDefaultTaskState('maintenance'),
                probing: createDefaultTaskState('probing')
            };

            const defaultOverall = {
                state: 'IDLE',
                t0: null,
                hold_s: 0,
                hold_t: null
            };

            try {
                const saved = localStorage.getItem('orion_task_clock');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    // Migrate legacy single-task format if needed
                    if (!parsed.tasks) {
                        parsed.tasks = defaultTasks;
                        const legacyTask = parsed.task || 'navigation';
                        parsed.tasks[legacyTask] = {
                            state: parsed.state || 'IDLE',
                            t0: parsed.t0 || null,
                            limit_s: parsed.limit_s || DEFAULT_TASK_DURATIONS[legacyTask] || 2100,
                            hold_s: parsed.hold_s || 0,
                            hold_t: parsed.hold_t || null,
                            stepIndex: parsed.stepIndex || 0,
                            stepStartTime: parsed.stepStartTime || null,
                            steps: parsed.steps || {}
                        };
                    } else {
                        // Ensure all 4 task keys exist
                        Object.keys(defaultTasks).forEach(k => {
                            if (!parsed.tasks[k]) {
                                parsed.tasks[k] = defaultTasks[k];
                            }
                        });
                    }

                    if (!parsed.overall) {
                        parsed.overall = defaultOverall;
                    }

                    // Strict requirement: Timelines must NEVER run from opening the app.
                    // Always start all missions in IDLE standby at 0 MET upon loading.
                    Object.keys(parsed.tasks).forEach(k => {
                        const t = parsed.tasks[k];
                        t.state = 'IDLE';
                        t.t0 = null;
                        t.hold_s = 0;
                        t.hold_t = null;
                        t.stepIndex = 0;
                        t.stepStartTime = null;
                        t.steps = {};
                    });

                    parsed.overall = {
                        state: 'IDLE',
                        t0: null,
                        hold_s: 0,
                        hold_t: null
                    };

                    if (!parsed.task) parsed.task = 'navigation';

                    return parsed;
                }
            } catch (_) {}

            return {
                task: 'navigation',
                overall: defaultOverall,
                tasks: defaultTasks,
                state: 'IDLE',
                t0: null,
                limit_s: 2100,
                hold_s: 0,
                hold_t: null,
                stepIndex: 0,
                stepStartTime: null,
                steps: {}
            };
        }

        getActiveTaskState() {
            if (!this.state.tasks) {
                this.state.tasks = {};
            }
            const k = this.state.task || 'navigation';
            if (!this.state.tasks[k]) {
                this.state.tasks[k] = createDefaultTaskState(k);
            }
            return this.state.tasks[k];
        }

        getTaskState(taskKey) {
            if (!this.state.tasks) return null;
            const k = (typeof window !== 'undefined' && window.OrionTimelineStore)
                ? window.OrionTimelineStore.normalizeKey(taskKey)
                : taskKey;
            return this.state.tasks[k] || null;
        }

        syncActiveProperties() {
            const active = this.getActiveTaskState();
            this.state.state = active.state;
            this.state.t0 = active.t0;
            this.state.limit_s = active.limit_s;
            this.state.hold_s = active.hold_s;
            this.state.hold_t = active.hold_t;
            this.state.stepIndex = active.stepIndex;
            this.state.stepStartTime = active.stepStartTime;
            this.state.steps = active.steps;
        }

        saveState() {
            this.syncActiveProperties();
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
            this.syncActiveProperties();
            this.listeners.forEach(cb => {
                try { cb(this.state); } catch (_) {}
            });
        }

        getTemplate(taskKey) {
            const k = taskKey || this.state.task || 'navigation';
            if (typeof window !== 'undefined' && window.OrionTimelineStore) {
                return window.OrionTimelineStore.getPlan(k);
            }
            return TASK_TEMPLATES[k] || TASK_TEMPLATES.navigation;
        }

        getCurrentStep(taskKey) {
            const k = taskKey || this.state.task;
            const tpl = this.getTemplate(k);
            const t = this.getTaskState(k);
            const idx = t ? t.stepIndex : 0;
            return tpl.steps[idx] || null;
        }

        getNextStep(taskKey) {
            const k = taskKey || this.state.task;
            const tpl = this.getTemplate(k);
            const t = this.getTaskState(k);
            const idx = t ? t.stepIndex : 0;
            return tpl.steps[idx + 1] || null;
        }

        getTaskMETMilliseconds(taskKey) {
            const k = taskKey || this.state.task || 'navigation';
            const t = (this.state.tasks && this.state.tasks[k]) ? this.state.tasks[k] : this.getActiveTaskState();
            if (!t || t.state === 'IDLE' || !t.t0) {
                return 0;
            }
            const limitMs = (t.limit_s || 2100) * 1000;
            if (t.state === 'HELD' || t.state === 'STOPPED') {
                const pauseMs = (t.hold_t ? t.hold_t : Date.now()) - t.t0 - (t.hold_s * 1000);
                return Math.max(0, Math.min(limitMs, pauseMs));
            }
            const now = Date.now();
            const elapsedMs = (now - t.t0) - (t.hold_s * 1000);
            return Math.max(0, Math.min(limitMs, elapsedMs));
        }

        getMETMilliseconds(taskKey) {
            return this.getTaskMETMilliseconds(taskKey);
        }

        getOverallMETMilliseconds() {
            const ov = this.state.overall;
            if (!ov || ov.state === 'IDLE' || !ov.t0) {
                return 0;
            }
            if (ov.state === 'HELD' || ov.state === 'STOPPED') {
                const pauseMs = (ov.hold_t ? ov.hold_t : Date.now()) - ov.t0 - (ov.hold_s * 1000);
                return Math.max(0, pauseMs);
            }
            const now = Date.now();
            const elapsedMs = (now - ov.t0) - (ov.hold_s * 1000);
            return Math.max(0, elapsedMs);
        }

        getRemainingSeconds(taskKey) {
            const k = taskKey || this.state.task || 'navigation';
            const t = (this.state.tasks && this.state.tasks[k]) ? this.state.tasks[k] : this.getActiveTaskState();
            if (!t || t.state === 'IDLE' || !t.t0) {
                return t ? t.limit_s : 2100;
            }
            const elapsed = Math.floor(this.getTaskMETMilliseconds(k) / 1000);
            return Math.max(0, t.limit_s - elapsed);
        }

        getElapsedSeconds(taskKey) {
            const k = taskKey || this.state.task || 'navigation';
            return Math.floor(this.getTaskMETMilliseconds(k) / 1000);
        }

        getBudgetUsedPercent(taskKey) {
            const k = taskKey || this.state.task || 'navigation';
            const t = (this.state.tasks && this.state.tasks[k]) ? this.state.tasks[k] : this.getActiveTaskState();
            if (!t || !t.limit_s || t.limit_s <= 0) return 0;
            return Math.min(100, Math.max(0, (this.getElapsedSeconds(k) / t.limit_s) * 100));
        }

        getActiveTaskLimitSeconds() {
            const t = this.getActiveTaskState();
            return t ? t.limit_s : 2100;
        }

        syncTimeConductorForActiveTask(openmct) {
            const om = openmct || (typeof window !== 'undefined' ? window.openmct : null);
            if (!om || !om.time) return;

            const t = this.getActiveTaskState();
            const limitMs = (t.limit_s || 2100) * 1000;
            const bounds = { start: 0, end: limitMs };

            try {
                const currentSys = om.time.getTimeSystem();
                // Only touch conductor bounds and mode if conductor is actively in MET system
                if (currentSys && currentSys.key === 'met') {
                    if (t.state === 'RUNNING') {
                        if (typeof om.time.setClock === 'function') {
                            om.time.setClock('met-clock', bounds);
                        }
                        if (typeof om.time.setMode === 'function') {
                            om.time.setMode('realtime', bounds);
                        }
                        om.time.setBounds(bounds);
                    } else {
                        om.time.setBounds(bounds);
                        if (typeof om.time.setMode === 'function') {
                            om.time.setMode('fixed', bounds);
                        }
                    }
                } else if (currentSys && currentSys.key === 'utc') {
                    // On UTC, do NOT force conductor to MET. Update plan body so it reflects state
                    this.syncPlansForTimeSystem(om, 'utc');
                }
            } catch (_) {}

            const met = this.getMETMilliseconds();
            if (metClockInstance) {
                metClockInstance.tick(met);
            }
            updateMETNowMarkers(met);
        }

        lockTimelineBounds(openmct) {
            this.syncTimeConductorForActiveTask(openmct);
        }

        switchToTaskMET(openmct, taskKey) {
            const om = openmct || (typeof window !== 'undefined' ? window.openmct : null);
            if (taskKey) {
                this.setTask(taskKey, om);
            }
            if (!om || !om.time) return;

            const t = this.getActiveTaskState();
            const limitMs = (t.limit_s || 2100) * 1000;
            const bounds = { start: 0, end: limitMs };

            try {
                const currentSys = om.time.getTimeSystem();
                if (!currentSys || currentSys.key !== 'met') {
                    om.time.setTimeSystem('met');
                }
                if (t.state === 'RUNNING') {
                    if (typeof om.time.setClock === 'function') {
                        om.time.setClock('met-clock', bounds);
                    }
                    if (typeof om.time.setMode === 'function') {
                        om.time.setMode('realtime', bounds);
                    }
                } else {
                    if (typeof om.time.setMode === 'function') {
                        om.time.setMode('fixed', bounds);
                    }
                }
                om.time.setBounds(bounds);
            } catch (_) {}

            this.syncPlansForTimeSystem(om, 'met');
            const met = this.getMETMilliseconds();
            if (metClockInstance) {
                metClockInstance.tick(met);
            }
            updateMETNowMarkers(met);
        }

        switchToMainUTC(openmct) {
            const om = openmct || (typeof window !== 'undefined' ? window.openmct : null);
            if (!om || !om.time) return;
            try {
                const currentSys = om.time.getTimeSystem();
                if (!currentSys || currentSys.key !== 'utc') {
                    om.time.setTimeSystem('utc');
                }
                if (typeof om.time.setClock === 'function') {
                    om.time.setClock('local', {
                        start: -30 * 60 * 1000,
                        end: 30 * 1000
                    });
                }
                if (typeof om.time.setMode === 'function') {
                    om.time.setMode('realtime', {
                        start: -30 * 60 * 1000,
                        end: 30 * 1000
                    });
                }
            } catch (_) {}
            this.syncPlansForTimeSystem(om, 'utc');
        }

        async syncPlansForTimeSystem(openmct, timeSystemKey) {
            const om = openmct || (typeof window !== 'undefined' ? window.openmct : null);
            if (!om || !om.objects) return;
            const mapping = {
                navigation: 'plan_nav',
                science: 'plan_science',
                maintenance: 'plan_maintenance',
                probing: 'plan_probing'
            };
            for (const [taskKey, objKey] of Object.entries(mapping)) {
                try {
                    const identifier = { namespace: 'orion.taxonomy', key: objKey };
                    const domainObj = await om.objects.get(identifier);
                    if (domainObj && typeof window !== 'undefined' && window.generateOpenMctPlanBody) {
                        const newBody = window.generateOpenMctPlanBody(taskKey, timeSystemKey);
                        om.objects.mutate(domainObj, 'selectFile.body', newBody);
                    }
                } catch (_) {}
            }
        }

        tick() {
            const active = this.getActiveTaskState();
            const overall = this.state.overall;
            const isAnyRunning = (active && active.state === 'RUNNING') || (overall && overall.state === 'RUNNING');
            if (isAnyRunning) {
                this.notify();
            }
        }

        setTask(taskKey, openmct) {
            const normKey = (typeof window !== 'undefined' && window.OrionTimelineStore)
                ? window.OrionTimelineStore.normalizeKey(taskKey)
                : taskKey;

            this.state.task = normKey;
            const t = this.getActiveTaskState();
            const tpl = this.getTemplate(normKey);
            if (!t.limit_s) {
                t.limit_s = tpl.defaultDurationS || 2100;
            }
            this.syncActiveProperties();
            this.saveState();

            this.lockTimelineBounds(openmct);
            updateMETNowMarkers(this.getMETMilliseconds());
        }

        setJudgeLimitSeconds(seconds, taskKey) {
            const t = taskKey ? this.getTaskState(taskKey) : this.getActiveTaskState();
            if (t) {
                t.limit_s = Math.max(60, parseInt(seconds, 10) || 2100);
            }
            this.syncActiveProperties();
            this.saveState();
        }

        start(openmct, taskKey) {
            const now = Date.now();
            if (taskKey) {
                this.state.task = taskKey;
            }
            const t = this.getActiveTaskState();
            t.state = 'RUNNING';
            t.t0 = now;
            t.hold_s = 0;
            t.hold_t = null;
            t.stepIndex = 0;
            t.stepStartTime = now;
            t.steps = {};

            const tpl = this.getTemplate(this.state.task);
            tpl.steps.forEach((s, idx) => {
                t.steps[s.id] = {
                    state: idx === 0 ? 'active' : 'pending',
                    startTime: idx === 0 ? now : null,
                    endTime: null
                };
            });

            // Start Overall Mission MET on first start
            if (!this.state.overall || this.state.overall.state === 'IDLE' || !this.state.overall.t0) {
                this.state.overall = {
                    state: 'RUNNING',
                    t0: now,
                    hold_s: 0,
                    hold_t: null
                };
            } else if (this.state.overall.state === 'HELD' || this.state.overall.state === 'STOPPED') {
                if (this.state.overall.hold_t) {
                    this.state.overall.hold_s += Math.floor((now - this.state.overall.hold_t) / 1000);
                    this.state.overall.hold_t = null;
                }
                this.state.overall.state = 'RUNNING';
            }

            this.syncActiveProperties();
            this.saveState();

            // Lock Open MCT Time Conductor bounds to [0, limit_s * 1000] - Always starting at first activity block!
            this.lockTimelineBounds(openmct);

            if (metClockInstance) {
                metClockInstance.tick(0);
            }
            updateMETNowMarkers(0);
        }

        hold(taskKey) {
            const k = taskKey || this.state.task;
            const t = this.getTaskState(k);
            if (!t || t.state !== 'RUNNING') return;
            t.state = 'HELD';
            t.hold_t = Date.now();
            this.syncActiveProperties();
            this.saveState();

            this.syncTimeConductorForActiveTask();
        }

        resume(taskKey) {
            const k = taskKey || this.state.task;
            const t = this.getTaskState(k);
            if (!t || t.state !== 'HELD') return;
            const now = Date.now();
            const pauseDuration = Math.floor((now - t.hold_t) / 1000);
            t.hold_s += pauseDuration;
            t.hold_t = null;
            t.state = 'RUNNING';

            if (this.state.overall && this.state.overall.state === 'HELD' && this.state.overall.hold_t) {
                this.state.overall.hold_s += Math.floor((now - this.state.overall.hold_t) / 1000);
                this.state.overall.hold_t = null;
                this.state.overall.state = 'RUNNING';
            }

            this.syncActiveProperties();
            this.saveState();

            this.syncTimeConductorForActiveTask();
        }

        stop(taskKey) {
            const k = taskKey || this.state.task;
            const t = this.getTaskState(k);
            if (!t) return;
            t.state = 'STOPPED';
            t.hold_t = Date.now();
            this.syncActiveProperties();
            this.saveState();

            this.syncTimeConductorForActiveTask();
        }

        reset(openmct, taskKey) {
            const targetKey = taskKey || this.state.task;
            const t = this.getTaskState(targetKey) || this.getActiveTaskState();
            if (t) {
                t.state = 'IDLE';
                t.t0 = null;
                t.hold_s = 0;
                t.hold_t = null;
                t.stepIndex = 0;
                t.stepStartTime = null;
                t.steps = {};
            }
            this.syncActiveProperties();
            this.saveState();

            this.syncTimeConductorForActiveTask(openmct);
        }

        resetOverall() {
            this.state.overall = {
                state: 'IDLE',
                t0: null,
                hold_s: 0,
                hold_t: null
            };
            this.saveState();
        }

        markStepDone(taskKey) {
            const k = taskKey || this.state.task;
            const t = this.getTaskState(k);
            if (!t) return;
            const tpl = this.getTemplate(k);
            const current = tpl.steps[t.stepIndex];
            if (!current) return;

            const now = Date.now();
            if (!t.steps[current.id]) t.steps[current.id] = {};
            t.steps[current.id].state = 'done';
            t.steps[current.id].endTime = now;

            if (t.stepIndex + 1 < tpl.steps.length) {
                t.stepIndex++;
                const next = tpl.steps[t.stepIndex];
                t.stepStartTime = now;
                if (!t.steps[next.id]) t.steps[next.id] = {};
                t.steps[next.id].state = 'active';
                t.steps[next.id].startTime = now;
            } else {
                t.state = 'STOPPED';
                t.hold_t = now;
            }

            this.syncActiveProperties();
            this.saveState();
        }

        skipStep(taskKey) {
            const k = taskKey || this.state.task;
            const t = this.getTaskState(k);
            if (!t) return;
            const tpl = this.getTemplate(k);
            const current = tpl.steps[t.stepIndex];
            if (!current) return;

            const now = Date.now();
            if (!t.steps[current.id]) t.steps[current.id] = {};
            t.steps[current.id].state = 'skipped';
            t.steps[current.id].endTime = now;

            if (t.stepIndex + 1 < tpl.steps.length) {
                t.stepIndex++;
                const next = tpl.steps[t.stepIndex];
                t.stepStartTime = now;
                if (!t.steps[next.id]) t.steps[next.id] = {};
                t.steps[next.id].state = 'active';
                t.steps[next.id].startTime = now;
            }

            this.syncActiveProperties();
            this.saveState();
        }
    }

    function updateMETNowMarkers(metMs) {
        if (typeof document === 'undefined') return;
        const axes = document.querySelectorAll('.c-timesystem-axis');
        if (!axes || axes.length === 0) return;

        let boundsStart = 0;
        let boundsEnd = 2100 * 1000;
        if (typeof window !== 'undefined' && window.openmct && window.openmct.time) {
            try {
                const b = window.openmct.time.getBounds();
                if (b && typeof b.start === 'number' && typeof b.end === 'number') {
                    boundsStart = b.start;
                    boundsEnd = b.end;
                }
            } catch (_) {}
        }
        const span = boundsEnd - boundsStart;
        if (span <= 0) return;

        const currentVal = (typeof metMs === 'number') ? metMs : (typeof taskManager !== 'undefined' ? taskManager.getMETMilliseconds() : 0);
        const clamped = Math.max(boundsStart, Math.min(boundsEnd, currentVal));
        const fraction = (clamped - boundsStart) / span;

        axes.forEach(axisHolder => {
            const marker = axisHolder.querySelector('.nowMarker');
            if (!marker) return;
            const width = axisHolder.clientWidth;
            if (!width || width <= 4) return;
            const leftPx = 1 + fraction * (width - 2);
            marker.style.left = `${leftPx}px`;
            marker.classList.remove('hidden');
        });
    }

    class METFormat {
        constructor() {
            this.key = 'met-format';
        }

        format(value) {
            if (value === undefined || value === null || isNaN(value)) {
                return '+00:00:00';
            }
            const isNegative = value < 0;
            const absSec = Math.floor(Math.abs(value) / 1000);
            const hours = Math.floor(absSec / 3600);
            const minutes = Math.floor((absSec % 3600) / 60);
            const seconds = absSec % 60;
            const sign = isNegative ? '-' : '+';
            const hh = String(hours).padStart(2, '0');
            const mm = String(minutes).padStart(2, '0');
            const ss = String(seconds).padStart(2, '0');
            return `${sign}${hh}:${mm}:${ss}`;
        }

        parse(text) {
            if (typeof text === 'number') return text;
            if (!text || typeof text !== 'string') return 0;
            const clean = text.trim();
            const sign = clean.startsWith('-') ? -1 : 1;
            const stripped = clean.replace(/^[+-]/, '').replace(/^MET\s*/i, '').replace(/^T[+-]/i, '');
            const parts = stripped.split(':').map(Number);
            let sec = 0;
            if (parts.length === 3) {
                sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
            } else if (parts.length === 2) {
                sec = parts[0] * 60 + parts[1];
            } else if (parts.length === 1) {
                sec = parts[0];
            }
            return sign * sec * 1000;
        }

        validate(text) {
            if (typeof text === 'number') return true;
            if (!text || typeof text !== 'string') return false;
            return /^[+-]?(MET\s*)?(T[+-])?\d{1,2}:\d{2}(:\d{2})?$/i.test(text.trim());
        }
    }

    function METTimeSystem() {
        this.key = 'met';
        this.name = 'MET';
        this.cssClass = 'icon-clock';
        this.timeFormat = 'met-format';
        this.durationFormat = 'duration';
        this.isUTCBased = false;
    }

    class OrionMETClock {
        constructor(manager) {
            this.key = 'met-clock';
            this.name = 'MET Mission Clock';
            this.description = 'Mission Elapsed Time Clock controlled by Orion Task Manager';
            this.cssClass = 'icon-clock';
            this.manager = manager;
            this.listeners = {};
            this.lastTick = 0;
            this.timer = null;
        }

        currentValue() {
            if (!this.manager) return 0;
            return this.manager.getMETMilliseconds();
        }

        tick(val) {
            const v = (typeof val === 'number') ? val : this.currentValue();
            this.lastTick = v;
            const cbs = this.listeners['tick'] || [];
            cbs.forEach(cb => {
                try { cb(v); } catch (e) { console.warn(e); }
            });
            updateMETNowMarkers(v);
        }

        on(event, cb) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(cb);
            if (event === 'tick' && this.listeners[event].length === 1) {
                this.start();
            }
            return () => this.off(event, cb);
        }

        off(event, cb) {
            if (!this.listeners[event]) return;
            this.listeners[event] = this.listeners[event].filter(l => l !== cb);
            if (event === 'tick' && this.listeners[event].length === 0) {
                this.stop();
            }
        }

        start() {
            if (this.timer) clearInterval(this.timer);
            this.timer = setInterval(() => {
                // Strict Immobility: ONLY emit ticks while actively RUNNING!
                const active = this.manager ? this.manager.getActiveTaskState() : null;
                if (active && active.state === 'RUNNING') {
                    const met = this.manager.getMETMilliseconds();
                    this.tick(met);
                }
            }, 100);
        }

        stop() {
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
        }
    }

    const taskManager = new TaskClockManager();
    const metClockInstance = new OrionMETClock(taskManager);

    function formatTimeRemaining(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function formatMET(ms) {
        if (!ms || isNaN(ms) || ms < 0) return '+00:00:00';
        const s = Math.floor(ms / 1000);
        const hh = String(Math.floor(s / 3600)).padStart(2, '0');
        const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        return `+${hh}:${mm}:${ss}`;
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
                    <option value="science">🔬 SCIENCE (~40M)</option>
                    <option value="navigation">🧭 NAVIGATION (~35M)</option>
                    <option value="maintenance">🔧 MAINTENANCE (~30M)</option>
                    <option value="probing">🎯 PROBING (~32M)</option>
                </select>
                <span id="orion-task-state-badge" style="background: #27272a; border: 1px solid #3f3f46; color: #a1a1aa; padding: 2px 6px; border-radius: 0px; font-weight: 700; font-size: 10px; font-family: monospace;">IDLE</span>
            </div>

            <!-- Middle-Left: Overall MISSION MET & TASK MET -->
            <div style="display: flex; align-items: center; gap: 12px;">
                <!-- Overall Mission MET -->
                <div style="display: flex; flex-direction: column; align-items: flex-start; background: #0c1a2e; border: 1px solid #1e3a8a; padding: 2px 8px; border-radius: 2px;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span style="font-size: 8px; font-weight: 700; color: #60a5fa; text-transform: uppercase; letter-spacing: 0.5px;">OVERALL MISSION MET:</span>
                        <span id="orion-mission-met-badge" style="font-size: 8px; background: #1e3a8a; color: #93c5fd; padding: 0 3px; font-weight: 700; font-family: monospace;">STANDBY</span>
                    </div>
                    <span id="orion-mission-met-clock" style="font-size: 14px; font-weight: 800; font-family: monospace; color: #38bdf8; letter-spacing: 1px;">+00:00:00</span>
                </div>

                <!-- Active Task MET -->
                <div style="display: flex; flex-direction: column; align-items: flex-start; background: #142e1a; border: 1px solid #166534; padding: 2px 8px; border-radius: 2px;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span style="font-size: 8px; font-weight: 700; color: #86efac; text-transform: uppercase; letter-spacing: 0.5px;">TASK MET:</span>
                        <span id="orion-task-met-badge" style="font-size: 8px; background: #166534; color: #bbf7d0; padding: 0 3px; font-weight: 700; font-family: monospace;">IDLE</span>
                    </div>
                    <span id="orion-task-met-clock" style="font-size: 14px; font-weight: 800; font-family: monospace; color: #4ade80; letter-spacing: 1px;">+00:00:00</span>
                </div>
            </div>

            <!-- Middle-Center: Large Judge Countdown Clock & Budget Bar -->
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <div style="display: flex; align-items: baseline; gap: 4px;">
                        <span style="font-size: 9px; color: #64748b; font-weight: 600;">JUDGE TIME:</span>
                        <span id="orion-judge-countdown" style="font-size: 16px; font-weight: 800; font-family: monospace; color: #22c55e; letter-spacing: 1px;">35:00</span>
                    </div>
                </div>
                <div style="width: 70px; height: 6px; background: #1c1c1c; border-radius: 0px; overflow: hidden; border: 1px solid #2e2e2e;">
                    <div id="orion-budget-progress" style="width: 0%; height: 100%; background: #38bdf8; transition: width 0.3s; border-radius: 0px;"></div>
                </div>
                <span id="orion-budget-pct" style="font-family: monospace; font-size: 10px; color: #94a3b8;">0%</span>
            </div>

            <!-- Middle-Right: Active Step & Next Step -->
            <div style="display: flex; align-items: center; gap: 10px; max-width: 320px;">
                <div style="display: flex; align-items: center; gap: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <span style="background: #2563eb; color: #ffffff; padding: 1px 4px; border-radius: 0px; font-weight: 800; font-size: 8px;">NOW</span>
                    <span id="orion-step-now" style="font-weight: 700; color: #e2e8f0; max-width: 140px; overflow: hidden; text-overflow: ellipsis;">--</span>
                </div>
                <div style="display: flex; align-items: center; gap: 5px; opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <span style="background: #27272a; border: 1px solid #3f3f46; color: #cbd5e1; padding: 1px 4px; border-radius: 0px; font-weight: 700; font-size: 8px;">NEXT</span>
                    <span id="orion-step-next" style="color: #94a3b8; max-width: 120px; overflow: hidden; text-overflow: ellipsis;">--</span>
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
                <button id="btn-task-reset" style="background: #3f1a1a; color: #fca5a5; border: 1px solid #7f1d1d; padding: 3px 6px; border-radius: 0px; font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase;">↺ RESET</button>
                <button id="btn-task-edit" style="background: #1e293b; color: #38bdf8; border: 1px solid #38bdf8; padding: 3px 8px; border-radius: 0px; font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase;">⚙ EDIT</button>
            </div>
        `;

        // Mount at top of document body, before Open MCT shell
        document.body.prepend(banner);

        // Bind Controls
        const select = document.getElementById('orion-task-select');
        const stateBadge = document.getElementById('orion-task-state-badge');
        const missionMetClock = document.getElementById('orion-mission-met-clock');
        const missionMetBadge = document.getElementById('orion-mission-met-badge');
        const taskMetClock = document.getElementById('orion-task-met-clock');
        const taskMetBadge = document.getElementById('orion-task-met-badge');
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
        const btnReset = document.getElementById('btn-task-reset');
        const btnEdit = document.getElementById('btn-task-edit');

        if (btnReset) {
            btnReset.addEventListener('click', () => {
                taskManager.reset(openmct);
                if (openmct && openmct.notifications) {
                    openmct.notifications.alert('Task reset to IDLE standby (00:00:00).');
                }
            });
        }

        if (btnEdit) {
            btnEdit.addEventListener('click', () => {
                if (typeof window.openOrionTimelineEditor === 'function') {
                    window.openOrionTimelineEditor(taskManager.state.task);
                }
            });
        }

        select.addEventListener('change', (e) => {
            taskManager.setTask(e.target.value, openmct);
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
            if (select.value !== state.task) {
                select.value = state.task;
            }

            const activeTask = taskManager.getActiveTaskState();
            const taskRunning = activeTask.state === 'RUNNING';
            const taskHeld = activeTask.state === 'HELD';
            const taskStopped = activeTask.state === 'STOPPED';

            select.disabled = taskRunning || taskHeld;

            // Overall Mission MET
            const overallMs = taskManager.getOverallMETMilliseconds();
            if (missionMetClock) {
                missionMetClock.textContent = formatMET(overallMs);
            }
            if (missionMetBadge) {
                const ovState = state.overall ? state.overall.state : 'IDLE';
                missionMetBadge.textContent = ovState;
                missionMetBadge.style.background = ovState === 'RUNNING' ? '#166534' : (ovState === 'HELD' ? '#854d0e' : '#1e3a8a');
                missionMetBadge.style.color = ovState === 'RUNNING' ? '#86efac' : (ovState === 'HELD' ? '#fde68a' : '#93c5fd');
            }

            // Task MET
            const taskMs = taskManager.getMETMilliseconds();
            if (taskMetClock) {
                taskMetClock.textContent = formatMET(taskMs);
            }
            if (taskMetBadge) {
                taskMetBadge.textContent = activeTask.state;
                taskMetBadge.style.background = taskRunning ? '#166534' : (taskHeld ? '#854d0e' : (taskStopped ? '#7f1d1d' : '#27272a'));
                taskMetBadge.style.color = taskRunning ? '#86efac' : (taskHeld ? '#fde68a' : (taskStopped ? '#fca5a5' : '#a1a1aa'));
            }

            const remaining = taskManager.getRemainingSeconds();
            countdown.textContent = formatTimeRemaining(remaining);

            // Color coding for urgency: yellow at <=25%, red at <=10%
            const pctLeft = activeTask.limit_s > 0 ? (remaining / activeTask.limit_s) : 1;
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

            stateBadge.textContent = activeTask.state;
            if (taskRunning) {
                stateBadge.style.background = '#16a34a';
                stateBadge.style.color = '#ffffff';
                btnStart.style.display = 'none';
                btnHold.style.display = 'inline-block';
                btnResume.style.display = 'none';
            } else if (taskHeld) {
                stateBadge.style.background = '#d97706';
                stateBadge.style.color = '#ffffff';
                btnStart.style.display = 'none';
                btnHold.style.display = 'none';
                btnResume.style.display = 'inline-block';
            } else if (taskStopped) {
                stateBadge.style.background = '#7f1d1d';
                stateBadge.style.color = '#fca5a5';
                btnStart.style.display = 'inline-block';
                btnHold.style.display = 'none';
                btnResume.style.display = 'none';
            } else {
                stateBadge.style.background = '#3e3e42';
                stateBadge.style.color = '#cbd5e1';
                btnStart.style.display = 'inline-block';
                btnHold.style.display = 'none';
                btnResume.style.display = 'none';
            }

            const curr = taskManager.getCurrentStep();
            const next = taskManager.getNextStep();
            if (activeTask.state === 'IDLE') {
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
                                <span id="tb-time-mission-met" style="font-family: monospace; font-size: 10px; color: #60a5fa; font-weight: 700; background: #0c1a2e; border: 1px solid #1e3a8a; padding: 1px 5px;">MISSION: +00:00:00</span>
                                <span id="tb-time-met" style="font-family: monospace; font-size: 11px; color: #4ade80; font-weight: 700; background: #142e1a; border: 1px solid #166534; padding: 1px 5px;">TASK MET T+00:00</span>
                                <span id="tb-time-rem" style="font-family: monospace; font-size: 10px; color: #94a3b8;">REM: --:--</span>
                            </div>

                            <!-- Middle: Active Milestone Indicator -->
                            <div style="display: flex; align-items: center; gap: 8px; max-width: 320px; overflow: hidden;">
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
                                <button id="tb-btn-reset" style="background: #3f1a1a; color: #fca5a5; border: 1px solid #7f1d1d; padding: 3px 8px; font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase;">↺ RESET</button>
                                
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
                        const missionMetEl = toolbar.querySelector('#tb-time-mission-met');
                        const met = toolbar.querySelector('#tb-time-met');
                        const rem = toolbar.querySelector('#tb-time-rem');
                        const stepName = toolbar.querySelector('#tb-step-name');

                        const btnStart = toolbar.querySelector('#tb-btn-start');
                        const btnHold = toolbar.querySelector('#tb-btn-hold');
                        const btnResume = toolbar.querySelector('#tb-btn-resume');
                        const btnDone = toolbar.querySelector('#tb-btn-done');
                        const btnSkip = toolbar.querySelector('#tb-btn-skip');
                        const btnStop = toolbar.querySelector('#tb-btn-stop');
                        const btnReset = toolbar.querySelector('#tb-btn-reset');
                        const selectTask = toolbar.querySelector('#tb-task-select');
                        const btnEdit = toolbar.querySelector('#tb-btn-edit');

                        const activeTaskKey = currentTask;
                        selectTask.value = currentTask;

                        selectTask.addEventListener('change', (e) => {
                            taskManager.setTask(e.target.value, openmct);
                            const targetKey = `plan_${e.target.value === 'navigation' ? 'nav' : e.target.value}`;
                            if (window.location.hash.includes('plan_')) {
                                window.location.hash = `#/browse/orion.taxonomy:${targetKey}`;
                            }
                        });

                        btnStart.addEventListener('click', () => {
                            const taskToStart = selectTask.value || activeTaskKey;
                            taskManager.start(openmct, taskToStart);
                            if (openmct && openmct.notifications) {
                                openmct.notifications.info(`Mission Timeline Started: ${taskManager.getTemplate(taskToStart).name}`);
                            }
                        });

                        btnHold.addEventListener('click', () => {
                            const taskToHold = selectTask.value || activeTaskKey;
                            taskManager.hold(taskToHold);
                            if (openmct && openmct.notifications) {
                                openmct.notifications.alert('Timeline paused on judge HOLD.');
                            }
                        });

                        btnResume.addEventListener('click', () => {
                            const taskToResume = selectTask.value || activeTaskKey;
                            taskManager.resume(taskToResume);
                            if (openmct && openmct.notifications) {
                                openmct.notifications.info('Timeline resumed.');
                            }
                        });

                        btnDone.addEventListener('click', () => {
                            const taskToDone = selectTask.value || activeTaskKey;
                            const curr = taskManager.getCurrentStep(taskToDone);
                            taskManager.markStepDone(taskToDone);
                            if (curr && openmct && openmct.notifications) {
                                openmct.notifications.info(`Step completed: ${curr.name}`);
                            }
                        });

                        btnSkip.addEventListener('click', () => {
                            const taskToSkip = selectTask.value || activeTaskKey;
                            const curr = taskManager.getCurrentStep(taskToSkip);
                            taskManager.skipStep(taskToSkip);
                            if (curr && openmct && openmct.notifications) {
                                openmct.notifications.info(`Step skipped: ${curr.name}`);
                            }
                        });

                        btnStop.addEventListener('click', () => {
                            const taskToStop = selectTask.value || activeTaskKey;
                            taskManager.stop(taskToStop);
                            if (openmct && openmct.notifications) {
                                openmct.notifications.alert('Mission timeline stopped.');
                            }
                        });

                        if (btnReset) {
                            btnReset.addEventListener('click', () => {
                                const taskToReset = selectTask.value || activeTaskKey;
                                taskManager.reset(openmct, taskToReset);
                                if (openmct && openmct.notifications) {
                                    openmct.notifications.alert('Timeline reset to IDLE standby (00:00:00).');
                                }
                            });
                        }

                        btnEdit.addEventListener('click', () => {
                            if (typeof window.openOrionTimelineEditor === 'function') {
                                window.openOrionTimelineEditor(selectTask.value || activeTaskKey);
                            }
                        });

                        function updateToolbar(state) {
                            const targetTaskKey = selectTask.value || activeTaskKey;
                            const taskState = taskManager.getTaskState(targetTaskKey) || taskManager.getActiveTaskState();
                            const isRunning = taskState.state === 'RUNNING';
                            const isHeld = taskState.state === 'HELD';
                            const isStopped = taskState.state === 'STOPPED';

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

                            // Overall Mission MET
                            const overallMs = taskManager.getOverallMETMilliseconds();
                            if (missionMetEl) {
                                missionMetEl.textContent = `MISSION: ${formatMET(overallMs)}`;
                            }

                            // Task MET & Remaining
                            if (isRunning || isHeld || isStopped) {
                                const taskMetMs = taskManager.getTaskMETMilliseconds(targetTaskKey);
                                const remS = taskManager.getRemainingSeconds(targetTaskKey);
                                const elM = Math.floor(taskMetMs / 60000);
                                const elS = Math.floor((taskMetMs % 60000) / 1000);
                                met.textContent = `TASK MET T+${String(elM).padStart(2, '0')}:${String(elS).padStart(2, '0')}`;
                                rem.textContent = `REM: ${formatTimeRemaining(remS)}`;
                            } else {
                                met.textContent = 'TASK MET T+00:00';
                                rem.textContent = `REM: ${formatTimeRemaining(taskState.limit_s || 2100)}`;
                            }

                            const curr = taskManager.getCurrentStep(targetTaskKey);
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
            // Register MET format, time system and clock into Open MCT
            try {
                openmct.telemetry.addFormat(new METFormat());
            } catch (_) {}
            try {
                openmct.time.addTimeSystem(new METTimeSystem());
            } catch (_) {}
            try {
                openmct.time.addClock(metClockInstance);
            } catch (_) {}

            // Strict Timeline Rule:
            // Timelines must ALWAYS begin at the beginning of the first activity block (start: 0)
            try {
                if (openmct.time && typeof openmct.time.tick === 'function') {
                    const originalTimeTick = openmct.time.tick.bind(openmct.time);
                    openmct.time.tick = function (timestamp) {
                        const currentSys = openmct.time.getTimeSystem();
                        if (currentSys && currentSys.key === 'met') {
                            const active = taskManager ? taskManager.getActiveTaskState() : null;
                            const limitMs = (taskManager ? taskManager.getActiveTaskLimitSeconds() : 2100) * 1000;
                            const fixedBounds = { start: 0, end: limitMs };
                            if (!active || active.state !== 'RUNNING') {
                                try {
                                    openmct.time.bounds(fixedBounds);
                                } catch (_) {}
                                return;
                            }
                            try {
                                openmct.time.bounds(fixedBounds);
                            } catch (_) {}
                            return;
                        }
                        return originalTimeTick(timestamp);
                    };
                }
            } catch (_) {}

            // Automatic time system routing:
            // All graphs, displays, tables, logs, and operating mode tabs run on UTC Real Time Clock.
            // Only dedicated task plan views run on MET.
            const handleRoute = () => {
                const hash = window.location.hash || '';
                let targetTask = null;

                // Match only dedicated task plan objects (not display layouts like disp_nav or disp_science!)
                if (hash.includes(':plan_sci') || hash.endsWith('plan_science')) {
                    targetTask = 'science';
                } else if (hash.includes(':plan_maint') || hash.endsWith('plan_maintenance')) {
                    targetTask = 'maintenance';
                } else if (hash.includes(':plan_prob') || hash.endsWith('plan_probing')) {
                    targetTask = 'probing';
                } else if (hash.includes(':plan_nav') || hash.endsWith('plan_nav')) {
                    targetTask = 'navigation';
                }

                if (targetTask && taskManager) {
                    taskManager.switchToTaskMET(openmct, targetTask);
                } else if (taskManager) {
                    // All displays, operating mode tabs, master timeline, graphs, tables, and logs:
                    taskManager.switchToMainUTC(openmct);
                }

                const met = taskManager ? taskManager.getMETMilliseconds() : 0;
                updateMETNowMarkers(met);
            };

            if (openmct.router) {
                openmct.router.on('change:path', handleRoute);
            }
            if (typeof window !== 'undefined') {
                window.addEventListener('hashchange', handleRoute);
            }

            // Sync plan representations if operator toggles Time Conductor system manually
            if (openmct.time) {
                openmct.time.on('timeSystem', (newSys) => {
                    if (newSys && newSys.key === 'met') {
                        taskManager.lockTimelineBounds(openmct);
                        taskManager.syncPlansForTimeSystem(openmct, 'met');
                    } else if (newSys && newSys.key === 'utc') {
                        taskManager.syncPlansForTimeSystem(openmct, 'utc');
                    }
                });
            }

            installTopBanner(openmct);
            installTimelineInteractiveView(openmct);
            installTimelineActions(openmct);

            // Register dedicated Mission Gantt View (MET) for Plan objects
            try {
                openmct.objectViews.addProvider({
                    key: 'orion.gantt.view',
                    name: 'Mission Gantt Chart (MET)',
                    cssClass: 'icon-timeline',
                    priority: function () {
                        return 900;
                    },
                    canView: function (domainObject) {
                        return domainObject.type === 'plan';
                    },
                    view: function (domainObject) {
                        return {
                            show: function (element) {
                                renderGanttView(element, domainObject, openmct);
                            },
                            destroy: function (element) {
                                if (element && typeof element._cleanup === 'function') {
                                    element._cleanup();
                                }
                            }
                        };
                    }
                });
            } catch (_) {}

            // Periodic sync to keep .nowMarker aligned on DOM views
            setInterval(() => {
                const met = taskManager.getMETMilliseconds();
                updateMETNowMarkers(met);
            }, 250);
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
            taskManager.start(openmct, taskKey);
            if (openmct && openmct.notifications) {
                openmct.notifications.info(`Task Started: ${tpl.name}`);
            }
        });

        btnHold.addEventListener('click', () => {
            taskManager.hold(taskKey);
        });

        btnResume.addEventListener('click', () => {
            taskManager.resume(taskKey);
        });

        btnDone.addEventListener('click', () => {
            taskManager.markStepDone(taskKey);
        });

        btnSkip.addEventListener('click', () => {
            taskManager.skipStep(taskKey);
        });

        btnReset.addEventListener('click', () => {
            taskManager.reset(openmct, taskKey);
        });

        function updateGantt() {
            const taskState = taskManager.getTaskState(taskKey) || taskManager.getActiveTaskState();
            const isRunning = taskState.state === 'RUNNING';
            const isHeld = taskState.state === 'HELD';
            const isStopped = taskState.state === 'STOPPED';

            // State Badge & Buttons
            if (isRunning) {
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
            const elapsedS = taskManager.getElapsedSeconds(taskKey);
            const remS = taskManager.getRemainingSeconds(taskKey);
            const elM = Math.floor(elapsedS / 60);
            const elS = elapsedS % 60;

            if (isRunning || isHeld || isStopped) {
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
            const activeStepIdx = taskState.stepIndex;
            const currentStep = taskManager.getCurrentStep(taskKey);

            computedSteps.forEach((step, idx) => {
                const bar = container.querySelector(`#gantt-step-${step.id}`);
                if (!bar) return;

                const stepData = (taskState.steps && taskState.steps[step.id]) || {};
                let status = 'pending';
                if (stepData.state) status = stepData.state;
                else if (idx < activeStepIdx) status = 'done';
                else if (idx === activeStepIdx) status = 'active';

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
        window.OrionMETClock = OrionMETClock;
        window.OrionMETClockInstance = metClockInstance;
        window.METFormat = METFormat;
        window.METTimeSystem = METTimeSystem;
        window.updateMETNowMarkers = updateMETNowMarkers;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionTaskClockPlugin;
    }
})();

