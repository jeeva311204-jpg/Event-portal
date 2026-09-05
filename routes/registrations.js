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