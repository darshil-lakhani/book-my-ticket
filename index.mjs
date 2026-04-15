// ===================== SQL SCHEMA =====================
// Run ONCE in your database before starting the server:

// ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';

// CREATE TABLE IF NOT EXISTS cinemas (
//   id SERIAL PRIMARY KEY,
//   name VARCHAR(255) UNIQUE NOT NULL,
//   location VARCHAR(255),
//   created_at TIMESTAMP DEFAULT NOW()
// );

// CREATE TABLE IF NOT EXISTS movies (
//   id SERIAL PRIMARY KEY,
//   title VARCHAR(255) UNIQUE NOT NULL,
//   description TEXT,
//   duration_minutes INT DEFAULT 120,
//   genre VARCHAR(100),
//   created_at TIMESTAMP DEFAULT NOW()
// );

// CREATE TABLE IF NOT EXISTS shows (
//   id SERIAL PRIMARY KEY,
//   cinema_id INT REFERENCES cinemas(id) ON DELETE CASCADE,
//   movie_id INT REFERENCES movies(id) ON DELETE CASCADE,
//   show_date DATE NOT NULL,
//   show_time TIME NOT NULL,
//   created_at TIMESTAMP DEFAULT NOW(),
//   UNIQUE(cinema_id, show_date, show_time)
// );

// CREATE TABLE IF NOT EXISTS cinema_seats (
//   id SERIAL PRIMARY KEY,
//   cinema_id INT REFERENCES cinemas(id) ON DELETE CASCADE,
//   row_name VARCHAR(5) NOT NULL,
//   seat_number INT NOT NULL,
//   category VARCHAR(20) NOT NULL CHECK (category IN ('standard', 'balcony', 'recliner')),
//   price DECIMAL(10,2) NOT NULL,
//   UNIQUE(cinema_id, row_name, seat_number)
// );

// CREATE TABLE IF NOT EXISTS bookings (
//   id SERIAL PRIMARY KEY,
//   user_id INT REFERENCES users(id),
//   show_id INT REFERENCES shows(id),
//   booking_reference VARCHAR(20) UNIQUE NOT NULL,
//   total_amount DECIMAL(10,2) NOT NULL,
//   status VARCHAR(20) DEFAULT 'confirmed',
//   created_at TIMESTAMP DEFAULT NOW()
// );

// CREATE TABLE IF NOT EXISTS booking_seats (
//   id SERIAL PRIMARY KEY,
//   booking_id INT REFERENCES bookings(id) ON DELETE CASCADE,
//   seat_id INT REFERENCES cinema_seats(id),
//   price DECIMAL(10,2) NOT NULL
// );

// CREATE TABLE IF NOT EXISTS show_seat_status (
//   show_id INT REFERENCES shows(id) ON DELETE CASCADE,
//   seat_id INT REFERENCES cinema_seats(id) ON DELETE CASCADE,
//   booking_id INT REFERENCES bookings(id) NULL,
//   is_booked BOOLEAN DEFAULT FALSE,
//   PRIMARY KEY(show_id, seat_id)
// );

import express from "express";
import pg from "pg";
import { dirname } from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) throw new Error("Missing env: DATABASE_URL");
if (!process.env.JWT_SECRET)   throw new Error("Missing env: JWT_SECRET");

const JWT_SECRET = process.env.JWT_SECRET;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  connectionTimeoutMillis: 0,
  idleTimeoutMillis: 0,
});

const app = new express();
app.use(cors());
app.use(express.json());

// ===================== HELPERS =====================

function generateBookingRef() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return (
    "BMT-" +
    Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
  );
}

// ===================== MIDDLEWARE =====================

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }
  try {
    req.user = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

// ===================== STATIC =====================

app.get("/", (req, res) => res.sendFile(__dirname + "/index.html"));

// ===================== AUTH =====================

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "Username and password are required." });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters." });

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username, role",
      [username, hashedPassword]
    );
    res.status(201).json({ message: "User registered successfully.", user: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Username already exists." });
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "Username and password are required." });

    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    if (result.rowCount === 0)
      return res.status(401).json({ error: "Invalid username or password." });

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid username or password." });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );
    res.json({
      message: "Login successful.",
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch {
    res.status(500).json({ error: "Login failed." });
  }
});

app.get("/me", authMiddleware, async (req, res) => {
  const result = await pool.query("SELECT id, username, role FROM users WHERE id = $1", [
    req.user.id,
  ]);
  res.json(result.rows[0]);
});

// ===================== CINEMAS =====================

app.get("/cinemas", async (req, res) => {
  const result = await pool.query("SELECT * FROM cinemas ORDER BY name");
  res.json(result.rows);
});

app.post("/cinemas", authMiddleware, adminMiddleware, async (req, res) => {
  const { name, location } = req.body;
  if (!name) return res.status(400).json({ error: "Name required." });
  try {
    const result = await pool.query(
      "INSERT INTO cinemas (name, location) VALUES ($1, $2) RETURNING *",
      [name, location || ""]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Cinema already exists." });
    res.status(500).json({ error: "Failed to create cinema." });
  }
});

// ===================== MOVIES =====================

app.get("/movies", async (req, res) => {
  const result = await pool.query("SELECT * FROM movies ORDER BY title");
  res.json(result.rows);
});

app.post("/movies", authMiddleware, adminMiddleware, async (req, res) => {
  const { title, description, duration_minutes, genre } = req.body;
  if (!title) return res.status(400).json({ error: "Title required." });
  try {
    const result = await pool.query(
      "INSERT INTO movies (title, description, duration_minutes, genre) VALUES ($1, $2, $3, $4) RETURNING *",
      [title, description || "", duration_minutes || 120, genre || ""]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Movie already exists." });
    res.status(500).json({ error: "Failed to create movie." });
  }
});

// ===================== SHOWS =====================

app.get("/shows", async (req, res) => {
  const { cinema_id, date } = req.query;
  const params = [];
  const conditions = [];

  if (cinema_id) {
    params.push(cinema_id);
    conditions.push(`s.cinema_id = $${params.length}`);
  }
  if (date) {
    params.push(date);
    conditions.push(`s.show_date = $${params.length}`);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const result = await pool.query(
    `SELECT s.id, TO_CHAR(s.show_date, 'YYYY-MM-DD') as show_date, TO_CHAR(s.show_time, 'HH24:MI') as show_time,
            m.id as movie_id, m.title as movie_title, m.genre, m.duration_minutes, m.description,
            c.id as cinema_id, c.name as cinema_name, c.location,
            COUNT(cs.id) AS total_seats,
            COUNT(CASE WHEN sss.is_booked = true THEN 1 END) AS booked_seats
     FROM shows s
     JOIN movies m ON s.movie_id = m.id
     JOIN cinemas c ON s.cinema_id = c.id
     JOIN cinema_seats cs ON cs.cinema_id = s.cinema_id
     LEFT JOIN show_seat_status sss ON sss.show_id = s.id AND sss.seat_id = cs.id
     ${where}
     GROUP BY s.id, m.id, c.id
     ORDER BY s.show_date, s.show_time`,
    params
  );
  res.json(result.rows);
});

app.post("/shows", authMiddleware, adminMiddleware, async (req, res) => {
  const { cinema_id, movie_id, show_date, show_time } = req.body;
  if (!cinema_id || !movie_id || !show_date || !show_time)
    return res.status(400).json({ error: "cinema_id, movie_id, show_date, show_time required." });
  try {
    const result = await pool.query(
      "INSERT INTO shows (cinema_id, movie_id, show_date, show_time) VALUES ($1, $2, $3, $4) RETURNING *",
      [cinema_id, movie_id, show_date, show_time]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "A show already exists at this time in this cinema." });
    res.status(500).json({ error: "Failed to create show." });
  }
});

// Get seats for a specific show with availability
app.get("/shows/:showId/seats", async (req, res) => {
  const { showId } = req.params;
  const result = await pool.query(
    `SELECT cs.id, cs.row_name, cs.seat_number, cs.category, cs.price,
            COALESCE(sss.is_booked, false) as is_booked,
            CASE WHEN COALESCE(sss.is_booked, false) THEN u.username ELSE NULL END as booked_by
     FROM cinema_seats cs
     JOIN shows s ON cs.cinema_id = s.cinema_id
     LEFT JOIN show_seat_status sss ON sss.show_id = $1 AND sss.seat_id = cs.id
     LEFT JOIN bookings b ON b.id = sss.booking_id
     LEFT JOIN users u ON u.id = b.user_id
     WHERE s.id = $1
     ORDER BY cs.row_name, cs.seat_number`,
    [showId]
  );
  res.json(result.rows);
});

// ===================== BOOKINGS =====================

// POST /bookings - book up to 3 seats in one transaction
app.post("/bookings", authMiddleware, async (req, res) => {
  const { showId, seatIds } = req.body;

  if (!showId || !Array.isArray(seatIds) || seatIds.length === 0)
    return res.status(400).json({ error: "showId and seatIds[] are required." });
  if (seatIds.length > 3)
    return res.status(400).json({ error: "Maximum 3 seats per booking." });

  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");

    // Verify show exists
    const showCheck = await conn.query("SELECT cinema_id FROM shows WHERE id = $1", [showId]);
    if (showCheck.rowCount === 0) {
      await conn.query("ROLLBACK");
      return res.status(404).json({ error: "Show not found." });
    }
    const cinemaId = showCheck.rows[0].cinema_id;

    // Ensure status rows exist for requested seats (only seats belonging to this show's cinema)
    await conn.query(
      `INSERT INTO show_seat_status (show_id, seat_id, is_booked)
       SELECT $1, cs.id, false FROM cinema_seats cs
       WHERE cs.id = ANY($2::int[]) AND cs.cinema_id = $3
       ON CONFLICT (show_id, seat_id) DO NOTHING`,
      [showId, seatIds, cinemaId]
    );

    // Lock rows to prevent double-booking
    const lockResult = await conn.query(
      `SELECT sss.seat_id, sss.is_booked, cs.price, cs.category, cs.row_name, cs.seat_number
       FROM show_seat_status sss
       JOIN cinema_seats cs ON cs.id = sss.seat_id
       WHERE sss.show_id = $1 AND sss.seat_id = ANY($2::int[])
       FOR UPDATE`,
      [showId, seatIds]
    );

    if (lockResult.rowCount !== seatIds.length) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ error: "One or more seats are not valid for this show." });
    }

    const alreadyBooked = lockResult.rows.filter((r) => r.is_booked);
    if (alreadyBooked.length > 0) {
      await conn.query("ROLLBACK");
      return res.status(400).json({
        error: `Seats already taken: ${alreadyBooked.map((s) => `${s.row_name}${s.seat_number}`).join(", ")}`,
      });
    }

    const totalAmount = lockResult.rows.reduce((sum, r) => sum + parseFloat(r.price), 0);

    // Generate unique booking reference
    let bookingRef;
    do {
      bookingRef = generateBookingRef();
    } while (
      (await conn.query("SELECT 1 FROM bookings WHERE booking_reference = $1", [bookingRef]))
        .rowCount > 0
    );

    // Create booking record
    const bookingResult = await conn.query(
      "INSERT INTO bookings (user_id, show_id, booking_reference, total_amount) VALUES ($1, $2, $3, $4) RETURNING *",
      [req.user.id, showId, bookingRef, totalAmount]
    );
    const bookingId = bookingResult.rows[0].id;

    // Insert each seat into booking_seats and update show_seat_status
    for (const row of lockResult.rows) {
      await conn.query(
        "INSERT INTO booking_seats (booking_id, seat_id, price) VALUES ($1, $2, $3)",
        [bookingId, row.seat_id, row.price]
      );
      await conn.query(
        "UPDATE show_seat_status SET is_booked = true, booking_id = $1 WHERE show_id = $2 AND seat_id = $3",
        [bookingId, showId, row.seat_id]
      );
    }

    await conn.query("COMMIT");

    res.status(201).json({
      message: "Booking confirmed!",
      booking_reference: bookingRef,
      total_amount: totalAmount,
      seats: lockResult.rows.map((r) => ({
        row: r.row_name,
        number: r.seat_number,
        category: r.category,
        price: r.price,
      })),
    });
  } catch (err) {
    await conn.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Booking failed." });
  } finally {
    conn.release();
  }
});

// GET /bookings - current user's booking history
app.get("/bookings", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.booking_reference, b.total_amount, b.status, b.created_at,
              m.title as movie_title, c.name as cinema_name,
              TO_CHAR(s.show_date, 'YYYY-MM-DD') as show_date,
              TO_CHAR(s.show_time, 'HH24:MI') as show_time,
              json_agg(json_build_object(
                'row', cs.row_name, 'number', cs.seat_number,
                'category', cs.category, 'price', bs.price
              ) ORDER BY cs.row_name, cs.seat_number) as seats
       FROM bookings b
       JOIN shows s ON s.id = b.show_id
       JOIN movies m ON m.id = s.movie_id
       JOIN cinemas c ON c.id = s.cinema_id
       JOIN booking_seats bs ON bs.booking_id = b.id
       JOIN cinema_seats cs ON cs.id = bs.seat_id
       WHERE b.user_id = $1
       GROUP BY b.id, m.title, c.name, s.show_date, s.show_time
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch bookings." });
  }
});

// ===================== ADMIN =====================

// GET /admin/bookings - all bookings dashboard
app.get("/admin/bookings", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.booking_reference, b.total_amount, b.status, b.created_at,
              u.username,
              m.title as movie_title, c.name as cinema_name,
              TO_CHAR(s.show_date, 'YYYY-MM-DD') as show_date,
              TO_CHAR(s.show_time, 'HH24:MI') as show_time,
              json_agg(json_build_object(
                'row', cs.row_name, 'number', cs.seat_number, 'category', cs.category
              ) ORDER BY cs.row_name, cs.seat_number) as seats
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       JOIN shows s ON s.id = b.show_id
       JOIN movies m ON m.id = s.movie_id
       JOIN cinemas c ON c.id = s.cinema_id
       JOIN booking_seats bs ON bs.booking_id = b.id
       JOIN cinema_seats cs ON cs.id = bs.seat_id
       GROUP BY b.id, u.username, m.title, c.name, s.show_date, s.show_time
       ORDER BY b.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch bookings." });
  }
});

// POST /admin/reset - reset all seats (or a specific show)
app.post("/admin/reset", authMiddleware, adminMiddleware, async (req, res) => {
  const { show_id } = req.body;
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    if (show_id) {
      await conn.query(
        "DELETE FROM booking_seats WHERE booking_id IN (SELECT id FROM bookings WHERE show_id = $1)",
        [show_id]
      );
      await conn.query("DELETE FROM bookings WHERE show_id = $1", [show_id]);
      await conn.query(
        "UPDATE show_seat_status SET is_booked = false, booking_id = NULL WHERE show_id = $1",
        [show_id]
      );
    } else {
      await conn.query("DELETE FROM booking_seats");
      await conn.query("DELETE FROM bookings");
      await conn.query("UPDATE show_seat_status SET is_booked = false, booking_id = NULL");
    }
    await conn.query("COMMIT");
    res.json({ message: show_id ? `Show ${show_id} seats reset.` : "All seats reset." });
  } catch (err) {
    await conn.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Reset failed." });
  } finally {
    conn.release();
  }
});

// POST /admin/seed - create demo cinemas, movies, shows, and seats
app.post("/admin/seed", authMiddleware, adminMiddleware, async (req, res) => {
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");

    // Insert cinemas
    const cinemasData = [
      ["PVR Nexus", "Bengaluru"],
      ["INOX GVK", "Hyderabad"],
      ["Cinepolis", "Mumbai"],
    ];
    const cinemaIds = [];
    for (const [name, location] of cinemasData) {
      const r = await conn.query(
        "INSERT INTO cinemas (name, location) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET location = EXCLUDED.location RETURNING id",
        [name, location]
      );
      cinemaIds.push(r.rows[0].id);
    }

    // Insert movies
    const moviesData = [
      ["Dhurandhar: The Revenge", "An epic tale of revenge and redemption.", 150, "Action"],
      ["Chai & Chill", "A heartwarming slice-of-life comedy.", 110, "Comedy"],
      ["Stellar Horizon", "A sci-fi thriller set in deep space.", 135, "Sci-Fi"],
      ["Monsoon Melody", "A romantic drama set in the rains of Mumbai.", 125, "Romance"],
    ];
    const movieIds = [];
    for (const [title, description, duration_minutes, genre] of moviesData) {
      const r = await conn.query(
        "INSERT INTO movies (title, description, duration_minutes, genre) VALUES ($1, $2, $3, $4) ON CONFLICT (title) DO UPDATE SET genre = EXCLUDED.genre RETURNING id",
        [title, description, duration_minutes, genre]
      );
      movieIds.push(r.rows[0].id);
    }

    // Create cinema seats: rows A-B = Recliner, C-D = Balcony, E-F = Standard, 8 seats each
    const seatConfig = [
      { row: "A", category: "recliner", price: 500 },
      { row: "B", category: "recliner", price: 500 },
      { row: "C", category: "balcony", price: 300 },
      { row: "D", category: "balcony", price: 300 },
      { row: "E", category: "standard", price: 200 },
      { row: "F", category: "standard", price: 200 },
    ];
    for (const cinemaId of cinemaIds) {
      for (const { row, category, price } of seatConfig) {
        for (let num = 1; num <= 8; num++) {
          await conn.query(
            "INSERT INTO cinema_seats (cinema_id, row_name, seat_number, category, price) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cinema_id, row_name, seat_number) DO NOTHING",
            [cinemaId, row, num, category, price]
          );
        }
      }
    }

    // Create shows: 9am–11pm every hour for next 3 days, rotating movies
    const timeSlots = [
      "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00",
      "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00",
    ];
    for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
      const date = new Date();
      date.setDate(date.getDate() + dayOffset);
      const dateStr = date.toISOString().split("T")[0];

      for (const cinemaId of cinemaIds) {
        for (let i = 0; i < timeSlots.length; i++) {
          const movieId = movieIds[i % movieIds.length];
          await conn.query(
            "INSERT INTO shows (cinema_id, movie_id, show_date, show_time) VALUES ($1, $2, $3, $4) ON CONFLICT (cinema_id, show_date, show_time) DO NOTHING",
            [cinemaId, movieId, dateStr, timeSlots[i]]
          );
        }
      }
    }

    await conn.query("COMMIT");
    res.json({
      message: `Seeded ${cinemaIds.length} cinemas, ${movieIds.length} movies, and shows for 3 days.`,
    });
  } catch (err) {
    await conn.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Seeding failed: " + err.message });
  } finally {
    conn.release();
  }
});

async function ensureAdminExists() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  
  const DEFAULT_ADMIN = { username: username, password: password };
  try {
    const existing = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (existing.rowCount > 0) return;

    const hashed = await bcrypt.hash(DEFAULT_ADMIN.password, 10);
    await pool.query(
      "INSERT INTO users (username, password, role) VALUES ($1, $2, 'admin') ON CONFLICT (username) DO UPDATE SET role = 'admin'",
      [DEFAULT_ADMIN.username, hashed]
    );
    console.log("====================================");
    console.log("  Admin user created automatically");
    console.log(`  Username : ${DEFAULT_ADMIN.username}`);
    console.log(`  Password : ${DEFAULT_ADMIN.password}`);
    console.log("  Change the password after first login!");
    console.log("====================================");
  } catch (err) {
    console.error("Could not ensure admin user:", err.message);
  }
}

app.listen(port, async () => {
  console.log("Server starting on port: " + port);
  await ensureAdminExists();
});
