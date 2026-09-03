const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const { auth, role } = require("../middleware/auth");

const router = express.Router();

router.use(auth, role("admin"));

router.get("/stats", async (req, res) => {
    const [users, students, organizers, admins, events, registrations, attended] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: "student" }),
        User.countDocuments({ role: "organizer" }),
        User.countDocuments({ role: "admin" }),
        Event.countDocuments(),
        Registration.countDocuments(),
        Registration.countDocuments({ attended: true })
    ]);
    res.json({ users, students, organizers, admins, events, registrations, attended });
});

router.get("/users", async (req, res) => {
    const users = await User.find({}, "-password").sort({ createdAt: -1 }).lean();
    res.json(users);
});

router.patch("/users/:id/role", async (req, res) => {
    const { role: newRole } = req.body;
    if (!["student", "organizer", "admin"].includes(newRole)) {
        return res.status(400).json({ error: "Invalid role" });
    }
    if (String(req.user.id) === String(req.params.id) && newRole !== "admin") {
        return res.status(400).json({ error: "You cannot remove your own admin role." });
    }
    const user = await User.findByIdAndUpdate(
        req.params.id,
        { role: newRole },
        { new: true, runValidators: true }
    ).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ message: "User role updated", user });
});

router.delete("/users/:id", async (req, res) => {
    if (String(req.user.id) === String(req.params.id)) {
        return res.status(400).json({ error: "You cannot delete your own account." });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Release seats this user was holding on events they don't own, so
    // seatsBooked (the atomic registration gate in routes/registrations.js)
    // stays accurate after their registrations are removed below. Each
    // freed seat is then offered to the next person on that event's
    // waitlist, if there is one.
    const { promoteFromWaitlist } = require("./waitlist");
    const theirRegs = await Registration.find({ userId: user._id }).select("eventId");
    for (const reg of theirRegs) {
        await Event.findByIdAndUpdate(reg.eventId, { $inc: { seatsBooked: -1 } });
        await promoteFromWaitlist(req.app.get("io"), reg.eventId).catch(() => {});
    }

    const ownedEvents = await Event.find({ organizerId: user._id }).select("_id");
    const eventIds = ownedEvents.map(e => e._id);
    if (eventIds.length) await Registration.deleteMany({ eventId: { $in: eventIds } });
    await Event.deleteMany({ organizerId: user._id });
    await Registration.deleteMany({ userId: user._id });
    await user.deleteOne();
    res.json({ message: "User and owned events deleted" });
});

router.post("/users", async (req, res) => {
    const { name, email, phone, password, department, role: newRole } = req.body;
    if (!name || !email || !phone || !password || !newRole) {
        return res.status(400).json({ error: "Name, email, phone, password and role are required." });
    }
    if (!["student", "organizer", "admin"].includes(newRole)) {
        return res.status(400).json({ error: "Invalid role" });
    }
    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { phone }] });
    if (exists) return res.status(409).json({ error: "Email or phone already exists" });

    const user = await User.create({
        name, email: email.toLowerCase(), phone,
        password: await bcrypt.hash(password, 10),
        role: newRole, department: department || "General",
        phoneVerified: true
    });
    const safe = user.toObject();
    delete safe.password;
    res.status(201).json({ message: "User created", user: safe });
});

module.exports = router;
