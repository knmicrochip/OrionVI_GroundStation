<div align="center" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <img src="logotyp_pion_white.png" alt="Orion VI Logo" width="110" style="margin-bottom: 12px; filter: drop-shadow(0 0 6px rgba(255,255,255,0.2));" />
  <h1 style="margin: 0; font-size: 28px; font-weight: 800; letter-spacing: 2px; color: #f8fafc;">ORION VI ROVER — GROUND CONTROL STATION</h1>
  <p style="margin: 6px 0 16px 0; font-size: 14px; color: #94a3b8; font-weight: 500;">
    Mission Control & Telemetry System | <b>KN MicroChip</b> | <b>European Rover Challenge (ERC 2026/27)</b>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Open%20MCT-v4.6.0-004c86?style=flat-square&logo=nasa&logoColor=white" alt="Open MCT" />
    <img src="https://img.shields.io/badge/Architecture-NASA--STD--3001-1e293b?style=flat-square" alt="NASA-STD-3001" />
    <img src="https://img.shields.io/badge/Power%20Bus-20.16V%20Nominal%20(5S)-10b981?style=flat-square" alt="Power Bus" />
    <img src="https://img.shields.io/badge/Cameras-10x%20Flexible%20Layout-38bdf8?style=flat-square" alt="10x Cameras" />
    <img src="https://img.shields.io/badge/Comms-5GHz%20Wi--Fi%20RF-f59e0b?style=flat-square" alt="5GHz Comms" />
    <img src="https://img.shields.io/badge/Runtime-Zero--Install%20Portable-8b5cf6?style=flat-square" alt="Zero-Install" />
  </p>
</div>

---

<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">

## Overview

A mission-critical Ground Control Station (GCS) engineered for the **Orion VI Planetary Rover**, built by **KN MicroChip** for competition in the **European Rover Challenge (ERC 2026/27)**. 

Built on top of the **NASA Open MCT** framework, the station enforces strict **NASA-STD-3001** and **ECSS** human-system interface principles:
* **Aerospace Dark Palette (`#121212`)**: Low-glare, high-contrast dark environment designed for outdoor command shelters.
* **Square Edge Topology (`0px !important`)**: Zero-radius framing for maximum information density and clean visual alignment.
* **Factual Telemetry Only**: Status indicators strictly reflect verified telemetry (`[B1: OK]` when link active, `[B1: ---]` when unreceived).
* **Tabular Monospace Typography**: Monospace numeric streams prevent character-width jitter during high-frequency sensor updates.

---

## Mission Interface Gallery

### 1. Main Teleoperation & Subsystem HUD
The master teleoperation dashboard integrating real-time IMU artificial horizon, robotic arm manipulator controls, subsystem power distribution strip, and live battery states on the upper HUD.

![Orion VI Main Teleoperation Display](docs/images/screenshot-clean-teleop-display.png)

---

### 2. 5S Li-ion Battery Diagnostics & Health Monitoring
Factual **20.1V – 20.2V** nominal operating plateau monitoring with individual module health badges, parallel bus balance tracking, and standalone diagnostics window with a **14V – 22V** trend graph.

<p align="center">
  <img src="docs/images/screenshot-top-panel-battery-states.png" alt="Top Panel Battery Indicator" width="100%" />
</p>

<p align="center">
  <img src="docs/images/screenshot-battery-details-calibrated.png" alt="Standalone Battery Diagnostics Window" width="85%" />
</p>

---

### 3. 10-Camera Flexible Layout & Reconnect Watchdog
Integrated **Flexible Layout** tab (`rover_cameras_flex`) within Rover Displays. Features primary hero view (Mast Camera), 9 auxiliary feeds, 5-second automatic reconnect watchdog, and independent sub-window popouts for multi-monitor command desks.

![10-Camera Flexible Layout in Rover Displays](docs/images/screenshot-10-cameras-flexible-layout-mixed.png)

<p align="center">
  <img src="docs/images/screenshot-cameras-reconnect-countdown.png" alt="Camera Reconnect Watchdog Countdown" width="58%" />
  <img src="docs/images/screenshot-camera-popout-nosignal.png" alt="Standalone Camera Popout Window" width="38%" />
</p>

### 4. 5GHz RF Comms & Dedicated Diagnostics
Live wireless transceiver link metrics (RSSI, SNR, downlink/uplink throughput, packet loss) with real-time health indicator and detached popout diagnostics window (`antenna-details.html`).

<p align="center">
  <img src="docs/images/screenshot-antenna-details.png" alt="5GHz RF Comms Diagnostics" width="75%" />
</p>

---

### 5. Native Open MCT Timelines, Time Strips & Task Plans
Full integration with native NASA Open MCT timeline engines:
* **Native Master Time Strip (`type: 'time-strip'`)**: Stacks multi-domain mission plans (`plan_nav`, `plan_science`) and live telemetry plots (`plot_bus_voltage`, `plot_wheel_currents`) along a unified, synchronized time axis with a moving real-time Conductor cursor.
* **Native Plan Layouts (`type: 'plan'`)**: High-performance canvas-rendered swimlanes (`Safety`, `Drive`, `Science`, `Arm`) with NASA-STD-3001 aerospace color coding, clickable activities, and full Conductor bounds synchronization.
* **Display Layout Integration**: Embedded plan views within single-screen operating modes (`NAV / AUTONOMY`, `SCIENCE`, `MANIPULATOR`, `MAINTENANCE`) alongside LAD tables and telemetry graphs.
* **Activity Time List (`type: 'timelist'`)**: Time-ordered tabular schedule showing active, past, and upcoming tasks with automatic count-up / count-down timers.

![Native Open MCT Master Time Strip](docs/images/screenshot-openmct-time-strip.png)

<p align="center">
  <img src="docs/images/screenshot-openmct-plan-timeline.png" alt="Native Open MCT Plan Timeline" width="49%" />
  <img src="docs/images/screenshot-modes-nav-plan.png" alt="Embedded Plan in Nav Operating Mode" width="49%" />
</p>

<p align="center">
  <img src="docs/images/screenshot-openmct-timelist.png" alt="Native Open MCT Activity Time List" width="75%" />
</p>

---

## Quick Start (Zero Installation)

The project includes a pre-bundled, portable **Electron runtime** (`node_modules/electron/dist/electron.exe`) embedding both Chromium and Node.js. **No external installations of Node.js, npm, or VS Code extensions are required on Windows.**

### Option A: Windows File Explorer (Double-Click)
Double-click [`start.bat`](start.bat).

### Option B: PowerShell
```powershell
.\start.bat
```
*(or run the PowerShell launcher: `.\start.ps1`)*

> [!NOTE]
> In PowerShell, the `.\` prefix is mandatory. PowerShell requires this prefix to execute files in the current working directory for security.

### Option C: Command Prompt (CMD)
```cmd
start.bat
```

### Option D: NPM Scripts (If Node.js is Installed)
```bash
# Launch Electron native desktop window
npm start

# Launch server and auto-open default web browser at http://localhost:8088
npm run start:browser

# Launch background server only (headless)
npm run start:web
```

---

## Typography & Fonts Specification

The Orion VI Ground Control Station enforces strict aerospace typography standards across all UI components and documentation:

```
+-----------------------------------------------------------------------------------------+
| Interface Element   | Primary Font Stack                                                |
+---------------------+-------------------------------------------------------------------+
| Headings & UI Labels| -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif |
| Telemetry & Numbers | "JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace|
| Status Badges       | "SFMono-Regular", Consolas, Menlo, monospace (font-weight: 800)   |
| Time & Coordinates  | "JetBrains Mono", monospace (font-variant-numeric: tabular-nums)  |
+-----------------------------------------------------------------------------------------+
```

### Why Tabular Monospace Font Matters:
In mission-critical aerospace telemetry, numbers must render with **fixed tabular character widths** (`font-variant-numeric: tabular-nums`). If proportional fonts (like Arial or Helvetica) are used for high-frequency telemetry (such as battery voltage updating at 10Hz), numbers jitter horizontally as glyph widths change (e.g. `1` is narrower than `8`), causing operator eye fatigue and reading errors during high-stress competition runs.

---

## Subsystems Architecture

```mermaid
flowchart TD
    subgraph Rover ["Orion VI Rover (Physical / Simulation)"]
        subgraph PowerSub ["Power Subsystem"]
            B1["Pack 1 (5S Li-ion)"]
            B2["Pack 2 (5S Li-ion)"]
            B3["Pack 3 (5S Li-ion)"]
            B4["Pack 4 (5S Li-ion)"]
            Bus["20V DC Main Power Bus"]
        end
        Cams["10x Downlink Video Cameras"]
        Nav["Autonomous Nav & IMU"]
        Arm["6-DoF Manipulator"]
        Broker["Mosquitto MQTT Broker (192.168.1.1:1883)"]
        
        PowerSub -->|"Power/feedback"| Broker
        Nav -->|"rover/nav/#"| Broker
        Arm -->|"rover/arm/#"| Broker
    end

    subgraph GCS_Backend ["Ground Station Gateway (Node.js/Express :8088)"]
        Bridge["MQTT TCP Bridge"]
        Gateway["Telemetry Gateway & Ring Buffers"]
        WSServer["WebSocket Realtime Feed (/realtime)"]
        HTTPServer["Static & Historical REST API (/history, /api)"]
        
        Broker <==>|"TCP Socket"| Bridge
        Bridge --> Gateway
        Gateway --> WSServer
        Gateway --> HTTPServer
    end

    subgraph GCS_Frontend ["Open MCT Mission Control (Electron / Browser)"]
        Shell["Open MCT UI Shell (Aerospace Theme)"]
        
        subgraph Plugins ["Custom Orion Plugins"]
            P_Batt["OrionBatteryPlugin (Top HUD & Health)"]
            P_Cam["OrionCameraMosaicPlugin (Flexible Layout)"]
            P_RF["OrionAntennaPlugin (5GHz Signal)"]
            P_3D["OrionModelPlugin (Three.js 3D Rover)"]
            P_Exc["OrionExceptionEngine (Master Caution/Warn)"]
            P_Clock["OrionTaskClockPlugin (MET / ERC Timers)"]
            P_Modes["OrionModesPlugin (Tabbed Operating Layouts)"]
        end

        subgraph SecondaryWindows ["Independent Windows"]
            Win_Batt["Battery Diagnostics (battery-details.html)"]
            Win_RF["RF Comms Diagnostics (antenna-details.html)"]
            Win_Cam["Detached Camera Views (camera-view.html)"]
        end

        WSServer <==>|"WebSocket"| Plugins
        HTTPServer <==>|"HTTP Fetch"| Plugins
        Plugins --> Shell
        P_Batt <==>|"BroadcastChannel ('orion-battery-sync')"| Win_Batt
        P_Cam -->|"window.open"| Win_Cam
        P_RF -->|"window.open"| Win_RF
    end
```

---

## Detailed Documentation Directory

For complete engineering details, see the dedicated guides in the [`docs/`](docs/) directory:

* [**Architecture & Protocol Guide**](docs/ARCHITECTURE.md): Backend gateway, MQTT bridge, FIFO ring-buffers, and multi-window state synchronization.
* [**Battery Subsystem Guide**](docs/BATTERY_SUBSYSTEM.md): 5S Li-ion battery curves, 20.1V–20.2V calibration, fault isolation thresholds, and diagnostics UI.
* [**Camera System Guide**](docs/CAMERA_SYSTEM.md): 10-camera flexible layout, reconnect watchdog mechanism, streaming architecture, and snapshotting.
* [**Telemetry Dictionary**](docs/TELEMETRY_DICTIONARY.md): Comprehensive table of telemetry identifiers, units, limits, and payload schemas.

---

## Automated Verification Tests

The GCS includes automated headless Electron verification scripts:

```powershell
# Verify battery telemetry, top panel indicators & diagnostics window
$env:TEST_RUN="test_battery"; & "node_modules\electron\dist\electron.exe" .

# Verify 10-camera flexible layout & reconnect watchdog countdown
$env:TEST_RUN="test_cameras"; & "node_modules\electron\dist\electron.exe" .

# Verify native Open MCT Plan layouts, Time Strips & Timelists
$env:TEST_RUN="test_timeline"; & "node_modules\electron\dist\electron.exe" .

# Full end-to-end telemetry ingestion test
$env:TEST_RUN="e2e"; & "node_modules\electron\dist\electron.exe" .
```

---

## License & Team
* **Team**: KN MicroChip — Orion Rover Team
* **Competition**: European Rover Challenge (ERC 2026/27)
* **Core Framework**: [NASA Open MCT](https://nasa.github.io/openmct/) (Apache 2.0 License)

</div>
