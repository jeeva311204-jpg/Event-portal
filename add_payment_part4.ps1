# ============================================================
# Fix Render Deployment Issues - Part 4
# ============================================================
# What this fixes:
#  1. utils/email.js - switches from SMTP (nodemailer) to Brevo's
#     HTTPS API. Render's free tier permanently blocks outbound
#     SMTP ports (25, 465, 587) as of Sept 2025, so Gmail SMTP can
#     never work there no matter how correct the credentials are.
#     Brevo sends over plain HTTPS instead, which is not blocked.
#  2. server.js - adds app.set("trust proxy", 1) so express-rate-limit
#     correctly identifies clients behind Render's reverse proxy
#     instead of throwing a ValidationError on every request.
#  3. .env.example - documents the new BREVO_* variables.
#
# BEFORE running this, sign up free at https://brevo.com, then:
#   - Go to Settings -> Senders, Domains & Dedicated IPs -> Senders
#     -> Add a Sender, and verify an email address you own (e.g.
#     your Gmail) by clicking the confirmation link Brevo emails you.
#   - Go to Settings -> SMTP & API -> API Keys -> Generate a new API key.
# Then add these to BOTH your local .env and your Render Environment tab:
#   BREVO_API_KEY=<the key you generated>
#   BREVO_SENDER_EMAIL=<the email you verified as a sender>
#   BREVO_SENDER_NAME=College Event Portal
#
# Run this from your project root, AFTER parts 1-3 have already
# been applied. USAGE:  .\add_payment_part4.ps1
# ============================================================

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\package.json")) {
    Write-Host "ERROR: Run this script from your project root (the folder containing package.json)." -ForegroundColor Red
    exit 1
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = ".\_pre_deployfix_backup_$stamp"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
foreach ($item in @("utils\email.js", "server.js", ".env.example")) {
    if (Test-Path $item) {
        $dest = Join-Path $backupDir $item
        New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
        Copy-Item $item -Destination $dest -Force
    }
}
Write-Host "Backed up existing files to $backupDir" -ForegroundColor Yellow

function Write-Utf8NoBom($Path, $Content) {
    $dir = Split-Path $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Join-Path (Get-Location) $Path), $Content, $enc)
}

$emailJs = @'
// Render's free tier blocks all outbound SMTP traffic (ports 25, 465, 587)
// as of a September 2025 policy change, so nodemailer over SMTP can never
// work there, no matter how correct the credentials are. Brevo's
// transactional email API sends over plain HTTPS instead, which Render
// does not block. The sender email below must be verified as a "Sender"
// in your Brevo dashboard first (Settings -> Senders, Domains & Dedicated
// IPs -> Senders -> Add a Sender) - this only requires proving you own
// that one address (a confirmation email/link), not a whole domain, so it
// works fine with a plain Gmail address. Once verified, Brevo will deliver
// to any recipient address, not just your own.
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

async function sendEmail(to, subject, text, html) {
    if (!process.env.BREVO_API_KEY) {
        console.warn("[EMAIL] BREVO_API_KEY not set - skipping email send. Set it in .env to enable real emails.");
        return null;
    }

    try {
        const res = await fetch(BREVO_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "api-key": process.env.BREVO_API_KEY
            },
            body: JSON.stringify({
                sender: {
                    email: process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER,
                    name: process.env.BREVO_SENDER_NAME || "College Event Portal"
                },
                to: [{ email: to }],
                subject,
                textContent: text,
                htmlContent: html || `<p>${text}</p>`
            })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.message || `Brevo API responded with status ${res.status}`);
        }

        console.log(`[EMAIL SENT] To: ${to} | Subject: ${subject} | MessageId: ${data.messageId || "n/a"}`);
        return data;
    } catch (err) {
        console.error(`[EMAIL ERROR] Failed to send to ${to}:`, err.message);
        throw err;
    }
}

module.exports = { sendEmail };

'@

$serverJs = @'
require("dotenv").config();

const missingSecrets = [];
if (!process.env.JWT_SECRET) missingSecrets.push("JWT_SECRET");
if (!process.env.QR_SECRET) missingSecrets.push("QR_SECRET");

if (missingSecrets.length) {
    if (process.env.NODE_ENV === "production") {
        throw new Error(
            `FATAL: Missing required secrets in production: ${missingSecrets.join(", ")}. ` +
            `Set these environment variables before starting the server.`
        );
    } else {
        // Development only â€” allow fallback with loud warning
        console.warn(`
â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•`);
        process.env.JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_this";
        process.env.QR_SECRET = process.env.QR_SECRET || "dev_qr_secret_change_this";
    }
}

const express = require("express");
const http = require("http");
const path = require("path");
const helmet = require("helmet");
const { Server } = require("socket.io");
const cors = require("cors");
const bcrypt = require("bcryptjs");

const connectDB = require("./config/db");
const { setIo } = require("./utils/notify");
const { startReminderScheduler } = require("./utils/reminders");

const User = require("./models/User");
const Event = require("./models/Event");

const app = express();

// Render (and most cloud hosts) sit their app behind a reverse proxy, so
// every request arrives with an X-Forwarded-For header. Without this
// setting, Express refuses to trust that header, which breaks
// express-rate-limit's ability to identify individual clients correctly.
// `1` trusts exactly one hop (the platform's own proxy) rather than
// blindly trusting the whole chain.
app.set("trust proxy", 1);
const server = http.createServer(app);

// CORS_ORIGIN can be a single origin or a comma-separated list, e.g.
// "https://portal.example.com,https://admin.example.com". Falls back to
// "*" only outside production so local dev keeps working without setup.
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map(o => o.trim()).filter(Boolean);
const corsOrigin = allowedOrigins.length ? allowedOrigins : (process.env.NODE_ENV === "production" ? [] : "*");

const io = new Server(server, { cors: { origin: corsOrigin } });

app.set("io", io);
setIo(io);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Simple liveness check for uptime monitors and Docker healthchecks.
// Does not touch the database, so it stays fast and always responds
// even if Mongo is briefly unreachable.
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
});

// Standard Routes
app.use("/api", require("./routes/auth"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/events", require("./routes/events"));
app.use("/api", require("./routes/registrations"));
app.use("/api/payments", require("./routes/payments"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/events", require("./routes/reviews"));
app.use("/api/events", require("./routes/waitlist"));
app.use("/api/scan", require("./routes/scan"));
app.use("/api", require("./routes/certificate"));

// The unauthenticated "/api/events/:eventId/attendees" route that used to
// live here has been removed â€” it leaked every attendee's name/email/phone
// to anyone, with no login check. The authenticated equivalent already
// exists at GET /api/events/:id/registrations (admin/organizer only) in
// routes/events.js, plus a CSV export at .../registrations/export.

// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err.message || "Internal server error" });
});

io.on("connection", (socket) => {
    socket.on("join_user_room", (userId) => {
        socket.join(String(userId));
    });
});

async function seed() {
    const count = await User.countDocuments();
    if (count > 0) return;

    const password = await bcrypt.hash("password123", 10);

    const admin = await User.create({
        name: "Admin User", email: "admin@college.edu", phone: "+19876543210",
        password, role: "admin", department: "Administration", phoneVerified: true
    });
    const organizer = await User.create({
        name: "Priya Sharma", email: "organizer@college.edu", phone: "+19876543211",
        password, role: "organizer", department: "Computer Science", phoneVerified: true
    });
    await User.create({
        name: "Arjun Kumar", email: "student1@college.edu", phone: "+19876543212",
        password, role: "student", department: "Information Technology", phoneVerified: true
    });

    await Event.create([
        {
            title: "AI & Machine Learning Workshop",
            description: "Hands-on AI and machine learning workshop for students.",
            category: "Technical", date: "2026-08-20", time: "10:00",
            venue: "Seminar Hall 1", department: "Computer Science", maxSeats: 60,
            organizerId: organizer._id, organizerName: organizer.name, status: "upcoming"
        },
        {
            title: "Annual Cultural Fest 2026",
            description: "Music, dance and cultural performances.",
            category: "Cultural", date: "2026-08-25", time: "17:00",
            venue: "Main Auditorium", department: "All Departments", maxSeats: 300,
            organizerId: organizer._id, organizerName: organizer.name, status: "upcoming"
        },
        {
            title: "Inter College Basketball Tournament",
            description: "Inter college basketball competition.",
            category: "Sports", date: "2026-08-18", time: "09:00",
            venue: "Sports Complex", department: "Physical Education", maxSeats: 150,
            organizerId: organizer._id, organizerName: organizer.name, status: "upcoming"
        }
    ]);

    console.log("Seeded admin/organizer/student. Admin: admin@college.edu | Pass: password123");
}

const PORT = process.env.PORT || 5000;

// Only auto-connect to Mongo and start listening when this file is run
// directly (`node server.js` / `npm start`). When it's `require()`d â€” e.g.
// by the Jest test suite in tests/ â€” we just export `app` so tests can hit
// routes with supertest without opening a real port or DB connection.
if (require.main === module) {
    connectDB()
        .then(seed)
        .then(() => {
            server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
            startReminderScheduler();
        });

    // Graceful shutdown so in-flight requests finish and the Mongo
    // connection closes cleanly instead of the process being killed
    // mid-write.
    const mongoose = require("mongoose");
    function shutdown(signal) {
        console.log(`\n${signal} received: closing server gracefully...`);
        server.close(() => {
            mongoose.connection.close(false).then(() => {
                console.log("Closed remaining connections.");
                process.exit(0);
            });
        });
        setTimeout(() => {
            console.error("Could not close connections in time, forcing shutdown.");
            process.exit(1);
        }, 10000).unref();
    }
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = { app, server };





'@

$envExample = @'
PORT=5000

JWT_SECRET=replace_with_a_long_random_string
QR_SECRET=replace_with_a_different_long_random_string

MONGO_URI=mongodb+srv://your_db_user:your_db_password@your-cluster.mongodb.net/?retryWrites=true&w=majority

# Email sending via Brevo's HTTPS API (not SMTP - see utils/email.js for
# why). Sign up free at brevo.com, verify a sender email under Settings ->
# Senders, Domains & Dedicated IPs -> Senders, then create an API key
# under Settings -> SMTP & API -> API Keys.
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=your_verified_sender@gmail.com
BREVO_SENDER_NAME=College Event Portal

# Comma-separated list of allowed frontend origins in production.
# Leave unset in local development.
CORS_ORIGIN=

# Razorpay dashboard -> Settings -> API Keys. Use the Test Mode keys while
# developing; switch to Live Mode keys only once you're ready to accept real
# payments.
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

'@


Write-Utf8NoBom "utils\email.js" $emailJs
Write-Utf8NoBom "server.js" $serverJs
Write-Utf8NoBom ".env.example" $envExample
Write-Host "Wrote updated files." -ForegroundColor Green

# Add BREVO_* placeholders to your real .env if not already present,
# without touching any of your existing secrets in there.
$envPath = ".\.env"
if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw
    if ($envContent -notmatch "BREVO_API_KEY") {
        Add-Content -Path $envPath -Value "`r`n# Brevo (https://brevo.com) - sends email over HTTPS, works on Render's free tier`r`nBREVO_API_KEY=your_brevo_api_key`r`nBREVO_SENDER_EMAIL=your_verified_sender@gmail.com`r`nBREVO_SENDER_NAME=College Event Portal"
        Write-Host "Added BREVO_* placeholders to .env - EDIT THESE with your real Brevo API key and verified sender email!" -ForegroundColor Yellow
    } else {
        Write-Host ".env already has BREVO_API_KEY, leaving it untouched." -ForegroundColor Yellow
    }
} else {
    Write-Host "No .env file found - copy .env.example to .env and fill in all values." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Part 4 (deployment fixes) complete." -ForegroundColor Green
Write-Host "No new npm packages needed (uses Node's built-in fetch)." -ForegroundColor Green
Write-Host "Remember to also add BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME to your Render Environment tab, then commit and push to trigger a redeploy." -ForegroundColor Green
