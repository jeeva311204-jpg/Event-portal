const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    code: { type: String, required: true },
    channel: { type: String, enum: ["sms", "email"], default: "email" },
    purpose: { type: String, enum: ["login", "reset"], default: "login" },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Otp", otpSchema);
