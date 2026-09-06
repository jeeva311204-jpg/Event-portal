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
        console.warn("WARNING: Using development fallback secrets. Set JWT_SECRET and QR_SECRET in .env for production.");
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

const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map(o => o.trim()).filter(Boolean);
const corsOrigin = allowedOrigins.length ? allowedOrigins : (process.env.NODE_ENV === "production" ? [] : "*");

const io = new Server(server, { cors: { origin: corsOrigin } });

app.set("io", io);
setIo(io);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
});

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

if (require.main === module) {
    connectDB()
        .then(seed)
        .then(() => {
            server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
            startReminderScheduler();
        });

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