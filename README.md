# Book My Ticket

A cinema seat booking system built with Node.js, Express, and PostgreSQL. Supports JWT-based authentication and concurrent-safe seat booking using database transactions.

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Framework**: Express 5
- **Database**: PostgreSQL (via `pg` connection pool)
- **Auth**: JWT (`jsonwebtoken`) + password hashing (`bcrypt`)

## Database Setup

Run these SQL statements in your PostgreSQL database before starting the server:

```sql
-- Seats table
CREATE TABLE seats (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    isbooked INT DEFAULT 0,
    user_id INT
);

-- Seed 20 seats
INSERT INTO seats (isbooked)
SELECT 0 FROM generate_series(1, 20);

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

If you already have a `seats` table without `user_id`:

```sql
ALTER TABLE seats ADD COLUMN user_id INT;
```

## Environment Variables

| Variable     | Default                          | Description                     |
|------------- |----------------------------------|---------------------------------|
| `PORT`       | `8080`                           | Port the server listens on      |
| `JWT_SECRET` | `super-secret-key-change-in-production` | Secret for signing JWT tokens |
| `DATABASE_URL` | _(hardcoded in index.mjs)_     | PostgreSQL connection string    |

Set a strong `JWT_SECRET` in production. Replace the hardcoded `connectionString` in `index.mjs` with `process.env.DATABASE_URL`.

## Setup & Run

```bash
# Install dependencies
npm install

# Start the server
node index.mjs
```

Server starts on `http://localhost:8080`.

## API Reference

### Public Endpoints

#### `GET /`
Serves the frontend HTML seat map.

#### `GET /seats`
Returns all seats with their booking status.

**Response**
```json
[
  { "id": 1, "name": "John", "isbooked": 1, "user_id": 3 },
  { "id": 2, "name": null, "isbooked": 0, "user_id": null }
]
```

#### `POST /register`
Creates a new user account.

**Body**
```json
{ "username": "john", "password": "secret123" }
```

**Response** `201`
```json
{ "message": "User registered successfully.", "user": { "id": 1, "username": "john" } }
```

#### `POST /login`
Authenticates a user and returns a JWT token.

**Body**
```json
{ "username": "john", "password": "secret123" }
```

**Response** `200`
```json
{
  "message": "Login successful.",
  "token": "<jwt>",
  "user": { "id": 1, "username": "john" }
}
```

---

### Protected Endpoints

All protected endpoints require this header:

```
Authorization: Bearer <token>
```

#### `PUT /book/:seatId`
Books a seat for the authenticated user. Uses a database transaction with `SELECT ... FOR UPDATE` to prevent double-booking under concurrent requests.

**Example**
```
PUT /book/5
Authorization: Bearer <token>
```

**Response** `200`
```json
{ "message": "Seat 5 booked successfully for john." }
```

**Error** `400` — seat already booked or does not exist.

#### `GET /bookings`
Returns all seats booked by the currently authenticated user.

**Response** `200`
```json
{ "bookings": [{ "id": 5, "name": "john" }] }
```

#### `PUT /:id/:name` _(Legacy)_
Original booking endpoint. Still protected by JWT. Prefer `/book/:seatId` for new integrations.

---

## API Flow

```
Client                          Server                        PostgreSQL
  |                               |                               |
  |-- POST /register -----------> |                               |
  |                               |-- INSERT INTO users --------> |
  |<-- 201 { user } ------------- |<-- user row ----------------- |
  |                               |                               |
  |-- POST /login --------------> |                               |
  |                               |-- SELECT user by username --> |
  |                               |-- bcrypt.compare() ---------> |
  |                               |-- jwt.sign()                  |
  |<-- 200 { token } ------------ |                               |
  |                               |                               |
  |-- GET /seats ---------------> |                               |
  |                               |-- SELECT * FROM seats ------> |
  |<-- 200 [ seats ] ------------ |<-- rows -------------------- |
  |                               |                               |
  |-- PUT /book/:id               |                               |
  |   Authorization: Bearer <t> ->|                               |
  |                               |-- jwt.verify(token)           |
  |                               |-- BEGIN transaction --------> |
  |                               |-- SELECT ... FOR UPDATE ----> | (row lock)
  |                               |<-- seat row (or 0 rows) ----- |
  |                               |-- UPDATE seats SET booked --> |
  |                               |-- COMMIT ------------------>  |
  |<-- 200 { message } ---------- |                               |
```

## Concurrency & Safety

- **Row-level locking**: `SELECT ... FOR UPDATE` inside a transaction ensures only one request can book a seat at a time, even under concurrent load.
- **SQL injection prevention**: All queries use parameterized placeholders (`$1`, `$2`, ...) — never string concatenation.
- **Password security**: Passwords are hashed with bcrypt (10 salt rounds) before storage.
- **JWT expiry**: Tokens expire after 24 hours.
