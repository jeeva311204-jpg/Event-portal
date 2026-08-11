<<<<<<< HEAD
﻿const express = require("express");
=======
const express = require("express");
>>>>>>> 83ad66c (Initial commit)
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Review = require("../models/Review");
const { auth, role } = require("../middleware/auth");

const router = express.Router();

router.get("/", async (req, res) => {
    const { search, category, department } = req.query;
    const filter = {};

    if (search) {
        const q = new RegExp(search, "i");
        filter.$or = [{ title: q }, { description: q }, { venue: q }];
    }
    if (category) filter.category = new RegExp(`^${category}$`, "i");
    if (department) filter.department = new RegExp(`^${department}$`, "i");

    const events = await Event.find(filter).sort({ date: 1 }).lean();

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

    res.json(enriched);
});

router.get("/:id", async (req, res) => {
    const event = await Event.findById(req.params.id).lean();
    if (!event) return res.status(404).json({ error: "Event not found" });

    const registered = await Registration.countDocuments({ eventId: event._id });
    const reviews = await Review.find({ eventId: event._id }).lean();

    res.json({ ...event, id: event._id, registered, seatsLeft: event.maxSeats - registered, reviews });
});

router.get("/:id/registrations", auth, role("admin", "organizer"), async (req, res) => {
    const regs = await Registration.find({ eventId: req.params.id }).lean();
    res.json(regs);
});

router.post("/", auth, role("admin", "organizer"), async (req, res) => {
    const { title, description, category, date, time, venue, department, maxSeats } = req.body;

    if (!title || !description || !category || !date || !time || !venue) {
        return res.status(400).json({ error: "Please fill all required fields" });
    }

    const event = await Event.create({
        title, description, category, date, time, venue,
        department: department || "All Departments",
        maxSeats: Number(maxSeats) || 50,
        organizerId: req.user.id,
        organizerName: req.user.name,
        status: "upcoming"
    });

    req.app.get("io").emit("broadcast_announcement", {
        title: "New Event Published!",
        message: `Check out "${event.title}" on ${event.date} at ${event.venue}.`
    });

    res.status(201).json({ message: "Event created successfully", event });
});

<<<<<<< HEAD
=======

router.put("/:id", auth, role("admin", "organizer"), async (req, res) => {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (req.user.role !== "admin" && String(event.organizerId) !== String(req.user.id)) {
        return res.status(403).json({ error: "Permission denied" });
    }

    const allowed = ["title", "description", "category", "date", "time", "venue", "department", "maxSeats", "status"];
    for (const key of allowed) {
        if (req.body[key] !== undefined) event[key] = key === "maxSeats" ? Number(req.body[key]) : req.body[key];
    }

    if (!event.title || !event.description || !event.category || !event.date || !event.time || !event.venue) {
        return res.status(400).json({ error: "Please fill all required fields" });
    }
    if (!Number.isFinite(event.maxSeats) || event.maxSeats < 1) {
        return res.status(400).json({ error: "Max seats must be at least 1" });
    }

    const registered = await Registration.countDocuments({ eventId: event._id });
    if (event.maxSeats < registered) {
        return res.status(400).json({ error: `Max seats cannot be below current registrations (${registered})` });
    }

    await event.save();
    res.json({ message: "Event updated successfully", event });
});

>>>>>>> 83ad66c (Initial commit)
router.delete("/:id", auth, role("admin", "organizer"), async (req, res) => {
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
});

module.exports = router;
