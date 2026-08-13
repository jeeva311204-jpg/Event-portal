<<<<<<< HEAD
﻿require("dotenv").config();
=======
require("dotenv").config();
>>>>>>> 83ad66c (Initial commit)

const missingSecrets = [];
if (!process.env.JWT_SECRET) missingSecrets.push("JWT_SECRET");
if (!process.env.QR_SECRET) missingSecrets.push("QR_SECRET");
if (missingSecrets.length) {
    console.warn(`[WARN] Missing environment variables: ${missingSecrets.join(", ")}. Using default development secrets.`);
    process.env.JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_this";
    process.env.QR_SECRET = process.env.QR_SECRET || "dev_qr_secret_change_this";
}

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const bcrypt = require("bcryptjs");

const connectDB = require("./config/db");
const { setIo } = require("./utils/notify");

const User = require("./models/User");
const Event = require("./models/Event");
const Registration = require("./models/Registration"); // Required to look up registrations

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.set("io", io);
setIo(io);

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Standard Routes
app.use("/api", require("./routes/auth"));
<<<<<<< HEAD
=======
app.use("/api/admin", require("./routes/admin"));
>>>>>>> 83ad66c (Initial commit)
app.use("/api/events", require("./routes/events"));
app.use("/api", require("./routes/registrations"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/events", require("./routes/reviews"));
app.use("/api/scan", require("./routes/scan"));
app.use("/api", require("./routes/certificate"));

// ==========================================
// NEW ROUTE: Fetch Attendees for an Event
// ==========================================
app.get("/api/events/:eventId/attendees", async (req, res) => {
    try {
        const { eventId } = req.params;

        // Find the event
        const event = await Event.findById(eventId);
        if (!event) {
            return res.status(404).json({ error: "Event not found" });
        }

        let attendees = [];

        // Check if Event model uses a embedded array (e.g., registeredUsers / attendees)
        if (event.registeredUsers && event.registeredUsers.length > 0) {
            const populatedEvent = await Event.findById(eventId).populate("registeredUsers", "name email phone department");
            attendees = populatedEvent.registeredUsers;
        } 
        // Fallback: Query the separate Registration model if registrations are stored in their own collection
        else if (Registration) {
            const registrations = await Registration.find({ eventId }).populate("userId", "name email phone department");
            attendees = registrations.map(reg => reg.userId || { name: reg.userName, email: reg.userEmail });
        }

        res.status(200).json({
            success: true,
            eventTitle: event.title,
            totalAttendees: attendees.length,
            attendees
        });
    } catch (error) {
        console.error("Error fetching attendees:", error);
        res.status(500).json({ error: "Failed to fetch event attendees" });
    }
});

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

connectDB()
    .then(seed)
    .then(() => {
        server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
    });