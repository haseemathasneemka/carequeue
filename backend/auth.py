"""Staff authentication.

Staff log in with username + password and receive a signed token
(itsdangerous, the same library Flask uses for its own sessions). The React app
sends it back in the `Authorization: Bearer <token>` header.
"""
from functools import wraps

from flask import current_app, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from db import db_cursor

ROLES = ("admin", "doctor", "receptionist")


def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="carequeue-auth")


def create_auth_token(user):
    return _serializer().dumps({"id": user["id"], "role": user["role"]})


def public_user(user):
    return {
        "id": user["id"],
        "name": user["name"],
        "username": user["username"],
        "role": user["role"],
        "doctor_id": user["doctor_id"],
    }


def login_required(*roles):
    """Decorator: require a valid staff token, optionally limited to some roles.

    @login_required()                      -> any logged-in staff member
    @login_required("admin")               -> admins only
    @login_required("admin", "receptionist")
    """

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            header = request.headers.get("Authorization", "")
            if not header.startswith("Bearer "):
                return jsonify(error="Please log in."), 401
            try:
                data = _serializer().loads(
                    header[7:], max_age=current_app.config["AUTH_TOKEN_MAX_AGE"]
                )
            except SignatureExpired:
                return jsonify(error="Session expired. Please log in again."), 401
            except BadSignature:
                return jsonify(error="Invalid session. Please log in again."), 401

            with db_cursor() as cur:
                cur.execute(
                    "SELECT id, name, username, role, doctor_id, is_active FROM users WHERE id = %s",
                    (data.get("id"),),
                )
                user = cur.fetchone()

            if not user or not user["is_active"]:
                return jsonify(error="Account not found or disabled."), 401
            if roles and user["role"] not in roles:
                return jsonify(error="You do not have permission to do this."), 403

            g.user = user
            return fn(*args, **kwargs)

        return wrapper

    return decorator
