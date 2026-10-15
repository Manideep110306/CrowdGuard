import os
import sys
import json
import subprocess


# ============================================================
# ACTIVE MONITORING PROCESSES
# ============================================================

active_processes = {}


# ============================================================
# PROJECT ROOT
# ============================================================

PROJECT_ROOT = os.path.dirname(
    os.path.dirname(
        os.path.abspath(__file__)
    )
)


# Path to the AI engine
PERSON_TRACKER = os.path.join(
    PROJECT_ROOT,
    "person_tracker.py"
)


# ============================================================
# START MONITORING
# ============================================================

def start_monitoring(
    camera_id,
    source_type,
    source,
    zones=None
):
    """
    Start AI monitoring for a camera.

    zones:
        List of user-configured zones belonging to this camera.
        Each zone will eventually contain its name, polygon
        coordinates, capacity, thresholds, and enabled status.
    """

    # --------------------------------------------------------
    # Check whether this camera is already running
    # --------------------------------------------------------

    if camera_id in active_processes:

        process = active_processes[camera_id]

        if process.poll() is None:
            return False, "Camera is already being monitored."


    # --------------------------------------------------------
    # Prepare the subprocess environment
    # --------------------------------------------------------

    env = os.environ.copy()

    # Tell camera_config.py which source to use.
    env["CAMERA_SOURCE_TYPE"] = str(source_type)
    env["CAMERA_SOURCE"] = str(source)
    env["CAMERA_ID"] = str(camera_id)

    # Avoid accidentally reusing an old configuration.
    env.pop("CAMERA_ZONES_JSON", None)

    # Pass the selected camera's saved zones to the AI engine.
    if zones is not None:
        try:
            env["CAMERA_ZONES_JSON"] = json.dumps(zones)
        except (TypeError, ValueError) as exc:
            return False, f"Invalid camera zone configuration: {exc}"


    # --------------------------------------------------------
    # Start the AI engine as a separate process
    # --------------------------------------------------------

    try:
        process = subprocess.Popen(
            [
                sys.executable,
                PERSON_TRACKER
            ],
            env=env,
            cwd=PROJECT_ROOT
        )

    except (OSError, subprocess.SubprocessError) as exc:
        return False, f"Could not start AI monitoring: {exc}"


    # --------------------------------------------------------
    # Store the process
    # --------------------------------------------------------

    active_processes[camera_id] = process

    return True, "Monitoring started successfully."


# ============================================================
# STOP MONITORING
# ============================================================

def stop_monitoring(camera_id):

    if camera_id not in active_processes:
        return False, "Camera is not currently being monitored."


    process = active_processes[camera_id]


    # Check if the process has already stopped.
    if process.poll() is not None:

        del active_processes[camera_id]

        return False, "Monitoring process has already stopped."


    # Stop the AI process.
    process.terminate()

    try:
        process.wait(timeout=5)

    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


    del active_processes[camera_id]

    return True, "Monitoring stopped successfully."


# ============================================================
# CHECK MONITORING STATUS
# ============================================================

def is_monitoring(camera_id):

    if camera_id not in active_processes:
        return False

    process = active_processes[camera_id]

    return process.poll() is None