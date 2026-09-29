#!/usr/bin/env python3
"""
Orion VI Ground Station - AXIS Camera Vision & ArUco / QR Stream Service
Based on KAMERY_AXIS_JERZY_MATEUSZ (Orion VI Archive)

Reads AXIS network cameras via RTSP or HTTP, runs real-time computer vision:
- ArUco tag detection (DICT_5X5_250) + 3D pose estimation (solvePnP + drawFrameAxes)
- QR code detection & decoding (cv2.QRCodeDetector)
- WDR status display
- Pushes annotated frames directly to Open MCT Gateway at POST /api/camera/axis/<id>/frame
  so Open MCT displays computer vision annotations live in browser with zero latency.

Usage:
  python scripts/axis_camera_service.py [--headless] [--openmct-url http://localhost:8088]
"""

import sys
import os
import time
import argparse
import threading
import requests
from requests.auth import HTTPDigestAuth
import numpy as np

# Safe OpenCV import with informative error message
try:
    import cv2
except ImportError:
    print("[ERROR] OpenCV is not installed. Please run: pip install -r scripts/requirements.txt")
    sys.exit(1)


class VideoStream:
    """Asynchronous RTSP / HTTP video capture thread with auto-reconnect."""
    def __init__(self, src, name="Camera", cam_id=1):
        self.src = src
        self.name = name
        self.cam_id = cam_id
        self.stopped = False
        self.frame = None
        self.lock = threading.Lock()
        self.is_connected = False

    def start(self):
        t = threading.Thread(target=self.update, args=(), daemon=True)
        t.start()
        return self

    def update(self):
        cap = None
        while not self.stopped:
            try:
                if cap is None or not cap.isOpened():
                    cap = cv2.VideoCapture(self.src)
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

                grabbed, frame = cap.read()
                if not grabbed or frame is None:
                    self.is_connected = False
                    with self.lock:
                        self.frame = None
                    time.sleep(0.5)
                    continue

                self.is_connected = True
                with self.lock:
                    self.frame = frame

                time.sleep(0.01)
            except Exception as e:
                self.is_connected = False
                time.sleep(1.0)

        if cap is not None:
            cap.release()

    def read(self):
        with self.lock:
            return self.frame.copy() if self.frame is not None else None

    def stop(self):
        self.stopped = True


def process_frame(frm, aruco_dict, aruco_params, camera_matrix, dist_coeffs, marker_3d_points, qr_detector):
    """Run ArUco and QR detection matching original kamery_axis.py algorithm."""
    if frm is None:
        return None

    frm_display = frm.copy()
    gray = cv2.cvtColor(frm_display, cv2.COLOR_BGR2GRAY)

    # 1. ArUco Marker Detection (DICT_5X5_250)
    try:
        corners, ids, rejected = cv2.aruco.detectMarkers(gray, aruco_dict, parameters=aruco_params)
        if ids is not None and len(ids) > 0:
            cv2.aruco.drawDetectedMarkers(frm_display, corners, ids)
            for j in range(len(ids)):
                marker_id = ids[j][0]
                marker_corners = corners[j][0]
                success, rvec, tvec = cv2.solvePnP(marker_3d_points, marker_corners, camera_matrix, dist_coeffs)

                if success:
                    cv2.drawFrameAxes(frm_display, camera_matrix, dist_coeffs, rvec, tvec, 0.03)
                    x, y, z = tvec[0][0], tvec[1][0], tvec[2][0]
                    text = f"ID: {marker_id}  X: {x:.2f} Y: {y:.2f} Z: {z:.2f}"
                    text_pos = (int(marker_corners[0][0]), max(20, int(marker_corners[0][1]) - 15))
                    cv2.putText(frm_display, text, text_pos, cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4)
                    cv2.putText(frm_display, text, text_pos, cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
    except Exception as e:
        pass

    # 2. QR Code Detection & Decoding
    try:
        retval, decoded_info, points, _ = qr_detector.detectAndDecodeMulti(frm_display)
        if retval and decoded_info:
            for info, pts in zip(decoded_info, points):
                if info:
                    pts = np.int32(pts)
                    cv2.polylines(frm_display, [pts], isClosed=True, color=(255, 0, 255), thickness=3)
                    qr_text = f"QR: {info}"
                    text_pos = (int(pts[0][0]), max(20, int(pts[0][1]) - 10))
                    cv2.putText(frm_display, qr_text, text_pos, cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4)
                    cv2.putText(frm_display, qr_text, text_pos, cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 255), 2)
    except Exception as e:
        pass

    return frm_display


def push_frame_to_openmct(openmct_url, cam_id, jpeg_bytes):
    """Push processed JPEG frame to Open MCT Express backend."""
    try:
        target_url = f"{openmct_url}/api/camera/axis/{cam_id}/frame"
        headers = {"Content-Type": "image/jpeg"}
        requests.post(target_url, data=jpeg_bytes, headers=headers, timeout=0.8)
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description="AXIS Camera ArUco/QR Vision Bridge for Open MCT")
    parser.add_argument("--axis-ip", default=os.getenv("AXIS_IP", "192.168.11.150"), help="AXIS camera system IP")
    parser.add_argument("--user", default=os.getenv("AXIS_USER", "orion"), help="AXIS username")
    parser.add_argument("--pass", dest="password", default=os.getenv("AXIS_PASS", "orion"), help="AXIS password")
    parser.add_argument("--openmct-url", default=os.getenv("OPENMCT_URL", "http://localhost:8088"), help="Open MCT Gateway base URL")
    parser.add_argument("--resolution", default="960x540", help="Camera resolution (960x540, 1280x720, etc.)")
    parser.add_argument("--headless", action="store_true", default=True, help="Run without OpenCV GUI window (default: True)")
    parser.add_argument("--gui", dest="headless", action="store_false", help="Open local OpenCV display window")
    parser.add_argument("--fps", type=float, default=15.0, help="Target push rate to Open MCT (default: 15 FPS)")
    args = parser.parse_args()

    print(f"=== Orion VI AXIS Camera Vision Service ===")
    print(f"AXIS Gateway IP:  {args.axis_ip}")
    print(f"Open MCT Server:  {args.openmct_url}")
    print(f"Resolution:       {args.resolution}")
    print(f"Mode:             {'Headless (Background Service)' if args.headless else 'GUI Window Active'}")
    print(f"ArUco Dictionary: DICT_5X5_250")
    print("===========================================")

    # Setup ArUco detector (DICT_5X5_250)
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_5X5_250)
    aruco_params = cv2.aruco.DetectorParameters()
    MARKER_SIZE = 0.05
    camera_matrix = np.array([[1000, 0, 480],
                              [0, 1000, 270],
                              [0, 0, 1]], dtype=np.float32)
    dist_coeffs = np.zeros((4, 1))
    marker_3d_points = np.array([
        [-MARKER_SIZE / 2, MARKER_SIZE / 2, 0],
        [MARKER_SIZE / 2, MARKER_SIZE / 2, 0],
        [MARKER_SIZE / 2, -MARKER_SIZE / 2, 0],
        [-MARKER_SIZE / 2, -MARKER_SIZE / 2, 0]
    ], dtype=np.float32)

    # Setup QR detector
    qr_detector = cv2.QRCodeDetector()

    # RTSP URLs for AXIS channels 1..4
    def get_stream_url(cam_id):
        return f"rtsp://{args.user}:{args.password}@{args.axis_ip}/axis-media/media.amp?camera={cam_id}&resolution={args.resolution}"

    streams = {
        1: VideoStream(get_stream_url(1), "AXIS 1", 1).start(),
        2: VideoStream(get_stream_url(2), "AXIS 2", 2).start(),
        3: VideoStream(get_stream_url(3), "AXIS 3", 3).start(),
        4: VideoStream(get_stream_url(4), "AXIS 4", 4).start()
    }

    if not args.headless:
        cv2.namedWindow("AXIS OpenMCT Vision Bridge", cv2.WINDOW_NORMAL)

    frame_delay = 1.0 / max(1.0, args.fps)

    try:
        while True:
            start_time = time.time()
            display_tiles = []

            for cam_id in range(1, 5):
                st = streams[cam_id]
                frm = st.read()

                if frm is not None:
                    # Run ArUco & QR processing
                    annotated = process_frame(frm, aruco_dict, aruco_params, camera_matrix, dist_coeffs, marker_3d_points, qr_detector)

                    # Encode to JPEG and push asynchronously to Open MCT
                    ret, jpeg = cv2.imencode('.jpg', annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                    if ret:
                        jpeg_bytes = jpeg.tobytes()
                        threading.Thread(target=push_frame_to_openmct, args=(args.openmct_url, cam_id, jpeg_bytes), daemon=True).start()

                    if not args.headless:
                        resized = cv2.resize(annotated, (480, 270))
                        cv2.putText(resized, f"AXIS {cam_id}", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                        display_tiles.append(resized)
                else:
                    if not args.headless:
                        blank = np.zeros((270, 480, 3), dtype=np.uint8)
                        cv2.putText(blank, f"AXIS {cam_id}: NO SIGNAL", (80, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                        display_tiles.append(blank)

            if not args.headless and len(display_tiles) == 4:
                top_row = np.hstack((display_tiles[0], display_tiles[1]))
                bottom_row = np.hstack((display_tiles[2], display_tiles[3]))
                grid = np.vstack((top_row, bottom_row))
                cv2.imshow("AXIS OpenMCT Vision Bridge", grid)
                if cv2.waitKey(1) & 0xFF == 27:
                    break

            elapsed = time.time() - start_time
            sleep_time = max(0.005, frame_delay - elapsed)
            time.sleep(sleep_time)

    except KeyboardInterrupt:
        print("\n[INFO] Stopping AXIS camera service...")
    finally:
        for st in streams.values():
            st.stop()
        if not args.headless:
            cv2.destroyAllWindows()
        print("[INFO] AXIS camera service stopped.")


if __name__ == "__main__":
    main()
