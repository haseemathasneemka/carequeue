"""Socket.IO event handlers.

Each screen joins one "room":
  display      -> the waiting-room TV
  staff        -> reception / doctor / admin dashboards
  doctor_<id>  -> a patient tracking a token for that doctor

When a queue changes the server emits `queue_update` with just the doctor id to
those rooms (see services.queue.broadcast) and each screen re-fetches its data.
"""
import re

from flask_socketio import join_room, leave_room

from extensions import socketio

ROOM_PATTERN = re.compile(r"^(display|staff|doctor_\d+)$")


def _room(data):
    room = str((data or {}).get("room", ""))
    return room if ROOM_PATTERN.match(room) else None


@socketio.on("join")
def on_join(data):
    room = _room(data)
    if room:
        join_room(room)


@socketio.on("leave")
def on_leave(data):
    room = _room(data)
    if room:
        leave_room(room)
