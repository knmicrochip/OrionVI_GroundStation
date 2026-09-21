# Orion VI Rover — Telemetry Dictionary & Taxonomy Reference
### Subsystem Metrics, Engineering Units & Measurement Ranges

This document is the authoritative engineering telemetry dictionary for the **Orion VI Mars Rover Ground Control Station**. All telemetry points registered in [`orion-dictionary-plugin.js`](../openmct-tutorial/orion-dictionary-plugin.js) and ingested by [`telemetry-gateway.js`](../openmct-tutorial/example-server/telemetry-gateway.js) are specified below.

---

## Typography & Monospace Formatting

All telemetry identifiers, raw packet payloads, and numeric measurement streams adhere to the aerospace tabular monospace standard:
```css
font-family: "JetBrains Mono", "Fira Code", Consolas, Monaco, monospace;
font-variant-numeric: tabular-nums;
```
*Fixed-width digits guarantee that rapid numeric values (voltages, currents, joint angles, and GPS coordinates) maintain stable character alignment and column positions across all telemetry tables, plots, and LAD views.*

---

## 1. Taxonomy & Object Hierarchy

All telemetry objects live under the root taxonomy identifier: `orion.taxonomy:spacecraft`

```
orion.taxonomy:spacecraft (Orion VI Rover)
├── power (Power Distribution Subsystem)
├── drive (Mobility & Chassis Subsystem)
├── arm (6-DoF Robotic Manipulator Subsystem)
├── nav (Navigation, IMU & Autonomy Subsystem)
├── science (Science Sampling & Analytical Bay)
└── comms (5GHz RF Communications Link)
```

---

## 2. Telemetry Channels Specification

### 2.1 Power Distribution Subsystem (`power`)

| Identifier Key | Name | Unit | Nominal Range | Warning Limits | Critical Limits |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `rover.power.bus.voltage` | Main DC Bus Voltage | `V` | `20.10 – 20.25` | `< 17.5` / `> 21.4` | `< 16.0` / `> 21.8` |
| `rover.power.bus.current` | Main DC Bus Current | `A` | `5.0 – 25.0` | `> 35.0` | `> 45.0` |
| `rover.power.battery.1.v` | Battery Module 1 Voltage | `V` | `20.10 – 20.25` | `< 17.5` / `> 21.4` | `< 16.0` / `> 21.8` |
| `rover.power.battery.2.v` | Battery Module 2 Voltage | `V` | `20.10 – 20.25` | `< 17.5` / `> 21.4` | `< 16.0` / `> 21.8` |
| `rover.power.battery.3.v` | Battery Module 3 Voltage | `V` | `20.10 – 20.25` | `< 17.5` / `> 21.4` | `< 16.0` / `> 21.8` |
| `rover.power.battery.4.v` | Battery Module 4 Voltage | `V` | `20.10 – 20.25` | `< 17.5` / `> 21.4` | `< 16.0` / `> 21.8` |
| `rover.power.soc` | Overall State of Charge | `%` | `75.0 – 100.0` | `< 30.0` | `< 15.0` |
| `rover.power.temp_c` | Accumulator Temperature | `°C` | `20.0 – 35.0` | `> 45.0` | `< -20.0` / `> 55.0` |

### 2.2 Mobility & Chassis Subsystem (`drive`)

| Identifier Key | Name | Unit | Nominal Range | Description |
| :--- | :--- | :---: | :---: | :--- |
| `rover.drive.speed` | Linear Velocity | `m/s` | `0.0 – 1.8` | Rover ground speed |
| `rover.drive.current.left` | Left Drive Rail Current | `A` | `2.0 – 15.0` | Total left wheel motors current |
| `rover.drive.current.right` | Right Drive Rail Current | `A` | `2.0 – 15.0` | Total right wheel motors current |
| `rover.drive.steering.front` | Front Steering Angle | `deg` | `-45.0 – +45.0` | Front wheel steering angle |
| `rover.drive.steering.rear` | Rear Steering Angle | `deg` | `-45.0 – +45.0` | Rear wheel steering angle |

### 2.3 6-DoF Robotic Manipulator Subsystem (`arm`)

| Identifier Key | Name | Unit | Nominal Range | Description |
| :--- | :--- | :---: | :---: | :--- |
| `rover.arm.active_profile` | Arm Control Mode Profile | `string` | `JOINT / CARTESIAN` | Active kinematic control profile |
| `rover.arm.j1.angle` | Base Turret Rotation (J1) | `deg` | `-170.0 – +170.0` | Azimuth angle |
| `rover.arm.j2.angle` | Shoulder Pitch (J2) | `deg` | `-90.0 – +90.0` | Primary elevation angle |
| `rover.arm.j3.angle` | Elbow Pitch (J3) | `deg` | `-135.0 – +135.0` | Secondary reach angle |
| `rover.arm.j4.angle` | Wrist Pitch (J4) | `deg` | `-100.0 – +100.0` | End-effector pitch |
| `rover.arm.j5.angle` | Wrist Roll (J5) | `deg` | `-180.0 – +180.0` | End-effector continuous roll |
| `rover.arm.j6.angle` | Wrist Yaw (J6) | `deg` | `-90.0 – +90.0` | Fine gripping alignment |
| `rover.arm.gripper.state` | End-Effector Gripper State | `string` | `OPEN / CLOSED` | Mechanical clamp feedback |
| `rover.arm.gripper.force` | Gripper Grasp Force | `N` | `0.0 – 120.0` | Force sensor feedback |

### 2.4 Navigation & IMU Pose Subsystem (`nav`)

| Identifier Key | Name | Unit | Nominal Range | Description |
| :--- | :--- | :---: | :---: | :--- |
| `rover.nav.estop.status` | Emergency Stop Status | `string` | `NOMINAL / ARMED` | Hardware E-Stop chain state |
| `rover.nav.mode` | System Operational Mode | `string` | `TELEOP / AUTO / SCI` | Active control paradigm |
| `rover.nav.task.state` | Competition Task State | `string` | `RUNNING / PAUSED` | ERC task execution state |
| `rover.nav.imu.pitch` | Vehicle Chassis Pitch | `deg` | `-25.0 – +25.0` | Fore-aft incline |
| `rover.nav.imu.roll` | Vehicle Chassis Roll | `deg` | `-25.0 – +25.0` | Lateral tilt |
| `rover.nav.imu.heading` | Compass Heading | `deg` | `0.0 – 359.9` | Magnetic / odometry azimuth |
| `rover.nav.gps.lat` | GPS Latitude Coordinate | `deg` | `Decimal Deg` | Current location coordinate |
| `rover.nav.gps.lon` | GPS Longitude Coordinate | `deg` | `Decimal Deg` | Current location coordinate |

### 2.5 Science Sampling Subsystem (`science`)

| Identifier Key | Name | Unit | Nominal Range | Description |
| :--- | :--- | :---: | :---: | :--- |
| `rover.science.analysis.active` | Science Run Active | `bool` | `true / false` | Assay execution status |
| `rover.science.carousel.index` | Carousel Sample Tube Index | `int` | `1 – 6` | Selected collection vial |
| `rover.science.drill.depth` | Subsurface Drill Depth | `mm` | `0 – 300` | Depth into Martian regolith simulant |
| `rover.science.soil.moisture` | Regolith Moisture Index | `%` | `0.0 – 100.0` | Capacitive soil sensor |
| `rover.science.spec.status` | UV Spectrometer Status | `string` | `IDLE / SCANNING` | Optical spectrometer sensor |

### 2.6 5GHz RF Communications Link Subsystem (`comms`)

| Identifier Key | Name | Unit | Nominal Range | Description |
| :--- | :--- | :---: | :---: | :--- |
| `rover.comms.rf.link_quality` | RF Link Quality Index | `%` | `70.0 – 100.0` | Composite wireless link health |
| `rover.comms.rf.rssi` | Signal Strength (RSSI) | `dBm` | `-45 – -70` | Received signal strength indicator |
| `rover.comms.rf.snr` | Signal-to-Noise Ratio | `dB` | `25 – 45` | RF margin above noise floor |
| `rover.comms.rf.downlink_mbps` | Video & Data Downlink Rate | `Mbps` | `20.0 – 150.0` | High-bandwidth video transmission |
| `rover.comms.rf.uplink_mbps` | Command Uplink Rate | `Mbps` | `5.0 – 25.0` | Control and commanding bandwidth |

---

## 3. Ingestion Payloads (JSON Schemas)

### 3.1 Primary Power Telemetry Packet (`Power/feedback`)
Published over MQTT to the `Power/feedback` topic at 5Hz:
```json
{
  "voltage_bus": 20.16,
  "v1": 20.18,
  "v2": 20.12,
  "v3": 20.21,
  "v4": 20.15,
  "temp_c": 28.2,
  "current_total": 12.50,
  "adcs": {
    "wl": 1024,
    "wr": 1018,
    "ram": 512,
    "elek": 820,
    "sci": 120,
    "inne": 45
  },
  "timestamp": 1726748900000
}
```

### 3.2 WebSocket Streaming Packet (`/realtime`)
Dispatched to Open MCT clients over the WebSocket feed:
```json
{
  "id": "rover.power.bus.voltage",
  "value": 20.16,
  "timestamp": 1726748900000
}
```

