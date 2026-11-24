-- CareQueue database schema (MySQL 8)
-- seed.py runs this file automatically. You can also run it by hand:
--   mysql -u root -p carequeue < schema.sql

CREATE TABLE IF NOT EXISTS doctors (
    id                       INT AUTO_INCREMENT PRIMARY KEY,
    name                     VARCHAR(100) NOT NULL,
    specialization           VARCHAR(100) NOT NULL DEFAULT 'General Medicine',
    room                     VARCHAR(20)  NOT NULL DEFAULT '1',
    default_consult_minutes  INT          NOT NULL DEFAULT 10,
    is_active                TINYINT(1)   NOT NULL DEFAULT 1,
    created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(100) NOT NULL,
    username       VARCHAR(50)  NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    role           ENUM('admin', 'doctor', 'receptionist') NOT NULL,
    doctor_id      INT NULL,
    is_active      TINYINT(1)   NOT NULL DEFAULT 1,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL
);

-- One row per doctor per day holding the last token number handed out.
-- Bookings lock this row, which is what prevents duplicate token numbers.
CREATE TABLE IF NOT EXISTS token_counters (
    doctor_id     INT  NOT NULL,
    counter_date  DATE NOT NULL,
    last_number   INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (doctor_id, counter_date),
    CONSTRAINT fk_counter_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tokens (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    public_code   CHAR(12)     NOT NULL UNIQUE,
    doctor_id     INT          NOT NULL,
    token_date    DATE         NOT NULL,
    token_number  INT          NOT NULL,
    patient_name  VARCHAR(100) NOT NULL,
    phone         VARCHAR(15)  NOT NULL,
    source        ENUM('online', 'walkin') NOT NULL DEFAULT 'online',
    status        ENUM('waiting', 'called', 'in_consultation', 'completed', 'no_show', 'cancelled')
                  NOT NULL DEFAULT 'waiting',
    created_at    DATETIME NOT NULL,
    called_at     DATETIME NULL,
    started_at    DATETIME NULL,
    completed_at  DATETIME NULL,
    UNIQUE KEY uq_token_per_doctor_day (doctor_id, token_date, token_number),
    KEY idx_queue (doctor_id, token_date, status),
    KEY idx_token_date (token_date),
    CONSTRAINT fk_tokens_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);
