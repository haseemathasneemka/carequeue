# CareQueue – Live Clinic Queue & Token Management System

CareQueue replaces manual token calling in clinics. Patients book an OP token online and track their place in the queue live from their phone. Reception, doctors and the waiting-room TV stay in sync in real time without refreshing the page.

**Tech stack:** React.js (Vite) · Python Flask · Flask-SocketIO (WebSockets) · MySQL · Chart.js · Docker

---

## Features

- **Online token booking.** Patients choose a doctor, see how many people are waiting and get a token number and a tracking link.
- **Live tracking page.** Shows the patient's position, the number being served now and an estimated waiting time. It updates instantly over WebSockets and vibrates the phone when the patient is called.
- **Dynamic wait-time estimate.** Uses each doctor's *average consultation time for the day*. Early in the day it is blended with the doctor's default time until enough patients have been seen.
- **No duplicate token numbers.** Booking runs in a MySQL transaction that locks a per-doctor, per-day counter row, so simultaneous bookings never get the same number. A `UNIQUE` key adds a database-level safety net.
- **Role-based dashboards:**
  - **Receptionist:** issues walk-in tokens, calls the next patient, marks no-shows and cancels tokens for any doctor.
  - **Doctor:** manages only their own queue (call next, start, complete, no-show).
  - **Admin:** manages doctors and staff accounts and views analytics.
- **Waiting-room display (`/display`).** A full-screen TV view that shows "Now serving" and the next tokens for each doctor. It can also announce calls by voice.
- **Analytics.** Shows peak booking hours, average waiting time per day, no-show rate, online vs walk-in share and per-doctor consultation times.

## Screens

| URL | Who | What |
|-----|-----|------|
| `/` | Patients | Book a token / track an existing one |
| `/token/<code>` | Patients | Live token status |
| `/display` | Waiting-room TV | Now serving + next tokens |
| `/login` | Staff | Login |
| `/reception` | Receptionist, Admin | Queue control + walk-ins |
| `/doctor` | Doctor | Own queue |
| `/admin` | Admin | Analytics, doctors, staff |

---

## Project structure

```
carequeue/
├── backend/                  Flask API + Socket.IO server
│   ├── app.py                App factory, error handlers, entry point
│   ├── config.py             Settings read from .env
│   ├── db.py                 MySQL connection + transaction helper (retries on deadlock)
│   ├── auth.py               Signed login tokens + @login_required(role) decorator
│   ├── extensions.py         Shared SocketIO instance
│   ├── sockets.py            Socket.IO "join"/"leave" room handlers
│   ├── services/queue.py     Core logic: booking, queue moves, wait-time estimate, broadcasts
│   ├── routes/               REST endpoints (public, auth, staff, admin)
│   ├── schema.sql            Database tables
│   ├── seed.py               Creates tables, default logins, sample doctors, demo history
│   └── requirements.txt
├── frontend/                 React app (Vite)
│   ├── src/api.js            fetch wrapper (adds the login token)
│   ├── src/socket.js         Socket.IO client + useQueueRoom hook
│   ├── src/AuthContext.jsx   Login state shared across the app
│   ├── src/components/       QueuePanel, Analytics (Chart.js), Navbar…
│   └── src/pages/            BookToken, TokenStatus, Display, Reception, Doctor, Admin
└── docker-compose.yml        MySQL + backend + frontend in containers
```

---

## Run it on your computer

### 1. Install these first

| Tool | Download | Check it works |
|------|----------|----------------|
| Python 3.10 or newer | https://www.python.org/downloads/ (on Windows tick **"Add Python to PATH"**) | `python --version` |
| Node.js 18 or newer (LTS) | https://nodejs.org | `node --version` |
| MySQL 8 | https://dev.mysql.com/downloads/installer/ (remember the root password you set) | `mysql --version` |
| Git | https://git-scm.com/downloads | `git --version` |
| VS Code (optional) | https://code.visualstudio.com | |

### 2. Start the backend (Flask)

Open a terminal in the `backend` folder:

```bash
cd backend

# create and activate a virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux

pip install -r requirements.txt
```

Create your settings file by copying `.env.example` to `.env`:

```bash
copy .env.example .env         # Windows
# cp .env.example .env         # macOS / Linux
```

Open `.env` and put your MySQL root password in `DB_PASSWORD=`.

Create the database, tables, default logins and sample data, then start the server:

```bash
python seed.py --demo          # --demo adds 7 days of history so the charts have data
python app.py
```

You should see `CareQueue API running on http://localhost:5000`. Keep this terminal open.

### 3. Start the frontend (React)

Open a **second** terminal:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

### 4. Log in

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Receptionist | `reception` | `reception123` |
| Doctor (Dr. Anjali Menon) | `doctor` | `doctor123` |

### 5. Try the real-time flow

1. Open `/display` in one browser tab and the booking page `/` on your phone or in another tab.
2. Book a token. The waiting count on the display updates instantly.
3. Log in as `reception` in another window and click **Call next**. The patient's tracking page and the TV display both change immediately.
4. Click **Start consultation**, then **Complete**. After a few patients the wait estimate starts following the doctor's real average.

> **Testing on your phone:** run `npm run dev -- --host`, then open `http://<your-laptop-IP>:5173` on a phone connected to the same Wi-Fi network.

### Common problems

| Problem | Fix |
|---------|-----|
| `Access denied for user 'root'` | Wrong `DB_PASSWORD` in `backend/.env` |
| `Can't connect to MySQL server` | Start the MySQL service (Windows: Services → MySQL80 → Start) |
| `'python' is not recognized` | Reinstall Python and tick "Add Python to PATH", or try `py` instead of `python` |
| Page says "Cannot reach the server" | The backend terminal isn't running `python app.py` |
| `npm` errors | Install Node.js LTS, close the terminal, open a new one and run `npm install` again |

---

## Run everything with Docker (optional)

If you have [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed, run this from the project root:

```bash
docker compose up --build
```

Then open **http://localhost:8080**. This starts three containers:

- **MySQL**
- **Flask backend:** creates the tables, logins and demo data automatically.
- **nginx:** serves the built React app and forwards `/api` and `/socket.io` to Flask.

Stop it with `Ctrl + C`. Run `docker compose down -v` to also delete the database.

---

## How it works

### Real-time updates

Every screen joins a Socket.IO room:

- `display` for the TV
- `staff` for the dashboards
- `doctor_<id>` for a patient tracking that doctor's queue

When anything changes a queue (booking, call, complete, no-show, cancel), the server emits `queue_update` with just the doctor's id. Each screen then re-fetches what it needs over REST. No patient data travels over the socket, and every screen always shows the authoritative data from the database.

### Preventing duplicate tokens

`services/queue.py → book_token()` runs in one transaction:

```sql
INSERT INTO token_counters (doctor_id, counter_date, last_number) VALUES (?, ?, 1)
ON DUPLICATE KEY UPDATE last_number = last_number + 1;   -- takes an exclusive row lock
SELECT last_number FROM token_counters WHERE ...;        -- our number
INSERT INTO tokens (...);                                -- then COMMIT releases the lock
```

Two bookings for the same doctor at the same moment are forced to wait for each other, so they get consecutive numbers. If MySQL reports a deadlock, `db.run_transaction()` retries the whole transaction. The unique key `(doctor_id, token_date, token_number)` guarantees correctness even if something goes wrong in the code. Queue actions such as **Call next** lock the doctor's row, so two receptionists can't call two patients at once.

### Wait-time estimate

```
avg = weight × (today's real average consult time) + (1 − weight) × (doctor's default time)
weight = min(patients completed today, 5) / 5

wait for the patient at position n = time left for the current patient + (n − 1) × avg
```

### Security

- Passwords are hashed with Werkzeug (`generate_password_hash`).
- Staff send a signed, expiring token in the `Authorization: Bearer` header.
- `@login_required("admin")` and similar decorators enforce roles on the server, and doctors can only touch their own queue.
- Patients get a random 12-character tracking code instead of the database id, so token pages can't be guessed.
- The public display shows token numbers only, never names or phone numbers.
- All SQL uses parameterised queries.

### API overview

| Method | Endpoint | Access |
|--------|----------|--------|
| GET | `/api/doctors` | public |
| POST | `/api/tokens` | public – book |
| GET | `/api/tokens/<code>` | public – status |
| POST | `/api/tokens/<code>/cancel` | public |
| GET | `/api/display` | public |
| POST | `/api/auth/login` · GET `/api/auth/me` | – |
| GET | `/api/staff/queue/<doctor_id>` | staff |
| POST | `/api/staff/queue/<doctor_id>/walkin` | receptionist, admin |
| POST | `/api/staff/queue/<doctor_id>/call-next` | staff |
| POST | `/api/staff/tokens/<id>/start\|complete\|no-show\|cancel` | staff |
| GET/POST/PATCH | `/api/admin/doctors`, `/api/admin/users` | admin |
| GET | `/api/admin/analytics?days=7` | admin |

## Ideas for future work

- SMS or WhatsApp alerts when a patient is 2 tokens away
- Appointment slots in addition to same-day tokens
- Deployment on AWS (EC2 for the containers and RDS for MySQL)
