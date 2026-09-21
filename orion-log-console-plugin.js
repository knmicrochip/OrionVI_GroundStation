/**
 * Orion VI Rover MQTT Live Log Console Plugin (ERC 2026)
 * 
 * Provides an aerospace terminal/console interface for viewing live logs
 * transmitted from the rover over MQTT.
 * 
 * Features:
 * - Real-time streaming over WebSocket (/realtime & /mqtt-bridge)
 * - Initial historical log fetch (/api/logs)
 * - Auto-detects plain text or JSON log structures
 * - Color-coded log severity badges: [INFO], [WARN], [ERROR], [DEBUG]
 * - Subsystem source identification (NAV, ARM, POWER, SCIENCE, SAFETY, etc.)
 * - Real-time client-side text search and level filtering
 * - Auto-scroll with pause on manual scroll up
 * - In-app test log injection for immediate verification
 * - Clear log buffer & Export to text file
 */

(function () {
    function OrionLogConsolePlugin() {
        return function install(openmct) {
            // Register log console view provider
            openmct.objectViews.addProvider({
                key: 'orion.log-console.view',
                name: 'Rover System Log Console',
                cssClass: 'icon-notebook',
                priority: function () {
                    return 1000;
                },
                canView: function (domainObject) {
                    return domainObject.type === 'orion.log-console' ||
                        (domainObject.identifier && domainObject.identifier.key === 'rover_logs_console');
                },
                view: function (domainObject, objectPath) {
                    let containerEl = null;
                    let ws = null;
                    let logs = [];
                    let activeFilter = 'ALL';
                    let searchQuery = '';
                    let autoScroll = true;
                    let activeTopic = 'rover/logs/#';

                    return {
                        show: function (element) {
                            containerEl = element;
                            containerEl.style.cssText = `
                                width: 100%;
                                height: 100%;
                                display: flex;
                                flex-direction: column;
                                background: #121212;
                                color: #cccccc;
                                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
                                box-sizing: border-box;
                                overflow: hidden;
                            `;

                            containerEl.innerHTML = `
                                <!-- Top Console Control Bar -->
                                <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: #181818; border-bottom: 1px solid #282828; flex-shrink: 0; flex-wrap: wrap; gap: 8px;">
                                    <!-- Left: Title & Status -->
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <div id="log-conn-led" style="width: 8px; height: 8px; background: #22c55e; border-radius: 0px; box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);"></div>
                                        <span style="font-weight: 800; font-size: 11px; letter-spacing: 0.6px; color: #f8fafc; text-transform: uppercase;">ROVER MQTT LIVE SYSTEM LOGS</span>
                                        <span id="log-topic-badge" style="background: #1e293b; border: 1px solid #334155; color: #38bdf8; padding: 2px 6px; font-size: 9px; font-family: monospace; font-weight: 700;">TOPIC: rover/logs/#</span>
                                        <span id="log-count-badge" style="background: #27272a; color: #94a3b8; padding: 2px 6px; font-size: 9px; font-family: monospace;">0 MSGS</span>
                                    </div>

                                    <!-- Right: Filters, Search, Actions -->
                                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                        <!-- Search Input -->
                                        <input type="text" id="log-search-input" placeholder="Search logs..." style="background: #141414; border: 1px solid #333333; color: #ffffff; padding: 3px 8px; font-size: 10px; font-family: monospace; outline: none; width: 130px;" />

                                        <!-- Level Filter Buttons -->
                                        <div style="display: flex; border: 1px solid #333333; overflow: hidden;">
                                            <button class="log-filter-btn is-active" data-filter="ALL" style="background: #2563eb; color: #ffffff; border: none; padding: 3px 6px; font-size: 9px; font-weight: 800; cursor: pointer;">ALL</button>
                                            <button class="log-filter-btn" data-filter="INFO" style="background: #181818; color: #94a3b8; border: none; border-left: 1px solid #333333; padding: 3px 6px; font-size: 9px; font-weight: 700; cursor: pointer;">INFO</button>
                                            <button class="log-filter-btn" data-filter="WARN" style="background: #181818; color: #f59e0b; border: none; border-left: 1px solid #333333; padding: 3px 6px; font-size: 9px; font-weight: 700; cursor: pointer;">WARN</button>
                                            <button class="log-filter-btn" data-filter="ERROR" style="background: #181818; color: #ef4444; border: none; border-left: 1px solid #333333; padding: 3px 6px; font-size: 9px; font-weight: 700; cursor: pointer;">ERR</button>
                                        </div>

                                        <!-- Auto-Scroll Toggle -->
                                        <button id="log-autoscroll-btn" style="background: #1e293b; color: #38bdf8; border: 1px solid #38bdf8; padding: 3px 6px; font-size: 9px; font-weight: 700; cursor: pointer;">AUTO-SCROLL: ON</button>

                                        <!-- Quick Test Injection Button -->
                                        <button id="log-inject-btn" title="Inject a sample log message to test the pipeline" style="background: #065f46; color: #6ee7b7; border: 1px solid #059669; padding: 3px 8px; font-size: 9px; font-weight: 800; cursor: pointer;">+ TEST LOG</button>

                                        <!-- Clear Button -->
                                        <button id="log-clear-btn" style="background: #27272a; color: #cbd5e1; border: 1px solid #3f3f46; padding: 3px 6px; font-size: 9px; font-weight: 600; cursor: pointer;">CLEAR</button>

                                        <!-- Export Button -->
                                        <button id="log-export-btn" style="background: #181818; color: #94a3b8; border: 1px solid #333333; padding: 3px 6px; font-size: 9px; font-weight: 600; cursor: pointer;">EXPORT</button>
                                    </div>
                                </div>

                                <!-- Log Stream Container -->
                                <div id="log-stream-wrapper" style="flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px 12px; font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace; font-size: 11px; line-height: 1.5;">
                                    <div id="log-empty-placeholder" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 120px; color: #64748b; text-align: center; gap: 8px;">
                                        <span style="font-weight: 700; font-size: 12px; color: #94a3b8;">AWAITING ROVER MQTT LOGS</span>
                                        <span style="font-size: 11px; max-width: 500px; color: #64748b;">
                                            Listening for telemetry logs on topic <code style="color: #38bdf8;">rover/logs/#</code> (and all <code style="color: #38bdf8;">rover/#</code> topics).
                                            Supports raw text messages and JSON payloads.
                                        </span>
                                        <button id="log-placeholder-inject" style="margin-top: 6px; background: #1e293b; color: #38bdf8; border: 1px solid #38bdf8; padding: 4px 10px; font-size: 10px; font-weight: 700; cursor: pointer;">
                                            ▶ Inject Test Rover Log
                                        </button>
                                    </div>
                                    <table id="log-table" style="width: 100%; border-collapse: collapse; display: none;">
                                        <thead>
                                            <tr style="border-bottom: 1px solid #282828; color: #64748b; font-size: 10px; text-align: left;">
                                                <th style="width: 90px; padding: 4px 6px;">TIME (UTC)</th>
                                                <th style="width: 60px; padding: 4px 6px;">LEVEL</th>
                                                <th style="width: 80px; padding: 4px 6px;">SOURCE</th>
                                                <th style="padding: 4px 6px;">MESSAGE</th>
                                            </tr>
                                        </thead>
                                        <tbody id="log-tbody"></tbody>
                                    </table>
                                </div>
                            `;

                            const wrapper = containerEl.querySelector('#log-stream-wrapper');
                            const table = containerEl.querySelector('#log-table');
                            const tbody = containerEl.querySelector('#log-tbody');
                            const placeholder = containerEl.querySelector('#log-empty-placeholder');
                            const countBadge = containerEl.querySelector('#log-count-badge');
                            const topicBadge = containerEl.querySelector('#log-topic-badge');
                            const connLed = containerEl.querySelector('#log-conn-led');
                            const searchInput = containerEl.querySelector('#log-search-input');
                            const autoscrollBtn = containerEl.querySelector('#log-autoscroll-btn');
                            const injectBtn = containerEl.querySelector('#log-inject-btn');
                            const placeholderInject = containerEl.querySelector('#log-placeholder-inject');
                            const clearBtn = containerEl.querySelector('#log-clear-btn');
                            const exportBtn = containerEl.querySelector('#log-export-btn');
                            const filterBtns = containerEl.querySelectorAll('.log-filter-btn');

                            function getLevelColor(lvl) {
                                switch (lvl) {
                                    case 'ERROR':
                                    case 'FATAL':
                                    case 'CRITICAL':
                                        return { bg: '#450a0a', text: '#fca5a5', border: '#7f1d1d' };
                                    case 'WARN':
                                    case 'WARNING':
                                        return { bg: '#451a03', text: '#fde68a', border: '#92400e' };
                                    case 'DEBUG':
                                        return { bg: '#1e293b', text: '#94a3b8', border: '#334155' };
                                    case 'INFO':
                                    default:
                                        return { bg: '#082f49', text: '#7dd3fc', border: '#0369a1' };
                                }
                            }

                            function renderLogs() {
                                const filtered = logs.filter(l => {
                                    if (activeFilter !== 'ALL' && l.level !== activeFilter) return false;
                                    if (searchQuery) {
                                        const query = searchQuery.toLowerCase();
                                        return l.message.toLowerCase().includes(query) ||
                                            l.source.toLowerCase().includes(query) ||
                                            l.level.toLowerCase().includes(query);
                                    }
                                    return true;
                                });

                                countBadge.textContent = `${logs.length} MSGS`;

                                if (filtered.length === 0) {
                                    if (logs.length === 0) {
                                        placeholder.style.display = 'flex';
                                        table.style.display = 'none';
                                    } else {
                                        placeholder.style.display = 'none';
                                        table.style.display = 'table';
                                        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #64748b; padding: 24px;">No logs matching filter "${activeFilter}" or query "${searchQuery}"</td></tr>`;
                                    }
                                    return;
                                }

                                placeholder.style.display = 'none';
                                table.style.display = 'table';

                                tbody.innerHTML = filtered.map(l => {
                                    const col = getLevelColor(l.level);
                                    return `
                                        <tr style="border-bottom: 1px solid #1a1a1a; font-size: 11px;">
                                            <td style="color: #64748b; padding: 3px 6px; white-space: nowrap; font-variant-numeric: tabular-nums;">${l.isoTime || ''}</td>
                                            <td style="padding: 3px 6px; white-space: nowrap;">
                                                <span style="background: ${col.bg}; color: ${col.text}; border: 1px solid ${col.border}; padding: 1px 4px; font-weight: 800; font-size: 9px;">${l.level}</span>
                                            </td>
                                            <td style="color: #38bdf8; font-weight: 700; padding: 3px 6px; white-space: nowrap;">${l.source || 'ROVER'}</td>
                                            <td style="color: #e2e8f0; padding: 3px 6px; word-break: break-word;">${escapeHtml(l.message)}</td>
                                        </tr>
                                    `;
                                }).join('');

                                if (autoScroll) {
                                    wrapper.scrollTop = wrapper.scrollHeight;
                                }
                            }

                            function escapeHtml(str) {
                                if (!str) return '';
                                return String(str)
                                    .replace(/&/g, '&amp;')
                                    .replace(/</g, '&lt;')
                                    .replace(/>/g, '&gt;')
                                    .replace(/"/g, '&quot;');
                            }

                            function addLog(entry) {
                                logs.push(entry);
                                if (logs.length > 500) logs.shift();
                                renderLogs();
                            }

                            // Fetch historical logs from backend REST API
                            fetch('/api/logs')
                                .then(res => res.json())
                                .then(data => {
                                    if (data && Array.isArray(data.logs)) {
                                        logs = data.logs;
                                        if (data.activeTopic) {
                                            activeTopic = data.activeTopic;
                                            topicBadge.textContent = `TOPIC: ${activeTopic}`;
                                        }
                                        renderLogs();
                                    }
                                })
                                .catch(() => {});

                            // Connect to Realtime WebSocket for live push
                            try {
                                const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                                const wsUrl = `${proto}//${window.location.host}/realtime`;
                                ws = new WebSocket(wsUrl);

                                ws.onopen = () => {
                                    connLed.style.background = '#22c55e';
                                    connLed.style.boxShadow = '0 0 6px rgba(34, 197, 94, 0.6)';
                                    // Subscribe to all telemetry points and log events
                                    ws.send(JSON.stringify({ action: 'subscribe', id: 'all' }));
                                    ws.send(JSON.stringify({ action: 'subscribe', id: 'rover.logs.latest' }));
                                };

                                ws.onmessage = (evt) => {
                                    try {
                                        const msg = JSON.parse(evt.data);
                                        if (msg.type === 'rover_log' && msg.log) {
                                            addLog(msg.log);
                                        } else if (msg.id === 'rover.logs.latest' && msg.value) {
                                            // Fallback point update
                                            const now = msg.utc || Date.now();
                                            const isoTime = new Date(now).toISOString().split('T')[1].replace('Z', '');
                                            addLog({
                                                id: Date.now(),
                                                utc: now,
                                                isoTime: isoTime,
                                                level: 'INFO',
                                                source: 'ROVER',
                                                message: msg.value,
                                                topic: 'rover/logs'
                                            });
                                        }
                                    } catch (_) {}
                                };

                                ws.onclose = () => {
                                    connLed.style.background = '#f59e0b';
                                    connLed.style.boxShadow = 'none';
                                };

                                ws.onerror = () => {
                                    connLed.style.background = '#ef4444';
                                    connLed.style.boxShadow = 'none';
                                };
                            } catch (e) {
                                console.warn('[Rover Log Console] WebSocket init error:', e);
                            }

                            // Filter Buttons Click
                            filterBtns.forEach(btn => {
                                btn.addEventListener('click', () => {
                                    filterBtns.forEach(b => {
                                        b.classList.remove('is-active');
                                        b.style.background = '#181818';
                                    });
                                    btn.classList.add('is-active');
                                    btn.style.background = '#2563eb';
                                    activeFilter = btn.getAttribute('data-filter') || 'ALL';
                                    renderLogs();
                                });
                            });

                            // Search Input
                            searchInput.addEventListener('input', (e) => {
                                searchQuery = e.target.value.trim();
                                renderLogs();
                            });

                            // Auto-Scroll Toggle
                            autoscrollBtn.addEventListener('click', () => {
                                autoScroll = !autoScroll;
                                autoscrollBtn.textContent = `AUTO-SCROLL: ${autoScroll ? 'ON' : 'OFF'}`;
                                autoscrollBtn.style.color = autoScroll ? '#38bdf8' : '#94a3b8';
                                autoscrollBtn.style.borderColor = autoScroll ? '#38bdf8' : '#334155';
                            });

                            // Detect manual scroll up to pause auto-scroll
                            wrapper.addEventListener('scroll', () => {
                                const atBottom = wrapper.scrollHeight - wrapper.scrollTop - wrapper.clientHeight < 30;
                                if (!atBottom && autoScroll) {
                                    autoScroll = false;
                                    autoscrollBtn.textContent = 'AUTO-SCROLL: OFF';
                                    autoscrollBtn.style.color = '#94a3b8';
                                    autoscrollBtn.style.borderColor = '#334155';
                                } else if (atBottom && !autoScroll) {
                                    autoScroll = true;
                                    autoscrollBtn.textContent = 'AUTO-SCROLL: ON';
                                    autoscrollBtn.style.color = '#38bdf8';
                                    autoscrollBtn.style.borderColor = '#38bdf8';
                                }
                            });

                            // Test Log Injector Function
                            let testCounter = 0;
                            const sampleLogs = [
                                { level: 'INFO', source: 'NAV', message: 'RTAB-Map SLAM loop closure detected. Map entropy: 0.14' },
                                { level: 'INFO', source: 'POWER', message: 'Main 20V power bus nominal: 20.16V @ 12.4A. All 4 battery packs balanced.' },
                                { level: 'WARN', source: 'DRIVE', message: 'Wheel current FR slightly elevated: 5.8A (terrain resistance nominal).' },
                                { level: 'INFO', source: 'ARM', message: 'Manipulator 6-DoF trajectory solved. End-effector waypoint reached.' },
                                { level: 'ERROR', source: 'SAFETY', message: 'UVLO trip threshold simulated clear. Bus voltage > 16.0V nominal.' },
                                { level: 'INFO', source: 'SCIENCE', message: 'Geological aggregate sample tensometer reading +32.4g confirmed.' }
                            ];

                            function triggerTestLog() {
                                const sample = sampleLogs[testCounter % sampleLogs.length];
                                testCounter++;
                                fetch('/api/logs', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        message: `[${sample.source}] ${sample.message}`,
                                        level: sample.level,
                                        source: sample.source,
                                        topic: `rover/logs/${sample.source.toLowerCase()}`
                                    })
                                }).then(res => res.json()).then(data => {
                                    if (data && data.log) {
                                        addLog(data.log);
                                    }
                                }).catch(() => {});
                            }

                            if (injectBtn) injectBtn.addEventListener('click', triggerTestLog);
                            if (placeholderInject) placeholderInject.addEventListener('click', triggerTestLog);

                            // Clear Logs
                            clearBtn.addEventListener('click', () => {
                                logs = [];
                                renderLogs();
                                fetch('/api/logs', { method: 'DELETE' }).catch(() => {});
                            });

                            // Export Logs
                            exportBtn.addEventListener('click', () => {
                                const text = logs.map(l => `[${l.isoTime}] [${l.level}] [${l.source}] ${l.message}`).join('\n');
                                const blob = new Blob([text], { type: 'text/plain' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `orion-rover-logs-${Date.now()}.txt`;
                                a.click();
                                URL.revokeObjectURL(url);
                            });
                        },
                        destroy: function () {
                            if (ws) {
                                try { ws.close(); } catch (_) {}
                                ws = null;
                            }
                            if (containerEl) {
                                containerEl.innerHTML = '';
                            }
                        }
                    };
                }
            });
        };
    }

    if (typeof window !== 'undefined') {
        window.OrionLogConsolePlugin = OrionLogConsolePlugin;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionLogConsolePlugin;
    }
})();

