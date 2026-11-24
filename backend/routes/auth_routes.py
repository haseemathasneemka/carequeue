from flask import Blueprint, g, jsonify, request
from werkzeug.security import check_password_hash

from auth import create_auth_token, login_required, public_user
from db import db_cursor

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""

    with db_cursor() as cur:
        cur.execute("SELECT * FROM users WHERE username = %s", (username,))
        user = cur.fetchone()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify(error="Wrong username or password."), 401
    if not user["is_active"]:
        return jsonify(error="This account has been disabled."), 403

    return jsonify(token=create_auth_token(user), user=public_user(user))


@bp.get("/me")
@login_required()
def me():
    return jsonify(user=public_user(g.user))
