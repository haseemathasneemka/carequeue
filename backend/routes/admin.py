"""Admin-only endpoints: manage doctors and staff accounts, and analytics."""
from datetime import timedelta

import pymysql
from flask import Blueprint, g, jsonify, request
from werkzeug.security import generate_password_hash

from auth import ROLES, login_required
from db import db_cursor
from services.queue import ApiError, public_doctor, today

bp = Blueprint("admin", __name__, url_prefix="/api/admin")


# --------------------------------------------------------------------------- #
# Doctors
# --------------------------------------------------------------------------- #
def _doctor_fields(data, partial=False):
    fields = {}
    if "name" in data or not partial:
        name = (data.get("name") or "").strip()
        if not 2 <= len(name) <= 100:
            raise ApiError("Doctor name must be 2-100 characters.")
        fields["name"] = name
    if "specialization" in data or not partial:
        fields["specialization"] = (data.get("specialization") or "General Medicine").strip()[:100]
    if "room" in data or not partial:
        fields["room"] = (str(data.get("room") or "1")).strip()[:20]
    if "default_consult_minutes" in data or not partial:
        try:
            minutes = int(data.get("default_consult_minutes") or 10)
        except (TypeError, ValueError):
            raise ApiError("Consultation time must be a number of minutes.")
        if not 1 <= minutes <= 120:
            raise ApiError("Consultation time must be between 1 and 120 minutes.")
        fields["default_consult_minutes"] = minutes
    if "is_active" in data:
        fields["is_active"] = 1 if data.get("is_active") else 0
    return fields


@bp.get("/doctors")
@login_required("admin", "receptionist")
def list_all_doctors():
    with db_cursor() as cur:
        cur.execute("SELECT * FROM doctors ORDER BY is_active DESC, name")
        return jsonify([public_doctor(d) for d in cur.fetchall()])


@bp.post("/doctors")
@login_required("admin")
def create_doctor():
    fields = _doctor_fields(request.get_json(silent=True) or {})
    with db_cursor(commit=True) as cur:
        cur.execute(
            """INSERT INTO doctors (name, specialization, room, default_consult_minutes)
               VALUES (%s, %s, %s, %s)""",
            (fields["name"], fields["specialization"], fields["room"], fields["default_consult_minutes"]),
        )
        cur.execute("SELECT * FROM doctors WHERE id = %s", (cur.lastrowid,))
        return jsonify(public_doctor(cur.fetchone())), 201


@bp.patch("/doctors/<int:doctor_id>")
@login_required("admin")
def update_doctor(doctor_id):
    fields = _doctor_fields(request.get_json(silent=True) or {}, partial=True)
    if not fields:
        raise ApiError("Nothing to update.")
    sets = ", ".join(f"{column} = %s" for column in fields)  # column names come from our own code
    with db_cursor(commit=True) as cur:
        cur.execute(f"UPDATE doctors SET {sets} WHERE id = %s", (*fields.values(), doctor_id))
        cur.execute("SELECT * FROM doctors WHERE id = %s", (doctor_id,))
        doctor = cur.fetchone()
        if not doctor:
            raise ApiError("Doctor not found.", 404)
        return jsonify(public_doctor(doctor))


# --------------------------------------------------------------------------- #
# Staff users
# --------------------------------------------------------------------------- #
@bp.get("/users")
@login_required("admin")
def list_users():
    with db_cursor() as cur:
        cur.execute(
            """SELECT u.id, u.name, u.username, u.role, u.doctor_id, u.is_active, u.created_at,
                      d.name AS doctor_name
               FROM users u LEFT JOIN doctors d ON d.id = u.doctor_id
               ORDER BY u.role, u.name"""
        )
        users = cur.fetchall()
    for u in users:
        u["is_active"] = bool(u["is_active"])
    return jsonify(users)


@bp.post("/users")
@login_required("admin")
def create_user():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    role = data.get("role")
    doctor_id = data.get("doctor_id") or None

    if not 2 <= len(name) <= 100:
        raise ApiError("Name must be 2-100 characters.")
    if not 3 <= len(username) <= 50 or not username.replace("_", "").replace(".", "").isalnum():
        raise ApiError("Username must be 3-50 letters, numbers, dots or underscores.")
    if len(password) < 6:
        raise ApiError("Password must be at least 6 characters.")
    if role not in ROLES:
        raise ApiError("Role must be admin, doctor or receptionist.")
    if role == "doctor" and not doctor_id:
        raise ApiError("Choose which doctor this login belongs to.")
    if role != "doctor":
        doctor_id = None

    try:
        with db_cursor(commit=True) as cur:
            cur.execute(
                """INSERT INTO users (name, username, password_hash, role, doctor_id)
                   VALUES (%s, %s, %s, %s, %s)""",
                (name, username, generate_password_hash(password), role, doctor_id),
            )
            new_id = cur.lastrowid
    except pymysql.err.IntegrityError:
        raise ApiError("That username is already taken (or the doctor does not exist).", 409)
    return jsonify(id=new_id), 201


@bp.patch("/users/<int:user_id>")
@login_required("admin")
def update_user(user_id):
    data = request.get_json(silent=True) or {}
    sets, values = [], []
    if "is_active" in data:
        if user_id == g.user["id"] and not data["is_active"]:
            raise ApiError("You cannot disable your own account.")
        sets.append("is_active = %s")
        values.append(1 if data["is_active"] else 0)
    if data.get("password"):
        if len(data["password"]) < 6:
            raise ApiError("Password must be at least 6 characters.")
        sets.append("password_hash = %s")
        values.append(generate_password_hash(data["password"]))
    if not sets:
        raise ApiError("Nothing to update.")
    with db_cursor(commit=True) as cur:
        cur.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = %s", (*values, user_id))
        if cur.rowcount == 0:
            cur.execute("SELECT id FROM users WHERE id = %s", (user_id,))
            if not cur.fetchone():
                raise ApiError("User not found.", 404)
    return jsonify(ok=True)


# --------------------------------------------------------------------------- #
# Analytics
# --------------------------------------------------------------------------- #
def _num(value, digits=1):
    return round(float(value), digits) if value is not None else None


@bp.get("/analytics")
@login_required("admin")
def analytics():
    try:
        days = max(1, min(int(request.args.get("days", 7)), 90))
    except ValueError:
        days = 7
    end = today()
    start = end - timedelta(days=days - 1)
    span = (start, end)

    with db_cursor() as cur:
        # Overall numbers
        cur.execute(
            """
            SELECT COUNT(*) AS total,
                   SUM(status = 'completed') AS completed,
                   SUM(status = 'no_show') AS no_show,
                   SUM(status = 'cancelled') AS cancelled,
                   SUM(source = 'online') AS online,
                   AVG(CASE WHEN called_at IS NOT NULL
                            THEN TIMESTAMPDIFF(SECOND, created_at, called_at) END) / 60 AS avg_wait,
                   AVG(CASE WHEN status = 'completed' AND started_at IS NOT NULL
                            THEN TIMESTAMPDIFF(SECOND, started_at, completed_at) END) / 60 AS avg_consult
            FROM tokens WHERE token_date BETWEEN %s AND %s
            """,
            span,
        )
        s = cur.fetchone()
        completed, no_show = int(s["completed"] or 0), int(s["no_show"] or 0)
        summary = {
            "total": int(s["total"] or 0),
            "completed": completed,
            "no_show": no_show,
            "cancelled": int(s["cancelled"] or 0),
            "online": int(s["online"] or 0),
            "avg_wait_minutes": _num(s["avg_wait"]),
            "avg_consult_minutes": _num(s["avg_consult"]),
            # No-show rate = no-shows out of the patients whose turn actually came
            "no_show_rate": _num(no_show * 100 / (completed + no_show)) if completed + no_show else 0,
        }

        # Peak hours: when tokens get booked
        cur.execute(
            """SELECT HOUR(created_at) AS hour, COUNT(*) AS count FROM tokens
               WHERE token_date BETWEEN %s AND %s GROUP BY HOUR(created_at)""",
            span,
        )
        by_hour = {r["hour"]: r["count"] for r in cur.fetchall()}
        peak_hours = [{"hour": h, "count": by_hour.get(h, 0)} for h in range(24)]

        # Day by day
        cur.execute(
            """
            SELECT token_date AS day, COUNT(*) AS total,
                   SUM(status = 'completed') AS completed,
                   SUM(status = 'no_show') AS no_show,
                   AVG(CASE WHEN called_at IS NOT NULL
                            THEN TIMESTAMPDIFF(SECOND, created_at, called_at) END) / 60 AS avg_wait
            FROM tokens WHERE token_date BETWEEN %s AND %s
            GROUP BY token_date
            """,
            span,
        )
        rows = {r["day"]: r for r in cur.fetchall()}
        daily = []
        for i in range(days):
            day = start + timedelta(days=i)
            r = rows.get(day)
            done = int(r["completed"] or 0) if r else 0
            ns = int(r["no_show"] or 0) if r else 0
            daily.append(
                {
                    "date": day,
                    "total": int(r["total"]) if r else 0,
                    "avg_wait_minutes": _num(r["avg_wait"]) if r else None,
                    "no_show_rate": _num(ns * 100 / (done + ns)) if done + ns else 0,
                }
            )

        # Per doctor
        cur.execute(
            """
            SELECT d.id, d.name, d.specialization,
                   COUNT(t.id) AS total,
                   SUM(t.status = 'completed') AS completed,
                   SUM(t.status = 'no_show') AS no_show,
                   AVG(CASE WHEN t.status = 'completed' AND t.started_at IS NOT NULL
                            THEN TIMESTAMPDIFF(SECOND, t.started_at, t.completed_at) END) / 60 AS avg_consult
            FROM doctors d
            LEFT JOIN tokens t ON t.doctor_id = d.id AND t.token_date BETWEEN %s AND %s
            GROUP BY d.id, d.name, d.specialization
            ORDER BY total DESC
            """,
            span,
        )
        per_doctor = [
            {
                "id": r["id"],
                "name": r["name"],
                "specialization": r["specialization"],
                "total": int(r["total"] or 0),
                "completed": int(r["completed"] or 0),
                "no_show": int(r["no_show"] or 0),
                "avg_consult_minutes": _num(r["avg_consult"]),
            }
            for r in cur.fetchall()
        ]

    return jsonify(
        start=start, end=end, days=days, summary=summary,
        peak_hours=peak_hours, daily=daily, per_doctor=per_doctor,
    )
