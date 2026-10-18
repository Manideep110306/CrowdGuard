import cv2
import ctypes
from ctypes import wintypes
import numpy as np
from ultralytics import YOLO
import time
import os
import requests
from datetime import datetime

from camera_config import get_video_source

from zones_config import (
    ZONES,
    get_zone,
    get_zone_capacity,
    get_zone_thresholds,
    get_zone_pixel_points,
    get_zone_label_position
)


# ============================================================
# VALIDATE CUSTOM ZONE CONFIGURATION
# ============================================================

if not ZONES:
    raise SystemExit(
        "No enabled monitoring zones found. "
        "Configure and save at least one zone for this camera, "
        "then start monitoring from the website."
    )

print(f"Loaded {len(ZONES)} custom monitoring zone(s).")

for zone in ZONES:
    print(
        f"Zone: {zone['name']} | "
        f"Capacity: {zone['capacity']} | "
        f"Warning: {zone['warning_threshold']}% | "
        f"Critical: {zone['critical_threshold']}%"
    )

# ============================================================
# CONFIGURATION
# ============================================================

# Testing with sample video
VIDEO_SOURCE = get_video_source()

# Later:
# Webcam:
# VIDEO_SOURCE = 0

# CCTV:
# VIDEO_SOURCE = "rtsp://username:password@camera_ip:port/stream"

MODEL_PATH = "yolo26n.pt"

# Occupancy thresholds
WARNING_THRESHOLD = 80
CRITICAL_THRESHOLD = 100

# Seconds crowd must remain above threshold
ALERT_DELAY = 3

# ============================================================
# MONITORING API CONFIGURATION
# ============================================================

CAMERA_ID = os.getenv("CAMERA_ID")

MONITORING_UPDATE_URL = (
    "http://127.0.0.1:5000/api/monitoring/update"
)

ALERT_EVENT_URL = "http://127.0.0.1:5000/api/alerts/event"

UPDATE_INTERVAL = 0.5

last_update_time = 0


# ============================================================
# LOAD YOLO MODEL
# ============================================================

model = YOLO(MODEL_PATH)


# ============================================================
# OPEN VIDEO SOURCE
# ============================================================

cap = cv2.VideoCapture(VIDEO_SOURCE)

if not cap.isOpened():
    print("ERROR: Could not open video source.")
    cap.release()
    exit()

print("Video source opened successfully.")

# ============================================================
# CREATE A RESIZABLE MONITORING WINDOW
# ============================================================

WINDOW_NAME = "AI Crowd Monitoring"

# Allow the window to be resized and maximized.
cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)

# Initial window size.
cv2.resizeWindow(WINDOW_NAME, 1280, 720)

# ============================================================
# GET THE ACTUAL WINDOW SIZE ON WINDOWS
# ============================================================

def get_window_client_size(window_name):
    try:
        user32 = ctypes.windll.user32

        user32.FindWindowW.argtypes = [
            wintypes.LPCWSTR,
            wintypes.LPCWSTR
        ]
        user32.FindWindowW.restype = wintypes.HWND

        user32.GetClientRect.argtypes = [
            wintypes.HWND,
            ctypes.POINTER(wintypes.RECT)
        ]
        user32.GetClientRect.restype = wintypes.BOOL

        hwnd = user32.FindWindowW(None, window_name)

        if not hwnd:
            return None

        rect = wintypes.RECT()

        if not user32.GetClientRect(
            hwnd,
            ctypes.byref(rect)
        ):
            return None

        width = rect.right - rect.left
        height = rect.bottom - rect.top

        if width <= 0 or height <= 0:
            return None

        return width, height

    except (AttributeError, OSError):
        return None


# ============================================================
# RESIZE VIDEO TO FIT THE WINDOW
# PRESERVE THE ORIGINAL ASPECT RATIO
# ============================================================

def fit_frame_to_window(frame, window_name):

    window_size = get_window_client_size(window_name)

    if window_size is None:
        return frame

    target_width, target_height = window_size

    frame_height, frame_width = frame.shape[:2]

    # Calculate scale without distorting the video.
    scale = min(
        target_width / frame_width,
        target_height / frame_height
    )

    display_width = max(
        1,
        int(frame_width * scale)
    )

    display_height = max(
        1,
        int(frame_height * scale)
    )

    # Resize only the displayed copy of the frame.
    interpolation = (
        cv2.INTER_AREA
        if scale < 1
        else cv2.INTER_LINEAR
    )

    resized_frame = cv2.resize(
        frame,
        (display_width, display_height),
        interpolation=interpolation
    )

    # Create a canvas matching the window dimensions.
    canvas = np.zeros(
        (target_height, target_width, 3),
        dtype=np.uint8
    )

    canvas[:] = (32, 32, 32)

    # Center the video within the canvas.
    x_offset = (target_width - display_width) // 2
    y_offset = (target_height - display_height) // 2

    canvas[
        y_offset:y_offset + display_height,
        x_offset:x_offset + display_width
    ] = resized_frame

    return canvas


# ============================================================
# ZONE ALERT STATE
# ============================================================

zone_warning_start = {
    zone["name"]: None
    for zone in ZONES
}

zone_alert_state = {
    zone["name"]: "NORMAL"
    for zone in ZONES
}

zone_highest_severity = {
    zone["name"]: "NORMAL"
    for zone in ZONES
}


# ============================================================
# FUNCTION: CALCULATE ZONE STATUS
# ============================================================

# ============================================================
# CALCULATE STATUS USING USER-DEFINED THRESHOLDS
# ============================================================

def get_status(
    occupancy,
    warning_threshold,
    critical_threshold
):
    if occupancy >= critical_threshold:
        return "CRITICAL"

    elif occupancy >= warning_threshold:
        return "WARNING"

    return "NORMAL"



# ============================================================
# SEND LIVE MONITORING DATA TO FLASK
# ============================================================

def send_monitoring_update(
    zone_counts,
    zone_statuses,
    total_detected_people
):

    if CAMERA_ID is None:
        return

    zones_data = {}

    for zone_name, count in zone_counts.items():

        capacity = get_zone_capacity(
            zone_name
        )

        if capacity <= 0:
            continue

        occupancy = (
            count / capacity
        ) * 100

        zones_data[zone_name] = {
            "people": count,
            "capacity": capacity,
            "occupancy": round(
                occupancy,
                1
            ),
            "status": zone_statuses.get(
                zone_name,
                "NORMAL"
            )
        }

    payload = {
        "camera_id": CAMERA_ID,
        "total_people": total_detected_people,
        "zones": zones_data,
        "updated_at": datetime.now().isoformat()
    }

    try:

        requests.post(
            MONITORING_UPDATE_URL,
            json=payload,
            timeout=0.5
        )

    except requests.RequestException:
        pass

# ============================================================
# SEND ALERT EVENTS TO FLASK
# ============================================================

def send_alert_event(
    event_type,
    zone_name,
    severity=None,
    people=0,
    capacity=0,
    occupancy=0
):
    """
    Send alert-created and alert-resolved events to Flask.
    Flask stores and updates alerts in MongoDB.
    """

    if not CAMERA_ID:
        print("Alert not sent: CAMERA_ID is missing.")
        return

    payload = {
        "camera_id": CAMERA_ID,
        "event_type": event_type,
        "zone": zone_name,
        "severity": severity,
        "people": int(people),
        "capacity": int(capacity),
        "occupancy": round(float(occupancy), 1)
    }

    try:
        response = requests.post(
            ALERT_EVENT_URL,
            json=payload,
            timeout=2
        )

        if response.ok:
            print(
                f"Alert event sent successfully: "
                f"{event_type} - {zone_name}"
            )
        else:
            print(
                f"Alert API returned HTTP {response.status_code}: "
                f"{response.text}"
            )

    except requests.RequestException as exc:
        print(
            f"Could not send alert event to Flask: {exc}"
        )


# ============================================================
# PROCESS VIDEO
# ============================================================

frame_number = 0

while True:

    # --------------------------------------------------------
    # READ FRAME
    # --------------------------------------------------------

    success, frame = cap.read()

    if not success:
        print("Video ended.")
        break

    frame_number += 1

    frame_height, frame_width = frame.shape[:2]


    # ========================================================
    # YOLO TRACKING
    # ========================================================

    results = model.track(
        frame,
        persist=True,
        classes=[0],
        conf=0.25,
        verbose=False
    )


    # ========================================================
    # ZONE COUNTERS
    # ========================================================

    zone_counts = {
        zone["name"]: 0
        for zone in ZONES
    }
    total_detected_people = 0

    # ========================================================
    # PROCESS DETECTIONS
    # ========================================================

    if results[0].boxes is not None:

        boxes = results[0].boxes

        for i in range(len(boxes)):

            # ------------------------------------------------
            # Bounding box
            # ------------------------------------------------
            total_detected_people += 1
            x1, y1, x2, y2 = boxes.xyxy[i].tolist()


            # ------------------------------------------------
            # Calculate person position
            # ------------------------------------------------

            # Calculate the center of the detected person
            center_x = int((x1 + x2) / 2)
            center_y = int((y1 + y2) / 2)

# Use the person's center for zone assignment
            person_x = center_x
            person_y = center_y

# Determine which configured polygon contains this point
            zone = get_zone(
                person_x,
                person_y,
                frame_width,
                frame_height
            )




            # ------------------------------------------------
            # Count person in zone
            # ------------------------------------------------

            if zone is not None:

                zone_counts[zone] += 1


            # ------------------------------------------------
            # Tracking ID
            # ------------------------------------------------

            track_id = None

            if boxes.id is not None:

                track_id = int(
                    boxes.id[i].item()
                )


            # ------------------------------------------------
            # Draw bounding box
            # ------------------------------------------------

            cv2.rectangle(
                frame,
                (int(x1), int(y1)),
                (int(x2), int(y2)),
                (0, 255, 0),
                2
            )


            # ------------------------------------------------
            # Draw tracking ID
            # ------------------------------------------------

            if track_id is not None:

                cv2.putText(
                    frame,
                    f"ID {track_id}",
                    (int(x1), int(y1) - 10),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 255, 0),
                    2
                )


            # ------------------------------------------------
            # Draw center point
            # ------------------------------------------------

            # Show the exact point used for zone assignment
            if zone is not None:
                point_color = (0, 255, 0)  # Green: assigned to a zone
            else:
                point_color = (0, 0, 255)  # Red: outside all zones

            cv2.circle(
                frame,
                (person_x, person_y),
                6,
                point_color,
                -1
            )

            if zone is not None:
                cv2.putText(
                    frame,
                    zone,
                    (person_x + 8, person_y),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 255, 0),
                    2
                )


    # ============================================================
    # DRAW USER-DEFINED POLYGON ZONES
    # ============================================================

    ZONE_COLORS = [
        (255, 200, 0),
        (0, 200, 255),
        (255, 100, 100),
        (100, 255, 100),
        (200, 100, 255),
        (100, 200, 255),
    ]

    for index, zone_config in enumerate(ZONES):

        # Convert normalized coordinates to frame pixels
        pixel_points = get_zone_pixel_points(
            zone_config,
            frame_width,
            frame_height
        )

        polygon = np.array(
            pixel_points,
            dtype=np.int32
        ).reshape((-1, 1, 2))

        color = ZONE_COLORS[index % len(ZONE_COLORS)]

        # Draw the complete polygon boundary
        cv2.polylines(
            frame,
            [polygon],
            isClosed=True,
            color=color,
            thickness=3,
            lineType=cv2.LINE_AA
        )

    # ============================================================
    # OCCUPANCY + ALERT PROCESSING
    # ============================================================

    current_time = time.monotonic()

    zone_statuses = {}

    for zone_name, count in zone_counts.items():

        # --------------------------------------------------------
        # Get the capacity for this zone
        # --------------------------------------------------------

        capacity = get_zone_capacity(zone_name)

        if capacity <= 0:
            continue

        # --------------------------------------------------------
        # Get the thresholds selected by the user
        # --------------------------------------------------------

        warning_threshold, critical_threshold = (
            get_zone_thresholds(zone_name)
        )

        # --------------------------------------------------------
        # Calculate occupancy percentage
        # --------------------------------------------------------

        occupancy = (count / capacity) * 100

        # --------------------------------------------------------
        # Determine zone status
        # --------------------------------------------------------

        status = get_status(
            occupancy,
            warning_threshold,
            critical_threshold
        )

        zone_statuses[zone_name] = status

        # ========================================================
        # ALERT STATE MANAGEMENT
        # ========================================================

        if status != "NORMAL":

            # Start the timer when the zone first becomes unsafe
            if zone_warning_start[zone_name] is None:
                zone_warning_start[zone_name] = current_time

            # Remember the highest severity reached
            if status == "CRITICAL":

                zone_highest_severity[zone_name] = "CRITICAL"

            elif (
                status == "WARNING"
                and zone_highest_severity[zone_name] == "NORMAL"
            ):

                zone_highest_severity[zone_name] = "WARNING"

            elapsed = (
                current_time - zone_warning_start[zone_name]
            )

            # Create only one active alert for this unsafe period
            if (
                elapsed >= ALERT_DELAY
                and zone_alert_state[zone_name] == "NORMAL"
            ):

                alert_severity = zone_highest_severity[zone_name]

                print(
                    f"ALERT CREATED: "
                    f"{zone_name} - "
                    f"{alert_severity} - "
                    f"{occupancy:.1f}%"
                )
                send_alert_event(
                    event_type="created",
                    zone_name=zone_name,
                    severity=alert_severity,
                    people=count,
                    capacity=capacity,
                    occupancy=occupancy
                )

                zone_alert_state[zone_name] = "ACTIVE"

        else:

            # ----------------------------------------------------
            # The zone has returned to a safe occupancy level
            # ----------------------------------------------------

            zone_warning_start[zone_name] = None

            if zone_alert_state[zone_name] == "ACTIVE":

                print(
                    f"ALERT RESOLVED: {zone_name}"
                )

    # Tell Flask that the zone has returned to a safe level
                send_alert_event(
                    event_type="resolved",
                    zone_name=zone_name,
                    people=count,
                    capacity=capacity,
                    occupancy=occupancy
                )

                zone_alert_state[zone_name] = "NORMAL"

                zone_highest_severity[zone_name] = "NORMAL"
    # ========================================================
    # SEND LIVE DATA TO FLASK
    # ========================================================

    current_update_time = time.monotonic()

    if (
        current_update_time - last_update_time
        >= UPDATE_INTERVAL
    ):

        send_monitoring_update(
            zone_counts,
            zone_statuses,
            total_detected_people
        )

        last_update_time = current_update_time
    # ========================================================
    # DISPLAY ZONE COUNTS
    # ========================================================

    y_position = 50

    for zone_name, count in zone_counts.items():

        cv2.putText(
            frame,
            f"{zone_name}: {count}",
            (30, y_position),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            (255, 255, 255),
            2
        )

        y_position += 50


    # ========================================================
    # DISPLAY TOTAL PEOPLE
    # ========================================================

    total_people: total_detected_people

    cv2.putText(
        frame,
        f"Total People: {total_detected_people}",
        (30, y_position),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 255, 255),
        2
    )


    # ============================================================
    # DISPLAY USER-DEFINED ZONE NAMES
    # ============================================================

    for zone_config in ZONES:

        label_x, label_y = get_zone_label_position(
            zone_config,
            frame_width,
            frame_height
        )

        # Keep the label inside the video frame
        label_x = max(
            10,
            min(label_x, frame_width - 300)
        )

        label_y = max(
            25,
            min(label_y, frame_height - 10)
        )

        cv2.putText(
            frame,
            zone_config["name"].upper(),
            (label_x, label_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (255, 255, 255),
            2,
            cv2.LINE_AA
        )

    # ========================================================
    # DISPLAY OCCUPANCY STATUS
    # ========================================================

    y_position = 250

    for zone_name, count in zone_counts.items():

        capacity = get_zone_capacity(
            zone_name
        )

        if capacity <= 0:
            continue

        occupancy = (
            count / capacity
        ) * 100

        status = zone_statuses.get(
            zone_name,
            "NORMAL"
        )

        text = (
            f"{zone_name}: "
            f"{occupancy:.0f}% "
            f"{status}"
        )

        cv2.putText(
            frame,
            text,
            (30, y_position),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 255, 255),
            2
        )

        y_position += 40


    # ========================================================
    # DISPLAY VIDEO
    # ========================================================

    display_frame = fit_frame_to_window(
        frame,
        WINDOW_NAME
    )

    cv2.imshow(
        WINDOW_NAME,
        display_frame
    )

    # ========================================================
    # PRESS Q TO STOP
    # ========================================================

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break


# ============================================================
# CLEANUP
# ============================================================

cap.release()

cv2.destroyAllWindows()

print()
print("Monitoring finished.")
print(f"Total frames processed: {frame_number}")
