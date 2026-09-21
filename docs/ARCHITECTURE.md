# Orion VI GCS — Architecture & Data Flow Guide
### European Rover Challenge (ERC 2026/27) | KN MicroChip

This document provides a technical specification of the software architecture, data flow pipelines, communication protocols, and state synchronization mechanisms within the **Orion VI Ground Control Station (GCS)**.

![Orion VI Main Teleoperation Display](images/screenshot-clean-teleop-display.png)

---

## Typography & Interface Font Specification

The Ground Control Station enforces strict typography rules based on **NASA-STD-3001** (Human Integration Design Handbook) and **ECSS-E-ST-70-11C** (Space Engineering: Space segment operations):

```
+-----------------------------------------------------------------------------------------+
| Element Type        | Target Font Family                                                |
+---------------------+-------------------------------------------------------------------+
| System Headings     | -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif |
| Form Controls & Menus| -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif |
| Live Sensor Feeds   | "JetBrains Mono", Consolas, Monaco, "Courier New", monospace       |
| Status Badges (OK/WARN)| "SFMono-Regular", Consolas, monospace (font-weight: 800)       |
| Time & GPS Telemetry| "JetBrains Mono", monospace (font-variant-numeric: tabular-nums)  |
+-----------------------------------------------------------------------------------------+
```

### Purpose of Fixed-Width (Tabular) Numerics
High-frequency telemetry updates (such as bus current or battery voltage fluctuating at 10Hz) cause horizontal visual jitter if proportional fonts are used, inducing operator reading errors. All telemetry displays throughout the Orion GCS use monospace tabular digits (`font-variant-numeric: tabular-nums`).

---

## 1. System High-Level Topology

The Orion VI Ground Control Station is organized into three distinct tiers:

```
+-------------------------------------------------------------+
|                      1. PHYSICAL ROVER                      |
|  - STM32 / ESP32 Power BMS & Sensors                        |
|  - Raspberry Pi / Jetson On-Board Computer                  |
|  - Mosquitto MQTT Broker (192.168.1.1:1883)                 |
+------------------------------+------------------------------+
                               |
                   5GHz Wi-Fi / Ethernet TCP
                               |
+------------------------------v------------------------------+
|                   2. GROUND STATION GATEWAY                 |
|  - Express HTTP & WebSocket Server (port 8088)              |
|  - MQTT-to-WebSocket Bridge (example-server/mqtt-bridge.js) |
|  - In-Memory Telemetry Ring Buffers (2,000 points/channel)  |
|  - REST APIs: Commanding, Camera Watchdog, History          |
+------------------------------+------------------------------+
                               |
              Local IPC / WebSocket / BroadcastChannel
                               |
+------------------------------v------------------------------+
|                     3. MISSION CONTROL UI                   |
|  - NASA Open MCT Shell (Custom Aerospace Dark Theme)        |
|  - Three.js 3D Rover Kinematics Digital Twin                |
|  - Real-time LAD Tables, Condition Sets & Strip Charts      |
|  - Multi-Window Subsystems (Battery, Antenna, Cameras)      |
+-------------------------------------------------------------+
```

---

## 2. Ingress & Transport Pipelines

### 2.1 Rover Ingress (MQTT)
* **Broker**: Mosquitto MQTT broker hosted on the rover's primary on-board computer (`192.168.1.1:1883`).
* **Connection**: The GCS backend establishes an outbound TCP socket to the broker using the `mqtt` library (`example-server/mqtt-bridge.js`).
* **Topics Ingested**:
  - `Power/#`: Comprehensive power bus, individual battery pack voltages, current draw, and temperatures.
  - `rover/nav/#`: Navigation state, GPS coordinates, IMU attitude (pitch, roll, yaw), odometry.
  - `rover/arm/#`: 6-axis joint angles, Cartesian end-effector coordinates, gripper state.
  - `rover/science/#`: Soil sensor readings, carousel position, UV/fluorescence spectrometer data.
  - `rover/antenna/#`: 5GHz wireless transceiver link metrics (RSSI, SNR, throughput, retry rates).

### 2.2 In-Memory Telemetry Gateway (`example-server/telemetry-gateway.js`)
* Stores the latest state of all telemetry channels in memory (`Map<string, TelemetryPoint>`).
* Maintains a historical FIFO ring buffer of up to **2,000 records per channel** to support instant telemetry backfilling when new views or graphs are opened in Open MCT.
* Handles simulation mode toggles: when offline, the gateway can generate realistic synthetic telemetry for mission practice and automated testing.

### 2.3 Client Egress (WebSocket & REST)
* **Realtime Stream**: `/realtime` (WebSocket). When Open MCT views subscribe to a telemetry point (e.g. `subscribe rover.power.bus.voltage`), the gateway dispatches new samples as JSON packets over WebSocket at up to 10Hz.
* **Historical Queries**: `GET /history/:pointId?start=:ms&end=:ms`. Open MCT queries this endpoint when initial plots and tables load to fetch time-series historical windows.
* **Command Dispatch**: `POST /api/command`. Transmits JSON payloads (`{ action: 'estop' }`, `{ action: 'set_mode', mode: 'teleop' }`) from GCS UI to the rover.

---

## 3. Open MCT Frontend Integration

### 3.1 Plugin Ecosystem
The Open MCT frontend (`openmct-tutorial/index.html`) installs both standard Open MCT components and custom Orion plugins:

```mermaid
graph TD
    OMCT[NASA Open MCT Core]
    
    subgraph CorePlugins [Standard Core Plugins]
        P_Storage[LocalStorage]
        P_Conductor[Time Conductor]
        P_Plot[Plot & Overlay Plot]
        P_LAD[LAD Tables]
        P_Flex[Flexible Layouts]
        P_Tabs[Tabs View]
    end

    subgraph OrionPlugins [Custom Orion Mission Plugins]
        O_Dict[OrionDictionaryPlugin]
        O_Telem[OrionTelemetryPlugin]
        O_Batt[OrionBatteryPlugin]
        O_Cam[OrionCameraMosaicPlugin]
        O_Ant[OrionAntennaPlugin]
        O_3D[OrionModelPlugin]
        O_Exc[OrionExceptionEngine]
        O_Clock[OrionTaskClockPlugin]
        O_Modes[OrionModesPlugin]
    end

    OMCT --> CorePlugins
    OMCT --> OrionPlugins
```

### 3.2 Taxonomy & Object Tree (`orion-dictionary-plugin.js`)
The rover telemetry points are exposed as native Open MCT **Domain Objects** arranged in a hierarchical tree:
* `Orion VI Rover` (Root Folder)
  * `Power System`: Bus Voltage, Bus Current, Battery 1..4 Voltages, Battery Temperatures, SoC.
  * `Drive & Mobility`: Left/Right Speeds, Wheel Current, Steering Angles.
  * `Manipulator (Arm)`: Joints J1–J6, Gripper Position, Effort/Torque.
  * `Navigation & Pose`: Pitch, Roll, Heading, Lat/Long Coordinates, Obstacle Distance.
  * `Science Bay`: Carousel Index, Drill Depth, Moisture Sensor, Spectrometer Status.
  * `Communications`: 5GHz RSSI, SNR, Downlink Throughput, Uplink Throughput.

---

## 4. Multi-Window IPC & State Synchronization

The Orion GCS allows mission operators to detach critical views into independent windows across multiple monitors (e.g. detailed battery telemetry, RF comms, and detached camera feeds).

<p align="center">
  <img src="images/screenshot-battery-details-calibrated.png" alt="Battery Diagnostics Window" width="49%" />
  <img src="images/screenshot-antenna-details.png" alt="Antenna Diagnostics Window" width="49%" />
</p>

### 4.1 BroadcastChannel Synchronization
* **Channel Name**: `orion-battery-sync`
* **Mechanism**: When an operator switches between **ACTUAL** and **SIMULATED** telemetry in either the main Open MCT window or the detached [`battery-details.html`](../openmct-tutorial/battery-details.html) window, a message is broadcast:
  ```json
  { "action": "switch_mode", "mode": "actual", "timestamp": 1726748900000 }
  ```
* All open windows immediately listen and synchronize their UI state without requiring a page reload.

### 4.2 Electron Window Intercepts (`main.js`)
In Electron desktop mode, `webContents.setWindowOpenHandler()` intercepts popouts:
- Windows opening `battery-details.html`, `antenna-details.html`, or `camera-view.html` are configured with native frameless or dedicated aspect ratios, persistent dimensions, and automatic menu suppression.

---

## 5. Styling & Visual Standards (NASA-STD-3001)

The Ground Control Station complies with strict aerospace human factors standards:
1. **Square Edges (`0px !important`)**: All rounded corners are overridden to 0px across all panels, frames, and buttons for maximum visual density and sharp professional alignment.
2. **High-Contrast Dark Theme (`#121212`)**: Background luminance is minimized (`#121212` / `#161616`) to reduce glare in low-light command tents during competition field operations.
3. **Master Caution & Warning (MC&W)**:
   - **Critical / Danger**: `#ef4444` (Pure red, high urgency).
   - **Warning / Caution**: `#f59e0b` (Amber/yellow, attention required).
   - **Nominal / OK**: `#10b981` (Bright emerald green).
   - **Offline / Inactive**: `#64748b` (Neutral slate gray).
4. **Non-Intrusive Notifications**: Routine connection handshakes and transient telemetry packet delays do NOT spawn persistent toast banners, preventing UI clutter during operations.

