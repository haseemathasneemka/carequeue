from datetime import date, datetime, timedelta
from decimal import Decimal

from flask import Flask, jsonify
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from config import Config
from extensions import socketio
from services.queue import ApiError


class JSONProvider(DefaultJSONProvider):
    """Send dates as ISO strings and MySQL DECIMALs as plain numbers."""

    @staticmethod
    def default(o):
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        if isinstance(o, Decimal):
            return float(o)
        if isinstance(o, timedelta):
            return o.total_seconds()
        return DefaultJSONProvider.default(o)


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    app.json = JSONProvider(app)

    CORS(app, resources={r"/api/*": {"origins": Config.CORS_ORIGINS}})

    from routes.admin import bp as admin_bp
    from routes.auth_routes import bp as auth_bp
    from routes.public import bp as public_bp
    from routes.staff import bp as staff_bp

    for bp in (public_bp, auth_bp, staff_bp, admin_bp):
        app.register_blueprint(bp)

    socketio.init_app(app, cors_allowed_origins=Config.CORS_ORIGINS)
    import sockets  # noqa: F401  (registers the Socket.IO event handlers)

    @app.errorhandler(ApiError)
    def handle_api_error(err):
        return jsonify(error=err.message, **err.extra), err.status

    @app.errorhandler(HTTPException)
    def handle_http_error(err):
        return jsonify(error=err.description), err.code

    @app.errorhandler(Exception)
    def handle_unexpected(err):
        app.logger.exception(err)
        return jsonify(error="Something went wrong on the server."), 500

    return app


app = create_app()

if __name__ == "__main__":
    print(f"CareQueue API running on http://localhost:{Config.PORT}")
    socketio.run(
        app,
        host="0.0.0.0",
        port=Config.PORT,
        debug=Config.DEBUG,
        allow_unsafe_werkzeug=True,  # fine for a project / demo; use gunicorn in real production
    )
