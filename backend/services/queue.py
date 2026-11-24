"""Core queue logic: booking tokens, moving patients through the queue and
estimating waiting time.

Token life cycle
    waiting -> called -> in_consultation -> completed
    waiting/called -> no_show
    waiting -> cancelled
"""
import re
import secrets
from datetime import date, datetime

from extensions import socketio

ACTIVE_STATUSES = ("called", "in_consultation")
OPEN_STATUSES = ("waiting", "called", "in_consultation")

# How many finished consultations today before we fully trust the live average
# instead of the doctor's default consultation time.
FULL_CONFIDENCE_SAMPLES = 5


class ApiError(Exception):
    """An error that should be sent to the client as JSON with a status code."""

    def __init__(self, message, status=400, **extra):
        super().__init__(message)
        self.message = message
        self.status = status
        self.extra = extra


def now():
    return datetime.now().replace(microsecond=0)


def today():
    return date.today()


# --------------------------------------------------------------------------- #
# Doctors
# --------------------------------------------------------------------------- #
def public_doctor(doctor):
    return {
        "id": doctor["id"],
        "name": doctor["name"],
        "specialization": doctor["specialization"],
        "room": doctor["room"],
        "default_consult_minutes": doctor["default_consult_minutes"],
        "is_active": bool(doctor["is_active"]),
    }


def get_doctor(cur, doctor_id, active_only=False, lock=False):
    sql = "SELECT * FROM doctors WHERE id = %s" + (" FOR UPDATE" if lock else "")
    cur.execute(sql, (doctor_id,))
    doctor = cur.fetchone()
    if not doctor or (active_only and not doctor["is_active"]):
        raise ApiError("Doctor not found.", 404)
    return doctor


# --------------------------------------------------------------------------- #
# Wait-time estimation
# --------------------------------------------------------------------------- #
def average_consult_minutes(cur, doctor):
    """Average consultation length for this doctor *today*.

    Early in the day there is little data, so we blend the live average with the
    doctor's default time. After FULL_CONFIDENCE_SAMPLES finished patients the
    live average is used on its own.
    Returns (minutes, number_of_samples).
    """
    cur.execute(
        """
        SELECT AVG(TIMESTAMPDIFF(SECOND, started_at, completed_at)) AS avg_sec,
               COUNT(*) AS samples
        FROM tokens
        WHERE doctor_id = %s AND token_date = %s AND status = 'completed'
          AND started_at IS NOT NULL AND completed_at IS NOT NULL
        """,
        (doctor["id"], today()),
    )
    row = cur.fetchone()
    default = float(doctor["default_consult_minutes"])
    samples = int(row["samples"] or 0)
    if samples == 0 or row["avg_sec"] is None:
        return round(default, 1), 0

    live = float(row["avg_sec"]) / 60
    weight = min(samples, FULL_CONFIDENCE_SAMPLES) / FULL_CONFIDENCE_SAMPLES
    blended = weight * live + (1 - weight) * default
    return round(max(blended, 1.0), 1), samples


def build_queue(cur, doctor_id):
    """Today's live queue for one doctor, with an estimated wait for each patient."""
    doctor = get_doctor(cur, doctor_id)
    avg, samples = average_consult_minutes(cur, doctor)

    cur.execute(
        """
        SELECT id, public_code, token_number, patient_name, phone, source, status,
               created_at, called_at, started_at
        FROM tokens
        WHERE doctor_id = %s AND token_date = %s
          AND status IN ('waiting', 'called', 'in_consultation')
        ORDER BY token_number
        """,
        (doctor_id, today()),
    )
    rows = cur.fetchall()
    current = next((r for r in rows if r["status"] in ACTIVE_STATUSES), None)
    waiting = [r for r in rows if r["status"] == "waiting"]

    # Time left for the patient who is with the doctor right now
    remaining_current = 0.0
    if current:
        if current["status"] == "in_consultation" and current["started_at"]:
            elapsed = (now() - current["started_at"]).total_seconds() / 60
            remaining_current = max(avg - elapsed, 1.0)
        else:
            remaining_current = avg

    for index, token in enumerate(waiting):
        token["position"] = index + 1
        token["estimated_wait_minutes"] = round(remaining_current + index * avg)

    cur.execute(
        "SELECT status, COUNT(*) AS c FROM tokens WHERE doctor_id = %s AND token_date = %s GROUP BY status",
        (doctor_id, today()),
    )
    counts = {r["status"]: r["c"] for r in cur.fetchall()}

    return {
        "date": today(),
        "doctor": public_doctor(doctor),
        "avg_consult_minutes": avg,
        "samples_today": samples,
        "current": current,
        "waiting": waiting,
        "counts": counts,
    }


# --------------------------------------------------------------------------- #
# Booking
# --------------------------------------------------------------------------- #
def clean_patient(patient_name, phone):
    name = re.sub(r"\s+", " ", (patient_name or "")).strip()
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if not 2 <= len(name) <= 100:
        raise ApiError("Please enter the patient's name (2-100 characters).")
    if len(digits) != 10:
        raise ApiError("Please enter a valid 10-digit mobile number.")
    return name, digits


def book_token(cur, doctor_id, patient_name, phone, source="online"):
    """Create the next token for a doctor, safely under concurrent bookings.

    The per-doctor, per-day counter row is incremented with an atomic
    INSERT ... ON DUPLICATE KEY UPDATE. That statement takes an exclusive row
    lock which is held until COMMIT, so two simultaneous bookings for the same
    doctor are forced to run one after the other and can never get the same
    number. The UNIQUE (doctor_id, token_date, token_number) key is a second
    safety net at database level.
    """
    name, digits = clean_patient(patient_name, phone)
    get_doctor(cur, doctor_id, active_only=True)
    day = today()

    # 1. Lock + increment the counter (serialises bookings for this doctor/day)
    cur.execute(
        """
        INSERT INTO token_counters (doctor_id, counter_date, last_number)
        VALUES (%s, %s, 1)
        ON DUPLICATE KEY UPDATE last_number = last_number + 1
        """,
        (doctor_id, day),
    )
    cur.execute(
        "SELECT last_number FROM token_counters WHERE doctor_id = %s AND counter_date = %s",
        (doctor_id, day),
    )
    number = cur.fetchone()["last_number"]

    # 2. One open online token per phone number per doctor per day.
    #    Checked *after* taking the lock so two quick double-clicks can't both pass.
    if source == "online":
        cur.execute(
            """
            SELECT public_code, token_number FROM tokens
            WHERE doctor_id = %s AND token_date = %s AND phone = %s
              AND status IN ('waiting', 'called', 'in_consultation')
            """,
            (doctor_id, day, digits),
        )
        existing = cur.fetchone()
        if existing:
            # Raising rolls back the transaction, so the counter is not used up.
            raise ApiError(
                f"This number already has token #{existing['token_number']} for this doctor today.",
                409,
                code=existing["public_code"],
            )

    # 3. Insert the token
    code = secrets.token_hex(6)
    cur.execute(
        """
        INSERT INTO tokens (public_code, doctor_id, token_date, token_number,
                            patient_name, phone, source, status, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, 'waiting', %s)
        """,
        (code, doctor_id, day, number, name, digits, source, now()),
    )
    return {"id": cur.lastrowid, "code": code, "token_number": number, "doctor_id": int(doctor_id)}


def token_status(cur, code):
    """What a patient sees on their tracking page."""
    cur.execute("SELECT * FROM tokens WHERE public_code = %s", (code,))
    token = cur.fetchone()
    if not token:
        raise ApiError("Token not found.", 404)

    is_today = token["token_date"] == today()
    queue = build_queue(cur, token["doctor_id"]) if is_today else None
    doctor = queue["doctor"] if queue else public_doctor(get_doctor(cur, token["doctor_id"]))

    position = estimate = None
    if queue and token["status"] == "waiting":
        mine = next((w for w in queue["waiting"] if w["id"] == token["id"]), None)
        if mine:
            position = mine["position"]
            estimate = mine["estimated_wait_minutes"]

    return {
        "code": token["public_code"],
        "token_number": token["token_number"],
        "patient_name": token["patient_name"],
        "status": token["status"],
        "source": token["source"],
        "token_date": token["token_date"],
        "created_at": token["created_at"],
        "is_today": is_today,
        "doctor": doctor,
        "position": position,
        "people_ahead": (position - 1) if position else None,
        "estimated_wait_minutes": estimate,
        "now_serving": queue["current"]["token_number"] if queue and queue["current"] else None,
        "avg_consult_minutes": queue["avg_consult_minutes"] if queue else None,
    }


# --------------------------------------------------------------------------- #
# Moving patients through the queue (staff actions)
# --------------------------------------------------------------------------- #
def call_next(cur, doctor_id):
    # Locking the doctor row makes all queue actions for this doctor run one at
    # a time, so two receptionists can't call two different patients at once.
    get_doctor(cur, doctor_id, lock=True)

    cur.execute(
        """
        SELECT token_number FROM tokens
        WHERE doctor_id = %s AND token_date = %s AND status IN ('called', 'in_consultation')
        """,
        (doctor_id, today()),
    )
    busy = cur.fetchone()
    if busy:
        raise ApiError(
            f"Token #{busy['token_number']} is still with the doctor. "
            "Mark it completed or no-show before calling the next patient.",
            409,
        )

    cur.execute(
        """
        SELECT id, token_number FROM tokens
        WHERE doctor_id = %s AND token_date = %s AND status = 'waiting'
        ORDER BY token_number LIMIT 1
        """,
        (doctor_id, today()),
    )
    nxt = cur.fetchone()
    if not nxt:
        raise ApiError("No patients are waiting.", 404)

    cur.execute("UPDATE tokens SET status = 'called', called_at = %s WHERE id = %s", (now(), nxt["id"]))
    return nxt


# action -> (allowed current statuses, new status)
TRANSITIONS = {
    "start": ({"called"}, "in_consultation"),
    "complete": ({"called", "in_consultation"}, "completed"),
    "no_show": ({"waiting", "called"}, "no_show"),
    "cancel": ({"waiting"}, "cancelled"),
}

LABELS = {
    "start": "start the consultation for",
    "complete": "complete",
    "no_show": "mark as no-show",
    "cancel": "cancel",
}


def change_status(cur, token_id, action, user=None):
    if action not in TRANSITIONS:
        raise ApiError("Unknown action.", 400)

    cur.execute("SELECT doctor_id FROM tokens WHERE id = %s", (token_id,))
    row = cur.fetchone()
    if not row:
        raise ApiError("Token not found.", 404)

    if user and user["role"] == "doctor" and user["doctor_id"] != row["doctor_id"]:
        raise ApiError("You can only manage your own queue.", 403)

    get_doctor(cur, row["doctor_id"], lock=True)
    cur.execute("SELECT * FROM tokens WHERE id = %s", (token_id,))
    token = cur.fetchone()

    allowed, new_status = TRANSITIONS[action]
    if token["status"] not in allowed:
        raise ApiError(
            f"Cannot {LABELS[action]} token #{token['token_number']} because it is "
            f"'{token['status'].replace('_', ' ')}'.",
            409,
        )

    ts = now()
    if action == "start":
        cur.execute(
            "UPDATE tokens SET status = %s, started_at = %s WHERE id = %s", (new_status, ts, token_id)
        )
    elif action == "complete":
        # If the doctor never pressed "Start", count the consultation from when they were called
        cur.execute(
            """
            UPDATE tokens
            SET status = %s, completed_at = %s, started_at = COALESCE(started_at, called_at, %s)
            WHERE id = %s
            """,
            (new_status, ts, ts, token_id),
        )
    else:
        cur.execute("UPDATE tokens SET status = %s WHERE id = %s", (new_status, token_id))

    token["status"] = new_status
    return token


# --------------------------------------------------------------------------- #
# Real-time updates
# --------------------------------------------------------------------------- #
def broadcast(doctor_id):
    """Tell every open screen that this doctor's queue changed.

    Clients then re-fetch the data they need over REST. Sending only the doctor
    id (no patient data) keeps the socket channel free of personal details.
    """
    payload = {"doctor_id": int(doctor_id)}
    for room in (f"doctor_{int(doctor_id)}", "display", "staff"):
        socketio.emit("queue_update", payload, to=room)
