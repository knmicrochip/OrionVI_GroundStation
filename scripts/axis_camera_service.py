#!/usr/bin/env python3
"""
ORION VI - AXIS Multi-Camera Vision Service & Open MCT Bridge
Standards: NASA-STD-3001, ECSS

Derived from: https://github.com/matthew1775/ORION_VI_ARCHIVE/tree/main/KAMERY_AXIS_JERZY_MATEUSZ
Author: Jerzy & Mateusz (Adapted for Open MCT Ground Station)

Features:
- Reads 4 AXIS camera RTSP streams (Axis F34 Multi-Sensor system)
- ArUco marker detection (DICT_5X5_250) + 3D Pose Estimation (X, Y, Z distance)
- QR code detection and text decoding (cv2.QRCodeDetector)
- Push processed frames directly to Open MCT Gateway (http://localhost:8088/api/camera/axis/:id/frame)
- Interactive OpenCV window (or --headless background service)
- Dynamic resolution switching (720p, 540p, 450p, 270p)
- WDR (Wide Dynamic Range) toggle API
"""

import sys
import os
import time
import argparse
import threading
from datetime import datetime

try:
    import cv2
    import numpy as np
    import requests
    from requests.auth import HTTPDigestAuth
except ImportError as err:
    print(f"[AXIS Vision Service] Missing required library: {err}")
    print("Please install requirements: pip install -r scripts/requirements.txt")
    print("(Note: Open MCT built-in HTTP MJPEG proxy works even without Python/OpenCV installed)")
    sys.exit(1)

class VideoStream:
    """Asynchronous RTSP stream reader."""
    def __init__(self, src, name="Camera"):
        self.src = src
        self.name = name
        self.stopped = False
        self.frame = None
        self.lock = threading.Lock()

    def start(self):
        threading.Thread(target=self.update, args=(), daemon=True).start()
        return self

    def update(self):
        cap = cv2.VideoCapture(self.src)
        while not self.stopped:
            grabbed, frame = cap.read()
            if not grabbed:
                with self.lock:
                    self.frame = None
                time.sleep(0.15)
                continue
            with self.lock:
                self.frame = frame
        cap.release()

    def read(self):
        with self.lock:
            return self.frame.copy() if self.frame is not None else None

    def stop(self):
        self.stopped = True

def parse_args():
    parser = argparse.ArgumentParser(description="Orion VI AXIS Camera Vision & Open MCT Bridge")
    parser.add_argument("--ip", default=os.environ.get("AXIS_IP", "169.254.186.98"), help="AXIS camera server IP (default: 169.254.186.98)")
    parser.add_argument("--user", default="orion", help="AXIS username (default: orion)")
    parser.add_argument("--password", default="orion", help="AXIS password (default: orion)")
    parser.add_argument("--gateway", default="http://localhost:8088", help="Open MCT gateway URL (default: http://localhost:8088)")
    parser.add_argument("--push", action="store_true", default=True, help="Push processed frames to Open MCT gateway")
    parser.add_argument("--no-push", dest="push", action="store_false", help="Do not push frames to Open MCT")
    parser.add_argument("--headless", action="store_true", help="Run without OpenCV GUI window")
    parser.add_argument("--resolution", default="960x540", choices=["1280x720", "960x540", "800x450", "480x270"], help="Stream resolution")
    return parser.parse_args()

def main():
    args = parse_args()
    script_dir = os.path.dirname(os.path.abspath(__file__))

    IP = args.ip
    USER = args.user
    PASS = args.password
    GATEWAY_URL = args.gateway
    current_resolution = args.resolution

    print("=" * 65)
    print(" ORION VI - AXIS CAMERA MULTI-VIEW & OPEN MCT BRIDGE")
    print("=" * 65)
    print(f"Target Camera IP  : {IP}")
    print(f"Open MCT Gateway  : {GATEWAY_URL} (Push: {args.push})")
    print(f"Initial Resolution: {current_resolution}")
    print(f"Headless Mode     : {args.headless}")
    print("-" * 65)

    def get_stream_url(cam_id, res):
        return f"rtsp://{USER}:{PASS}@{IP}/axis-media/media.amp?camera={cam_id}&resolution={res}"

    active_streams = {}
    for i in range(4):
        cam_id = i + 1
        url = get_stream_url(cam_id, current_resolution)
        print(f"[Stream Init] Cam {cam_id} -> {url}")
        active_streams[i] = VideoStream(url, f"AXIS {cam_id}").start()

    # ArUco Configuration (DICT_5X5_250)
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_5X5_250)
    aruco_params = cv2.aruco.DetectorParameters()
    MARKER_SIZE = 0.05
    camera_matrix = np.array([[1000, 0, 960],
                              [0, 1000, 540],
                              [0, 0, 1]], dtype=np.float32)
    dist_coeffs = np.zeros((4, 1))
    marker_3d_points = np.array([
        [-MARKER_SIZE / 2, MARKER_SIZE / 2, 0],
        [MARKER_SIZE / 2, MARKER_SIZE / 2, 0],
        [MARKER_SIZE / 2, -MARKER_SIZE / 2, 0],
        [-MARKER_SIZE / 2, -MARKER_SIZE / 2, 0]
    ], dtype=np.float32)

    # QR Code Detector
    qr_detector = cv2.QRCodeDetector()

    window_name = "Axis F34 - Multiview (ArUco & QR) [Orion VI]"
    if not args.headless:
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL | cv2.WINDOW_KEEPRATIO)

    wdr_enabled = False
    is_recording = False
    video_writer = None
    last_push_time = 0

    def push_frame_to_gateway(cam_id, frame_bgr):
        try:
            _, jpeg_data = cv2.imencode('.jpg', frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 80])
            post_url = f"{GATEWAY_URL}/api/camera/axis/{cam_id}/frame"
            requests.post(post_url, data=jpeg_data.tobytes(), headers={'Content-Type': 'image/jpeg'}, timeout=0.8)
        except Exception:
            pass

    print("\n[Controls] 1-4: Toggle feeds | 6-8: Change Res | w: WDR | s: Snapshot | q: Quit\n")

    try:
        while True:
            frames_to_show = []
            now = time.time()
            do_push = args.push and (now - last_push_time >= 0.09) # ~11 FPS push rate
            if do_push:
                last_push_time = now

            for i in range(4):
                stream = active_streams.get(i)
                cam_id = i + 1
                if stream is not None:
                    frm = stream.read()
                    name = stream.name

                    if frm is not None:
                        frm_display = frm.copy()
                        gray = cv2.cvtColor(frm_display, cv2.COLOR_BGR2GRAY)

                        # 1. ArUco Marker Detection
                        corners, ids, _ = cv2.aruco.detectMarkers(gray, aruco_dict, parameters=aruco_params)
                        if ids is not None:
                            cv2.aruco.drawDetectedMarkers(frm_display, corners, ids)
                            for j in range(len(ids)):
                                marker_id = ids[j][0]
                                marker_corners = corners[j][0]
                                success, rvec, tvec = cv2.solvePnP(marker_3d_points, marker_corners, camera_matrix, dist_coeffs)
                                if success:
                                    cv2.drawFrameAxes(frm_display, camera_matrix, dist_coeffs, rvec, tvec, 0.03)
                                    x, y, z = tvec[0][0], tvec[1][0], tvec[2][0]
                                    text = f"ID:{marker_id} X:{x:.2f} Y:{y:.2f} Z:{z:.2f}m"
                                    pos = (int(marker_corners[0][0]), int(marker_corners[0][1]) - 15)
                                    cv2.putText(frm_display, text, pos, cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4)
                                    cv2.putText(frm_display, text, pos, cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

                        # 2. QR Code Detection
                        retval, decoded_info, points, _ = qr_detector.detectAndDecodeMulti(frm_display)
                        if retval:
                            for info, pts in zip(decoded_info, points):
                                if info:
                                    pts = np.int32(pts)
                                    cv2.polylines(frm_display, [pts], isClosed=True, color=(255, 0, 255), thickness=3)
                                    qr_text = f"QR: {info}"
                                    pos = (int(pts[0][0]), int(pts[0][1]) - 10)
                                    cv2.putText(frm_display, qr_text, pos, cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4)
                                    cv2.putText(frm_display, qr_text, pos, cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 255), 2)

                        # Push processed frame to Open MCT Gateway
                        if do_push:
                            threading.Thread(target=push_frame_to_gateway, args=(cam_id, frm_display), daemon=True).start()

                    else:
                        frm_display = np.zeros((540, 960, 3), dtype=np.uint8)
                        cv2.putText(frm_display, f"{name} - Awaiting Signal...", (240, 270), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 165, 255), 2)

                    frames_to_show.append((name, frm_display))

            if not args.headless:
                # Dynamic 2x2 layout
                grid_frames = []
                for i in range(4):
                    if i < len(frames_to_show):
                        name, frm = frames_to_show[i]
                        f = cv2.resize(frm, (960, 540))
                        cv2.putText(f, name, (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
                        grid_frames.append(f)
                    else:
                        grid_frames.append(np.zeros((540, 960, 3), dtype=np.uint8))

                top_row = np.hstack((grid_frames[0], grid_frames[1]))
                bottom_row = np.hstack((grid_frames[2], grid_frames[3]))
                display_grid = np.vstack((top_row, bottom_row))

                # Visual HUD overlays
                wdr_text = f"WDR: {'ON' if wdr_enabled else 'OFF'} | RES: {current_resolution}"
                cv2.putText(display_grid, wdr_text, (20, 1050), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

                cv2.imshow(window_name, display_grid)
                key = cv2.waitKey(20) & 0xFF

                if key in [ord('q'), 27]:
                    break
                elif key in [ord('1'), ord('2'), ord('3'), ord('4')]:
                    idx = key - ord('1')
                    if active_streams.get(idx) is not None:
                        active_streams[idx].stop()
                        active_streams[idx] = None
                        print(f"[Stream] AXIS {idx+1} stopped")
                    else:
                        url = get_stream_url(idx+1, current_resolution)
                        active_streams[idx] = VideoStream(url, f"AXIS {idx+1}").start()
                        print(f"[Stream] AXIS {idx+1} started")
                elif key == ord('w'):
                    wdr_enabled = not wdr_enabled
                    state_str = "on" if wdr_enabled else "off"
                    for k in range(4):
                        def toggle_wdr(sensor_idx):
                            try:
                                u = f"http://{IP}/axis-cgi/param.cgi?action=update&ImageSource.{sensor_idx}.Sensor.WDR={state_str}"
                                requests.get(u, auth=HTTPDigestAuth(USER, PASS), timeout=2)
                            except Exception:
                                pass
                        threading.Thread(target=toggle_wdr, args=(k,), daemon=True).start()
                elif key == ord('s'):
                    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                    fname = os.path.join(script_dir, f"axis_snapshot_{stamp}.png")
                    cv2.imwrite(fname, display_grid)
                    print(f"[Snapshot] Saved {fname}")
            else:
                time.sleep(0.03)

    except KeyboardInterrupt:
        pass
    finally:
        print("[Shutdown] Stopping camera streams...")
        for s in active_streams.values():
            if s is not None:
                s.stop()
        if not args.headless:
            cv2.destroyAllWindows()
        print("[Shutdown] AXIS Vision Service stopped cleanly.")

if __name__ == '__main__':
    main()

