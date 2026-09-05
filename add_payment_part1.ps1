# ============================================================
# Add Razorpay Payment Feature - Part 1 (Backend)
# ============================================================
# What this adds:
#  1. Event model gets a new "fee" field (INR, 0 = free event).
#  2. A new Payment model that records every Razorpay order and
#     whether it was verified as paid.
#  3. utils/completeRegistration.js - the seat-reservation + QR +
#     email logic pulled out of routes/registrations.js so both
#     the free-event flow and the new paid-event flow share the
#     exact same, already-tested code path.
#  4. routes/registrations.js - free events register exactly as
#     before; paid events (fee > 0) are now rejected here and
#     must go through the new payment routes instead.
#  5. routes/payments.js (new) - POST /api/payments/create-order
#     creates a Razorpay order; POST /api/payments/verify checks
#     the payment signature server-side (never trust the browser)
#     and only then creates the registration.
#  6. routes/events.js - create/update event now accepts a "fee"
#     field.
#  7. server.js - mounts the new /api/payments routes.
#  8. .env.example / package.json get the Razorpay key placeholders
#     and dependency respectively.
#
# USAGE: place this script in your project root (same folder as
# package.json) and run:  .\add_payment_part1.ps1
# Then run add_payment_part2.ps1 for the frontend changes.
# ============================================================

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\package.json")) {
    Write-Host "ERROR: Run this script from your project root (the folder containing package.json)." -ForegroundColor Red
    exit 1
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = ".\_pre_payment_backup_$stamp"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
foreach ($item in @("models\Event.js", "routes\registrations.js", "routes\events.js", "server.js", ".env.example", "package.json")) {
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

$eventJs = @'
const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    venue: { type: String, required: true },
    department: { type: String, default: "All Departments" },
    maxSeats: { type: Number, default: 50 },
    seatsBooked: { type: Number, default: 0 },
    // Registration fee in INR. 0 means the event is free and skips the
    // Razorpay flow entirely.
    fee: { type: Number, default: 0, min: 0 },
    organizerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    organizerName: { type: String, required: true },
    status: { type: String, enum: ["upcoming", "ongoing", "completed", "cancelled"], default: "upcoming" }
}, { timestamps: true });

module.exports = mongoose.model("Event", eventSchema);

'@

$paymentJs = @'
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    // Stored in the smallest currency unit (paise) to match what Razorpay
    // itself uses, avoiding floating point rounding issues.
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: ["created", "paid", "failed"], default: "created" },
    registrationId: { type: mongoose.Schema.Types.ObjectId, ref: "Registration" }
}, { timestamps: true });

module.exports = mongoose.model("Payment", paymentSchema);

'@

$completeRegJs = @'
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const { addNotification } = require("./notify");
const { sendEmail } = require("./email");

function generateCheckinCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Shared by the free-event registration route (routes/registrations.js) and
// the post-payment verification route (routes/payments.js) so both paths
// reserve seats, generate QR tickets and send confirmation email/sockets in
// exactly the same way.
async function completeRegistration(event, user, io) {
    const already = await Registration.findOne({ eventId: event._id, userId: user.id });
    if (already) {
        const err = new Error("Already registered for this event");
        err.statusCode = 409;
        throw err;
    }

    // Atomic seat reservation — see routes/registrations.js for why this
    // needs to be a single $inc rather than a count-then-create.
    const reserved = await Event.findOneAndUpdate(
        { _id: event._id, $expr: { $lt: ["$seatsBooked", "$maxSeats"] } },
        { $inc: { seatsBooked: 1 } },
        { new: true }
    );
    if (!reserved) {
        const err = new Error("Event is fully booked");
        err.statusCode = 400;
        throw err;
    }

    let registration;
    try {
        registration = await Registration.create({
            eventId: event._id,
            eventTitle: event.title,
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            userPhone: user.phone,
            qrToken: "pending",
            qrCode: "pending",
            checkinCode: generateCheckinCode()
        });
    } catch (err) {
        await Event.findByIdAndUpdate(event._id, { $inc: { seatsBooked: -1 } });
        if (err.code === 11000) {
            const dup = new Error("Already registered for this event");
            dup.statusCode = 409;
            throw dup;
        }
        throw err;
    }

    const qrToken = jwt.sign(
        { registrationId: registration._id.toString(), eventId: event._id.toString() },
        process.env.QR_SECRET,
        { expiresIn: "90d" }
    );
    const qrCode = await QRCode.toDataURL(qrToken, { errorCorrectionLevel: "H", width: 320 });

    registration.qrToken = qrToken;
    registration.qrCode = qrCode;
    await registration.save();

    await addNotification(user.id, "Registration Confirmed", `You are registered for "${event.title}".`);

    sendEmail(
        user.email,
        `Ticket Confirmation: ${event.title}`,
        `Hello ${user.name},\n\nYour spot for "${event.title}" is confirmed!\nDate: ${event.date}\nVenue: ${event.venue}\nTicket ID: ${registration._id}\n\nCheck-in code: ${registration.checkinCode}\nShow your QR ticket at the door. If the QR scanner isn't working, give the organizer this 6-digit check-in code instead.`,
        `<div style="font-family:sans-serif;padding:20px;background:#f4f4f4;">
            <h2>You're registered for ${event.title}!</h2>
            <p>Hello ${user.name},</p>
            <p><b>Date:</b> ${event.date}<br><b>Venue:</b> ${event.venue}</p>
            <p>Show your QR ticket at the door. If the scanner isn't working, give the organizer this code instead:</p>
            <h1 style="color:#d4a73d;letter-spacing:4px;">${registration.checkinCode}</h1>
         </div>`
    ).catch(() => {});

    if (io) {
        const count = await Registration.countDocuments({ eventId: event._id });
        io.emit("seat_update", {
            eventId: event._id,
            seatsLeft: event.maxSeats - count
        });
    }

    return registration;
}

module.exports = { completeRegistration };

'@

$registrationsJs = @'
const express = require("express");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const { auth, role } = require("../middleware/auth");
const { completeRegistration } = require("../utils/completeRegistration");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.post("/events/:eventId/register", auth, role("student"), asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    // Paid events must go through /api/payments/create-order +
    // /api/payments/verify so a registration can never be created without a
    // verified Razorpay payment. This route only ever handles free (fee: 0)
    // events.
    if (event.fee > 0) {
        return res.status(400).json({
            error: "This event requires payment. Use the payment flow to register.",
            fee: event.fee
        });
    }

    try {
        const registration = await completeRegistration(event, req.user, req.app.get("io"));
        res.json({ message: "Successfully registered", registration });
    } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        throw err;
    }
}));

router.get("/my-registrations", auth, role("student"), asyncHandler(async (req, res) => {
    const registrations = await Registration.find({ userId: req.user.id }).lean();
    const withEvents = await Promise.all(registrations.map(async (r) => ({
        ...r,
        event: await Event.findById(r.eventId).lean()
    })));
    res.json(withEvents);
}));

module.exports = router;

'@

$paymentsJs = @'
const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Payment = require("../models/Payment");
const { auth, role } = require("../middleware/auth");
const { completeRegistration } = require("../utils/completeRegistration");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

function getRazorpayInstance() {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        const err = new Error("Payment gateway is not configured. Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.");
        err.statusCode = 500;
        throw err;
    }
    return new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
}

// Step 1: student asks to pay for a paid event. We create a Razorpay order
// (no money moves yet) and hand the order id + public key back to the
// frontend, which opens the Razorpay Checkout popup.
router.post("/create-order", auth, role("student"), asyncHandler(async (req, res) => {
    const { eventId } = req.body;
    if (!eventId) return res.status(400).json({ error: "eventId is required" });

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (!event.fee || event.fee <= 0) {
        return res.status(400).json({ error: "This event is free — register directly instead of paying." });
    }

    const already = await Registration.findOne({ eventId: event._id, userId: req.user.id });
    if (already) return res.status(409).json({ error: "Already registered for this event" });

    const seatsTaken = await Registration.countDocuments({ eventId: event._id });
    if (seatsTaken >= event.maxSeats) {
        return res.status(400).json({ error: "Event is fully booked" });
    }

    const razorpay = getRazorpayInstance();

    // Amount is in paise (smallest unit) and must be an integer.
    const amountPaise = Math.round(event.fee * 100);

    const order = await razorpay.orders.create({
        amount: amountPaise,
        currency: "INR",
        receipt: `evt_${event._id}_${req.user.id}`.slice(0, 40),
        notes: { eventId: String(event._id), userId: String(req.user.id) }
    });

    await Payment.create({
        eventId: event._id,
        userId: req.user.id,
        razorpayOrderId: order.id,
        amount: amountPaise,
        currency: "INR",
        status: "created"
    });

    res.json({
        orderId: order.id,
        amount: amountPaise,
        currency: "INR",
        keyId: process.env.RAZORPAY_KEY_ID,
        eventTitle: event.title
    });
}));

// Step 2: after Razorpay Checkout completes, the frontend sends us back the
// order id, payment id and signature. We verify the signature ourselves
// (never trust the client) before creating the actual registration.
router.post("/verify", auth, role("student"), asyncHandler(async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: "Missing payment verification fields" });
    }

    const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id, userId: req.user.id });
    if (!payment) return res.status(404).json({ error: "Payment order not found" });
    if (payment.status === "paid") {
        return res.status(409).json({ error: "This payment has already been processed" });
    }

    const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

    if (expectedSignature !== razorpay_signature) {
        payment.status = "failed";
        await payment.save();
        return res.status(400).json({ error: "Payment verification failed. If money was deducted, contact support with your order id." });
    }

    const event = await Event.findById(payment.eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    try {
        const registration = await completeRegistration(event, req.user, req.app.get("io"));
        payment.status = "paid";
        payment.razorpayPaymentId = razorpay_payment_id;
        payment.razorpaySignature = razorpay_signature;
        payment.registrationId = registration._id;
        await payment.save();

        res.json({ message: "Payment verified and registration confirmed", registration });
    } catch (err) {
        // Payment succeeded on Razorpay's side but we couldn't seat them
        // (e.g. event filled up in the meantime) — record it so support can
        // find and refund it, and tell the student clearly.
        payment.status = "failed";
        await payment.save();
        if (err.statusCode) return res.status(err.statusCode).json({ error: `Payment received but registration failed: ${err.message}. Contact support with order id ${razorpay_order_id} for a refund.` });
        throw err;
    }
}));

module.exports = router;

'@

$eventsJs = @'
const express = require("express");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Review = require("../models/Review");
const { auth, role } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function csvEscape(value) {
    const str = String(value ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
    const { search, category, department } = req.query;
    const filter = {};

    if (search) {
        const escapedSearch = escapeRegExp(search);
        const q = new RegExp(escapedSearch, "i");
        filter.$or = [{ title: q }, { description: q }, { venue: q }];
    }
    if (category) {
        filter.category = new RegExp(`^${escapeRegExp(category)}$`, "i");
    }
    if (department) {
        filter.department = new RegExp(`^${escapeRegExp(department)}$`, "i");
    }

    // Pagination is opt-in via ?page=&limit= so the existing frontend,
    // which expects a plain array, keeps working unchanged.
    const page = Math.max(parseInt(req.query.page, 10) || 0, 0);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 100);

    let query = Event.find(filter).sort({ date: 1 });
    let total = null;
    if (page && limit) {
        total = await Event.countDocuments(filter);
        query = query.skip((page - 1) * limit).limit(limit);
    }
    const events = await query.lean();

    const enriched = await Promise.all(events.map(async (event) => {
        const registered = await Registration.countDocuments({ eventId: event._id });
        const reviews = await Review.find({ eventId: event._id }).lean();
        const avgRating = reviews.length
            ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
            : null;

        return {
            ...event,
            id: event._id,
            registered,
            seatsLeft: event.maxSeats - registered,
            avgRating,
            reviewCount: reviews.length
        };
    }));

    if (total !== null) {
        return res.json({ events: enriched, page, limit, total, totalPages: Math.ceil(total / limit) });
    }
    res.json(enriched);
}));

router.get("/:id", asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.id).lean();
    if (!event) return res.status(404).json({ error: "Event not found" });

    const registered = await Registration.countDocuments({ eventId: event._id });
    const reviews = await Review.find({ eventId: event._id }).lean();

    res.json({ ...event, id: event._id, registered, seatsLeft: event.maxSeats - registered, reviews });
}));

router.get("/:id/registrations", auth, role("admin", "organizer"), asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (req.user.role !== "admin" && String(event.organizerId) !== req.user.id) {
        return res.status(403).json({ error: "Permission denied" });
    }

    const regs = await Registration.find({ eventId: req.params.id }).lean();
    res.json(regs);
}));

router.get("/:id/registrations/export", auth, role("admin", "organizer"), asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (req.user.role !== "admin" && String(event.organizerId) !== req.user.id) {
        return res.status(403).json({ error: "Permission denied" });
    }

    const regs = await Registration.find({ eventId: req.params.id }).sort({ createdAt: 1 }).lean();

    const header = ["Name", "Email", "Phone", "Status", "Registered At", "Checked In At"];
    const rows = regs.map(r => [
        r.userName, r.userEmail, r.userPhone,
        r.attended ? "Checked in" : "Registered",
        new Date(r.createdAt).toISOString(),
        r.attendedAt ? new Date(r.attendedAt).toISOString() : ""
    ]);
    const csv = [header, ...rows].map(row => row.map(csvEscape).join(",")).join("\r\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="attendees-${event._id}.csv"`);
    res.send(csv);
}));

router.post("/", auth, role("admin", "organizer"), asyncHandler(async (req, res) => {
    const { title, description, category, date, time, venue, department, maxSeats, fee } = req.body;

    if (!title || !description || !category || !date || !time || !venue) {
        return res.status(400).json({ error: "Please fill all required fields" });
    }

    const parsedFee = Number(fee) || 0;
    if (parsedFee < 0) {
        return res.status(400).json({ error: "Fee cannot be negative" });
    }

    const event = await Event.create({
        title, description, category, date, time, venue,
        department: department || "All Departments",
        maxSeats: Number(maxSeats) || 50,
        fee: parsedFee,
        organizerId: req.user.id,
        organizerName: req.user.name,
        status: "upcoming"
    });

    req.app.get("io").emit("broadcast_announcement", {
        title: "New Event Published!",
        message: `Check out "${event.title}" on ${event.date} at ${event.venue}.`
    });

    res.status(201).json({ message: "Event created successfully", event });
}));

router.put("/:id", auth, role("admin", "organizer"), async (req, res) => {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (req.user.role !== "admin" && String(event.organizerId) !== String(req.user.id)) {
        return res.status(403).json({ error: "Permission denied" });
    }

    const allowed = ["title", "description", "category", "date", "time", "venue", "department", "maxSeats", "fee", "status"];
    const numericFields = ["maxSeats", "fee"];
    for (const key of allowed) {
        if (req.body[key] !== undefined) event[key] = numericFields.includes(key) ? Number(req.body[key]) : req.body[key];
    }

    if (!event.title || !event.description || !event.category || !event.date || !event.time || !event.venue) {
        return res.status(400).json({ error: "Please fill all required fields" });
    }
    if (!Number.isFinite(event.maxSeats) || event.maxSeats < 1) {
        return res.status(400).json({ error: "Max seats must be at least 1" });
    }
    if (!Number.isFinite(event.fee) || event.fee < 0) {
        return res.status(400).json({ error: "Fee cannot be negative" });
    }

    const registered = await Registration.countDocuments({ eventId: event._id });
    if (event.maxSeats < registered) {
        return res.status(400).json({ error: `Max seats cannot be below current registrations (${registered})` });
    }

    await event.save();
    res.json({ message: "Event updated successfully", event });
});

router.delete("/:id", auth, role("admin", "organizer"), asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (req.user.role !== "admin" && String(event.organizerId) !== req.user.id) {
        return res.status(403).json({ error: "Permission denied" });
    }

    const { addNotification } = require("../utils/notify");
    const { sendEmail } = require("../utils/email");

    const regs = await Registration.find({ eventId: event._id });
    for (const r of regs) {
        await addNotification(r.userId, "Event Cancelled", `The event "${event.title}" has been cancelled.`);
        sendEmail(r.userEmail, "Event Cancellation Notice", `The event "${event.title}" on ${event.date} has been cancelled.`).catch(() => {});
    }

    await Registration.deleteMany({ eventId: event._id });
    await event.deleteOne();

    res.json({ message: "Event deleted and attendees notified" });
}));

module.exports = router;

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

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_gmail_app_password
SMTP_FROM="College Event Portal <your_email@gmail.com>"

# Comma-separated list of allowed frontend origins in production.
# Leave unset in local development.
CORS_ORIGIN=

# Razorpay dashboard -> Settings -> API Keys. Use the Test Mode keys while
# developing; switch to Live Mode keys only once you're ready to accept real
# payments.
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

'@

$packageJson = @'
{
    "name": "college-event-portal",
    "version": "2.0.0",
    "description": "College Event Portal",
    "main": "server.js",
    "scripts": {
        "start": "node server.js",
        "dev": "nodemon server.js",
        "test": "jest --runInBand"
    },
    "dependencies": {
        "bcryptjs": "^2.4.3",
        "cors": "^2.8.5",
        "dotenv": "^16.4.5",
        "express": "^4.19.2",
        "express-rate-limit": "^7.4.0",
        "helmet": "^7.1.0",
        "jsonwebtoken": "^9.0.2",
        "mongoose": "^8.5.0",
        "node-cron": "^3.0.3",
        "nodemailer": "^6.9.14",
        "pdfkit": "^0.15.0",
        "qrcode": "^1.5.3",
        "razorpay": "^2.9.8",
        "socket.io": "^4.7.5"
    },
    "devDependencies": {
        "jest": "^29.7.0",
        "nodemon": "^3.1.4",
        "supertest": "^7.0.0"
    },
    "directories": {
        "test": "tests"
    },
    "repository": {
        "type": "git",
        "url": "git+https://github.com/jeeva311204-jpg/Event-portal.git"
    },
    "keywords": [],
    "author": "",
    "license": "ISC",
    "type": "commonjs",
    "bugs": {
        "url": "https://github.com/jeeva311204-jpg/Event-portal/issues"
    },
    "homepage": "https://github.com/jeeva311204-jpg/Event-portal#readme"
}

'@


Write-Utf8NoBom "models\Event.js" $eventJs
Write-Utf8NoBom "models\Payment.js" $paymentJs
Write-Utf8NoBom "utils\completeRegistration.js" $completeRegJs
Write-Utf8NoBom "routes\registrations.js" $registrationsJs
Write-Utf8NoBom "routes\payments.js" $paymentsJs
Write-Utf8NoBom "routes\events.js" $eventsJs
Write-Utf8NoBom "server.js" $serverJs
Write-Utf8NoBom ".env.example" $envExample
Write-Utf8NoBom "package.json" $packageJson
Write-Host "Wrote backend files." -ForegroundColor Green

# Add the Razorpay keys to your REAL .env too (not just .env.example),
# without touching any of your existing secrets in there.
$envPath = ".\.env"
if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw
    if ($envContent -notmatch "RAZORPAY_KEY_ID") {
        Add-Content -Path $envPath -Value "`r`n# Razorpay dashboard -> Settings -> API Keys (use Test Mode keys first)`r`nRAZORPAY_KEY_ID=rzp_test_your_key_id`r`nRAZORPAY_KEY_SECRET=your_razorpay_key_secret"
        Write-Host "Added RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET placeholders to .env" -ForegroundColor Yellow
        Write-Host "  -> EDIT .env NOW and put your real Razorpay TEST keys in." -ForegroundColor Yellow
    } else {
        Write-Host ".env already has RAZORPAY_KEY_ID, leaving it untouched." -ForegroundColor Yellow
    }
} else {
    Write-Host "No .env file found — copy .env.example to .env and fill in all values, including Razorpay keys." -ForegroundColor Yellow
}

Write-Host "Installing the razorpay npm package..." -ForegroundColor Cyan
npm install razorpay

Write-Host ""
Write-Host "Part 1 (backend) complete." -ForegroundColor Green
Write-Host "Next: run .\add_payment_part2.ps1 for the frontend changes." -ForegroundColor Green
