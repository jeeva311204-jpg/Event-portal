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

function generateCheckinCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

router.post("/events/:eventId/register", auth, role("student"), asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const already = await Registration.findOne({ eventId: event._id, userId: req.user.id });
    if (already) return res.status(409).json({ error: "Already registered for this event" });

    // Atomically reserve a seat before creating the registration record.
    // Using countDocuments + a separate create() left a window where two
    // concurrent requests could both pass the "seats available" check and
    // both register, overselling the event. This $inc is atomic at the
    // database level regardless of concurrency.
    const reserved = await Event.findOneAndUpdate(
        { _id: event._id, $expr: { $lt: ["$seatsBooked", "$maxSeats"] } },
        { $inc: { seatsBooked: 1 } },
        { new: true }
    );
    if (!reserved) return res.status(400).json({ error: "Event is fully booked" });

    let registration;
    try {
        registration = await Registration.create({
            eventId: event._id,
            eventTitle: event.title,
            userId: req.user.id,
            userName: req.user.name,
            userEmail: req.user.email,
            userPhone: req.user.phone,
            qrToken: "pending",
            qrCode: "pending",
            checkinCode: generateCheckinCode()
        });
    } catch (err) {
        // Roll back the seat reservation if the registration record couldn't
        // be created (e.g. a duplicate slipped in under a race, or a
        // validation error).
        await Event.findByIdAndUpdate(event._id, { $inc: { seatsBooked: -1 } });
        if (err.code === 11000) return res.status(409).json({ error: "Already registered for this event" });
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

    await addNotification(req.user.id, "Registration Confirmed", `You are registered for "${event.title}".`);

    sendEmail(
        req.user.email,
        `Ticket Confirmation: ${event.title}`,
        `Hello ${req.user.name},\n\nYour spot for "${event.title}" is confirmed!\nDate: ${event.date}\nVenue: ${event.venue}\nTicket ID: ${registration._id}\n\nCheck-in code: ${registration.checkinCode}\nShow your QR ticket at the door. If the QR scanner isn't working, give the organizer this 6-digit check-in code instead.`,
        `<div style="font-family:sans-serif;padding:20px;background:#f4f4f4;">
            <h2>You're registered for ${event.title}!</h2>
            <p>Hello ${req.user.name},</p>
            <p><b>Date:</b> ${event.date}<br><b>Venue:</b> ${event.venue}</p>
            <p>Show your QR ticket at the door. If the scanner isn't working, give the organizer this code instead:</p>
            <h1 style="color:#d4a73d;letter-spacing:4px;">${registration.checkinCode}</h1>
         </div>`
    ).catch(() => {});

    const count = await Registration.countDocuments({ eventId: event._id });
    req.app.get("io").emit("seat_update", {
        eventId: event._id,
        seatsLeft: event.maxSeats - count
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
