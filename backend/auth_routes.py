import re
import secrets
from datetime import datetime, timezone

import jwt

from bson import ObjectId
from bson.errors import InvalidId
from pymongo.errors import DuplicateKeyError

from flask import Blueprint, jsonify, request, current_app

from werkzeug.security import (
    generate_password_hash,
    check_password_hash
)

from google.oauth2 import id_token
from google.auth.transport.requests import Request as GoogleRequest
from google.auth import exceptions as google_auth_exceptions


def create_auth_blueprint(
    db,
    jwt_secret_key,
    jwt_expiry_hours=8,
    google_client_id=""
):
    """
    Create authentication routes using the existing MongoDB database.
    """

    auth_bp = Blueprint(
        "auth",
        __name__,
        url_prefix="/api/auth"
    )

    users_collection = db["users"]
    revoked_tokens_collection = db["revoked_tokens"]

    # Create indexes to prevent duplicate accounts.
    users_collection.create_index(
        "username",
        unique=True
    )

    users_collection.create_index(
        "email",
        unique=True
    )

    users_collection.create_index(
        "google_sub",
        unique=True,
        sparse=True
    )

    # Automatically delete expired revoked-token records.
    revoked_tokens_collection.create_index(
        "expires_at",
        expireAfterSeconds=0
    )

    # --------------------------------------------------------
    # USER RESPONSE
    # --------------------------------------------------------

    def public_user(user):
        """
        Return safe user information.
        Never return password hashes or internal auth details.
        """

        return {
            "id": str(user["_id"]),
            "name": user.get("name", ""),
            "username": user.get("username", ""),
            "email": user.get("email", ""),
            "role": user.get("role", "security_operator")
        }

    # --------------------------------------------------------
    # JWT GENERATION
    # --------------------------------------------------------

    def create_token(user):

        now = int(datetime.now(timezone.utc).timestamp())

        payload = {
            "sub": str(user["_id"]),
            "iat": now,
            "exp": now + (int(jwt_expiry_hours) * 3600),
            "jti": secrets.token_urlsafe(24)
        }

        return jwt.encode(
            payload,
            jwt_secret_key,
            algorithm="HS256"
        )

    # --------------------------------------------------------
    # LOGIN RESPONSE
    # --------------------------------------------------------

    def authenticated_response(user):

        return {
            "message": "Login successful",
            "user": public_user(user),
            "token": create_token(user)
        }

    # --------------------------------------------------------
    # READ AND VALIDATE BEARER TOKEN
    # --------------------------------------------------------

    def get_token_payload():

        auth_header = request.headers.get(
            "Authorization",
            ""
        )

        if not auth_header.startswith("Bearer "):
            return None

        token = auth_header.split(
            " ",
            1
        )[1].strip()

        if not token:
            return None

        try:

            payload = jwt.decode(
                token,
                jwt_secret_key,
                algorithms=["HS256"],
                options={
                    "require": [
                        "sub",
                        "iat",
                        "exp",
                        "jti"
                    ]
                }
            )

            # Reject tokens that were revoked by logout.
            revoked = revoked_tokens_collection.find_one(
                {"jti": payload["jti"]}
            )

            if revoked:
                return None

            return payload

        except jwt.InvalidTokenError:
            return None

    # ========================================================
    # REGISTER
    # POST /api/auth/register
    # ========================================================

    @auth_bp.route(
        "/register",
        methods=["POST"]
    )
    def register():

        data = request.get_json(silent=True)

        if not isinstance(data, dict):
            return jsonify({
                "error": "A JSON request body is required."
            }), 400

        name = data.get("name", "")
        username = data.get("username", "")
        email = data.get("email", "")
        password = data.get("password", "")

        # Validate input types.
        if not all(
            isinstance(value, str)
            for value in [name, username, email, password]
        ):
            return jsonify({
                "error": "All registration fields must be strings."
            }), 400

        name = name.strip()
        username = username.strip().lower()
        email = email.strip().lower()

        # Validate required fields.
        if not name or not username or not email or not password:
            return jsonify({
                "error": "Name, username, email and password are required."
            }), 400

        if len(name) > 100:
            return jsonify({
                "error": "Name must be 100 characters or fewer."
            }), 400

        if not re.fullmatch(
            r"[a-zA-Z0-9_.-]{3,30}",
            username
        ):
            return jsonify({
                "error": (
                    "Username must contain 3–30 characters "
                    "and use letters, numbers, dots, hyphens "
                    "or underscores."
                )
            }), 400

        if not re.fullmatch(
            r"[^@\s]+@[^@\s]+\.[^@\s]+",
            email
        ):
            return jsonify({
                "error": "Enter a valid email address."
            }), 400

        if len(email) > 254:
            return jsonify({
                "error": "Email address is too long."
            }), 400

        if len(password) < 8:
            return jsonify({
                "error": "Password must be at least 8 characters long."
            }), 400

        if len(password) > 128:
            return jsonify({
                "error": "Password must be 128 characters or fewer."
            }), 400

        # Check for an existing username or email.
        existing_user = users_collection.find_one({
            "$or": [
                {"username": username},
                {"email": email}
            ]
        })

        if existing_user:
            return jsonify({
                "error": "That username or email is already registered."
            }), 409

        now = datetime.now(timezone.utc)

        # IMPORTANT: never store a plain-text password.
        user = {
            "name": name,
            "username": username,
            "email": email,
            "password_hash": generate_password_hash(password),
            "role": "security_operator",
            "active": True,
            "auth_provider": "password",
            "created_at": now,
            "last_login": now
        }

        try:

            result = users_collection.insert_one(user)

            user["_id"] = result.inserted_id

        except DuplicateKeyError:

            return jsonify({
                "error": "That username or email is already registered."
            }), 409

        # Registration also creates a login session.
        return jsonify(
            authenticated_response(user)
        ), 201

    # ========================================================
    # LOGIN
    # POST /api/auth/login
    # ========================================================

    @auth_bp.route(
        "/login",
        methods=["POST"]
    )
    def login():

        data = request.get_json(silent=True)

        if not isinstance(data, dict):
            return jsonify({
                "error": "A JSON request body is required."
            }), 400

        identifier = data.get("identifier", "")
        password = data.get("password", "")

        if not isinstance(identifier, str) or not isinstance(password, str):
            return jsonify({
                "error": "Invalid request fields."
            }), 400

        identifier = identifier.strip().lower()

        if not identifier or not password:
            return jsonify({
                "error": "Username/email and password are required."
            }), 400

        user = users_collection.find_one({
            "$or": [
                {"username": identifier},
                {"email": identifier}
            ]
        })

        # Use a generic error to avoid revealing whether
        # an account exists.
        if not user:
            return jsonify({
                "error": "Invalid username/email or password."
            }), 401

        if not user.get("active", True):
            return jsonify({
                "error": "This account is disabled."
            }), 403

        password_hash = user.get("password_hash")

        if not password_hash or not check_password_hash(
            password_hash,
            password
        ):
            return jsonify({
                "error": "Invalid username/email or password."
            }), 401

        users_collection.update_one(
            {"_id": user["_id"]},
            {
                "$set": {
                    "last_login": datetime.now(timezone.utc)
                }
            }
        )

        user["last_login"] = datetime.now(timezone.utc)

        return jsonify(
            authenticated_response(user)
        ), 200

    # ========================================================
    # GOOGLE SIGN-IN
    # POST /api/auth/google
    # ========================================================

    @auth_bp.route(
        "/google",
        methods=["POST"]
    )
    def google_login():

        if not google_client_id:
            return jsonify({
                "error": "Google sign-in is not configured on the server."
            }), 503

        data = request.get_json(silent=True)

        if not isinstance(data, dict):
            return jsonify({
                "error": "A JSON request body is required."
            }), 400

        credential = data.get("credential")

        if not isinstance(credential, str) or not credential:
            return jsonify({
                "error": "Google credential is required."
            }), 400

        # Verify the token with Google's authentication library.
        try:

            google_user = id_token.verify_oauth2_token(
                credential,
                GoogleRequest(),
                google_client_id
            )

        except (
            ValueError,
            google_auth_exceptions.GoogleAuthError
        ) as exc:
            current_app.logger.error(
                "Google token verification failed (%s): %s",
                type(exc).__name__,
                exc
            )

            return jsonify({
                "error": "Google sign-in could not be verified."
            }), 401

        email = str(
            google_user.get("email", "")
        ).strip().lower()

        google_sub = google_user.get("sub")

        email_verified = google_user.get(
            "email_verified",
            False
        )

        if (
            not email
            or not google_sub
            or email_verified is not True
        ):
            return jsonify({
                "error": "Google did not provide a verified email identity."
            }), 401

        now = datetime.now(timezone.utc)

        # Look for an account already linked to this Google ID.
        user = users_collection.find_one({
            "google_sub": google_sub
        })

        if user:

            if not user.get("active", True):
                return jsonify({
                    "error": "This account is disabled."
                }), 403

            users_collection.update_one(
                {"_id": user["_id"]},
                {
                    "$set": {
                        "last_login": now
                    }
                }
            )

            user["last_login"] = now

            return jsonify(
                authenticated_response(user)
            ), 200

        # If a local account already uses this verified email,
        # link the Google identity to that account.
        existing_email_user = users_collection.find_one({
            "email": email
        })

        if existing_email_user:

            if not existing_email_user.get("active", True):
                return jsonify({
                    "error": "This account is disabled."
                }), 403

            existing_sub = existing_email_user.get("google_sub")

            if existing_sub and existing_sub != google_sub:
                return jsonify({
                    "error": "This email is linked to another Google account."
                }), 409

            users_collection.update_one(
                {"_id": existing_email_user["_id"]},
                {
                    "$set": {
                        "google_sub": google_sub,
                        "auth_provider": (
                            "password_and_google"
                            if existing_email_user.get("password_hash")
                            else "google"
                        ),
                        "last_login": now
                    }
                }
            )

            user = users_collection.find_one({
                "_id": existing_email_user["_id"]
            })

            return jsonify(
                authenticated_response(user)
            ), 200

        # Create a unique username for a new Google account.
        email_prefix = email.split("@", 1)[0].lower()

        base_username = re.sub(
            r"[^a-z0-9_.-]",
            "",
            email_prefix
        )[:24]

        if len(base_username) < 3:
            base_username = "google_user"

        username = base_username

        while users_collection.find_one({
            "username": username
        }):
            username = (
                f"{base_username[:23]}_"
                f"{secrets.token_hex(3)}"
            )

        user = {
            "name": str(
                google_user.get("name") or email_prefix
            )[:100],
            "username": username,
            "email": email,
            "google_sub": google_sub,
            "role": "security_operator",
            "active": True,
            "auth_provider": "google",
            "created_at": now,
            "last_login": now
        }

        try:

            result = users_collection.insert_one(user)

            user["_id"] = result.inserted_id

        except DuplicateKeyError:

            # Handle a simultaneous request for the same identity.
            user = users_collection.find_one({
                "google_sub": google_sub
            })

            if not user:
                return jsonify({
                    "error": "Unable to create the Google account. Please try again."
                }), 409

        return jsonify(
            authenticated_response(user)
        ), 201

    # ========================================================
    # CURRENT USER
    # GET /api/auth/me
    # ========================================================

    @auth_bp.route(
        "/me",
        methods=["GET"]
    )
    def current_user():

        payload = get_token_payload()

        if not payload:
            return jsonify({
                "error": "Authentication required."
            }), 401

        try:

            user_id = ObjectId(
                payload["sub"]
            )

        except (InvalidId, KeyError, TypeError):

            return jsonify({
                "error": "Invalid authentication token."
            }), 401

        user = users_collection.find_one({
            "_id": user_id
        })

        if not user or not user.get("active", True):
            return jsonify({
                "error": "User account is unavailable."
            }), 401

        return jsonify({
            "user": public_user(user)
        }), 200

    # ========================================================
    # LOGOUT
    # POST /api/auth/logout
    # ========================================================

    @auth_bp.route(
        "/logout",
        methods=["POST"]
    )
    def logout():

        auth_header = request.headers.get(
            "Authorization",
            ""
        )

        if auth_header.startswith("Bearer "):

            token = auth_header.split(
                " ",
                1
            )[1].strip()

            try:

                payload = jwt.decode(
                    token,
                    jwt_secret_key,
                    algorithms=["HS256"],
                    options={
                        "require": [
                            "exp",
                            "iat",
                            "sub",
                            "jti"
                        ]
                    }
                )

                expiry = datetime.fromtimestamp(
                    payload["exp"],
                    tz=timezone.utc
                )

                revoked_tokens_collection.update_one(
                    {"jti": payload["jti"]},
                    {
                        "$setOnInsert": {
                            "jti": payload["jti"],
                            "expires_at": expiry,
                            "revoked_at": datetime.now(timezone.utc)
                        }
                    },
                    upsert=True
                )

            except jwt.InvalidTokenError:
                # The frontend should still clear its local session.
                pass

        return jsonify({
            "message": "Logged out successfully."
        }), 200

    return auth_bp