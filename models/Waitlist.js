const mongoose = require("mongoose");

const waitlistSchema = new mongoose.Schema({
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    eventTitle: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, required: true },
    userEmail: { type: String, required: true },
    userPhone: { type: String, required: true }
}, { timestamps: true });

// One waitlist entry per user per event, and createdAt order determines
// queue position (first joined, first offered the seat).
waitlistSchema.index({ eventId: 1, userId: 1 }, { unique: true });
waitlistSchema.index({ eventId: 1, createdAt: 1 });

module.exports = mongoose.model("Waitlist", waitlistSchema);
