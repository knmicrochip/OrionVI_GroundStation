<div align="center" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <img src="logotyp_pion_white.png" alt="Orion VI Logo" width="90" style="margin-bottom: 8px; filter: drop-shadow(0 0 5px rgba(255,255,255,0.25));" />
  <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 1.5px; color: #f8fafc;">ORION VI ROVER — GROUND CONTROL APPLICATION</h1>
  <p style="margin: 4px 0 14px 0; font-size: 13px; color: #94a3b8;">
    Core NASA Open MCT Application, Plugins & Telemetry Gateway | <b>KN MicroChip (ERC 2026/27)</b>
  </p>
</div>

---

<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">

## Application Overview

This directory contains the primary Open MCT implementation, custom telemetry plugins, and backend services for the **Orion VI Mars Rover Ground Control Station**.

![Orion VI Main Teleoperation Display](../docs/images/screenshot-clean-teleop-display.png)

---

## Quick Launch (Zero-Install Portable Mode)

The pre-bundled, self-contained Electron runtime is located in `node_modules/electron/dist/electron.exe`. You do not need to install Node.js or any VS Code extensions on your machine.

### In PowerShell:
```powershell
.\start.bat
```
*(or `.\start.ps1`)*

### In Command Prompt (CMD):
```cmd
start.bat
```

### In Windows File Explorer:
Double-click [`start.bat`](start.bat).

---

## Typography & Aerospace Font Stack

This application adheres to aerospace human-factors design standards:

* **UI Labels & Interface Controls**:
  ```css
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  ```
* **Telemetry Data Streams & Tabular Indicators**:
  ```css
  font-family: "JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace;
  font-variant-numeric: tabular-nums;
  ```
  *Tabular monospace numbers ensure that high-speed numerical updates (such as pack voltages, current draw, and joint angles) do not vibrate or jitter horizontally.*

---

## Subsystems & Visual Highlights

### 1. Power Subsystem (~20.1V – 20.2V 5S Li-ion Accumulator)
Monitors 4 parallel 5S packs, main bus voltage, current draw, and temperatures with real-time fault isolation.

<p align="center">
  <img src="../docs/images/screenshot-top-panel-battery-states.png" alt="Top Panel Battery HUD" width="100%" />
</p>
<p align="center">
  <img src="../docs/images/screenshot-battery-details-calibrated.png" alt="Standalone Battery Diagnostics Window" width="80%" />
</p>

### 2. Multi-Camera Flexible Layout & Reconnect Watchdog
Integrated as a dedicated **Flexible Layout** tab in Rover Displays (`modes_tab`) with primary hero mast camera, auxiliary feeds, and automated 5-second reconnect watchdog polling.

<p align="center">
  <img src="../docs/images/screenshot-10-cameras-flexible-layout-mixed.png" alt="10-Camera Flexible Layout" width="100%" />
</p>
<p align="center">
  <img src="../docs/images/screenshot-cameras-reconnect-countdown.png" alt="Watchdog Countdown" width="55%" />
  <img src="../docs/images/screenshot-camera-popout-nosignal.png" alt="Camera Popout Window" width="40%" />
</p>

### 3. 5GHz RF Comms & Competition Mission Clock
Monitors wireless link quality, RSSI, SNR, and uplink/downlink throughput alongside ERC competition task countdown timers.

<p align="center">
  <img src="../docs/images/screenshot-antenna-details.png" alt="5GHz RF Comms Diagnostics" width="49%" />
  <img src="../docs/images/screenshot-gantt-nav-running.png" alt="ERC Navigation Task Gantt Clock" width="49%" />
</p>

---

## Plugin Directory Reference

| Plugin / File | Subsystem | Description |
| :--- | :--- | :--- |
| [`orion-battery-plugin.js`](orion-battery-plugin.js) | Power (5S Li-ion) | Parallel bus & 4-pack voltage monitoring (`~20.1V–20.2V`), fault isolation, top panel HUD, and multi-window sync. |
| [`battery-details.html`](battery-details.html) | Power Diagnostics | Standalone secondary window with KPI cards, individual cell badges, 14V–22V trend chart, and actual/simulated mode toggle. |
| [`orion-camera-mosaic-plugin.js`](orion-camera-mosaic-plugin.js) | Vision & Teleop | 10-camera flexible layout tab (`rover_cameras_flex`), individual camera popouts, active timestamps, and 5-second reconnect countdown. |
| [`camera-view.html`](camera-view.html) | Camera View Viewer | Standalone popout camera viewer with native snapshotting and watchdog overlay. |
| [`orion-antenna-plugin.js`](orion-antenna-plugin.js) | 5GHz RF Comms | RF link quality, signal strength (RSSI/SNR), and uplink/downlink throughput monitoring. |
| [`antenna-details.html`](antenna-details.html) | RF Diagnostics | Standalone 5GHz RF telemetry dashboard. |
| [`orion-model-plugin.js`](orion-model-plugin.js) | 3D Digital Twin | Real-time Three.js 3D rendering of [`orion_VI.glb`](orion_VI.glb) with IMU kinematics and joint synchronization. |
| [`orion-attitude-indicator-plugin.js`](orion-attitude-indicator-plugin.js) | Navigation | Real-time artificial horizon displaying pitch, roll, and heading. |
| [`orion-modes-plugin.js`](orion-modes-plugin.js) | Operational Modes | Tabbed views for Teleoperation, Autonomous Navigation, Science Sampling, and Camera Feeds. |
| [`orion-exception-engine.js`](orion-exception-engine.js) | Fault Isolation | Master Caution & Warning annunciators following NASA/ECSS standards. |
| [`orion-task-clock-plugin.js`](orion-task-clock-plugin.js) | Mission Timing | ERC competition task countdown timers and Mission Elapsed Time (MET). |
| [`orion-gamepad-plugin.js`](orion-gamepad-plugin.js) | Controls | Direct HTML5 Gamepad API integration for joystick teleoperation. |
| [`orion-dictionary-plugin.js`](orion-dictionary-plugin.js) | Taxonomy | Open MCT object provider and domain taxonomy mapping. |
| [`orion-telemetry-plugin.js`](orion-telemetry-plugin.js) | Telemetry Ingress | Normalized historical and real-time telemetry providers. |

---

## Detailed Documentation

For comprehensive engineering specifications, see the parent documentation:
* [Master Project README](../README.md)
* [System Architecture Guide](../docs/ARCHITECTURE.md)
* [Battery & Power Subsystem Guide](../docs/BATTERY_SUBSYSTEM.md)
* [Multi-Camera System Guide](../docs/CAMERA_SYSTEM.md)
* [Telemetry Dictionary Reference](../docs/TELEMETRY_DICTIONARY.md)

</div>
