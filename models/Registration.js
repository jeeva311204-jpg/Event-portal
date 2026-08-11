const mongoose = require("mongoose");

const registrationSchema = new mongoose.Schema({
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    eventTitle: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, required: true },
    userEmail: { type: String, required: true },
    userPhone: { type: String, required: true },
    qrToken: { type: String, required: true, unique: true },
    qrCode: { type: String, required: true },
    attended: { type: Boolean, default: false },
    attendedAt: { type: Date }
}, { timestamps: true });

registrationSchema.index({ eventId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("Registration", registrationSchema);
