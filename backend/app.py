import os
from copy import deepcopy
from functools import wraps
import uuid
import jwt
from bson import ObjectId
from dotenv import load_dotenv
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from pymongo import MongoClient

from auth_routes import create_auth_blueprint
from monitoring_service import start_monitoring, stop_monitoring, is_monitoring


# Load environment variables from backend/.env
load_dotenv(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
)

app = Flask(__name__)
CORS(app)


# ============================================================
# MONGODB CONNECTION
# ============================================================

MONGO_URI = "mongodb://localhost:27017/"

client = MongoClient(
    MONGO_URI,
    serverSelectionTimeoutMS=5000
)

db = client["crowd_monitoring"]

users_collection = db["users"]
revoked_tokens_collection = db["revoked_tokens"]
cameras_collection = db["cameras"]
monitoring_status_collection = db["monitoring_status"]


# ============================================================
# DEFAULT MONITORING ZONES
# ============================================================

DEFAULT_VERTICAL_ZONES = [
    {
        "id": "default-left-zone",
        "name": "Left Zone",
        "points": [
            {"x": 0.0, "y": 0.0},
            {"x": 0.3333, "y": 0.0},
            {"x": 0.3333, "y": 1.0},
            {"x": 0.0, "y": 1.0},
        ],
        "capacity": 20,
        "warning_threshold": 80,
        "critical_threshold": 100,
        "enabled": True,
    },
    {
        "id": "default-center-zone",
        "name": "Center Zone",
        "points": [
            {"x": 0.3333, "y": 0.0},
            {"x": 0.6667, "y": 0.0},
            {"x": 0.6667, "y": 1.0},
            {"x": 0.3333, "y": 1.0},
        ],
        "capacity": 20,
        "warning_threshold": 80,
        "critical_threshold": 100,
        "enabled": True,
    },
    {
        "id": "default-right-zone",
        "name": "Right Zone",
        "points": [
            {"x": 0.6667, "y": 0.0},
            {"x": 1.0, "y": 0.0},
            {"x": 1.0, "y": 1.0},
            {"x": 0.6667, "y": 1.0},
        ],
        "capacity": 20,
        "warning_threshold": 80,
        "critical_threshold": 100,
        "enabled": True,
    },
]


# ============================================================
# AUTHENTICATION CONFIGURATION
# ============================================================

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
if not JWT_SECRET_KEY or JWT_SECRET_KEY == "YOUR_GENERATED_SECRET_KEY":
    raise RuntimeError(
        "JWT_SECRET_KEY is missing or not configured. Check backend/.env."
    )

try:
    JWT_EXPIRY_HOURS = int(os.getenv("JWT_EXPIRY_HOURS", "8"))
    if JWT_EXPIRY_HOURS <= 0:
        raise ValueError
except ValueError as exc:
    raise RuntimeError("JWT_EXPIRY_HOURS must be a positive integer.") from exc

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")


# ============================================================
# REGISTER AUTHENTICATION ROUTES
# ============================================================

auth_blueprint = create_auth_blueprint(
    db=db,
    jwt_secret_key=JWT_SECRET_KEY,
    jwt_expiry_hours=JWT_EXPIRY_HOURS,
    google_client_id=GOOGLE_CLIENT_ID,
)
app.register_blueprint(auth_blueprint)


# ============================================================
# AUTHENTICATION HELPER FOR PROTECTED API ROUTES
# ============================================================

def require_auth(view_function):
    """Require a valid bearer token and expose its user ID to the route."""

    @wraps(view_function)
    def wrapped(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Authentication required."}), 401

        token = auth_header.split(" ", 1)[1].strip()
        if not token:
            return jsonify({"error": "Authentication required."}), 401

        try:
            payload = jwt.decode(
                token,
                JWT_SECRET_KEY,
                algorithms=["HS256"],
            )
            subject = payload.get("sub")
            if not subject or not ObjectId.is_valid(str(subject)):
                return jsonify({"error": "Invalid authentication token."}), 401
            user_object_id = ObjectId(str(subject))
        except (jwt.InvalidTokenError, TypeError, ValueError):
            return jsonify({"error": "Invalid or expired authentication token."}), 401

        token_id = payload.get("jti")
        if token_id:
            revoked = revoked_tokens_collection.find_one(
                {"$or": [{"jti": token_id}, {"token_id": token_id}]},
                {"_id": 1},
            )
            if revoked:
                return jsonify({"error": "This session has been logged out."}), 401

        user = users_collection.find_one({"_id": user_object_id})
        if not user or user.get("active", True) is False:
            return jsonify({"error": "User account is unavailable."}), 401

        g.current_user_id = str(user["_id"])
        g.current_user = user
        return view_function(*args, **kwargs)

    return wrapped


def camera_to_response(camera):
    """Return only fields intended for the frontend."""
    return {
        "id": str(camera["_id"]),
        "name": camera.get("name"),
        "source_type": camera.get("source_type"),
        "source": camera.get("source"),
        "location": camera.get("location"),
        "status": camera.get("status", "inactive"),
    }


def get_owned_camera(camera_id):
    """Find a camera only if it belongs to the currently authenticated user."""
    if not ObjectId.is_valid(camera_id):
        return None
    return cameras_collection.find_one(
        {"_id": ObjectId(camera_id), "user_id": g.current_user_id}
    )


def default_vertical_zones():
    """Return a fresh copy of the built-in vertical monitoring zones."""
    return deepcopy(DEFAULT_VERTICAL_ZONES)


def camera_zones_or_default(camera):
    """Use saved camera zones, or fall back to the built-in vertical zones."""
    zones = camera.get("zones")
    if isinstance(zones, list) and zones:
        return zones
    return default_vertical_zones()

# ============================================================
# GET USER-DEFINED ZONES FOR A CAMERA
# ============================================================

@app.route(
    "/api/cameras/<camera_id>/zones",
    methods=["GET"]
)
@require_auth
def get_camera_zones(camera_id):

    camera = get_owned_camera(camera_id)

    if camera is None:
        return jsonify({
            "error": "Camera not found."
        }), 404

    zones = camera_zones_or_default(camera)

    return jsonify({
        "camera_id": camera_id,
        "zones": zones,
        "using_default_zones": not bool(camera.get("zones")),
    }), 200


# ============================================================
# SAVE USER-DEFINED ZONES FOR A CAMERA
# ============================================================

@app.route(
    "/api/cameras/<camera_id>/zones",
    methods=["PUT"]
)
@require_auth
def save_camera_zones(camera_id):

    camera = get_owned_camera(camera_id)

    if camera is None:
        return jsonify({
            "error": "Camera not found."
        }), 404

    # Require a JSON request.
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "A JSON request body is required."
        }), 400

    zones = data.get("zones")

    if not isinstance(zones, list):
        return jsonify({
            "error": "Zones must be provided as a list."
        }), 400

    # Validate every submitted zone.
    validated_zones = []
    used_names = set()
    used_ids = set()

    for index, zone in enumerate(zones):

        if not isinstance(zone, dict):
            return jsonify({
                "error": f"Zone {index + 1} must be an object."
            }), 400

        # Validate the zone name.
        name = zone.get("name")

        if not isinstance(name, str) or not name.strip():
            return jsonify({
                "error": f"Zone {index + 1} requires a name."
            }), 400

        name = name.strip()
        name_key = name.casefold()

        if name_key in used_names:
            return jsonify({
                "error": f"Duplicate zone name: {name}"
            }), 400

        used_names.add(name_key)

        # Validate the polygon.
        points = zone.get("points")

        if not isinstance(points, list) or len(points) < 3:
            return jsonify({
                "error": (
                    f"Zone '{name}' needs at least "
                    "three boundary points."
                )
            }), 400

        validated_points = []

        for point in points:

            if not isinstance(point, dict):
                return jsonify({
                    "error": (
                        f"Every boundary point in '{name}' "
                        "must contain x and y coordinates."
                    )
                }), 400

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
                return jsonify({
                    "error": (
                        f"Zone '{name}' coordinates must "
                        "be between 0 and 1."
                    )
                }), 400

            validated_points.append({
                "x": float(x),
                "y": float(y)
            })

        # Validate capacity.
        capacity = zone.get("capacity")

        if (
            isinstance(capacity, bool)
            or not isinstance(capacity, int)
            or capacity <= 0
        ):
            return jsonify({
                "error": (
                    f"Zone '{name}' capacity must be "
                    "a positive integer."
                )
            }), 400

        # Validate warning and critical thresholds.
        warning = zone.get("warning_threshold", 80)
        critical = zone.get("critical_threshold", 100)

        if (
            isinstance(warning, bool)
            or isinstance(critical, bool)
            or not isinstance(warning, (int, float))
            or not isinstance(critical, (int, float))
            or not (0 <= warning < critical <= 100)
        ):
            return jsonify({
                "error": (
                    f"Zone '{name}' must have thresholds "
                    "between 0 and 100, with warning "
                    "below critical."
                )
            }), 400

        enabled = zone.get("enabled", True)

        if not isinstance(enabled, bool):
            return jsonify({
                "error": (
                    f"Zone '{name}' enabled must be true or false."
                )
            }), 400

        # Preserve the ID when editing an existing zone.
        zone_id = zone.get("id") or str(uuid.uuid4())

        if not isinstance(zone_id, str) or not zone_id.strip():
            return jsonify({
                "error": f"Zone '{name}' has an invalid ID."
            }), 400

        zone_id = zone_id.strip()

        if zone_id in used_ids:
            return jsonify({
                "error": f"Duplicate zone ID in '{name}'."
            }), 400

        used_ids.add(zone_id)

        validated_zones.append({
            "id": zone_id,
            "name": name,
            "points": validated_points,
            "capacity": capacity,
            "warning_threshold": warning,
            "critical_threshold": critical,
            "enabled": enabled
        })

    # Zone configurations are loaded when monitoring starts.
    # Require monitoring to stop before changing the configuration.
    if is_monitoring(camera_id):
        return jsonify({
            "error": (
                "Stop monitoring this camera before changing its zones."
            )
        }), 409

    # Store the configuration against this camera.
    cameras_collection.update_one(
        {
            "_id": ObjectId(camera_id),
            "user_id": g.current_user_id
        },
        {
            "$set": {
                "zones": validated_zones
            }
        }
    )

    return jsonify({
        "message": "Camera zones saved successfully.",
        "camera_id": camera_id,
        "zones": validated_zones
    }), 200
# ============================================================
# GET CAMERAS FOR THE SIGNED-IN USER ONLY
# ============================================================

@app.route("/api/cameras", methods=["GET"])
@require_auth
def get_cameras():
    cameras = cameras_collection.find({"user_id": g.current_user_id})
    return jsonify([camera_to_response(camera) for camera in cameras]), 200


# ============================================================
# REGISTER A CAMERA FOR THE SIGNED-IN USER
# ============================================================

@app.route("/api/cameras", methods=["POST"])
@require_auth
def add_camera():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "A JSON request body is required."}), 400

    name = data.get("name")
    source_type = data.get("source_type")
    # A webcam normally uses OpenCV source 0. Accept an omitted source for webcams.
    source = data.get("source", 0 if source_type == "webcam" else None)
    location = data.get("location", "")

    if not isinstance(name, str) or not name.strip():
        return jsonify({"error": "Camera name is required."}), 400
    if not isinstance(source_type, str) or not source_type.strip():
        return jsonify({"error": "Camera source_type is required."}), 400
    if source is None or source == "":
        return jsonify({"error": "Camera source is required."}), 400

    camera = {
        "user_id": g.current_user_id,
        "name": name.strip(),
        "source_type": source_type.strip(),
        "source": source,
        "location": location.strip() if isinstance(location, str) else location,
        "status": "inactive",
        "zones": default_vertical_zones(),
    }

    result = cameras_collection.insert_one(camera)
    camera["_id"] = result.inserted_id
    return jsonify({
        "message": "Camera registered successfully.",
        "camera": camera_to_response(camera),
    }), 201


# ============================================================
# EDIT A CAMERA OWNED BY THE SIGNED-IN USER
# Supports PUT and PATCH at /api/cameras/<camera_id>
# ============================================================

@app.route("/api/cameras/<camera_id>", methods=["PUT", "PATCH"])
@require_auth
def edit_camera(camera_id):
    camera = get_owned_camera(camera_id)
    if camera is None:
        return jsonify({"error": "Camera not found."}), 404

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "A JSON request body is required."}), 400

    editable_fields = ("name", "source_type", "source", "location")
    updates = {key: data[key] for key in editable_fields if key in data}
    if not updates:
        return jsonify({"error": "No editable camera fields were provided."}), 400

    if "name" in updates:
        if not isinstance(updates["name"], str) or not updates["name"].strip():
            return jsonify({"error": "Camera name cannot be empty."}), 400
        updates["name"] = updates["name"].strip()

    if "source_type" in updates:
        if not isinstance(updates["source_type"], str) or not updates["source_type"].strip():
            return jsonify({"error": "Camera source_type cannot be empty."}), 400
        updates["source_type"] = updates["source_type"].strip()

    if "source" in updates and (updates["source"] is None or updates["source"] == ""):
        return jsonify({"error": "Camera source cannot be empty."}), 400

    if "location" in updates and isinstance(updates["location"], str):
        updates["location"] = updates["location"].strip()

    # Changing a source while its process is active can leave the old source running.
    source_is_changing = "source" in updates or "source_type" in updates
    if source_is_changing and is_monitoring(camera_id):
        return jsonify({
            "error": "Stop monitoring this camera before changing its source."
        }), 409

    cameras_collection.update_one(
        {"_id": ObjectId(camera_id), "user_id": g.current_user_id},
        {"$set": updates},
    )
    updated_camera = get_owned_camera(camera_id)
    return jsonify({
        "message": "Camera updated successfully.",
        "camera": camera_to_response(updated_camera),
    }), 200


# ============================================================
# DELETE A CAMERA OWNED BY THE SIGNED-IN USER
# ============================================================

@app.route("/api/cameras/<camera_id>", methods=["DELETE"])
@require_auth
def delete_camera(camera_id):
    camera = get_owned_camera(camera_id)
    if camera is None:
        return jsonify({"error": "Camera not found."}), 404

    if is_monitoring(camera_id):
        success, message = stop_monitoring(camera_id)
        if not success:
            return jsonify({
                "error": message or "Could not stop camera monitoring. Stop it manually and retry."
            }), 409

    result = cameras_collection.delete_one(
        {"_id": ObjectId(camera_id), "user_id": g.current_user_id}
    )
    if result.deleted_count == 0:
        return jsonify({"error": "Camera not found."}), 404

    monitoring_status_collection.delete_one({"camera_id": camera_id})
    return jsonify({"message": "Camera deleted successfully."}), 200


# ============================================================
# START CAMERA MONITORING
# ============================================================

@app.route(
    "/api/cameras/<camera_id>/start",
    methods=["POST"]
)
@require_auth
def start_camera_monitoring(camera_id):

    # --------------------------------------------------------
    # 1. Retrieve the camera belonging to the logged-in user
    # --------------------------------------------------------

    camera = get_owned_camera(camera_id)

    if camera is None:
        return jsonify({
            "error": "Camera not found."
        }), 404

    # --------------------------------------------------------
    # 2. Get the saved zones for this camera
    # --------------------------------------------------------

    zones = camera_zones_or_default(camera)

    # Keep only enabled zones
    enabled_zones = [
        zone for zone in zones
        if zone.get("enabled", True)
    ]

    # --------------------------------------------------------
    # 3. Require at least one enabled zone
    # --------------------------------------------------------

    if not enabled_zones:
        return jsonify({
            "error": (
                "Configure at least one enabled zone "
                "before starting camera monitoring."
            )
        }), 400

    # --------------------------------------------------------
    # 4. Start monitoring with the saved zones
    # --------------------------------------------------------

    success, message = start_monitoring(
        camera_id,
        camera["source_type"],
        camera["source"],
        zones=zones
    )

    # --------------------------------------------------------
    # 5. Update camera status if monitoring starts
    # --------------------------------------------------------

    if success:

        cameras_collection.update_one(
            {
                "_id": camera["_id"]
            },
            {
                "$set": {
                    "status": "active"
                }
            }
        )

        return jsonify({
            "message": message,
            "camera_id": camera_id,
            "status": "active"
        }), 200

    # --------------------------------------------------------
    # 6. Handle failure
    # --------------------------------------------------------

    return jsonify({
        "message": message
    }), 400

# ============================================================
# STOP CAMERA MONITORING
# ============================================================

@app.route("/api/cameras/<camera_id>/stop", methods=["POST"])
@require_auth
def stop_camera_monitoring(camera_id):
    camera = get_owned_camera(camera_id)
    if camera is None:
        return jsonify({"error": "Camera not found."}), 404

    success, message = stop_monitoring(camera_id)
    if success:
        cameras_collection.update_one(
            {"_id": ObjectId(camera_id), "user_id": g.current_user_id},
            {"$set": {"status": "inactive"}},
        )
        return jsonify({
            "message": message,
            "camera_id": camera_id,
            "status": "inactive",
        }), 200

    return jsonify({"message": message}), 400


# ============================================================
# RECEIVE LIVE MONITORING DATA FROM THE LOCAL AI PROCESS
# This route is called by person_tracker.py, not by the browser.
# ============================================================

@app.route("/api/monitoring/update", methods=["POST"])
def update_monitoring_status():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "A JSON request body is required."}), 400

    camera_id = data.get("camera_id")
    if not camera_id:
        return jsonify({"error": "camera_id is required."}), 400

    monitoring_data = {
        "camera_id": str(camera_id),
        "total_people": data.get("total_people", 0),
        "zones": data.get("zones", {}),
        "updated_at": data.get("updated_at"),
    }
    monitoring_status_collection.update_one(
        {"camera_id": str(camera_id)},
        {"$set": monitoring_data},
        upsert=True,
    )

    return jsonify({
        "message": "Monitoring status updated successfully.",
        "camera_id": str(camera_id),
    }), 200


# ============================================================
# GET LIVE MONITORING DATA FOR THE SIGNED-IN USER'S CAMERA
# ============================================================

@app.route("/api/monitoring/status/<camera_id>", methods=["GET"])
@require_auth
def get_monitoring_status(camera_id):
    camera = get_owned_camera(camera_id)
    if camera is None:
        return jsonify({"error": "Camera not found."}), 404

    status = monitoring_status_collection.find_one(
        {"camera_id": camera_id},
        {"_id": 0},
    )
    if status is None:
        return jsonify({"error": "No monitoring data available."}), 404

    return jsonify(status), 200


# ============================================================
# HOME AND HEALTH CHECK
# ============================================================

@app.route("/")
def home():
    return jsonify({
        "message": "AI Crowd Monitoring Backend is running",
        "status": "online",
    })


@app.route("/api/health")
def health():
    try:
        client.admin.command("ping")
        database_status = "connected"
    except Exception:
        database_status = "disconnected"

    return jsonify({
        "backend": "online",
        "ai_engine": "ready",
        "database": database_status,
    })


try:
    client.admin.command("ping")
    print("MongoDB connected successfully.")
except Exception as exc:
    print("MongoDB connection failed.")
    print(exc)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
