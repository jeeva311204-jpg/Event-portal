const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    venue: { type: String, required: true },
    department: { type: String, default: "All Departments" },
    maxSeats: { type: Number, default: 50 },
    seatsBooked: { type: Number, default: 0 },
    fee: { type: Number, default: 0, min: 0 },
    organizerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    organizerName: { type: String, required: true },
    status: { type: String, enum: ["upcoming", "ongoing", "completed", "cancelled"], default: "upcoming" }
}, { timestamps: true });

module.exports = mongoose.model("Event", eventSchema);