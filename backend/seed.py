"""Create the database tables and default accounts.

    python seed.py          # tables + default logins + 3 sample doctors
    python seed.py --demo   # also adds 7 days of past tokens so the analytics charts have data

Safe to run more than once: it only adds what is missing.
"""
import os
import random
import secrets
import sys
import time
from datetime import date, datetime, timedelta

import pymysql
from werkzeug.security import generate_password_hash

from config import Config
from db import get_connection

DEFAULT_DOCTORS = [
    ("Dr. Anjali Menon", "General Medicine", "1", 8),
    ("Dr. Rahul Nair", "Paediatrics", "2", 10),
    ("Dr. Fathima Rasheed", "Dermatology", "3", 12),
]

FIRST_NAMES = ["Arun", "Divya", "Fasil", "Gopika", "Hari", "Jasmine", "Kiran", "Lakshmi",
               "Midhun", "Nimmi", "Rizwan", "Sneha", "Tom", "Vishnu", "Ameena", "Joel"]
LAST_NAMES = ["K", "P", "M", "Thomas", "Nair", "Joseph", "Ali", "Varghese", "Menon"]


def wait_for_database(attempts=30):
    """In Docker the MySQL container can take a few seconds to start."""
    for i in range(attempts):
        try:
            return get_connection(with_database=False)
        except pymysql.err.OperationalError as exc:
            print(f"Waiting for MySQL ({i + 1}/{attempts}): {exc.args[-1]}")
            time.sleep(2)
    sys.exit("Could not connect to MySQL. Check DB_HOST / DB_USER / DB_PASSWORD in .env")


def create_schema():
    conn = wait_for_database()
    with conn.cursor() as cur:
        try:
            cur.execute(f"CREATE DATABASE IF NOT EXISTS `{Config.DB_NAME}` CHARACTER SET utf8mb4")
        except pymysql.err.MySQLError:
            pass  # user may not have CREATE DATABASE rights; the database may already exist
    conn.commit()
    conn.close()

    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")
    with open(path, encoding="utf-8") as f:
        sql = "\n".join(line for line in f if not line.strip().startswith("--"))

    conn = get_connection()
    with conn.cursor() as cur:
        for statement in sql.split(";"):
            if statement.strip():
                cur.execute(statement)
    conn.commit()
    conn.close()
    print("Tables ready.")


def seed_defaults():
    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM doctors")
        if cur.fetchone()["n"] == 0:
            cur.executemany(
                "INSERT INTO doctors (name, specialization, room, default_consult_minutes) VALUES (%s, %s, %s, %s)",
                DEFAULT_DOCTORS,
            )
            print(f"Added {len(DEFAULT_DOCTORS)} sample doctors.")

        cur.execute("SELECT COUNT(*) AS n FROM users")
        if cur.fetchone()["n"] == 0:
            cur.execute("SELECT id FROM doctors ORDER BY id LIMIT 1")
            first_doctor = cur.fetchone()["id"]
            users = [
                ("Clinic Admin", "admin", "admin123", "admin", None),
                ("Front Desk", "reception", "reception123", "receptionist", None),
                ("Dr. Anjali Menon", "doctor", "doctor123", "doctor", first_doctor),
            ]
            cur.executemany(
                "INSERT INTO users (name, username, password_hash, role, doctor_id) VALUES (%s, %s, %s, %s, %s)",
                [(n, u, generate_password_hash(p), r, d) for n, u, p, r, d in users],
            )
            print("Added default logins: admin/admin123, reception/reception123, doctor/doctor123")
    conn.commit()
    conn.close()


def random_booking_time(day):
    # Busy mornings and a smaller evening rush, like a real OP clinic
    hour = random.choices(
        range(8, 19),
        weights=[6, 10, 12, 9, 6, 3, 3, 4, 6, 7, 4],
    )[0]
    return datetime.combine(day, datetime.min.time()) + timedelta(hours=hour, minutes=random.randint(0, 59))


def seed_demo_history(days=7):
    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM tokens WHERE token_date < %s", (date.today(),))
        if cur.fetchone()["n"] > 0:
            print("Past tokens already exist - skipping demo data.")
            conn.close()
            return
        cur.execute("SELECT id, default_consult_minutes FROM doctors WHERE is_active = 1")
        doctors = cur.fetchall()

        count = 0
        for back in range(days, 0, -1):
            day = date.today() - timedelta(days=back)
            for doc in doctors:
                times = sorted(random_booking_time(day) for _ in range(random.randint(14, 32)))
                doctor_free_at = None
                for number, created in enumerate(times, start=1):
                    status = random.choices(["completed", "no_show", "cancelled"], weights=[85, 10, 5])[0]
                    called = started = completed = None
                    if status != "cancelled":
                        # Patient is called when both they have arrived and the doctor is free
                        called = max(created + timedelta(minutes=random.randint(3, 15)),
                                     doctor_free_at or created)
                        if status == "completed":
                            started = called + timedelta(minutes=random.randint(0, 2))
                            consult = max(3, int(random.gauss(doc["default_consult_minutes"], 3)))
                            completed = started + timedelta(minutes=consult)
                            doctor_free_at = completed
                        else:
                            doctor_free_at = called + timedelta(minutes=2)
                    cur.execute(
                        """INSERT INTO tokens (public_code, doctor_id, token_date, token_number, patient_name,
                                               phone, source, status, created_at, called_at, started_at, completed_at)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (
                            secrets.token_hex(6), doc["id"], day, number,
                            f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}",
                            f"9{random.randint(100000000, 999999999)}",
                            random.choice(["online", "online", "walkin"]),
                            status, created, called, started, completed,
                        ),
                    )
                    count += 1
                cur.execute(
                    "INSERT INTO token_counters (doctor_id, counter_date, last_number) VALUES (%s, %s, %s)",
                    (doc["id"], day, len(times)),
                )
    conn.commit()
    conn.close()
    print(f"Added {count} demo tokens over the last {days} days.")


if __name__ == "__main__":
    create_schema()
    seed_defaults()
    if "--demo" in sys.argv:
        seed_demo_history()
    print("Done.")
