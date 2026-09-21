/**
 * Orion VI Mission Timeline Configurator & In-App Milestone Editor (ERC 2026)
 * 
 * Provides:
 * - Unified Timeline Store (window.OrionTimelineStore)
 * - LocalStorage persistence (orion_custom_timelines)
 * - Interactive in-app Milestone & Activity Editor Modal
 * - Real-time synchronization with Open MCT Plan objects and Time Conductor
 */

(function () {
    const STORAGE_KEY = 'orion_custom_timelines';

    const DEFAULT_TASK_PLANS = {
        navigation: {
            id: 'navigation',
            key: 'navigation',
            name: 'Navigation Traverse Plan',
            defaultDurationS: 2100, // 35 min
            steps: [
                { id: 'nav_arm_gnss_init', name: 'Arm Transit Stow & RTAB-Map Init', durationM: 2, swimlane: 'Safety', color: '#ef4444', goal: 'Stow arm to clear RealSense D435i FOV and initialize SLAM.', passCriteria: 'RTAB-Map status NOMINAL, keyframes > 50.' },
                { id: 'nav_wp1', name: 'Waypoint 1 (Traverse & Tag)', durationM: 5, swimlane: 'Drive', color: '#22c55e', goal: 'Traverse to GNSS Waypoint 1 over sand dunes.', passCriteria: 'Waypoint distance < 1.0m, ArUco tag detected.' },
                { id: 'nav_wp2', name: 'Waypoint 2 (Obstacle Avoidance)', durationM: 5, swimlane: 'Drive', color: '#22c55e', goal: 'NAV2 autonomous path planning around rocky outcrop.', passCriteria: 'Waypoint distance < 1.0m, zero collision events.' },
                { id: 'nav_wp3', name: 'Waypoint 3 (Rocker Compliance Test)', durationM: 5, swimlane: 'Drive', color: '#22c55e', goal: 'Ascend 20-deg slope using Rocker Differencing suspension.', passCriteria: 'Waypoint distance < 1.0m, roll/pitch within +- 25 deg.' },
                { id: 'nav_wp4', name: 'Waypoint 4 (Crater Rim)', durationM: 5, swimlane: 'Drive', color: '#22c55e', goal: 'Traverse along crater rim to northern perimeter.', passCriteria: 'Waypoint distance < 1.0m, ArUco tag logged.' },
                { id: 'nav_wp5', name: 'Waypoint 5 (Final Target)', durationM: 5, swimlane: 'Drive', color: '#22c55e', goal: 'Approach final navigation marker coordinates.', passCriteria: 'Waypoint distance < 1.0m, autonomous stop.' },
                { id: 'nav_recovery_reserve', name: 'Recovery Reserve Window', durationM: 5, swimlane: 'Safety', color: '#f59e0b', goal: 'Reserve time for potential unstuck maneuvers or SLAM re-init.', passCriteria: 'Zero time penalties from judges.' },
                { id: 'nav_slack', name: 'Mission Halt & Parking', durationM: 3, swimlane: 'Safety', color: '#64748b', goal: 'Lock brakes, power down drive motors.', passCriteria: 'Drive disabled, telemetry confirmed.' }
            ]
        },
        science: {
            id: 'science',
            key: 'science',
            name: 'Science Task Plan',
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
        maintenance: {
            id: 'maintenance',
            key: 'maintenance',
            name: 'Maintenance Task Plan',
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
            key: 'probing',
            name: 'Probing Task Plan',
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

    class OrionTimelineStore {
        constructor() {
            this.plans = this.loadPlans();
            this.listeners = new Set();
        }

        normalizeKey(key) {
            if (!key) return 'navigation';
            const k = key.toLowerCase();
            if (k.includes('nav')) return 'navigation';
            if (k.includes('sci')) return 'science';
            if (k.includes('maint')) return 'maintenance';
            if (k.includes('prob')) return 'probing';
            return k;
        }

        loadPlans() {
            const copy = JSON.parse(JSON.stringify(DEFAULT_TASK_PLANS));
            try {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    Object.keys(parsed).forEach(k => {
                        const normKey = this.normalizeKey(k);
                        if (copy[normKey] && parsed[k] && parsed[k].steps) {
                            copy[normKey] = {
                                ...copy[normKey],
                                ...parsed[k],
                                steps: parsed[k].steps
                            };
                        }
                    });
                }
            } catch (e) {
                console.warn('[Timeline Store] Failed to load customized timelines:', e);
            }
            return copy;
        }

        savePlans() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.plans));
            } catch (e) {
                console.warn('[Timeline Store] Failed to save timelines to localStorage:', e);
            }
            this.notify();
        }

        subscribe(cb) {
            this.listeners.add(cb);
            cb(this.plans);
            return () => this.listeners.delete(cb);
        }

        notify() {
            this.listeners.forEach(cb => {
                try { cb(this.plans); } catch (_) {}
            });
        }

        getAllPlans() {
            return this.plans;
        }

        getPlan(taskKey) {
            const k = this.normalizeKey(taskKey);
            return this.plans[k] || this.plans.navigation;
        }

        updatePlan(taskKey, updatedPlan) {
            const k = this.normalizeKey(taskKey);
            const totalMin = updatedPlan.steps.reduce((sum, s) => sum + (parseFloat(s.durationM) || 0), 0);
            this.plans[k] = {
                ...this.plans[k],
                ...updatedPlan,
                defaultDurationS: Math.round(totalMin * 60),
                steps: updatedPlan.steps
            };
            this.savePlans();
        }

        resetToDefaults(taskKey) {
            const k = this.normalizeKey(taskKey);
            if (DEFAULT_TASK_PLANS[k]) {
                this.plans[k] = JSON.parse(JSON.stringify(DEFAULT_TASK_PLANS[k]));
                this.savePlans();
            }
        }

        generatePlanBody(taskKey, baseTime) {
            const plan = this.getPlan(taskKey);
            const t0 = (typeof baseTime === 'number' && baseTime > 0) ? baseTime : (Date.now() - 5 * 60 * 1000);
            const body = {};
            let cursor = t0;

            plan.steps.forEach(step => {
                const durationMs = (parseFloat(step.durationM) || 1) * 60 * 1000;
                const start = cursor;
                const end = cursor + durationMs;
                cursor = end;

                const category = step.swimlane || 'General';
                if (!body[category]) {
                    body[category] = [];
                }

                body[category].push({
                    name: step.name,
                    start: start,
                    end: end,
                    type: category,
                    color: step.color || '#38bdf8',
                    textColor: '#ffffff'
                });
            });

            return body;
        }

        async reanchorAllPlans(openmct, baseTime) {
            if (!openmct || !openmct.objects) return;
            const mapping = {
                navigation: 'plan_nav',
                science: 'plan_science',
                maintenance: 'plan_maintenance',
                probing: 'plan_probing'
            };

            const t0 = (typeof baseTime === 'number' && baseTime > 0) ? baseTime : Date.now();

            for (const [taskKey, objKey] of Object.entries(mapping)) {
                try {
                    const identifier = { namespace: 'orion.taxonomy', key: objKey };
                    const domainObj = await openmct.objects.get(identifier);
                    if (domainObj) {
                        const newBody = this.generatePlanBody(taskKey, t0);
                        openmct.objects.mutate(domainObj, 'selectFile.body', newBody);
                    }
                } catch (err) {
                    console.warn(`[Timeline Store] Error mutating ${objKey}:`, err);
                }
            }
        }
    }

    const storeInstance = new OrionTimelineStore();

    // In-App Interactive Milestone & Activity Editor Modal
    function openTimelineEditorModal(taskKey) {
        const normKey = storeInstance.normalizeKey(taskKey || (window.OrionTaskManager && window.OrionTaskManager.state ? window.OrionTaskManager.state.task : 'navigation'));
        let activeKey = normKey;
        let currentPlan = JSON.parse(JSON.stringify(storeInstance.getPlan(activeKey)));

        // Remove any preexisting dialog
        const existing = document.getElementById('orion-timeline-editor-modal');
        if (existing) existing.remove();

        // Create overlay container
        const modal = document.createElement('div');
        modal.id = 'orion-timeline-editor-modal';
        modal.className = 'c-overlay js-overlay l-overlay-large';
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 10005;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.75);
            backdrop-filter: blur(2px);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
        `;

        // Inner Dialog Container
        modal.innerHTML = `
            <div class="c-overlay__blocker js-overlay-blocker" style="position: absolute; inset: 0; cursor: pointer;"></div>
            <div class="c-overlay__outer" style="position: relative; z-index: 10006; width: 900px; max-width: 95vw; height: 680px; max-height: 90vh; background: #181818; border: 1px solid #333333; box-shadow: 0 10px 40px rgba(0,0,0,0.8); display: flex; flex-direction: column; overflow: hidden;">
                
                <!-- Modal Header -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #141414; border-bottom: 1px solid #282828;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 14px; font-weight: 800; letter-spacing: 0.8px; color: #f8fafc; text-transform: uppercase;">MISSION TIMELINE CONFIGURATOR</span>
                        <span style="background: #2563eb; color: #ffffff; padding: 2px 6px; font-size: 9px; font-weight: 800; font-family: monospace;">IN-APP EDITOR</span>
                    </div>
                    <button class="c-click-icon c-overlay__close-button icon-x js-modal-close" aria-label="Close" style="font-size: 16px; color: #94a3b8; background: transparent; border: none; cursor: pointer; padding: 4px 8px;"></button>
                </div>

                <!-- Top Selector & Controls Bar -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: #1f1f1f; border-bottom: 1px solid #282828; flex-wrap: wrap; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase;">SELECT TIMELINE:</span>
                        <select id="editor-task-select" style="background: #141414; color: #ffffff; border: 1px solid #3b82f6; padding: 4px 8px; font-size: 12px; font-weight: 700; outline: none; cursor: pointer;">
                            <option value="navigation">🧭 Navigation Traverse Plan (35m)</option>
                            <option value="science">🔬 Science Task Plan (40m)</option>
                            <option value="maintenance">🔧 Maintenance Task Plan (30m)</option>
                            <option value="probing">🎯 Probing Task Plan (32m)</option>
                        </select>
                    </div>

                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span id="editor-total-duration-badge" style="background: #064e3b; border: 1px solid #059669; color: #a7f3d0; padding: 3px 8px; font-size: 11px; font-family: monospace; font-weight: 700;">
                            TOTAL: 35 MIN (8 ACTIVITIES)
                        </span>
                    </div>
                </div>

                <!-- Step Table Container (Scrollable) -->
                <div style="flex: 1; min-height: 0; overflow-y: auto; padding: 16px; background: #121212;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 11px; color: #e2e8f0;">
                        <thead>
                            <tr style="border-bottom: 1px solid #282828; color: #94a3b8; text-align: left; font-size: 10px; font-family: monospace;">
                                <th style="padding: 6px 8px; width: 36px;">#</th>
                                <th style="padding: 6px 8px;">ACTIVITY / MILESTONE NAME</th>
                                <th style="padding: 6px 8px; width: 110px;">SWIMLANE</th>
                                <th style="padding: 6px 8px; width: 100px;">DURATION (M)</th>
                                <th style="padding: 6px 8px; width: 80px;">COLOR</th>
                                <th style="padding: 6px 8px; width: 90px; text-align: right;">ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody id="editor-steps-tbody">
                            <!-- Injected rows -->
                        </tbody>
                    </table>

                    <div style="margin-top: 14px; display: flex; justify-content: flex-start;">
                        <button id="editor-btn-add-step" style="background: #1e293b; color: #38bdf8; border: 1px dashed #38bdf8; padding: 6px 14px; font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                            <span>+</span> ADD ACTIVITY / MILESTONE
                        </button>
                    </div>
                </div>

                <!-- Footer Action Buttons -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #141414; border-top: 1px solid #282828;">
                    <button id="editor-btn-reset-defaults" style="background: #27272a; color: #fca5a5; border: 1px solid #7f1d1d; padding: 6px 12px; font-size: 11px; font-weight: 700; cursor: pointer;">
                        ↺ RESET TO ERC DEFAULTS
                    </button>

                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button class="js-modal-close" style="background: #27272a; color: #cbd5e1; border: 1px solid #3f3f46; padding: 6px 14px; font-size: 11px; font-weight: 700; cursor: pointer;">
                            CANCEL
                        </button>
                        <button id="editor-btn-save-apply" style="background: #15803d; color: #ffffff; border: 1px solid #16a34a; padding: 6px 18px; font-size: 11px; font-weight: 800; cursor: pointer; letter-spacing: 0.5px;">
                            💾 SAVE & APPLY TIMELINE
                        </button>
                    </div>
                </div>

            </div>
        `;

        document.body.appendChild(modal);

        const selectTask = modal.querySelector('#editor-task-select');
        const tbody = modal.querySelector('#editor-steps-tbody');
        const durationBadge = modal.querySelector('#editor-total-duration-badge');
        const btnAdd = modal.querySelector('#editor-btn-add-step');
        const btnSave = modal.querySelector('#editor-btn-save-apply');
        const btnReset = modal.querySelector('#editor-btn-reset-defaults');

        selectTask.value = activeKey;

        function renderRows() {
            tbody.innerHTML = '';
            let totalM = 0;

            currentPlan.steps.forEach((step, idx) => {
                const dur = parseFloat(step.durationM) || 0;
                totalM += dur;

                const tr = document.createElement('tr');
                tr.style.cssText = 'border-bottom: 1px solid #202020; background: #161616;';
                tr.innerHTML = `
                    <td style="padding: 6px 8px; font-family: monospace; color: #64748b; font-weight: 700;">${idx + 1}</td>
                    <td style="padding: 4px 6px;">
                        <input type="text" class="step-input-name" data-idx="${idx}" value="${step.name.replace(/"/g, '&quot;')}" style="width: 100%; background: #0f0f0f; border: 1px solid #2d2d2d; color: #ffffff; padding: 4px 8px; font-size: 11px; outline: none; box-sizing: border-box;">
                    </td>
                    <td style="padding: 4px 6px;">
                        <select class="step-input-lane" data-idx="${idx}" style="background: #0f0f0f; border: 1px solid #2d2d2d; color: #cbd5e1; padding: 4px 6px; font-size: 11px; outline: none; width: 100%; cursor: pointer;">
                            <option value="Drive" ${step.swimlane === 'Drive' ? 'selected' : ''}>Drive</option>
                            <option value="Arm" ${step.swimlane === 'Arm' ? 'selected' : ''}>Arm</option>
                            <option value="Science" ${step.swimlane === 'Science' ? 'selected' : ''}>Science</option>
                            <option value="Safety" ${step.swimlane === 'Safety' ? 'selected' : ''}>Safety</option>
                            <option value="General" ${step.swimlane === 'General' ? 'selected' : ''}>General</option>
                        </select>
                    </td>
                    <td style="padding: 4px 6px;">
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <input type="number" min="1" max="60" class="step-input-dur" data-idx="${idx}" value="${step.durationM}" style="width: 50px; background: #0f0f0f; border: 1px solid #2d2d2d; color: #38bdf8; font-family: monospace; font-weight: 700; padding: 4px 6px; font-size: 11px; outline: none; text-align: center;">
                            <span style="color: #64748b; font-size: 10px;">min</span>
                        </div>
                    </td>
                    <td style="padding: 4px 6px;">
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <input type="color" class="step-input-color" data-idx="${idx}" value="${step.color || '#22c55e'}" style="width: 26px; height: 24px; border: none; background: transparent; cursor: pointer; padding: 0;">
                            <span style="font-size: 9px; font-family: monospace; color: #94a3b8;">${step.color || '#22c55e'}</span>
                        </div>
                    </td>
                    <td style="padding: 4px 6px; text-align: right;">
                        <button class="step-btn-up" data-idx="${idx}" title="Move Up" style="background: #27272a; border: 1px solid #3f3f46; color: #ffffff; padding: 2px 5px; font-size: 9px; cursor: pointer; margin-right: 2px;" ${idx === 0 ? 'disabled style="opacity: 0.3;"' : ''}>▲</button>
                        <button class="step-btn-down" data-idx="${idx}" title="Move Down" style="background: #27272a; border: 1px solid #3f3f46; color: #ffffff; padding: 2px 5px; font-size: 9px; cursor: pointer; margin-right: 4px;" ${idx === currentPlan.steps.length - 1 ? 'disabled style="opacity: 0.3;"' : ''}>▼</button>
                        <button class="step-btn-del" data-idx="${idx}" title="Delete Step" style="background: #3f1a1a; border: 1px solid #7f1d1d; color: #fca5a5; padding: 2px 6px; font-size: 10px; cursor: pointer; font-weight: 800;">✕</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            durationBadge.textContent = `TOTAL: ${totalM} MIN (${currentPlan.steps.length} ACTIVITIES)`;

            // Attach input event listeners
            tbody.querySelectorAll('.step-input-name').forEach(el => {
                el.addEventListener('input', (e) => {
                    const i = parseInt(e.target.dataset.idx, 10);
                    currentPlan.steps[i].name = e.target.value;
                });
            });

            tbody.querySelectorAll('.step-input-lane').forEach(el => {
                el.addEventListener('change', (e) => {
                    const i = parseInt(e.target.dataset.idx, 10);
                    currentPlan.steps[i].swimlane = e.target.value;
                });
            });

            tbody.querySelectorAll('.step-input-dur').forEach(el => {
                el.addEventListener('input', (e) => {
                    const i = parseInt(e.target.dataset.idx, 10);
                    const val = parseFloat(e.target.value) || 1;
                    currentPlan.steps[i].durationM = Math.max(1, val);
                    updateDurationBadge();
                });
            });

            tbody.querySelectorAll('.step-input-color').forEach(el => {
                el.addEventListener('input', (e) => {
                    const i = parseInt(e.target.dataset.idx, 10);
                    currentPlan.steps[i].color = e.target.value;
                    e.target.nextElementSibling.textContent = e.target.value;
                });
            });

            tbody.querySelectorAll('.step-btn-up').forEach(el => {
                el.addEventListener('click', (e) => {
                    const i = parseInt(e.target.dataset.idx, 10);
                    if (i > 0) {
                        const temp = currentPlan.steps[i];
                        currentPlan.steps[i] = currentPlan.steps[i - 1];
                        currentPlan.steps[i - 1] = temp;
                        renderRows();
                    }
                });
            });

            tbody.querySelectorAll('.step-btn-down').forEach(el => {
                el.addEventListener('click', (e) => {
                    const i = parseInt(e.target.dataset.idx, 10);
                    if (i < currentPlan.steps.length - 1) {
                        const temp = currentPlan.steps[i];
                        currentPlan.steps[i] = currentPlan.steps[i + 1];
                        currentPlan.steps[i + 1] = temp;
                        renderRows();
                    }
                });
            });

            tbody.querySelectorAll('.step-btn-del').forEach(el => {
                el.addEventListener('click', (e) => {
                    const i = parseInt(e.target.dataset.idx, 10);
                    if (currentPlan.steps.length > 1) {
                        currentPlan.steps.splice(i, 1);
                        renderRows();
                    } else {
                        if (window.openmct && window.openmct.notifications) {
                            window.openmct.notifications.alert('A timeline must have at least one activity.');
                        }
                    }
                });
            });
        }

        function updateDurationBadge() {
            const totalM = currentPlan.steps.reduce((sum, s) => sum + (parseFloat(s.durationM) || 0), 0);
            durationBadge.textContent = `TOTAL: ${totalM} MIN (${currentPlan.steps.length} ACTIVITIES)`;
        }

        renderRows();

        // Switch Task Preset
        selectTask.addEventListener('change', (e) => {
            activeKey = e.target.value;
            currentPlan = JSON.parse(JSON.stringify(storeInstance.getPlan(activeKey)));
            renderRows();
        });

        // Add Step
        btnAdd.addEventListener('click', () => {
            const stepNum = currentPlan.steps.length + 1;
            currentPlan.steps.push({
                id: `${activeKey}_step_${Date.now()}`,
                name: `Milestone ${stepNum} (Custom Activity)`,
                durationM: 5,
                swimlane: 'Drive',
                color: '#22c55e',
                goal: 'Execute custom operator milestone.',
                passCriteria: 'Telemetry confirmed.'
            });
            renderRows();
        });

        // Save & Apply
        btnSave.addEventListener('click', async () => {
            storeInstance.updatePlan(activeKey, currentPlan);

            // If active task in TaskManager matches, update limit
            if (window.OrionTaskManager) {
                const totalM = currentPlan.steps.reduce((sum, s) => sum + (parseFloat(s.durationM) || 0), 0);
                if (window.OrionTaskManager.state && window.OrionTaskManager.state.task === activeKey) {
                    window.OrionTaskManager.state.limit_s = totalM * 60;
                    window.OrionTaskManager.saveState();
                }
            }

            // Re-anchor Open MCT plan objects
            if (window.openmct) {
                const baseT = (window.OrionTaskManager && window.OrionTaskManager.state && window.OrionTaskManager.state.t0) || Date.now();
                await storeInstance.reanchorAllPlans(window.openmct, baseT);

                if (window.openmct.notifications) {
                    window.openmct.notifications.info(`Timeline "${currentPlan.name}" successfully updated and synchronized.`);
                }
            }

            modal.remove();
        });

        // Reset to ERC Defaults
        btnReset.addEventListener('click', () => {
            storeInstance.resetToDefaults(activeKey);
            currentPlan = JSON.parse(JSON.stringify(storeInstance.getPlan(activeKey)));
            renderRows();
            if (window.openmct && window.openmct.notifications) {
                window.openmct.notifications.info(`Reset "${currentPlan.name}" to ERC 2026 default baseline.`);
            }
        });

        // Close handlers
        function closeModal() {
            modal.remove();
        }

        modal.querySelectorAll('.js-modal-close, .js-overlay-blocker').forEach(el => {
            el.addEventListener('click', closeModal);
        });

        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', keyHandler);
            }
        };
        document.addEventListener('keydown', keyHandler);
    }

    // Export globally
    if (typeof window !== 'undefined') {
        window.OrionTimelineStore = storeInstance;
        window.openOrionTimelineEditor = openTimelineEditorModal;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            OrionTimelineStore: storeInstance,
            openOrionTimelineEditor: openTimelineEditorModal
        };
    }
})();

