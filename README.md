# BookMyTicket

A full-stack cinema seat booking system inspired by BookMyShow. Built with Node.js, Express, and PostgreSQL — supports multiple cinemas, movies, hourly showtimes, seat categories, multi-seat booking, JWT auth, QR code tickets, and social sharing.

---

## Features

- **Multi-cinema & multi-movie** — manage multiple cinemas and movies
- **Hourly showtimes** — shows every hour from 9 AM to 11 PM
- **Seat categories** — Recliner (₹500), Balcony (₹300), Standard (₹200)
- **Multi-seat booking** — book up to 3 seats in a single transaction
- **Booking reference** — unique `BMT-XXXXXXXX` reference per booking
- **QR code ticket** — scannable QR code generated on confirmation
- **Social sharing** — share bookings via WhatsApp, X (Twitter), or clipboard
- **JWT authentication** — register, login, protected booking endpoints
- **Admin dashboard** — view all bookings, seed demo data, reset seats
- **Docker ready** — multi-stage Dockerfile for production deployment
- **Concurrency safe** — `SELECT ... FOR UPDATE` row-level locking prevents double-booking

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 (ESM) |
| Framework | Express 5 |
| Database | PostgreSQL (via `pg` connection pool) |
| Auth | JWT (`jsonwebtoken`) + `bcrypt` |
| Frontend | Vanilla JS SPA + Tailwind CSS CDN |
| Container | Docker (multi-stage Alpine build) |

---

## Database Setup

Run these SQL statements **once** in your PostgreSQL database before starting the server:

```sql
-- Add role to existing users table (skip if fresh install)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';

CREATE TABLE IF NOT EXISTS cinemas (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  location VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movies (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  duration_minutes INT DEFAULT 120,
  genre VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shows (
  id SERIAL PRIMARY KEY,
  cinema_id INT REFERENCES cinemas(id) ON DELETE CASCADE,
  movie_id  INT REFERENCES movies(id)  ON DELETE CASCADE,
  show_date DATE NOT NULL,
  show_time TIME NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(cinema_id, show_date, show_time)
);

CREATE TABLE IF NOT EXISTS cinema_seats (
  id SERIAL PRIMARY KEY,
  cinema_id   INT REFERENCES cinemas(id) ON DELETE CASCADE,
  row_name    VARCHAR(5) NOT NULL,
  seat_number INT NOT NULL,
  category    VARCHAR(20) NOT NULL CHECK (category IN ('standard','balcony','recliner')),
  price       DECIMAL(10,2) NOT NULL,
  UNIQUE(cinema_id, row_name, seat_number)
);

CREATE TABLE IF NOT EXISTS bookings (
  id                SERIAL PRIMARY KEY,
  user_id           INT REFERENCES users(id),
  show_id           INT REFERENCES shows(id),
  booking_reference VARCHAR(20) UNIQUE NOT NULL,
  total_amount      DECIMAL(10,2) NOT NULL,
  status            VARCHAR(20) DEFAULT 'confirmed',
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_seats (
  id         SERIAL PRIMARY KEY,
  booking_id INT REFERENCES bookings(id) ON DELETE CASCADE,
  seat_id    INT REFERENCES cinema_seats(id),
  price      DECIMAL(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS show_seat_status (
  show_id    INT REFERENCES shows(id)          ON DELETE CASCADE,
  seat_id    INT REFERENCES cinema_seats(id)   ON DELETE CASCADE,
  booking_id INT REFERENCES bookings(id)       NULL,
  is_booked  BOOLEAN DEFAULT FALSE,
  PRIMARY KEY(show_id, seat_id)
);
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PORT` | Port the server listens on (default `3000`) |
| `DATABASE_URL` | Full PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWT tokens — use a long random string in production |
| `ADMIN_USERNAME` | Username for the auto-created admin account (default `admin`) |
| `ADMIN_PASSWORD` | Password for the auto-created admin account (default `admin123`) |

> **Note:** `.env` is gitignored and never committed. Set these as environment variables in your hosting platform (Coolify, Railway, etc.).

---

## Local Development

```bash
# Install dependencies
npm install

# Start with hot reload
npm run dev

# Start without hot reload
npm start
```

Server starts on `http://localhost:3000`.

### First-time setup

1. Run the SQL schema above in your database
2. Start the server — an admin user is **auto-created** on first boot:
   ```
   Username : admin
   Password : admin123
   ```
3. Login as admin → click **⚙ Admin** → **🌱 Seed Demo Data**
4. Browse cinemas, pick a show, book seats

---

## Docker

### Build & run locally

```bash
# Build the image
docker build -t book-my-ticket .

# Run (reads credentials from .env)
docker run -p 3000:3000 --env-file .env book-my-ticket
```

### Deploy on Coolify

1. Push this repo to GitHub (`.env` is gitignored automatically)
2. In Coolify: **New Resource → GitHub Repo → Dockerfile**
3. Set environment variables in the **Environment Variables** tab:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
4. Deploy — Coolify builds the image and starts the container

---

## API Reference

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/register` | — | Create a new user account |
| `POST` | `/login` | — | Login and receive a JWT token |
| `GET` | `/me` | ✅ | Get current user info |

### Cinemas & Movies

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/cinemas` | — | List all cinemas |
| `POST` | `/cinemas` | Admin | Add a cinema |
| `GET` | `/movies` | — | List all movies |
| `POST` | `/movies` | Admin | Add a movie |

### Shows & Seats

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/shows?cinema_id=&date=` | — | List shows filtered by cinema and date |
| `POST` | `/shows` | Admin | Create a show |
| `GET` | `/shows/:showId/seats` | — | Get seat map with availability for a show |

### Bookings

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/bookings` | ✅ | Book 1–3 seats (body: `{ showId, seatIds[] }`) |
| `GET` | `/bookings` | ✅ | Get current user's booking history |

### Admin

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/admin/bookings` | Admin | View all bookings |
| `POST` | `/admin/reset` | Admin | Reset all seats (or a specific show) |
| `POST` | `/admin/seed` | Admin | Seed 3 cinemas, 4 movies, 15 shows/day for 3 days |

---

### Request / Response examples

**Login**
```http
POST /login
Content-Type: application/json

{ "username": "admin", "password": "admin123" }
```
```json
{
  "token": "<jwt>",
  "user": { "id": 1, "username": "admin", "role": "admin" }
}
```

**Book seats**
```http
POST /bookings
Authorization: Bearer <token>
Content-Type: application/json

{ "showId": 12, "seatIds": [5, 6] }
```
```json
{
  "booking_reference": "BMT-A3K9XZ2F",
  "total_amount": 1000,
  "seats": [
    { "row": "A", "number": 1, "category": "recliner", "price": "500.00" },
    { "row": "A", "number": 2, "category": "recliner", "price": "500.00" }
  ]
}
```

---

## Architecture

```
Client (Browser SPA)
  │
  │  JWT in Authorization header
  ▼
Express Server (index.mjs)
  ├── Auth middleware        — verifies JWT on protected routes
  ├── Admin middleware       — checks role = 'admin'
  ├── /cinemas, /movies      — cinema & movie management
  ├── /shows                 — show listings with seat availability %
  ├── /shows/:id/seats       — per-show seat map
  ├── /bookings (POST)       — transactional multi-seat booking
  └── /admin/*               — dashboard, seed, reset
  │
  │  pg connection pool (max 20)
  ▼
PostgreSQL (Neon / self-hosted)
  ├── users
  ├── cinemas
  ├── movies
  ├── shows
  ├── cinema_seats
  ├── bookings
  ├── booking_seats
  └── show_seat_status       — per-show seat lock state
```

## Concurrency & Safety

- **Row-level locking** — `SELECT ... FOR UPDATE` inside a transaction prevents double-booking under concurrent requests
- **SQL injection prevention** — all queries use parameterized placeholders (`$1`, `$2`, ...)
- **Password security** — bcrypt with 10 salt rounds
- **JWT expiry** — tokens expire after 24 hours
- **Env validation** — server throws at startup if `DATABASE_URL` or `JWT_SECRET` are missing
