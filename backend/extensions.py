from flask_socketio import SocketIO

# Created here (not in app.py) so services can import it to broadcast events
# without a circular import.
socketio = SocketIO()
