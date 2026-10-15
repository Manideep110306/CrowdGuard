import os


# ============================================================
# DEFAULT CAMERA CONFIGURATION
# ============================================================

SOURCE_TYPE = "webcam"

VIDEO_PATH = "videos/sample.mp4"

WEBCAM_INDEX = 0

RTSP_URL = ""


# ============================================================
# GET VIDEO SOURCE
# ============================================================

def get_video_source():

    # Flask can override the camera configuration
    # using environment variables.

    env_source_type = os.getenv(
        "CAMERA_SOURCE_TYPE"
    )

    env_source = os.getenv(
        "CAMERA_SOURCE"
    )

    source_type = (
        env_source_type
        if env_source_type
        else SOURCE_TYPE
    )

    # --------------------------------------------------------
    # VIDEO
    # --------------------------------------------------------

    if source_type == "video":

        return (
            env_source
            if env_source
            else VIDEO_PATH
        )

    # --------------------------------------------------------
    # WEBCAM
    # --------------------------------------------------------

    elif source_type == "webcam":

        if env_source:
            return int(env_source)

        return WEBCAM_INDEX

    # --------------------------------------------------------
    # CCTV / RTSP
    # --------------------------------------------------------

    elif source_type == "rtsp":

        return (
            env_source
            if env_source
            else RTSP_URL
        )

    else:

        raise ValueError(
            f"Invalid SOURCE_TYPE: {source_type}"
        )