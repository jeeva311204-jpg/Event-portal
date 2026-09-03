const express = require("express");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Waitlist = require("../models/Waitlist");
const { auth, role } = require("../middleware/auth");
const { addNotification } = require("../utils/notify");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.post("/:eventId/waitlist", auth, role("student"), asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (event.seatsBooked < event.maxSeats) {
        return res.status(400).json({ error: "This event still has open seats â€” register directly instead of joining the waitlist." });
    }

    const alreadyRegistered = await Registration.findOne({ eventId: event._id, userId: req.user.id });
    if (alreadyRegistered) return res.status(409).json({ error: "You are already registered for this event" });

    try {
        await Waitlist.create({
            eventId: event._id,
            eventTitle: event.title,
            userId: req.user.id,
            userName: req.user.name,
            userEmail: req.user.email,
            userPhone: req.user.phone
        });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: "You are already on the waitlist for this event" });
        throw err;
    }

    const position = await Waitlist.countDocuments({ eventId: event._id });
    res.json({ message: `You're on the waitlist, position ${position}. We'll email you if a seat opens up.`, position });
}));

router.delete("/:eventId/waitlist", auth, role("student"), asyncHandler(async (req, res) => {
    const result = await Waitlist.findOneAndDelete({ eventId: req.params.eventId, userId: req.user.id });
    if (!result) return res.status(404).json({ error: "You are not on the waitlist for this event" });
    res.json({ message: "Removed from waitlist" });
}));

router.get("/:eventId/waitlist/me", auth, role("student"), asyncHandler(async (req, res) => {
    const entry = await Waitlist.findOne({ eventId: req.params.eventId, userId: req.user.id });
    if (!entry) return res.json({ onWaitlist: false });

    const position = await Waitlist.countDocuments({
        eventId: req.params.eventId,
        createdAt: { $lte: entry.createdAt }
    });
    res.json({ onWaitlist: true, position });
}));

// Called internally whenever a seat frees up on an event (e.g. an admin
// deletes a user who was registered). Promotes the longest-waiting person
// on the waitlist into a real registration, if anyone is waiting.
// Exported so other routes (admin.js) can trigger it without an HTTP round
// trip.
async function promoteFromWaitlist(io, eventId) {
    const event = await Event.findById(eventId);
    if (!event || event.seatsBooked >= event.maxSeats) return null;

    const next = await Waitlist.findOne({ eventId }).sort({ createdAt: 1 });
    if (!next) return null;

    const reserved = await Event.findOneAndUpdate(
        { _id: eventId, $expr: { $lt: ["$seatsBooked", "$maxSeats"] } },
        { $inc: { seatsBooked: 1 } },
        { new: true }
    );
    if (!reserved) return null;

    const jwt = require("jsonwebtoken");
    const QRCode = require("qrcode");
    const { sendEmail } = require("../utils/email");

    const checkinCode = Math.floor(100000 + Math.random() * 900000).toString();
    const qrToken = jwt.sign(
        { registrationId: new (require("mongoose").Types.ObjectId)().toString(), eventId: String(eventId) },
        process.env.QR_SECRET,
        { expiresIn: "90d" }
    );
    const qrCode = await QRCode.toDataURL(qrToken, { errorCorrectionLevel: "H", width: 320 });

    let registration;
    try {
        registration = await Registration.create({
            eventId, eventTitle: event.title,
            userId: next.userId, userName: next.userName, userEmail: next.userEmail, userPhone: next.userPhone,
            qrToken, qrCode, checkinCode
        });
    } catch (err) {
        await Event.findByIdAndUpdate(eventId, { $inc: { seatsBooked: -1 } });
        return null;
    }

    await Waitlist.deleteOne({ _id: next._id });
    await addNotification(next.userId, "A seat opened up!", `You've been moved from the waitlist into "${event.title}" â€” you're now registered.`);
    sendEmail(next.userEmail, `You're in: ${event.title}`, `Hello ${next.userName},\n\nA seat opened up and you've been automatically registered for "${event.title}".\nDate: ${event.date}\nVenue: ${event.venue}\n\nCheck-in code: ${checkinCode}`).catch(() => {});
    if (io) io.to(String(next.userId)).emit("realtime_notification", { title: "Seat available", message: `You're now registered for ${event.title}` });

    return registration;
}

module.exports = router;
module.exports.promoteFromWaitlist = promoteFromWaitlist;
