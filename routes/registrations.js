const express = require("express");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const { auth, role } = require("../middleware/auth");
const { addNotification } = require("../utils/notify");
const { sendEmail } = require("../utils/email");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.post("/events/:eventId/register", auth, role("student"), asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const already = await Registration.findOne({ eventId: event._id, userId: req.user.id });
    if (already) return res.status(409).json({ error: "Already registered for this event" });

    const count = await Registration.countDocuments({ eventId: event._id });
    if (count >= event.maxSeats) return res.status(400).json({ error: "Event is fully booked" });

    const registration = await Registration.create({
        eventId: event._id,
        eventTitle: event.title,
        userId: req.user.id,
        userName: req.user.name,
        userEmail: req.user.email,
        userPhone: req.user.phone,
        qrToken: "pending",
        qrCode: "pending"
    });

    const qrToken = jwt.sign(
        { registrationId: registration._id.toString(), eventId: event._id.toString() },
        process.env.QR_SECRET,
        { expiresIn: "90d" }
    );
    const qrCode = await QRCode.toDataURL(qrToken, { errorCorrectionLevel: "H", width: 320 });

    registration.qrToken = qrToken;
    registration.qrCode = qrCode;
    await registration.save();

    await addNotification(req.user.id, "Registration Confirmed", `You are registered for "${event.title}".`);

    sendEmail(
        req.user.email,
        `Ticket Confirmation: ${event.title}`,
        `Hello ${req.user.name},\n\nYour spot for "${event.title}" is confirmed!\nDate: ${event.date}\nVenue: ${event.venue}\nTicket ID: ${registration._id}`
    ).catch(() => {});

    req.app.get("io").emit("seat_update", {
        eventId: event._id,
        seatsLeft: event.maxSeats - (count + 1)
    });

    res.json({ message: "Successfully registered", registration });
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
