import json
import os


# ============================================================
# LOAD CAMERA ZONES FROM THE MONITORING PROCESS
# ============================================================

def load_zones():
    """
    Load zone definitions passed by the Flask backend.

    Zones are received through CAMERA_ZONES_JSON.
    Only enabled zones are used for AI monitoring.
    """

    raw_zones = os.getenv("CAMERA_ZONES_JSON", "").strip()

    # No predefined zones: configuration must come from the user.
    if not raw_zones:
        return []

    try:
        configured_zones = json.loads(raw_zones)

    except json.JSONDecodeError as exc:
        raise ValueError(
            "CAMERA_ZONES_JSON contains invalid JSON."
        ) from exc

    if not isinstance(configured_zones, list):
        raise ValueError(
            "Camera zones must be provided as a list."
        )

    enabled_zones = []

    for zone in configured_zones:

        if not isinstance(zone, dict):
            raise ValueError(
                "Each zone configuration must be an object."
            )

        if not zone.get("enabled", True):
            continue

        name = zone.get("name")
        points = zone.get("points")
        capacity = zone.get("capacity")
        warning = zone.get("warning_threshold", 80)
        critical = zone.get("critical_threshold", 100)

        # ----------------------------------------------------
        # Validate zone name
        # ----------------------------------------------------

        if not isinstance(name, str) or not name.strip():
            raise ValueError(
                "Every enabled zone must have a name."
            )

        # ----------------------------------------------------
        # Validate polygon boundary
        # ----------------------------------------------------

        if not isinstance(points, list) or len(points) < 3:
            raise ValueError(
                f"Zone '{name}' must have at least three points."
            )

        validated_points = []

        for point in points:

            if not isinstance(point, dict):
                raise ValueError(
                    f"Invalid boundary point in zone '{name}'."
                )

            x = point.get("x")
            y = point.get("y")

            if (
                isinstance(x, bool)
                or isinstance(y, bool)
                or not isinstance(x, (int, float))
                or not isinstance(y, (int, float))
                or not (0 <= x <= 1)
                or not (0 <= y <= 1)
            ):
                raise ValueError(
                    f"Invalid coordinates in zone '{name}'. "
                    "Coordinates must be between 0 and 1."
                )

            validated_points.append({
                "x": float(x),
                "y": float(y)
            })

        # ----------------------------------------------------
        # Validate capacity
        # ----------------------------------------------------

        if (
            isinstance(capacity, bool)
            or not isinstance(capacity, int)
            or capacity <= 0
        ):
            raise ValueError(
                f"Zone '{name}' must have a positive capacity."
            )

        # ----------------------------------------------------
        # Validate warning and critical thresholds
        # ----------------------------------------------------

        if (
            isinstance(warning, bool)
            or isinstance(critical, bool)
            or not isinstance(warning, (int, float))
            or not isinstance(critical, (int, float))
            or not (0 <= warning < critical <= 100)
        ):
            raise ValueError(
                f"Invalid alert thresholds for zone '{name}'."
            )

        enabled_zones.append({
            "id": str(zone.get("id", "")),
            "name": name.strip(),
            "points": validated_points,
            "capacity": capacity,
            "warning_threshold": float(warning),
            "critical_threshold": float(critical),
            "enabled": True
        })

    return enabled_zones


# ============================================================
# ACTIVE ZONES FOR THE SELECTED CAMERA
# ============================================================

ZONES = load_zones()


# ============================================================
# POINT-IN-POLYGON TEST
# ============================================================

def point_in_polygon(x, y, points):
    """
    Determine whether a normalized point is inside a polygon.

    x and y are normalized coordinates between 0 and 1.
    The polygon is a list of dictionaries containing x and y.
    """

    inside = False

    j = len(points) - 1

    for i in range(len(points)):

        xi = points[i]["x"]
        yi = points[i]["y"]

        xj = points[j]["x"]
        yj = points[j]["y"]

        # Treat points on an edge as inside the polygon.
        cross = (
            (x - xi) * (yj - yi)
            - (y - yi) * (xj - xi)
        )

        if abs(cross) < 1e-9:
            if (
                min(xi, xj) - 1e-9 <= x <= max(xi, xj) + 1e-9
                and
                min(yi, yj) - 1e-9 <= y <= max(yi, yj) + 1e-9
            ):
                return True

        # Ray-casting test.
        if (yi > y) != (yj > y):

            intersection_x = (
                (xj - xi) * (y - yi)
                / (yj - yi)
                + xi
            )

            if x < intersection_x:
                inside = not inside

        j = i

    return inside


# ============================================================
# FIND THE ZONE CONTAINING A PERSON
# ============================================================

def get_zone(
    center_x,
    center_y,
    frame_width,
    frame_height
):
    """
    Return the name of the polygon containing the person's
    selected reference point.

    Pixel coordinates are converted to normalized coordinates
    so the same zone configuration works at different
    video resolutions.
    """

    if frame_width <= 0 or frame_height <= 0:
        return None

    normalized_x = center_x / frame_width
    normalized_y = center_y / frame_height

    for zone in ZONES:

        if point_in_polygon(
            normalized_x,
            normalized_y,
            zone["points"]
        ):
            return zone["name"]

    return None


# ============================================================
# GET A ZONE'S CAPACITY
# ============================================================

def get_zone_capacity(zone_name):

    for zone in ZONES:

        if zone["name"] == zone_name:
            return zone["capacity"]

    return 0


# ============================================================
# GET A ZONE'S ALERT THRESHOLDS
# ============================================================

def get_zone_thresholds(zone_name):

    for zone in ZONES:

        if zone["name"] == zone_name:

            return (
                zone["warning_threshold"],
                zone["critical_threshold"]
            )

    return 80.0, 100.0


# ============================================================
# CONVERT NORMALIZED POLYGON TO PIXEL COORDINATES
# ============================================================

def get_zone_pixel_points(
    zone,
    frame_width,
    frame_height
):
    """
    Convert a zone's normalized coordinates to pixel points
    for drawing boundaries on the video frame.
    """

    pixel_points = []

    for point in zone["points"]:

        x = round(point["x"] * (frame_width - 1))
        y = round(point["y"] * (frame_height - 1))

        pixel_points.append([x, y])

    return pixel_points


# ============================================================
# GET THE ZONE LABEL POSITION
# ============================================================

def get_zone_label_position(zone, frame_width, frame_height):
    """
    Return an approximate center position for the zone label.
    """

    points = zone["points"]

    if not points:
        return 0, 0

    center_x = sum(
        point["x"] for point in points
    ) / len(points)

    center_y = sum(
        point["y"] for point in points
    ) / len(points)

    x = int(center_x * frame_width)
    y = int(center_y * frame_height)

    return x, y