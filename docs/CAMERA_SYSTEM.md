# Orion VI Rover — Multi-Camera & Teleoperation Vision System
### Flexible Layout Integration, Reconnect Watchdogs & Native Snapshotting

This document details the architecture, UI layout, signal-loss watchdog mechanism, and popout viewing capabilities of the **10-Camera Vision System** of the Orion VI Rover.

---

## Visual Interface & Camera Views

### 1. 10-Camera Flexible Layout Tab in Rover Displays
The primary mission perception layout combining hero Mast Camera with auxiliary driving and science feeds:

![10-Camera Flexible Layout](images/screenshot-10-cameras-flexible-layout-mixed.png)

### 2. Signal-Loss Watchdog & Independent Popout Windows
When feed downlink hardware is offline or interrupted, the system automatically engages the high-visibility **`NO SIGNAL`** overlay with live UTC timestamps, 5-second polling watchdog countdown, and standalone popout viewing:

<p align="center">
  <img src="images/screenshot-cameras-reconnect-countdown.png" alt="Watchdog Countdown" width="58%" />
  <img src="images/screenshot-camera-popout-nosignal.png" alt="Standalone Camera Window" width="38%" />
</p>

---

## Typography & HUD Overlay Standards

Overlaid telemetry, UTC clocks, and watchdog counts use the aerospace monospace standard:
```css
font-family: "JetBrains Mono", Consolas, "Courier New", monospace;
font-weight: 700;
letter-spacing: 0.5px;
```
*Monospace font ensures that the countdown timer (`5s -> 4s -> 3s -> 2s -> 1s -> 0s`) and live UTC timestamp (`16:15:32.400`) update with zero horizontal glyph jitter, maintaining clean readability over live video feeds.*

---

## 1. System Overview

Perception and situational awareness are critical during competition teleoperation (traverse, sample collection, equipment servicing). The Orion GCS provides a dedicated multi-camera layout supporting up to 10 cameras located across the rover chassis, mast, and robotic arm:

```
               [ Mast Camera (Hero) ]
                       |
   [ Nav Cam Left ] ---+--- [ Nav Cam Right ]
                       |
       +---------------+---------------+
       |                               |
[ Arm Base Cam ]                [ Chassis Front ]
       |                               |
[ Arm Wrist Cam ]               [ Chassis Rear ]
       |                               |
[ Science Bay Cam ]             [ Underbelly Cam ]
                                       |
                             [ 360° Panoramic Cam ]
```

---

## 2. Layout Architecture

### Flexible Layout Tab (`rover_cameras_flex`)
The camera array is integrated as a native Open MCT **Flexible Layout** contained as a first-class tab within the main **Rover Displays** tabbed container (`orion.taxonomy:modes_tab`).
* **Main Feed (Hero)**: Large high-resolution frame dedicated to the primary **Mast Camera** or active teleoperation camera.
* **Secondary Feeds (Grid)**: Auxiliary camera feeds arranged in a responsive grid layout.
* **Resizing & Rearrangement**: In Open MCT Edit mode, operators can dynamically resize or rearrange camera panes to prioritize task-specific views (e.g. magnifying the Arm Wrist camera during sample manipulation).

### Camera Inventory

| ID | Key | Camera Name | Typical Lens / Purpose | Default Layout Position |
| :---: | :--- | :--- | :--- | :--- |
| **1** | `cam_mast` | **Mast Camera (Hero)** | Narrow FOV / Long-Range Driving & Target ID | Primary Hero Frame |
| **2** | `cam_nav_left` | **Navigation Cam Left** | Wide FOV / Stereo Obstacle Detection | Upper Left Secondary |
| **3** | `cam_nav_right` | **Navigation Cam Right** | Wide FOV / Stereo Obstacle Detection | Upper Right Secondary |
| **4** | `cam_arm_wrist` | **Arm Wrist Camera** | Macro / Gripper Finger Alignment | Center Left Grid |
| **5** | `cam_arm_base` | **Arm Base Camera** | Medium FOV / Manipulator Envelope Clearance | Center Right Grid |
| **6** | `cam_front` | **Chassis Front Cam** | 120° Wide / Forward Wheel Clearance | Lower Left Grid |
| **7** | `cam_rear` | **Chassis Rear Cam** | 120° Wide / Reversing & Tether Clearance | Lower Center Grid |
| **8** | `cam_underbelly` | **Underbelly Cam** | Downward / Rocker-Bogie & Ground Clearance | Lower Right Grid |
| **9** | `cam_science` | **Science Bay Cam** | Enclosed / Carousel & Drill Inspection | Auxiliary Bay |
| **10** | `cam_pano` | **360° Panoramic Cam** | Equirectangular / Mission Scene Context | Top Strip |

---

## 3. Signal Loss Watchdog & Reconnect Mechanism

When physical camera feeds are disconnected, transmitting over noisy RF channels, or when the video downlink hardware is not yet online, the camera viewer triggers an aerospace-standard **NO SIGNAL** state:

```
+--------------------------------------------------------------+
| [LIVE UTC: 2026-09-21 16:15:32 UTC]           [CAM 01: MAST] |
|                                                              |
|                                                              |
|                       [ ORION LOGO ]                         |
|                                                              |
|                         NO SIGNAL                            |
|                 Attempting reconnect in 4s...                |
|                                                              |
|                                                              |
| [Status: AWAITING RTSP DOWNLINK]          [Resolution: AUTO] |
+--------------------------------------------------------------+
```

### Watchdog Rules & Behavior
1. **Visual Elements**:
   - High-contrast glowing red **`NO SIGNAL`** badge (`#ef4444`) centered in frame.
   - Orion Rover emblem displayed in monochrome white with drop shadow.
   - Live UTC timestamp updated continuously every second in the upper-left corner.
2. **Automated Countdown Watchdog**:
   - Displays: `"Attempting reconnect in Xs..."` with a 5-second countdown timer.
   - At count `0`, the client issues a non-blocking poll to `GET /api/camera/:id/feed_status`.
   - If the endpoint reports `online: true`, the placeholder fades out and live video is rendered.
   - If the endpoint reports `online: false`, the 5-second countdown resets and repeats.

---

## 4. Standalone Popout Windows & Open MCT Snapshotting

Each camera view can be opened independently in a dedicated popout window:

### 1. Multi-Monitor Teleoperation
* Clicking the **Popout** icon on any camera frame opens [`camera-view.html?id=X`](../openmct-tutorial/camera-view.html) in an isolated Electron window or browser tab.
* Allows operators to arrange cameras across 2, 3, or more monitors in the ground station command tent.

### 2. Native Snapshotting
* Integrated capture button allows operators to take instant PNG snapshots of any feed.
* Snapshots are timestamped with the current Mission Elapsed Time (MET) and saved for post-mission science reports or engineering debriefings.
