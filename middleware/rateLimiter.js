const rateLimit = require("express-rate-limit");

// Applies to register / login / forgot-password: fairly generous since
// legitimate users can retype a wrong password a few times.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again in a few minutes." }
});

// Applies to verify-otp / resend-otp / reset-password: tighter, since these
// guard a 6-digit code that's brute-forceable in isolation.
const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many OTP attempts. Please wait before trying again." }
});

module.exports = { authLimiter, otpLimiter };
