const express = require("express");
const Notification = require("../models/Notification");
const { auth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.get("/", auth, asyncHandler(async (req, res) => {
    const notifs = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json(notifs);
}));

router.post("/mark-read", auth, asyncHandler(async (req, res) => {
    await Notification.updateMany({ userId: req.user.id }, { $set: { read: true } });
    res.json({ message: "Marked all as read" });
}));

module.exports = router;
