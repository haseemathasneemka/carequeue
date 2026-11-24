"""Endpoints for receptionists and doctors to run the queue."""
from flask import Blueprint, g, jsonify, request

from auth import login_required
from db import db_cursor, run_transaction
from services.queue import ApiError, book_token, broadcast, build_queue, call_next, change_status

bp = Blueprint("staff", __name__, url_prefix="/api/staff")


def check_doctor_access(doctor_id):
    """Doctors may only see and manage their own queue."""
    if g.user["role"] == "doctor" and g.user["doctor_id"] != doctor_id:
        raise ApiError("You can only manage your own queue.", 403)


@bp.get("/queue/<int:doctor_id>")
@login_required()
def get_queue(doctor_id):
    check_doctor_access(doctor_id)
    with db_cursor() as cur:
        return jsonify(build_queue(cur, doctor_id))


@bp.post("/queue/<int:doctor_id>/walkin")
@login_required("receptionist", "admin")
def add_walkin(doctor_id):
    data = request.get_json(silent=True) or {}
    token = run_transaction(
        lambda cur: book_token(cur, doctor_id, data.get("patient_name"), data.get("phone"), "walkin")
    )
    broadcast(doctor_id)
    return jsonify(token), 201


@bp.post("/queue/<int:doctor_id>/call-next")
@login_required()
def call_next_patient(doctor_id):
    check_doctor_access(doctor_id)
    token = run_transaction(lambda cur: call_next(cur, doctor_id))
    broadcast(doctor_id)
    return jsonify(called=token)


@bp.post("/tokens/<int:token_id>/<action>")
@login_required()
def update_token(token_id, action):
    action = action.replace("-", "_")  # URL uses "no-show", code uses "no_show"
    if action == "cancel" and g.user["role"] == "doctor":
        raise ApiError("Only reception can cancel tokens.", 403)
    token = run_transaction(lambda cur: change_status(cur, token_id, action, g.user))
    broadcast(token["doctor_id"])
    return jsonify(id=token["id"], status=token["status"])
