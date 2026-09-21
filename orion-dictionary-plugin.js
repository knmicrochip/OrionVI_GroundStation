/**
 * Orion VI Taxonomy & Dictionary Plugin (ERC 2026)
 * Native NASA Open MCT Product Tree & Display Layouts
 * 
 * Orion GS
 * ├── Rover
 * │   ├── Chassis / Drive
 * │   ├── Power
 * │   ├── Compute / Net
 * │   ├── Perception
 * │   ├── Navigation
 * │   ├── Manipulator
 * │   ├── Science
 * │   └── Safety
 * ├── Base Station
 * ├── Task Plans
 * └── Displays
 *     ├── OPERATING MODES (TABS)
 *     ├── HEALTH / OVERVIEW (Display Layout)
 *     ├── TELEOP (Display Layout)
 *     ├── NAV / AUTONOMY (Display Layout)
 *     ├── MANIPULATOR (Display Layout)
 *     ├── SCIENCE (Display Layout)
 *     ├── MAINTENANCE (Display Layout)
 *     └── SAFETY / COMM (Display Layout)
 */

(function () {
    const TAXONOMY_NAMESPACE = 'orion.taxonomy';

    const TASK_PLANS_DATA = {
        nav: {
            id: 'navigation',
            name: 'Navigation Traverse Plan',
            steps: [
                { id: 'nav_arm_gnss_init', name: 'Arm Transit Stow & RTAB-Map Init', durationM: 2, swimlane: 'Safety', color: '#ef4444' },
                { id: 'nav_wp1', name: 'Waypoint 1 (Traverse & Tag)', durationM: 5, swimlane: 'Drive', color: '#22c55e' },
                { id: 'nav_wp2', name: 'Waypoint 2 (Obstacle Avoidance)', durationM: 5, swimlane: 'Drive', color: '#22c55e' },
                { id: 'nav_wp3', name: 'Waypoint 3 (Rocker Compliance Test)', durationM: 5, swimlane: 'Drive', color: '#22c55e' },
                { id: 'nav_wp4', name: 'Waypoint 4 (Crater Rim)', durationM: 5, swimlane: 'Drive', color: '#22c55e' },
                { id: 'nav_wp5', name: 'Waypoint 5 (Final Target)', durationM: 5, swimlane: 'Drive', color: '#22c55e' },
                { id: 'nav_recovery_reserve', name: 'Recovery Reserve Window', durationM: 5, swimlane: 'Safety', color: '#f59e0b' },
                { id: 'nav_slack', name: 'Mission Halt & Parking', durationM: 3, swimlane: 'Safety', color: '#64748b' }
            ]
        },
        science: {
            id: 'science',
            name: 'Science Task Plan',
            steps: [
                { id: 'sci_safety_link', name: 'Safety & Link Verification', durationM: 2, swimlane: 'Safety', color: '#ef4444' },
                { id: 'sci_drive_site_a', name: 'Drive to Site A', durationM: 6, swimlane: 'Drive', color: '#22c55e' },
                { id: 'sci_sample_1', name: 'Surface Sample 1 Acquisition', durationM: 5, swimlane: 'Science', color: '#a855f7' },
                { id: 'sci_drive_site_b', name: 'Drive to Site B', durationM: 5, swimlane: 'Drive', color: '#22c55e' },
                { id: 'sci_sample_2', name: 'Surface Sample 2 Acquisition', durationM: 5, swimlane: 'Science', color: '#a855f7' },
                { id: 'sci_deep_sample', name: 'Deep Stratum Sample Collection', durationM: 8, swimlane: 'Science', color: '#a855f7' },
                { id: 'sci_photos', name: 'On-Board Laboratory Inspection Photos', durationM: 4, swimlane: 'Science', color: '#a855f7' },
                { id: 'sci_stow', name: 'Arm & Science Tool Stow', durationM: 3, swimlane: 'Arm', color: '#f97316' },
                { id: 'sci_slack', name: 'Contingency Slack & Debrief', durationM: 2, swimlane: 'Safety', color: '#64748b' }
            ]
        },
        maintenance: {
            id: 'maintenance',
            name: 'Maintenance Task Plan',
            steps: [
                { id: 'maint_approach', name: 'Approach ERC Maintenance Panel', durationM: 4, swimlane: 'Drive', color: '#22c55e' },
                { id: 'maint_switches', name: 'Toggle Power & Safety Switches', durationM: 6, swimlane: 'Arm', color: '#f97316' },
                { id: 'maint_electrical', name: 'Electrical Voltage Measurement', durationM: 5, swimlane: 'Arm', color: '#f97316' },
                { id: 'maint_em_lock', name: 'Release Electro-Magnetic Lock', durationM: 4, swimlane: 'Arm', color: '#f97316' },
                { id: 'maint_rj45', name: 'Connect RJ-45 Ethernet Cable', durationM: 6, swimlane: 'Arm', color: '#f97316' },
                { id: 'maint_photos', name: 'Document Completed Panel State', durationM: 3, swimlane: 'Science', color: '#a855f7' },
                { id: 'maint_backoff', name: 'Back Off & Stow Manipulator', durationM: 2, swimlane: 'Drive', color: '#22c55e' }
            ]
        },
        probing: {
            id: 'probing',
            name: 'Probing Task Plan',
            steps: [
                { id: 'probe_search_1', name: 'Search & Locate Probe 1', durationM: 6, swimlane: 'Drive', color: '#22c55e' },
                { id: 'probe_stow_1', name: 'Pick & Stow Probe 1', durationM: 4, swimlane: 'Arm', color: '#f97316' },
                { id: 'probe_search_2', name: 'Search & Locate Probe 2', durationM: 6, swimlane: 'Drive', color: '#22c55e' },
                { id: 'probe_stow_2', name: 'Pick & Stow Probe 2', durationM: 4, swimlane: 'Arm', color: '#f97316' },
                { id: 'probe_search_3', name: 'Search & Locate Probe 3', durationM: 6, swimlane: 'Drive', color: '#22c55e' },
                { id: 'probe_stow_3', name: 'Pick & Stow Probe 3', durationM: 4, swimlane: 'Arm', color: '#f97316' },
                { id: 'probe_confirm', name: 'Confirm 3 Probes Aboard', durationM: 2, swimlane: 'Science', color: '#a855f7' }
            ]
        }
    };

    function generateOpenMctPlanBody(taskKey, baseTime) {
        if (typeof window !== 'undefined' && window.OrionTimelineStore) {
            return window.OrionTimelineStore.generatePlanBody(taskKey, baseTime);
        }
        const template = TASK_PLANS_DATA[taskKey] || TASK_PLANS_DATA.nav;
        let t0;
        if (typeof baseTime === 'number' && baseTime > 0) {
            t0 = baseTime;
        } else if (typeof window !== 'undefined' && window.OrionTaskManager && window.OrionTaskManager.state && window.OrionTaskManager.state.state === 'RUNNING' && window.OrionTaskManager.state.t0) {
            t0 = window.OrionTaskManager.state.t0;
        } else {
            // Standby state: timeline not initiated yet. Anchor 60s in future so cursor is before start line
            t0 = Date.now() + 60 * 1000;
        }
        const body = {};
        let cursor = t0;

        template.steps.forEach(step => {
            const start = cursor;
            const end = cursor + (step.durationM * 60 * 1000);
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

    const MEASUREMENTS = [
        // Chassis / Drive
        { key: 'rover.drive.speed.fl', name: 'Wheel Speed FL', category: 'chassis_drive', unit: 'RPM', min: -100, max: 100 },
        { key: 'rover.drive.speed.ml', name: 'Wheel Speed ML', category: 'chassis_drive', unit: 'RPM', min: -100, max: 100 },
        { key: 'rover.drive.speed.rl', name: 'Wheel Speed RL', category: 'chassis_drive', unit: 'RPM', min: -100, max: 100 },
        { key: 'rover.drive.speed.fr', name: 'Wheel Speed FR', category: 'chassis_drive', unit: 'RPM', min: -100, max: 100 },
        { key: 'rover.drive.speed.mr', name: 'Wheel Speed MR', category: 'chassis_drive', unit: 'RPM', min: -100, max: 100 },
        { key: 'rover.drive.speed.rr', name: 'Wheel Speed RR', category: 'chassis_drive', unit: 'RPM', min: -100, max: 100 },
        { key: 'rover.drive.current.fl', name: 'Wheel Current FL', category: 'chassis_drive', unit: 'A', min: 0, max: 15 },
        { key: 'rover.drive.current.ml', name: 'Wheel Current ML', category: 'chassis_drive', unit: 'A', min: 0, max: 15 },
        { key: 'rover.drive.current.rl', name: 'Wheel Current RL', category: 'chassis_drive', unit: 'A', min: 0, max: 15 },
        { key: 'rover.drive.current.fr', name: 'Wheel Current FR', category: 'chassis_drive', unit: 'A', min: 0, max: 15 },
        { key: 'rover.drive.current.mr', name: 'Wheel Current MR', category: 'chassis_drive', unit: 'A', min: 0, max: 15 },
        { key: 'rover.drive.current.rr', name: 'Wheel Current RR', category: 'chassis_drive', unit: 'A', min: 0, max: 15 },
        { key: 'rover.drive.state', name: 'Drive State', category: 'chassis_drive', format: 'string' },
        { key: 'rover.drive.speed_limit', name: 'Speed Limit', category: 'chassis_drive', unit: 'm/s', min: 0, max: 3.0 },
        { key: 'rover.drive.suspension_angle', name: 'Rocker Differential Angle', category: 'chassis_drive', unit: 'deg', min: -45, max: 45 },

        // Power System
        { key: 'rover.power.bus.voltage', name: 'Main Bus Voltage (20V)', category: 'power', unit: 'V', min: 14, max: 22 },
        { key: 'rover.power.bus.current', name: 'Total Bus Current', category: 'power', unit: 'A', min: 0, max: 40 },
        { key: 'rover.power.battery.1.v', name: 'Pack 1 Voltage', category: 'power', unit: 'V', min: 14, max: 21.5 },
        { key: 'rover.power.battery.1.i', name: 'Pack 1 Current', category: 'power', unit: 'A', min: 0, max: 10 },
        { key: 'rover.power.battery.1.temp', name: 'Pack 1 Temperature', category: 'power', unit: '°C', min: 0, max: 60 },
        { key: 'rover.power.battery.1.soc', name: 'Pack 1 SoC', category: 'power', unit: '%', min: 0, max: 100 },
        { key: 'rover.power.battery.2.v', name: 'Pack 2 Voltage', category: 'power', unit: 'V', min: 14, max: 21.5 },
        { key: 'rover.power.battery.2.i', name: 'Pack 2 Current', category: 'power', unit: 'A', min: 0, max: 10 },
        { key: 'rover.power.battery.2.temp', name: 'Pack 2 Temperature', category: 'power', unit: '°C', min: 0, max: 60 },
        { key: 'rover.power.battery.2.soc', name: 'Pack 2 SoC', category: 'power', unit: '%', min: 0, max: 100 },
        { key: 'rover.power.battery.3.v', name: 'Pack 3 Voltage', category: 'power', unit: 'V', min: 14, max: 21.5 },
        { key: 'rover.power.battery.3.i', name: 'Pack 3 Current', category: 'power', unit: 'A', min: 0, max: 10 },
        { key: 'rover.power.battery.3.temp', name: 'Pack 3 Temperature', category: 'power', unit: '°C', min: 0, max: 60 },
        { key: 'rover.power.battery.3.soc', name: 'Pack 3 SoC', category: 'power', unit: '%', min: 0, max: 100 },
        { key: 'rover.power.battery.4.v', name: 'Pack 4 Voltage', category: 'power', unit: 'V', min: 14, max: 21.5 },
        { key: 'rover.power.battery.4.i', name: 'Pack 4 Current', category: 'power', unit: 'A', min: 0, max: 10 },
        { key: 'rover.power.battery.4.temp', name: 'Pack 4 Temperature', category: 'power', unit: '°C', min: 0, max: 60 },
        { key: 'rover.power.battery.4.soc', name: 'Pack 4 SoC', category: 'power', unit: '%', min: 0, max: 100 },

        // 6 Power Rails
        { key: 'rover.power.rail.drive.v', name: 'Rail 1 Drive V', category: 'power', unit: 'V' },
        { key: 'rover.power.rail.drive.i', name: 'Rail 1 Drive Current', category: 'power', unit: 'A' },
        { key: 'rover.power.rail.drive.state', name: 'Rail 1 Drive State', category: 'power', format: 'number' },
        { key: 'rover.power.rail.jetson.v', name: 'Rail 2 Jetson V', category: 'power', unit: 'V' },
        { key: 'rover.power.rail.jetson.i', name: 'Rail 2 Jetson Current', category: 'power', unit: 'A' },
        { key: 'rover.power.rail.jetson.state', name: 'Rail 2 Jetson State', category: 'power', format: 'number' },
        { key: 'rover.power.rail.rpi_esp.v', name: 'Rail 3 RPi/ESP V', category: 'power', unit: 'V' },
        { key: 'rover.power.rail.rpi_esp.i', name: 'Rail 3 RPi/ESP Current', category: 'power', unit: 'A' },
        { key: 'rover.power.rail.rpi_esp.state', name: 'Rail 3 RPi/ESP State', category: 'power', format: 'number' },
        { key: 'rover.power.rail.arm.v', name: 'Rail 4 Manipulator V', category: 'power', unit: 'V' },
        { key: 'rover.power.rail.arm.i', name: 'Rail 4 Manipulator Current', category: 'power', unit: 'A' },
        { key: 'rover.power.rail.arm.state', name: 'Rail 4 Manipulator State', category: 'power', format: 'number' },
        { key: 'rover.power.rail.science.v', name: 'Rail 5 Science V', category: 'power', unit: 'V' },
        { key: 'rover.power.rail.science.i', name: 'Rail 5 Science Current', category: 'power', unit: 'A' },
        { key: 'rover.power.rail.science.state', name: 'Rail 5 Science State', category: 'power', format: 'number' },
        { key: 'rover.power.rail.comms.v', name: 'Rail 6 Comms V', category: 'power', unit: 'V' },
        { key: 'rover.power.rail.comms.i', name: 'Rail 6 Comms Current', category: 'power', unit: 'A' },
        { key: 'rover.power.rail.comms.state', name: 'Rail 6 Comms State', category: 'power', format: 'number' },

        // Compute / Net
        { key: 'rover.compute.jetson.cpu_temp', name: 'Jetson CPU Temp', category: 'compute_net', unit: '°C', min: 20, max: 90 },
        { key: 'rover.compute.jetson.gpu_temp', name: 'Jetson GPU Temp', category: 'compute_net', unit: '°C', min: 20, max: 90 },
        { key: 'rover.compute.jetson.ram_pct', name: 'Jetson RAM Usage', category: 'compute_net', unit: '%', min: 0, max: 100 },
        { key: 'rover.compute.jetson.cpu_pct', name: 'Jetson CPU Usage', category: 'compute_net', unit: '%', min: 0, max: 100 },
        { key: 'rover.compute.rpi.cpu_temp', name: 'RPi 5 CPU Temp', category: 'compute_net', unit: '°C', min: 20, max: 85 },
        { key: 'rover.compute.rpi.ram_pct', name: 'RPi 5 RAM Usage', category: 'compute_net', unit: '%', min: 0, max: 100 },
        { key: 'rover.compute.rpi.load', name: 'RPi 5 System Load', category: 'compute_net', unit: '', min: 0, max: 4.0 },
        { key: 'rover.net.latency', name: '5GHz Link Latency', category: 'compute_net', unit: 'ms', min: 0, max: 200 },
        { key: 'rover.net.rssi', name: '5GHz Link RSSI', category: 'compute_net', unit: 'dBm', min: -90, max: -30 },
        { key: 'rover.net.bitrate_down', name: 'Downlink Throughput', category: 'compute_net', unit: 'Mbps', min: 0, max: 50 },
        { key: 'rover.net.packet_loss', name: 'Packet Loss', category: 'compute_net', unit: '%', min: 0, max: 10 },

        // Rover Logs & Events
        { key: 'rover.logs.latest', name: 'Rover Latest Log Message', category: 'compute_net', format: 'string' },
        { key: 'rover.logs.count', name: 'Rover Total Log Messages', category: 'compute_net', format: 'number' },
        { key: 'rover.logs.level', name: 'Rover Latest Log Level', category: 'compute_net', format: 'string' },

        // Perception
        { key: 'rover.perception.realsense.alive', name: 'RealSense Alive', category: 'perception', format: 'number' },
        { key: 'rover.perception.realsense.fps', name: 'RealSense FPS', category: 'perception', unit: 'FPS', min: 0, max: 60 },
        { key: 'rover.perception.realsense.temp', name: 'RealSense Temp', category: 'perception', unit: '°C' },
        { key: 'rover.perception.active_cam', name: 'Active Cam Channel', category: 'perception', format: 'number' },
        { key: 'rover.perception.video_bitrate', name: 'Downlink Bitrate', category: 'perception', unit: 'Mbps' },

        // Navigation
        { key: 'rover.nav.pitch', name: 'IMU Pitch', category: 'navigation', unit: 'deg', min: -90, max: 90 },
        { key: 'rover.nav.roll', name: 'IMU Roll', category: 'navigation', unit: 'deg', min: -90, max: 90 },
        { key: 'rover.nav.yaw', name: 'IMU Yaw', category: 'navigation', unit: 'deg', min: 0, max: 360 },
        { key: 'rover.nav.pose_x', name: 'Pose X', category: 'navigation', unit: 'm' },
        { key: 'rover.nav.pose_y', name: 'Pose Y', category: 'navigation', unit: 'm' },
        { key: 'rover.nav.heading', name: 'Heading', category: 'navigation', unit: 'deg' },
        { key: 'rover.nav.nav2_state', name: 'NAV2 State', category: 'navigation', format: 'string' },
        { key: 'rover.nav.slam_health', name: 'SLAM Health', category: 'navigation', format: 'string' },
        { key: 'rover.nav.slam_keyframes', name: 'SLAM Keyframes', category: 'navigation', format: 'number' },
        { key: 'rover.nav.target_wp_dist', name: 'Waypoint Distance', category: 'navigation', unit: 'm' },
        { key: 'rover.nav.target_wp_bearing', name: 'Waypoint Bearing', category: 'navigation', unit: 'deg' },
        { key: 'rover.nav.autonomy_mode', name: 'Autonomy Mode', category: 'navigation', format: 'string' },

        // Manipulator
        { key: 'rover.arm.joint.base', name: 'Base Rotation', category: 'manipulator', unit: 'deg', min: -180, max: 180 },
        { key: 'rover.arm.joint.shoulder', name: 'Shoulder Angle', category: 'manipulator', unit: 'deg', min: -90, max: 90 },
        { key: 'rover.arm.joint.elbow', name: 'Elbow Angle', category: 'manipulator', unit: 'deg', min: -135, max: 135 },
        { key: 'rover.arm.joint.wrist_pitch', name: 'Wrist Pitch', category: 'manipulator', unit: 'deg' },
        { key: 'rover.arm.joint.wrist_roll', name: 'Wrist Roll', category: 'manipulator', unit: 'deg' },
        { key: 'rover.arm.joint.gripper', name: 'Gripper Aperture', category: 'manipulator', unit: '%', min: 0, max: 100 },
        { key: 'rover.arm.joint.load.shoulder', name: 'Shoulder Load', category: 'manipulator', unit: 'A' },
        { key: 'rover.arm.joint.load.elbow', name: 'Elbow Load', category: 'manipulator', unit: 'A' },
        { key: 'rover.arm.gripper_id', name: 'Active Gripper', category: 'manipulator', format: 'string' },
        { key: 'rover.arm.pose', name: 'Arm Pose', category: 'manipulator', format: 'string' },

        // Science
        { key: 'rover.science.vacuum_state', name: 'Vacuum State', category: 'science', format: 'string' },
        { key: 'rover.science.vacuum_pwm', name: 'Vacuum PWM', category: 'science', unit: '%', min: 0, max: 100 },
        { key: 'rover.science.nozzle_rpm', name: 'Nozzle Speed', category: 'science', unit: 'RPM', min: 0, max: 800 },
        { key: 'rover.science.gas_blast', name: 'Gas Blast Valve', category: 'science', format: 'string' },
        { key: 'rover.science.cyclone_door', name: 'Cyclone Door', category: 'science', format: 'string' },
        { key: 'rover.science.tensometer_weight', name: 'Sample Weight', category: 'science', unit: 'g', min: 0, max: 200 },
        { key: 'rover.science.fluid_level', name: 'Fluid Reservoir', category: 'science', unit: '%', min: 0, max: 100 },
        { key: 'rover.science.sample_count', name: 'Sample Count', category: 'science', format: 'number' },
        { key: 'rover.science.pressure', name: 'Duct Pressure', category: 'science', unit: 'kPa' },

        // Safety
        { key: 'rover.safety.estop_hardware', name: 'ABB E-Stop Relay', category: 'safety', format: 'number' },
        { key: 'rover.safety.kill_chain_state', name: 'Kill Chain State', category: 'safety', format: 'string' },
        { key: 'rover.safety.heartbeat_timer', name: 'Heartbeat Watchdog', category: 'safety', unit: 's', min: 0, max: 5.0 },
        { key: 'rover.safety.uvlo_tripped', name: 'UVLO Trigger', category: 'safety', format: 'number' },
        { key: 'rover.safety.enclosure_temp', name: 'Compartment Temp', category: 'safety', unit: '°C' },
        { key: 'rover.safety.last_trip_reason', name: 'Last Inhibit Reason', category: 'safety', format: 'string' },

        // Base Station
        { key: 'base.laptop.battery_soc', name: 'GS Laptop Battery', category: 'base_station', unit: '%', min: 0, max: 100 },
        { key: 'base.laptop.ping_ms', name: 'Base Gateway Ping', category: 'base_station', unit: 'ms' },
        { key: 'base.gamepad.connected', name: 'Gamepad Connected', category: 'base_station', format: 'number' },
        { key: 'base.gamepad.deadman_active', name: 'Deadman Switch', category: 'base_station', format: 'number' },
        { key: 'base.ubiquiti.rssi_dbm', name: 'Ubiquiti Base RSSI', category: 'base_station', unit: 'dBm' }
    ];

    const FOLDERS = {
        'root': {
            name: 'Orion GS',
            children: ['rover', 'disp_cameras', 'displays', 'task_plans', 'base_station']
        },
        'rover': {
            name: 'Rover',
            location: 'root',
            children: [
                'chassis_drive',
                'power',
                'compute_net',
                'perception',
                'navigation',
                'manipulator',
                'science',
                'safety'
            ]
        },
        'chassis_drive': { name: 'Chassis / Drive', location: 'rover' },
        'power': { name: 'Power', location: 'rover' },
        'compute_net': { name: 'Compute / Net', location: 'rover' },
        'perception': {
            name: 'Perception (Cameras)',
            location: 'rover',
            children: [
                'cam_mast_rgb',
                'cam_mast_depth',
                'cam_haz_fl',
                'cam_haz_fr',
                'cam_haz_rear',
                'cam_arm_wrist',
                'cam_arm_elbow',
                'cam_science_macro',
                'cam_science_chamber',
                'cam_deck_pano',
                'rover.perception.realsense.alive',
                'rover.perception.realsense.fps',
                'rover.perception.realsense.temp',
                'rover.perception.active_cam',
                'rover.perception.video_bitrate'
            ]
        },
        'cam_mast_rgb': { name: 'Mast Intel RealSense D435i RGB', location: 'perception', type: 'orion.camera_feed' },
        'cam_mast_depth': { name: 'Mast RealSense Depth Sensor', location: 'perception', type: 'orion.camera_feed' },
        'cam_haz_fl': { name: 'Front Left Chassis Hazard Cam', location: 'perception', type: 'orion.camera_feed' },
        'cam_haz_fr': { name: 'Front Right Chassis Hazard Cam', location: 'perception', type: 'orion.camera_feed' },
        'cam_haz_rear': { name: 'Rear Chassis Hazard Cam', location: 'perception', type: 'orion.camera_feed' },
        'cam_arm_wrist': { name: 'Manipulator Wrist / Gripper Cam', location: 'perception', type: 'orion.camera_feed' },
        'cam_arm_elbow': { name: 'Manipulator Elbow Overview Cam', location: 'perception', type: 'orion.camera_feed' },
        'cam_science_macro': { name: 'Science Macro Probing Cam', location: 'perception', type: 'orion.camera_feed' },
        'cam_science_chamber': { name: 'Science Internal Carousel Cam', location: 'perception', type: 'orion.camera_feed' },
        'cam_deck_pano': { name: 'Chassis Top Deck Context Cam', location: 'perception', type: 'orion.camera_feed' },
        'cam_mast': { name: 'Mast Intel RealSense D435i RGB', location: 'perception', type: 'orion.camera_feed' },
        'cam_front': { name: 'Front Left Chassis Hazard Cam', location: 'perception', type: 'orion.camera_feed' },
        'cam_arm': { name: 'Manipulator Wrist / Gripper Cam', location: 'perception', type: 'orion.camera_feed' },
        'cam_science': { name: 'Science Internal Carousel Cam', location: 'perception', type: 'orion.camera_feed' },
        'navigation': { name: 'Navigation', location: 'rover' },
        'manipulator': { name: 'Manipulator', location: 'rover' },
        'science': { name: 'Science', location: 'rover' },
        'safety': { name: 'Safety', location: 'rover' },
        'base_station': { name: 'Base Station', location: 'root' },
        'task_plans': {
            name: 'Task Plans & Timelines',
            location: 'root',
            children: [
                'timeline_mission',
                'timeline_nav',
                'timeline_science',
                'plan_nav',
                'plan_science',
                'plan_maintenance',
                'plan_probing',
                'timelist_nav'
            ]
        },
        'timeline_mission': { name: 'Full Mission Master Time Strip', location: 'task_plans', type: 'time-strip' },
        'timeline_nav': { name: 'Navigation Traverse Time Strip', location: 'task_plans', type: 'time-strip' },
        'timeline_science': { name: 'Science Operations Time Strip', location: 'task_plans', type: 'time-strip' },
        'plan_nav': { name: 'Navigation Traverse Plan', location: 'task_plans', type: 'plan' },
        'plan_science': { name: 'Science Task Plan', location: 'task_plans', type: 'plan' },
        'plan_maintenance': { name: 'Maintenance Task Plan', location: 'task_plans', type: 'plan' },
        'plan_probing': { name: 'Probing Task Plan', location: 'task_plans', type: 'plan' },
        'timelist_nav': { name: 'Navigation Activities Time List', location: 'task_plans', type: 'timelist' },
        'rover_logs_console': { name: 'ROVER MQTT LIVE SYSTEM LOGS', location: 'displays', type: 'orion.log-console' },
        'displays': {
            name: 'Displays',
            location: 'root',
            children: [
                'modes_tab',
                'timeline_mission',
                'timeline_nav',
                'timeline_science',
                'disp_overview',
                'rover_logs_console',
                'disp_cameras',
                'disp_teleop',
                'disp_nav',
                'disp_manipulator',
                'disp_science',
                'disp_maintenance',
                'disp_safety',
                'lad_power',
                'lad_drive',
                'lad_nav',
                'lad_manipulator',
                'lad_science',
                'lad_safety',
                'plot_bus_voltage',
                'plot_wheel_currents',
                'plot_arm_loads',
                'plot_tensometer'
            ]
        }
    };

    // Helper function to build native Open MCT layout items
    function createLayoutItem(id, key, x, y, width, height) {
        return {
            id: id,
            identifier: { namespace: TAXONOMY_NAMESPACE, key: key },
            type: 'subobject-view',
            x: x,
            y: y,
            width: width,
            height: height,
            hasFrame: true
        };
    }

    function OrionDictionaryPlugin() {
        return function install(openmct) {
            // Add root object
            openmct.objects.addRoot({
                namespace: TAXONOMY_NAMESPACE,
                key: 'root'
            });

            // Register custom types
            openmct.types.addType('orion.telemetry', {
                name: 'Orion Telemetry Point',
                description: 'Normalized telemetry metric from the Orion VI Rover',
                cssClass: 'icon-telemetry'
            });

            openmct.types.addType('orion.log-console', {
                name: 'Rover System Log Console',
                description: 'Live console for rover logs received via MQTT',
                cssClass: 'icon-notebook'
            });

            // Interceptor to ensure every retrieved domain object has configuration and series defined
            openmct.objects.addGetInterceptor({
                appliesTo: (identifier, domainObject) => Boolean(domainObject),
                invoke: (identifier, domainObject) => {
                    if (domainObject && !domainObject.configuration) {
                        domainObject.configuration = {};
                    }
                    if (domainObject && domainObject.type === 'flexible-layout') {
                        if (!domainObject.configuration.containers) {
                            domainObject.configuration.containers = [];
                        }
                    }
                    if (domainObject && domainObject.type === 'telemetry.plot.overlay') {
                        if (!domainObject.configuration.series) {
                            domainObject.configuration.series = (domainObject.composition || []).map(item => ({
                                identifier: item,
                                yAxisId: 1
                            }));
                        }
                    }
                    return domainObject;
                }
            });

            // Dynamic Object Storage & Custom Compositions for user creations (with LocalStorage persistence)
            const STORAGE_OBJECTS_KEY = 'orion_taxonomy_dynamic_objects';
            const STORAGE_COMPOSITIONS_KEY = 'orion_taxonomy_custom_compositions';

            const dynamicObjects = new Map();
            try {
                const saved = localStorage.getItem(STORAGE_OBJECTS_KEY);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    Object.keys(parsed).forEach(k => {
                        if (k !== 'modes_tab' && k !== 'disp_cameras' && !k.startsWith('disp_') && !FOLDERS[k]) {
                            dynamicObjects.set(k, parsed[k]);
                        }
                    });
                }
            } catch (_) {}

            const customCompositions = new Map();
            try {
                const savedComp = localStorage.getItem(STORAGE_COMPOSITIONS_KEY);
                if (savedComp) {
                    const parsedComp = JSON.parse(savedComp);
                    Object.keys(parsedComp).forEach(k => {
                        if (k !== 'modes_tab' && k !== 'disp_cameras') {
                            customCompositions.set(k, parsedComp[k]);
                        }
                    });
                }
            } catch (_) {}

            function persistTaxonomyStorage() {
                try {
                    const objRecord = {};
                    dynamicObjects.forEach((v, k) => { objRecord[k] = v; });
                    localStorage.setItem(STORAGE_OBJECTS_KEY, JSON.stringify(objRecord));

                    const compRecord = {};
                    customCompositions.forEach((v, k) => { compRecord[k] = v; });
                    localStorage.setItem(STORAGE_COMPOSITIONS_KEY, JSON.stringify(compRecord));
                } catch (_) {}
            }

            // Object Provider
            openmct.objects.addProvider(TAXONOMY_NAMESPACE, {
                get: function (identifier) {
                    const key = identifier.key;
                    if (dynamicObjects.has(key)) {
                        return Promise.resolve(dynamicObjects.get(key));
                    }

                    // Native Open MCT Plans
                    if (key === 'plan_nav' || key === 'plan_science' || key === 'plan_maintenance' || key === 'plan_probing') {
                        let taskKey = 'navigation';
                        if (key === 'plan_science') taskKey = 'science';
                        else if (key === 'plan_maintenance') taskKey = 'maintenance';
                        else if (key === 'plan_probing') taskKey = 'probing';

                        const activeT0 = (typeof window !== 'undefined' && window.OrionTaskManager && window.OrionTaskManager.state && window.OrionTaskManager.state.t0);
                        const body = generateOpenMctPlanBody(taskKey, activeT0);

                        const planObj = {
                            identifier: identifier,
                            name: FOLDERS[key] ? FOLDERS[key].name : key,
                            type: 'plan',
                            location: `${TAXONOMY_NAMESPACE}:task_plans`,
                            selectFile: {
                                body: body
                            },
                            configuration: {
                                clipActivityNames: true
                            }
                        };
                        dynamicObjects.set(key, planObj);
                        return Promise.resolve(planObj);
                    }

                    // Native Open MCT Time Strips (master mission & domain timelines)
                    if (key === 'timeline_mission') {
                        const comp = [
                            { namespace: TAXONOMY_NAMESPACE, key: 'plan_nav' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'plan_science' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'plot_bus_voltage' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'plot_wheel_currents' }
                        ];
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Full Mission Master Time Strip',
                            type: 'time-strip',
                            location: `${TAXONOMY_NAMESPACE}:task_plans`,
                            composition: comp,
                            configuration: {}
                        });
                    }

                    if (key === 'timeline_nav') {
                        const comp = [
                            { namespace: TAXONOMY_NAMESPACE, key: 'plan_nav' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'plot_wheel_currents' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'plot_nav_pitch_roll' }
                        ];
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Navigation Traverse Time Strip',
                            type: 'time-strip',
                            location: `${TAXONOMY_NAMESPACE}:task_plans`,
                            composition: comp,
                            configuration: {}
                        });
                    }

                    if (key === 'timeline_science') {
                        const comp = [
                            { namespace: TAXONOMY_NAMESPACE, key: 'plan_science' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'plot_tensometer' }
                        ];
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Science Operations Time Strip',
                            type: 'time-strip',
                            location: `${TAXONOMY_NAMESPACE}:task_plans`,
                            composition: comp,
                            configuration: {}
                        });
                    }

                    // Native Open MCT Time List
                    if (key === 'timelist_nav') {
                        const comp = [
                            { namespace: TAXONOMY_NAMESPACE, key: 'plan_nav' }
                        ];
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Navigation Activities Time List',
                            type: 'timelist',
                            location: `${TAXONOMY_NAMESPACE}:task_plans`,
                            composition: comp,
                            configuration: {
                                sortOrderIndex: 0,
                                futureEventsIndex: 1,
                                futureEventsDurationIndex: 0,
                                futureEventsDuration: 30,
                                currentEventsIndex: 1,
                                currentEventsDurationIndex: 0,
                                currentEventsDuration: 30,
                                pastEventsIndex: 1,
                                pastEventsDurationIndex: 0,
                                pastEventsDuration: 30,
                                filter: ''
                            }
                        });
                    }

                    // 1. Folder objects
                    if (FOLDERS[key]) {
                        const folder = FOLDERS[key];
                        return Promise.resolve({
                            identifier: identifier,
                            name: folder.name,
                            type: folder.type || 'folder',
                            location: folder.location ? `${TAXONOMY_NAMESPACE}:${folder.location}` : 'ROOT'
                        });
                    }

                    // 2. Telemetry measurements
                    const m = MEASUREMENTS.find(item => item.key === key);
                    if (m) {
                        return Promise.resolve({
                            identifier: identifier,
                            name: m.name,
                            type: 'orion.telemetry',
                            location: `${TAXONOMY_NAMESPACE}:${m.category}`,
                            telemetry: {
                                values: [
                                    {
                                        key: 'value',
                                        name: 'Value',
                                        unit: m.unit || '',
                                        format: m.format || 'number',
                                        min: m.min,
                                        max: m.max,
                                        hints: { range: 1 }
                                    },
                                    {
                                        key: 'utc',
                                        name: 'Timestamp',
                                        format: 'utc',
                                        hints: { domain: 1 }
                                    }
                                ]
                            }
                        });
                    }

                    // 3. Custom Widgets (embeddable in layouts)
                    if (key === 'widget_overview_status') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Rover Master Health & Anomaly Feed',
                            type: 'orion.overview_exception',
                            location: `${TAXONOMY_NAMESPACE}:displays`
                        });
                    }
                    if (key === 'widget_nav_status') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Navigation Health & Hazard Watchdog',
                            type: 'orion.nav_status',
                            location: `${TAXONOMY_NAMESPACE}:displays`
                        });
                    }
                    if (key === 'widget_maintenance_status') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'System Maintenance & Node Health',
                            type: 'orion.maintenance_status',
                            location: `${TAXONOMY_NAMESPACE}:displays`
                        });
                    }
                    if (key === 'widget_attitude_indicator') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Pitch / Roll Artificial Horizon',
                            type: 'orion.attitude_indicator',
                            location: `${TAXONOMY_NAMESPACE}:displays`
                        });
                    }
                    if (key === 'widget_camera_mosaic') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Camera Mosaic & Switcher',
                            type: 'orion.camera_mosaic',
                            location: `${TAXONOMY_NAMESPACE}:displays`
                        });
                    }
                    if (key === 'widget_gamepad') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Gamepad Teleoperation Pad',
                            type: 'orion.gamepad_widget',
                            location: `${TAXONOMY_NAMESPACE}:displays`
                        });
                    }
                    if (key === 'widget_power_strip') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: '6-Rail Power Distribution Strip',
                            type: 'orion.power_strip',
                            location: `${TAXONOMY_NAMESPACE}:displays`
                        });
                    }
                    if (key === 'widget_safety_chain') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Safety Kill Chain Interlock',
                            type: 'orion.safety_chain',
                            location: `${TAXONOMY_NAMESPACE}:displays`
                        });
                    }
                    if (key === 'widget_science_pad') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Science Module Control Pad',
                            type: 'orion.science_pad',
                            location: `${TAXONOMY_NAMESPACE}:displays`
                        });
                    }
                    if (key === 'widget_manipulator_pad') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Manipulator Control Pad',
                            type: 'orion.manipulator_pad',
                            location: `${TAXONOMY_NAMESPACE}:displays`
                        });
                    }
                    if (key === 'rover_logs_console') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'ROVER MQTT LIVE SYSTEM LOGS',
                            type: 'orion.log-console',
                            location: `${TAXONOMY_NAMESPACE}:displays`
                        });
                    }

                    // 4. Native Open MCT LAD Tables
                    if (key === 'lad_power') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Power System LAD Table',
                            type: 'LadTable',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            configuration: {},
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.power.bus.voltage' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.power.bus.current' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.power.battery.1.v' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.power.battery.1.temp' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.power.battery.2.v' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.power.battery.3.v' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.power.battery.4.v' }
                            ]
                        });
                    }
                    if (key === 'lad_drive') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Chassis & Drivetrain LAD Table',
                            type: 'LadTable',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            configuration: {},
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.drive.state' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.drive.speed_limit' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.drive.speed.fl' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.drive.speed.fr' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.drive.current.fl' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.drive.current.fr' }
                            ]
                        });
                    }
                    if (key === 'lad_nav') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Navigation & Pose LAD Table',
                            type: 'LadTable',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            configuration: {},
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.nav.pitch' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.nav.roll' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.nav.yaw' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.nav.pose_x' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.nav.pose_y' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.nav.nav2_state' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.nav.target_wp_dist' }
                            ]
                        });
                    }
                    if (key === 'lad_manipulator') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Manipulator Joints LAD Table',
                            type: 'LadTable',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            configuration: {},
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.arm.gripper_id' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.arm.pose' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.arm.joint.base' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.arm.joint.shoulder' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.arm.joint.elbow' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.arm.joint.gripper' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.arm.joint.load.shoulder' }
                            ]
                        });
                    }
                    if (key === 'lad_science') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Science Module LAD Table',
                            type: 'LadTable',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            configuration: {},
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.science.tensometer_weight' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.science.sample_count' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.science.vacuum_state' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.science.nozzle_rpm' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.science.gas_blast' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.science.fluid_level' }
                            ]
                        });
                    }
                    if (key === 'lad_safety') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Safety System LAD Table',
                            type: 'LadTable',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            configuration: {},
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.safety.estop_hardware' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.safety.kill_chain_state' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.safety.heartbeat_timer' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.safety.uvlo_tripped' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.safety.enclosure_temp' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover.safety.last_trip_reason' }
                            ]
                        });
                    }

                    // 5. Native Open MCT Overlay Plots
                    if (key === 'plot_bus_voltage') {
                        const comp = [
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.power.bus.voltage' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.power.battery.1.v' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.power.battery.2.v' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.power.battery.3.v' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.power.battery.4.v' }
                        ];
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Main 20V Bus & Pack Voltages',
                            type: 'telemetry.plot.overlay',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: comp,
                            configuration: {
                                series: comp.map(item => ({
                                    identifier: item,
                                    yAxisId: 1
                                }))
                            }
                        });
                    }
                    if (key === 'plot_wheel_currents') {
                        const comp = [
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.drive.current.fl' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.drive.current.fr' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.drive.current.ml' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.drive.current.mr' }
                        ];
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Drive Motor Currents',
                            type: 'telemetry.plot.overlay',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: comp,
                            configuration: {
                                series: comp.map(item => ({
                                    identifier: item,
                                    yAxisId: 1
                                }))
                            }
                        });
                    }
                    if (key === 'plot_arm_loads') {
                        const comp = [
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.arm.joint.load.shoulder' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.arm.joint.load.elbow' }
                        ];
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Manipulator Motor Loads',
                            type: 'telemetry.plot.overlay',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: comp,
                            configuration: {
                                series: comp.map(item => ({
                                    identifier: item,
                                    yAxisId: 1
                                }))
                            }
                        });
                    }
                    if (key === 'plot_tensometer') {
                        const comp = [
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.science.tensometer_weight' }
                        ];
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Tensometer Weight Acquisition',
                            type: 'telemetry.plot.overlay',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: comp,
                            configuration: {
                                series: comp.map(item => ({
                                    identifier: item,
                                    yAxisId: 1
                                }))
                            }
                        });
                    }

                    if (key === 'plot_nav_pitch_roll') {
                        const comp = [
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.nav.pitch' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.nav.roll' }
                        ];
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Pitch & Roll Attitude Trend',
                            type: 'telemetry.plot.overlay',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: comp,
                            configuration: {
                                series: comp.map(item => ({
                                    identifier: item,
                                    yAxisId: 1
                                }))
                            }
                        });
                    }

                    if (key === 'plot_compute_temps') {
                        const comp = [
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.compute.jetson.cpu_temp' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.compute.rpi.cpu_temp' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'rover.safety.enclosure_temp' }
                        ];
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Compute & Enclosure Temperatures',
                            type: 'telemetry.plot.overlay',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: comp,
                            configuration: {
                                series: comp.map(item => ({
                                    identifier: item,
                                    yAxisId: 1
                                }))
                            }
                        });
                    }

                    // 6. Top-Level Modes Tab View (Native Open MCT Tabs)
                    if (key === 'modes_tab') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'OPERATING MODES (TABS)',
                            type: 'tabs',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            keep_alive: true,
                            configuration: {},
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'disp_overview' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'disp_cameras' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'disp_teleop' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'disp_nav' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'disp_manipulator' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'disp_science' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'disp_maintenance' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'disp_safety' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'timeline_mission' }
                            ]
                        });
                    }

                    // 7. Native Open MCT Display Layouts for each Operating Mode
                    // Standards: NASA-STD-3001, ECSS-E-ST-70-41C (Management by Exception)
                    // Single-screen layout (total height <= 55 grid units, ZERO vertical scrolling)
                    // Displays Graphs + Telemetry Data (LAD Table) + Status Indicators + Essential Buttons
                    if (key === 'disp_overview') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'HEALTH / OVERVIEW',
                            type: 'layout',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'widget_overview_status' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'plot_bus_voltage' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'lad_power' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'rover_logs_console' }
                            ],
                            configuration: {
                                layoutGrid: [10, 10],
                                items: [
                                    createLayoutItem('item_ov_status', 'widget_overview_status', 1, 1, 98, 8),
                                    createLayoutItem('item_ov_plot', 'plot_bus_voltage', 1, 10, 48, 26),
                                    createLayoutItem('item_ov_lad', 'lad_power', 50, 10, 49, 26),
                                    createLayoutItem('item_ov_logs', 'rover_logs_console', 1, 37, 98, 26)
                                ]
                            }
                        });
                    }

                    // Standalone Separate Flexible Layout for Rover Cameras (10 Feeds)
                    // Native Open MCT flexible layout: each camera has its own independent frame/field
                    // with its own native Open MCT Notebook Snapshot button, larger view, and separate window popout
                    if (key === 'disp_cameras') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'CAMERAS (10 FEEDS)',
                            type: 'flexible-layout',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'cam_mast_rgb' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'cam_mast_depth' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'cam_haz_fl' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'cam_haz_fr' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'cam_haz_rear' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'cam_arm_wrist' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'cam_arm_elbow' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'cam_science_macro' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'cam_science_chamber' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'cam_deck_pano' }
                            ],
                            configuration: {
                                rowsLayout: false,
                                containers: [
                                    {
                                        id: 'col_mast',
                                        size: 20,
                                        frames: [
                                            {
                                                id: 'frame_mast_rgb',
                                                domainObjectIdentifier: { namespace: TAXONOMY_NAMESPACE, key: 'cam_mast_rgb' },
                                                size: 50,
                                                noFrame: false
                                            },
                                            {
                                                id: 'frame_mast_depth',
                                                domainObjectIdentifier: { namespace: TAXONOMY_NAMESPACE, key: 'cam_mast_depth' },
                                                size: 50,
                                                noFrame: false
                                            }
                                        ]
                                    },
                                    {
                                        id: 'col_haz_front',
                                        size: 20,
                                        frames: [
                                            {
                                                id: 'frame_haz_fl',
                                                domainObjectIdentifier: { namespace: TAXONOMY_NAMESPACE, key: 'cam_haz_fl' },
                                                size: 50,
                                                noFrame: false
                                            },
                                            {
                                                id: 'frame_haz_fr',
                                                domainObjectIdentifier: { namespace: TAXONOMY_NAMESPACE, key: 'cam_haz_fr' },
                                                size: 50,
                                                noFrame: false
                                            }
                                        ]
                                    },
                                    {
                                        id: 'col_haz_deck',
                                        size: 20,
                                        frames: [
                                            {
                                                id: 'frame_haz_rear',
                                                domainObjectIdentifier: { namespace: TAXONOMY_NAMESPACE, key: 'cam_haz_rear' },
                                                size: 50,
                                                noFrame: false
                                            },
                                            {
                                                id: 'frame_deck_pano',
                                                domainObjectIdentifier: { namespace: TAXONOMY_NAMESPACE, key: 'cam_deck_pano' },
                                                size: 50,
                                                noFrame: false
                                            }
                                        ]
                                    },
                                    {
                                        id: 'col_arm',
                                        size: 20,
                                        frames: [
                                            {
                                                id: 'frame_arm_wrist',
                                                domainObjectIdentifier: { namespace: TAXONOMY_NAMESPACE, key: 'cam_arm_wrist' },
                                                size: 50,
                                                noFrame: false
                                            },
                                            {
                                                id: 'frame_arm_elbow',
                                                domainObjectIdentifier: { namespace: TAXONOMY_NAMESPACE, key: 'cam_arm_elbow' },
                                                size: 50,
                                                noFrame: false
                                            }
                                        ]
                                    },
                                    {
                                        id: 'col_science',
                                        size: 20,
                                        frames: [
                                            {
                                                id: 'frame_science_macro',
                                                domainObjectIdentifier: { namespace: TAXONOMY_NAMESPACE, key: 'cam_science_macro' },
                                                size: 50,
                                                noFrame: false
                                            },
                                            {
                                                id: 'frame_science_chamber',
                                                domainObjectIdentifier: { namespace: TAXONOMY_NAMESPACE, key: 'cam_science_chamber' },
                                                size: 50,
                                                noFrame: false
                                            }
                                        ]
                                    }
                                ]
                            }
                        });
                    }

                    if (key === 'disp_teleop') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'TELEOP',
                            type: 'layout',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'widget_gamepad' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'widget_attitude_indicator' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'plot_wheel_currents' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'lad_drive' }
                            ],
                            configuration: {
                                layoutGrid: [10, 10],
                                items: [
                                    createLayoutItem('item_gamepad', 'widget_gamepad', 1, 1, 58, 25),
                                    createLayoutItem('item_att', 'widget_attitude_indicator', 60, 1, 39, 25),
                                    createLayoutItem('item_plot_curr', 'plot_wheel_currents', 1, 27, 48, 27),
                                    createLayoutItem('item_lad_drive', 'lad_drive', 50, 27, 49, 27)
                                ]
                            }
                        });
                    }

                    if (key === 'disp_nav') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'NAV / AUTONOMY',
                            type: 'layout',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'widget_nav_status' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'plan_nav' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'plot_nav_pitch_roll' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'lad_nav' }
                            ],
                            configuration: {
                                layoutGrid: [10, 10],
                                items: [
                                    createLayoutItem('item_nav_status', 'widget_nav_status', 1, 1, 98, 7),
                                    createLayoutItem('item_nav_plan', 'plan_nav', 1, 9, 98, 18),
                                    createLayoutItem('item_nav_plot', 'plot_nav_pitch_roll', 1, 28, 48, 26),
                                    createLayoutItem('item_nav_lad', 'lad_nav', 50, 28, 49, 26)
                                ]
                            }
                        });
                    }

                    if (key === 'disp_manipulator') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'MANIPULATOR',
                            type: 'layout',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'widget_manipulator_pad' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'plan_probing' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'plot_arm_loads' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'lad_manipulator' }
                            ],
                            configuration: {
                                layoutGrid: [10, 10],
                                items: [
                                    createLayoutItem('item_arm_pad', 'widget_manipulator_pad', 1, 1, 98, 9),
                                    createLayoutItem('item_arm_plan', 'plan_probing', 1, 11, 98, 18),
                                    createLayoutItem('item_arm_plot', 'plot_arm_loads', 1, 30, 48, 24),
                                    createLayoutItem('item_arm_lad', 'lad_manipulator', 50, 30, 49, 24)
                                ]
                            }
                        });
                    }

                    if (key === 'disp_science') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'SCIENCE',
                            type: 'layout',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'widget_science_pad' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'plan_science' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'plot_tensometer' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'lad_science' }
                            ],
                            configuration: {
                                layoutGrid: [10, 10],
                                items: [
                                    createLayoutItem('item_sci_pad', 'widget_science_pad', 1, 1, 98, 9),
                                    createLayoutItem('item_sci_plan', 'plan_science', 1, 11, 98, 18),
                                    createLayoutItem('item_sci_plot', 'plot_tensometer', 1, 30, 48, 24),
                                    createLayoutItem('item_sci_lad', 'lad_science', 50, 30, 49, 24)
                                ]
                            }
                        });
                    }

                    if (key === 'disp_maintenance') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'MAINTENANCE',
                            type: 'layout',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'widget_maintenance_status' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'plan_maintenance' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'plot_compute_temps' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'widget_power_strip' }
                            ],
                            configuration: {
                                layoutGrid: [10, 10],
                                items: [
                                    createLayoutItem('item_maint_status', 'widget_maintenance_status', 1, 1, 98, 7),
                                    createLayoutItem('item_maint_plan', 'plan_maintenance', 1, 9, 98, 18),
                                    createLayoutItem('item_maint_plot', 'plot_compute_temps', 1, 28, 48, 26),
                                    createLayoutItem('item_strip_maint', 'widget_power_strip', 50, 28, 49, 26)
                                ]
                            }
                        });
                    }

                    if (key === 'disp_safety') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'SAFETY / COMM',
                            type: 'layout',
                            location: `${TAXONOMY_NAMESPACE}:displays`,
                            composition: [
                                { namespace: TAXONOMY_NAMESPACE, key: 'widget_safety_chain' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'plot_bus_voltage' },
                                { namespace: TAXONOMY_NAMESPACE, key: 'lad_safety' }
                            ],
                            configuration: {
                                layoutGrid: [10, 10],
                                items: [
                                    createLayoutItem('item_chain_saf', 'widget_safety_chain', 1, 1, 98, 11),
                                    createLayoutItem('item_saf_plot', 'plot_bus_voltage', 1, 13, 48, 42),
                                    createLayoutItem('item_saf_lad', 'lad_safety', 50, 13, 49, 42)
                                ]
                            }
                        });
                    }

                    return Promise.resolve(null);
                },
                create: function (domainObject) {
                    if (domainObject && domainObject.identifier) {
                        dynamicObjects.set(domainObject.identifier.key, domainObject);
                        persistTaxonomyStorage();
                    }
                    return Promise.resolve(true);
                },
                update: function (domainObject) {
                    if (domainObject && domainObject.identifier) {
                        dynamicObjects.set(domainObject.identifier.key, domainObject);
                        persistTaxonomyStorage();
                    }
                    return Promise.resolve(true);
                },
                isReadOnly: function () {
                    return false;
                }
            });

            // Composition Provider
            openmct.composition.addProvider({
                appliesTo: function (domainObject) {
                    return domainObject.identifier.namespace === TAXONOMY_NAMESPACE &&
                           (domainObject.type === 'folder' ||
                            domainObject.type === 'tabs' ||
                            domainObject.type === 'layout' ||
                            domainObject.type === 'flexible-layout' ||
                            domainObject.type === 'LadTable' ||
                            domainObject.type === 'telemetry.plot.overlay' ||
                            domainObject.type === 'time-strip' ||
                            domainObject.type === 'timelist');
                },
                load: function (domainObject) {
                    const key = domainObject.identifier.key;
                    if (key === 'modes_tab') {
                        return Promise.resolve([
                            { namespace: TAXONOMY_NAMESPACE, key: 'disp_overview' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'disp_cameras' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'disp_teleop' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'disp_nav' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'disp_manipulator' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'disp_science' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'disp_maintenance' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'disp_safety' },
                            { namespace: TAXONOMY_NAMESPACE, key: 'timeline_mission' }
                        ]);
                    }
                    const folder = FOLDERS[key];
                    const dynamicList = customCompositions.get(key) || [];

                    // Explicit children defined in folder
                    if (folder && folder.children) {
                        let base = folder.children.map(childKey => ({
                            namespace: TAXONOMY_NAMESPACE,
                            key: childKey
                        }));
                        dynamicList.forEach(child => {
                            if (!base.some(b => b.namespace === child.namespace && b.key === child.key)) {
                                base.push(child);
                            }
                        });
                        return Promise.resolve(base);
                    }

                    // Explicit composition defined in domainObject
                    if (domainObject.composition && Array.isArray(domainObject.composition)) {
                        let base = [...domainObject.composition];
                        dynamicList.forEach(child => {
                            if (!base.some(b => b.namespace === child.namespace && b.key === child.key)) {
                                base.push(child);
                            }
                        });
                        return Promise.resolve(base);
                    }

                    // Measurements under folder category
                    let items = MEASUREMENTS
                        .filter(m => m.category === key)
                        .map(m => ({
                            namespace: TAXONOMY_NAMESPACE,
                            key: m.key
                        }));
                    dynamicList.forEach(child => {
                        if (!items.some(b => b.namespace === child.namespace && b.key === child.key)) {
                            items.push(child);
                        }
                    });

                    return Promise.resolve(items);
                },
                add: function (parent, childId) {
                    const key = parent.identifier.key;
                    if (!customCompositions.has(key)) {
                        customCompositions.set(key, []);
                    }
                    const list = customCompositions.get(key);
                    if (!list.some(item => item.namespace === childId.namespace && item.key === childId.key)) {
                        list.push(childId);
                    }
                    if (!parent.composition) {
                        parent.composition = [];
                    }
                    if (!parent.composition.some(item => item.namespace === childId.namespace && item.key === childId.key)) {
                        parent.composition.push(childId);
                    }
                    try {
                        openmct.objects.mutate(parent, 'composition', parent.composition);
                    } catch (_) {}
                    persistTaxonomyStorage();
                    return Promise.resolve();
                },
                remove: function (parent, childId) {
                    const key = parent.identifier.key;
                    if (customCompositions.has(key)) {
                        const list = customCompositions.get(key);
                        const idx = list.findIndex(item => item.namespace === childId.namespace && item.key === childId.key);
                        if (idx !== -1) list.splice(idx, 1);
                    }
                    if (parent.composition) {
                        parent.composition = parent.composition.filter(item => !(item.namespace === childId.namespace && item.key === childId.key));
                    }
                    try {
                        openmct.objects.mutate(parent, 'composition', parent.composition);
                    } catch (_) {}
                    persistTaxonomyStorage();
                    return Promise.resolve();
                }
            });
        };
    }

    if (typeof window !== 'undefined') {
        window.OrionDictionaryPlugin = OrionDictionaryPlugin;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionDictionaryPlugin;
    }
})();
