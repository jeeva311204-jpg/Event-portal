const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Otp = require("../models/Otp");
const { auth, issueToken } = require("../middleware/auth");
const { sendEmail } = require("../utils/email");
const { addNotification } = require("../utils/notify");
const { isRealEmail } = require("../utils/emailValidator");
const { authLimiter, otpLimiter } = require("../middleware/rateLimiter");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

const E164 = /^\+[1-9]\d{7,14}$/;

function publicUser(user) {
    return {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        department: user.department,
        phoneVerified: user.phoneVerified
    };
}

function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

router.post("/register", authLimiter, asyncHandler(async (req, res) => {
    const { name, email, phone, password, department } = req.body;
    const normalizedEmail = email?.toLowerCase().trim();
    const normalizedPhone = phone?.trim();

    if (!name || !normalizedEmail || !normalizedPhone || !password) {
        return res.status(400).json({ error: "Name, Email, Phone, and Password are required." });
    }

    if (!E164.test(normalizedPhone)) {
        return res.status(400).json({ error: "Phone number must be in international format, e.g. +919876543210" });
    }

    // Reject syntactically-valid emails whose domain can't receive mail at all
    // (typos, placeholder domains, etc.) before creating the account.
    if (!(await isRealEmail(normalizedEmail))) {
        return res.status(400).json({ error: "Please enter a valid, deliverable email address." });
    }

    const exists = await User.findOne({ $or: [{ email: normalizedEmail }, { phone: normalizedPhone }] });
    if (exists) {
        return res.status(409).json({ error: "An account with this email or phone already exists" });
    }

    const user = await User.create({
        name,
        email: normalizedEmail,
        phone: normalizedPhone,
        password: await bcrypt.hash(password, 10),
        role: "student",
        department: department || "General"
    });

    await addNotification(user._id, "Welcome!", "Welcome to College Event Portal. Browse and register for events now!");

    sendEmail(user.email, "Welcome to College Event Portal", `Hello ${user.name},\n\nYour account has been created successfully.`)
        .catch(() => {});

    res.json({ message: "Registration successful", token: issueToken(user), user: publicUser(user) });
}));

router.post("/login", authLimiter, asyncHandler(async (req, res) => {
    const email = req.body.email?.toLowerCase().trim();
    const { password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: "Invalid email or password" });
    }

    const otpCode = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await Otp.deleteMany({ userId: user._id, purpose: "login" });
    await Otp.create({ userId: user._id, code: otpCode, channel: "email", purpose: "login", expiresAt });

    try {
        await sendEmail(
            user.email,
            "Your 2-Step Verification Code",
            `Your OTP for login is: ${otpCode}. It expires in 5 minutes.`,
            `<div style="font-family:sans-serif;padding:20px;background:#f4f4f4;">
                <h2>2-Step Verification Required</h2>
                <p>Hello ${user.name}, use the code below to complete your login:</p>
                <h1 style="color:#d4a73d;letter-spacing:4px;">${otpCode}</h1>
                <p>This code is valid for 5 minutes.</p>
             </div>`
        );

        res.json({
            twoFactorRequired: true,
            channel: "email",
            userId: user._id,
            message: `A 6-digit verification code was emailed to ${user.email}`
        });
    } catch (emailErr) {
        console.error("[2FA] Email send failed:", emailErr.message);
        res.status(502).json({ error: "Could not send verification code by email. Please try again later." });
    }
}));

router.post("/verify-otp", otpLimiter, asyncHandler(async (req, res) => {
    const { userId, otpCode } = req.body;

    const record = await Otp.findOne({ userId, code: otpCode, purpose: "login" });
    if (!record) {
        await Otp.updateMany({ userId, purpose: "login" }, { $inc: { attempts: 1 } });
        return res.status(400).json({ error: "Invalid OTP code" });
    }

    if (record.expiresAt < new Date()) {
        await Otp.deleteOne({ _id: record._id });
        return res.status(400).json({ error: "OTP code has expired. Please login again." });
    }

    await Otp.deleteMany({ userId, purpose: "login" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ message: "2FA verification successful", token: issueToken(user), user: publicUser(user) });
}));

router.post("/resend-otp", otpLimiter, asyncHandler(async (req, res) => {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const otpCode = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await Otp.deleteMany({ userId: user._id, purpose: "login" });
    await Otp.create({ userId: user._id, code: otpCode, channel: "email", purpose: "login", expiresAt });

    try {
        await sendEmail(
            user.email,
            "Your 2-Step Verification Code",
            `Your OTP for login is: ${otpCode}. It expires in 5 minutes.`
        );
        res.json({ message: `Code resent to ${user.email}` });
    } catch (err) {
        res.status(502).json({ error: "Could not resend the email. Please wait a moment and try again." });
    }
}));

// ---- Forgot / reset password (reuses the Otp model with purpose:"reset") ----

router.post("/forgot-password", authLimiter, asyncHandler(async (req, res) => {
    const email = req.body.email?.toLowerCase().trim();
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "No account found with this email" });

    const otpCode = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await Otp.deleteMany({ userId: user._id, purpose: "reset" });
    await Otp.create({ userId: user._id, code: otpCode, channel: "email", purpose: "reset", expiresAt });

    try {
        await sendEmail(
            user.email,
            "Your Password Reset Code",
            `Your password reset code is: ${otpCode}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
            `<div style="font-family:sans-serif;padding:20px;background:#f4f4f4;">
                <h2>Password Reset Requested</h2>
                <p>Hello ${user.name}, use the code below to reset your password:</p>
                <h1 style="color:#d4a73d;letter-spacing:4px;">${otpCode}</h1>
                <p>This code is valid for 10 minutes. If you didn't request this, you can ignore this email.</p>
             </div>`
        );
        res.json({ userId: user._id, message: `A password reset code was emailed to ${user.email}` });
    } catch (err) {
        console.error("[Reset] Email send failed:", err.message);
        res.status(502).json({ error: "Could not send the reset code by email. Please try again later." });
    }
}));

router.post("/reset-password", otpLimiter, asyncHandler(async (req, res) => {
    const { userId, otpCode, newPassword } = req.body;
    if (!userId || !otpCode || !newPassword) {
        return res.status(400).json({ error: "userId, otpCode and newPassword are required" });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ error: "New password must be at least 6 characters" });
    }

    const record = await Otp.findOne({ userId, code: otpCode, purpose: "reset" });
    if (!record) {
        await Otp.updateMany({ userId, purpose: "reset" }, { $inc: { attempts: 1 } });
        return res.status(400).json({ error: "Invalid reset code" });
    }
    if (record.expiresAt < new Date()) {
        await Otp.deleteOne({ _id: record._id });
        return res.status(400).json({ error: "Reset code has expired. Please request a new one." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    await Otp.deleteMany({ userId, purpose: "reset" });

    sendEmail(user.email, "Your password was changed", `Hello ${user.name},\n\nYour password was just reset. If this wasn't you, contact support immediately.`).catch(() => {});

    res.json({ message: "Password reset successfully. Please login with your new password." });
}));

router.get("/me", auth, asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: publicUser(user) });
}));

router.patch("/me", auth, asyncHandler(async (req, res) => {
    const { name, phone, department, currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (phone && phone !== user.phone) {
        if (!E164.test(phone)) return res.status(400).json({ error: "Phone must use international format, e.g. +919876543210" });
        const exists = await User.findOne({ phone, _id: { $ne: user._id } });
        if (exists) return res.status(409).json({ error: "Phone number already in use" });
        user.phone = phone;
    }
    if (name) user.name = name.trim();
    if (department) user.department = department.trim();

    if (newPassword) {
        if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
            return res.status(400).json({ error: "Current password is incorrect" });
        }
        if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
        user.password = await bcrypt.hash(newPassword, 10);
    }

    await user.save();
    res.json({ message: "Profile updated", token: issueToken(user), user: publicUser(user) });
}));

module.exports = router;
