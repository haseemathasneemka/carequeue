"""Endpoints patients and the waiting-room screen use (no login needed)."""
from flask import Blueprint, jsonify, request

from db import db_cursor, run_transaction
from services.queue import (
    ApiError,
    average_consult_minutes,
    book_token,
    broadcast,
    build_queue,
    change_status,
    public_doctor,
    today,
    token_status,
)

bp = Blueprint("public", __name__, url_prefix="/api")


@bp.get("/health")
def health():
    return jsonify(status="ok")


@bp.get("/doctors")
def list_doctors():
    """Active doctors with how busy they are right now (for the booking form)."""
    with db_cursor() as cur:
        cur.execute("SELECT * FROM doctors WHERE is_active = 1 ORDER BY name")
        doctors = cur.fetchall()
        cur.execute(
            """
            SELECT doctor_id, COUNT(*) AS waiting FROM tokens
            WHERE token_date = %s AND status = 'waiting' GROUP BY doctor_id
            """,
            (today(),),
        )
        waiting = {r["doctor_id"]: r["waiting"] for r in cur.fetchall()}

        result = []
        for d in doctors:
            avg, _ = average_consult_minutes(cur, d)
            item = public_doctor(d)
            item["waiting"] = waiting.get(d["id"], 0)
            item["avg_consult_minutes"] = avg
            item["estimated_wait_minutes"] = round(item["waiting"] * avg)
            result.append(item)
    return jsonify(result)


@bp.post("/tokens")
def create_token():
    data = request.get_json(silent=True) or {}
    doctor_id = data.get("doctor_id")
    if not doctor_id:
        raise ApiError("Please choose a doctor.")

    token = run_transaction(
        lambda cur: book_token(cur, doctor_id, data.get("patient_name"), data.get("phone"), "online")
    )
    broadcast(token["doctor_id"])
    return jsonify(token), 201


@bp.get("/tokens/<code>")
def get_token(code):
    with db_cursor() as cur:
        return jsonify(token_status(cur, code))


@bp.post("/tokens/<code>/cancel")
def cancel_token(code):
    def work(cur):
        cur.execute("SELECT id FROM tokens WHERE public_code = %s", (code,))
        row = cur.fetchone()
        if not row:
            raise ApiError("Token not found.", 404)
        return change_status(cur, row["id"], "cancel")

    token = run_transaction(work)
    broadcast(token["doctor_id"])
    return jsonify(status=token["status"])


@bp.get("/display")
def display_board():
    """Data for the waiting-room TV: who is being served and who is next.

    Only token numbers are shown publicly, never names or phone numbers.
    """
    with db_cursor() as cur:
        cur.execute("SELECT id FROM doctors WHERE is_active = 1 ORDER BY name")
        ids = [r["id"] for r in cur.fetchall()]
        board = []
        for doctor_id in ids:
            q = build_queue(cur, doctor_id)
            board.append(
                {
                    "doctor": q["doctor"],
                    "now_serving": q["current"]["token_number"] if q["current"] else None,
                    "now_serving_status": q["current"]["status"] if q["current"] else None,
                    "next": [w["token_number"] for w in q["waiting"][:5]],
                    "waiting_count": len(q["waiting"]),
                    "avg_consult_minutes": q["avg_consult_minutes"],
                }
            )
    return jsonify(board)
