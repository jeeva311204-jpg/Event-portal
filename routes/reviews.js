const express = require("express");
const Registration = require("../models/Registration");
const Review = require("../models/Review");
const { auth, role } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.post("/:eventId/review", auth, role("student"), asyncHandler(async (req, res) => {
    const { rating, comment } = req.body;

    const reg = await Registration.findOne({ eventId: req.params.eventId, userId: req.user.id, attended: true });
    if (!reg) return res.status(403).json({ error: "Only verified attendees can submit reviews." });

    const existing = await Review.findOne({ eventId: req.params.eventId, userId: req.user.id });
    if (existing) return res.status(409).json({ error: "You have already reviewed this event." });

    const review = await Review.create({
        eventId: req.params.eventId,
        userId: req.user.id,
        userName: req.user.name,
        rating: Number(rating) || 5,
        comment: comment || ""
    });

    res.json({ message: "Review submitted successfully!", review });
}));

module.exports = router;
