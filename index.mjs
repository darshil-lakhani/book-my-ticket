//  CREATE TABLE seats (
//      id SERIAL PRIMARY KEY,
//      name VARCHAR(255),
//      isbooked INT DEFAULT 0
//  );
// INSERT INTO seats (isbooked)
// SELECT 0 FROM generate_series(1, 20);

//  CREATE TABLE users (
//      id SERIAL PRIMARY KEY,
//      username VARCHAR(255) UNIQUE NOT NULL,
//      password VARCHAR(255) NOT NULL,
//      created_at TIMESTAMP DEFAULT NOW()
//  );

// If you already have the seats table, add user_id column:
//  ALTER TABLE seats ADD COLUMN user_id INT;

import express from "express";
import pg from "pg";
import { dirname } from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const __dirname = dirname(fileURLToPath(import.meta.url));

const port = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-change-in-production";

// Equivalent to mongoose connection
// Pool is nothing but group of connections
// If you pick one connection out of the pool and release it
// the pooler will keep that connection open for sometime to other clients to reuse
const pool = new pg.Pool({
  connectionString:
    "postgresql://tallytouch_owner:PQ2FZmKj0vaR@ep-little-forest-a1g0cbct.ap-southeast-1.aws.neon.tech/sql_class_2_db?sslmode=require",
  ssl: { rejectUnauthorized: false },
  max: 20,
  connectionTimeoutMillis: 0,
  idleTimeoutMillis: 0,
});

const app = new express();
app.use(cors());
app.use(express.json()); // Parse JSON request bodies (needed for register/login)

// ===================== AUTH MIDDLEWARE =====================
// This function checks the Authorization header for a valid JWT token.
// If valid, it attaches the user info to req.user and calls next().
// If invalid/missing, it returns 401 Unauthorized.
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, username }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

// ===================== EXISTING ENDPOINTS (unchanged) =====================

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

//get all seats
app.get("/seats", async (req, res) => {
  const result = await pool.query("select * from seats"); // equivalent to Seats.find() in mongoose
  res.send(result.rows);
});

// ===================== AUTH ENDPOINTS =====================

// POST /register - Create a new user account
// Body: { "username": "john", "password": "secret123" }
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    // Hash the password with 10 salt rounds (never store plain text passwords!)
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username",
      [username, hashedPassword]
    );

    res.status(201).json({
      message: "User registered successfully.",
      user: result.rows[0],
    });
  } catch (err) {
    // PostgreSQL unique violation error code = 23505
    if (err.code === "23505") {
      return res.status(409).json({ error: "Username already exists." });
    }
    console.log(err);
    res.status(500).json({ error: "Registration failed." });
  }
});

// POST /login - Authenticate and get a JWT token
// Body: { "username": "john", "password": "secret123" }
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    // Find user in database
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const user = result.rows[0];

    // Compare provided password with stored hash
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    // Generate JWT token (expires in 24 hours)
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
      expiresIn: "24h",
    });

    res.json({
      message: "Login successful.",
      token,
      user: { id: user.id, username: user.username },
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Login failed." });
  }
});

// ===================== PROTECTED BOOKING ENDPOINTS =====================

// PUT /book/:seatId - Book a seat (PROTECTED - requires login)
// Header: Authorization: Bearer <token>
app.put("/book/:seatId", authMiddleware, async (req, res) => {
  try {
    const seatId = req.params.seatId;
    const userId = req.user.id;
    const username = req.user.username;

    const conn = await pool.connect(); // pick a connection from the pool

    //begin transaction
    // KEEP THE TRANSACTION AS SMALL AS POSSIBLE
    await conn.query("BEGIN");

    // Lock the row to prevent double booking (FOR UPDATE locks the row)
    // getting the row to make sure it is not booked
    /// $1 is a variable which we are passing in the array as the second parameter of query function,
    // Why do we use $1? -> this is to avoid SQL INJECTION
    const sql = "SELECT * FROM seats WHERE id = $1 AND isbooked = 0 FOR UPDATE";
    const result = await conn.query(sql, [seatId]);

    console.log(`User ${username} is trying to book seat ${seatId}`);
    //if no rows found then the operation should fail can't book
    // This shows we Do not have the current seat available for booking
    if (result.rowCount === 0) {
      await conn.query("ROLLBACK");
      conn.release();
      return res.status(400).json({ error: "Seat already booked or does not exist." });
    }

    console.log(`User ${username} is booking seat ${seatId}`);

    //if we get the row, we are safe to update
    const sqlUpdate = "UPDATE seats SET isbooked = 1, name = $2, user_id = $3 WHERE id = $1";
    await conn.query(sqlUpdate, [seatId, username, userId]);

    console.log(`User ${username} successfully booked seat ${seatId}`);

    //end transaction by committing
    await conn.query("COMMIT");
    conn.release(); // release the connection back to the pool

    res.json({ message: `Seat ${seatId} booked successfully for ${username}.` });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Booking failed." });
  }
});

// GET /bookings - Get all bookings for the logged-in user (PROTECTED)
// Header: Authorization: Bearer <token>
app.get("/bookings", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query("SELECT id, name FROM seats WHERE user_id = $1", [userId]);

    res.json({ bookings: result.rows });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to fetch bookings." });
  }
});

// ===================== LEGACY BOOKING ENDPOINT (original, now protected) =====================

//book a seat give the seatId and your name
app.put("/:id/:name", authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const name = req.params.name;
    // payment integration should be here
    // verify payment
    const conn = await pool.connect(); // pick a connection from the pool
    //begin transaction
    // KEEP THE TRANSACTION AS SMALL AS POSSIBLE
    await conn.query("BEGIN");
    //getting the row to make sure it is not booked
    /// $1 is a variable which we are passing in the array as the second parameter of query function,
    // Why do we use $1? -> this is to avoid SQL INJECTION
    // (If you do ${id} directly in the query string,
    // then it can be manipulated by the user to execute malicious SQL code)
    const sql = "SELECT * FROM seats where id = $1 and isbooked = 0 FOR UPDATE";
    const result = await conn.query(sql, [id]);

    //if no rows found then the operation should fail can't book
    // This shows we Do not have the current seat available for booking
    if (result.rowCount === 0) {
      await conn.query("ROLLBACK");
      conn.release();
      return res.status(400).json({ error: "Seat already booked" });
    }
    //if we get the row, we are safe to update
    const sqlU = "update seats set isbooked = 1, name = $2, user_id = $3 where id = $1";
    const updateResult = await conn.query(sqlU, [id, name, req.user.id]); // Again to avoid SQL INJECTION we are using $1 and $2 as placeholders

    //end transaction by committing
    await conn.query("COMMIT");
    conn.release(); // release the connection back to the pool (so we do not keep the connection open unnecessarily)
    res.send(updateResult);
  } catch (ex) {
    console.log(ex);
    res.status(500).json({ error: "Booking failed." });
  }
});

app.listen(port, () => console.log("Server starting on port: " + port));
