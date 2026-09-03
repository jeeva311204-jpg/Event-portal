const express = require("express");
const jwt = require("jsonwebtoken");
const Registration = require("../models/Registration");
const Event = require("../models/Event");
const { auth, role } = require("../middleware/auth");
const { addNotification } = require("../utils/notify");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.post("/", auth, role("admin", "organizer"), asyncHandler(async (req, res) => {
    const { qrPayload, checkinCode } = req.body;
    if (!qrPayload && !checkinCode) return res.status(400).json({ error: "QR payload or check-in code required" });

    let registration;

    if (checkinCode) {
        // Manual fallback for when the camera/QR scan isn't working: the
        // student reads out their 6-digit check-in code (emailed at
        // registration) and the organizer types it in here instead.
        const code = String(checkinCode).trim();
        if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Check-in code must be 6 digits" });
        registration = await Registration.findOne({ checkinCode: code });
        if (!registration) return res.status(404).json({ error: "No registration found with that check-in code" });
    } else {
        let decoded;
        try {
            decoded = jwt.verify(qrPayload, process.env.QR_SECRET);
        } catch (err) {
            return res.status(400).json({ error: "This QR code is invalid, forged, or expired." });
        }

        registration = await Registration.findById(decoded.registrationId);
        if (!registration || registration.qrToken !== qrPayload) {
            return res.status(404).json({ error: "Ticket not found" });
        }
    }

    const event = await Event.findById(registration.eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (req.user.role !== "admin" && String(event.organizerId) !== req.user.id) {
        return res.status(403).json({ error: "This ticket belongs to an event you don't organize" });
    }

    if (registration.attended) {
        return res.json({
            message: "Already checked in",
            name: registration.userName,
            eventTitle: event.title,
            alreadyCheckedIn: true,
            attendedAt: registration.attendedAt
        });
    }

    registration.attended = true;
    registration.attendedAt = new Date();
    await registration.save();

    await addNotification(
        registration.userId,
        "Attendance Verified",
        `Your attendance for "${event.title}" has been confirmed! Certificate unlocked.`
    );

    req.app.get("io").emit("checkin_broadcast", {
        userName: registration.userName,
        eventId: event._id,
        eventTitle: event.title,
        registrationId: registration._id,
        attendedAt: registration.attendedAt
    });

    res.json({
        message: "Attendance marked successfully",
        name: registration.userName,
        eventTitle: event.title,
        alreadyCheckedIn: false
    });
}));

module.exports = router;
