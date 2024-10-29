const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());
const PORT = 3000;

// Initialize SQLite database
const db = new sqlite3.Database("./exchange_rate.db", (err) => {
  if (err) {
    console.error("Error opening database:", err);
  } else {
    console.log("Connected to the SQLite database.");
    db.run(`CREATE TABLE IF NOT EXISTS exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      rate REAL
    )`);
  }
});

// Logging function to console and file
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp}: ${message}\n`;
  console.log(message);
  fs.appendFile("exchange_rate_log.txt", logMessage, (err) => {
    if (err) console.error("Error writing to log file:", err);
  });
}

// Fetch USD to INR rate and store in SQLite
async function getAndStoreUSDtoINRRate() {
  try {
    const response = await axios.get(
      "https://api.exchangerate-api.com/v4/latest/USD"
    );
    const inrRate = response.data.rates.INR;
    const date = new Date().toISOString().split("T")[0];

    db.run(
      `INSERT INTO exchange_rates (date, rate) VALUES (?, ?)`,
      [date, inrRate],
      function (err) {
        if (err) {
          log(`Error inserting data: ${err.message}`);
        } else {
          log(`Stored in DB: 1 USD = ${inrRate} INR on ${date}`);
        }
      }
    );
  } catch (error) {
    log(`Error fetching exchange rate: ${error.message}`);
  }
}

// Fetch the latest rate from the database
function getLatestRate() {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM exchange_rates ORDER BY id DESC LIMIT 1`,
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

// Fetch all rates from the database
function getAllRates() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM exchange_rates ORDER BY date DESC`, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Set up the cron job to run once a day at midnight
cron.schedule("0 0 * * *", () => {
  log("Running daily USD to INR exchange rate check");
  getAndStoreUSDtoINRRate();
});
log("Cron job scheduled. Waiting for next execution...");

// Express Routes

// Get latest rate
app.get("/api/latest-rate", async (req, res) => {
  try {
    const latestRate = await getLatestRate();
    if (latestRate) {
      res.json({ success: true, data: latestRate });
    } else {
      res.status(404).json({ success: false, message: "No data available" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all rates
app.get("/api/rates", async (req, res) => {
  try {
    const rates = await getAllRates();
    res.json({ success: true, data: rates });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get cron status
app.get("/api/cron-status", (req, res) => {
  // Here, we simply return the log of the last cron job.
  // You may enhance this by storing cron job timestamps or other details.
  fs.readFile("exchange_rate_log.txt", "utf8", (err, data) => {
    if (err) {
      res
        .status(500)
        .json({ success: false, message: "Error reading log file" });
    } else {
      const logEntries = data.trim().split("\n").slice(-10); // Get last 10 log entries
      res.json({ success: true, logs: logEntries });
    }
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
