const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");

const app = express();
app.use(cors());
app.use(express.json());
const PORT = 3000;

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Exchange Rate API",
      version: "1.0.0",
      description: "API for tracking USD to INR exchange rates",
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: "Development server",
      },
    ],
  },
  apis: ["./index.js"], // files containing annotations
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Initialize SQLite database
const db = new sqlite3.Database("./exchange_rate.db", async (err) => {
  if (err) {
    console.error("Error opening database:", err);
  } else {
    console.log("Connected to the SQLite database.");
    db.run(
      `CREATE TABLE IF NOT EXISTS exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      rate REAL
    )`,
      async (err) => {
        if (err) {
          console.error("Error creating table:", err);
        } else {
          // Check if database is empty and populate if needed
          try {
            const isEmpty = await isDatabaseEmpty();
            if (isEmpty) {
              log("Database is empty. Fetching initial exchange rate...");
              await getAndStoreUSDtoINRRate();
            }
          } catch (error) {
            console.error("Error checking/populating database:", error);
          }
        }
      }
    );
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
  return new Promise((resolve, reject) => {
    axios
      .get("https://api.exchangerate-api.com/v4/latest/USD")
      .then((response) => {
        const inrRate = response.data.rates.INR;
        const date = new Date().toISOString().split("T")[0];

        db.run(
          `INSERT INTO exchange_rates (date, rate) VALUES (?, ?)`,
          [date, inrRate],
          function (err) {
            if (err) {
              log(`Error inserting data: ${err.message}`);
              reject(err);
            } else {
              log(`Stored in DB: 1 USD = ${inrRate} INR on ${date}`);
              resolve();
            }
          }
        );
      })
      .catch((error) => {
        log(`Error fetching exchange rate: ${error.message}`);
        reject(error);
      });
  });
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

/**
 * @swagger
 * /api/latest-rate:
 *   get:
 *     summary: Get the latest exchange rate
 *     description: Retrieves the most recent USD to INR exchange rate
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     date:
 *                       type: string
 *                     rate:
 *                       type: number
 *       404:
 *         description: No data available
 *       500:
 *         description: Server error
 */
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

/**
 * @swagger
 * /api/rates:
 *   get:
 *     summary: Get all exchange rates
 *     description: Retrieves all stored USD to INR exchange rates
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       date:
 *                         type: string
 *                       rate:
 *                         type: number
 *       500:
 *         description: Server error
 */
app.get("/api/rates", async (req, res) => {
  try {
    const rates = await getAllRates();
    res.json({ success: true, data: rates });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/cron-status:
 *   get:
 *     summary: Get cron job status
 *     description: Retrieves the last 10 log entries from the cron job
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Server error
 */
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

// Add this function to check if database is empty
function isDatabaseEmpty() {
  return new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) as count FROM exchange_rates", (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row.count === 0);
      }
    });
  });
}
