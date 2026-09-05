const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const PDFDocument = require("pdfkit");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Payment = require("../models/Payment");
const { auth, role } = require("../middleware/auth");
const { completeRegistration } = require("../utils/completeRegistration");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

function getRazorpayInstance() {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        const err = new Error("Payment gateway is not configured. Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.");
        err.statusCode = 500;
        throw err;
    }
    return new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
}

router.post("/create-order", auth, role("student"), asyncHandler(async (req, res) => {
    const { eventId } = req.body;
    if (!eventId) return res.status(400).json({ error: "eventId is required" });

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (!event.fee || event.fee <= 0) {
        return res.status(400).json({ error: "This event is free — register directly instead of paying." });
    }

    const already = await Registration.findOne({ eventId: event._id, userId: req.user.id });
    if (already) return res.status(409).json({ error: "Already registered for this event" });

    const seatsTaken = await Registration.countDocuments({ eventId: event._id });
    if (seatsTaken >= event.maxSeats) {
        return res.status(400).json({ error: "Event is fully booked" });
    }

    const razorpay = getRazorpayInstance();
    const amountPaise = Math.round(event.fee * 100);

    const order = await razorpay.orders.create({
        amount: amountPaise,
        currency: "INR",
        receipt: `evt_${event._id}_${req.user.id}`.slice(0, 40),
        notes: { eventId: String(event._id), userId: String(req.user.id) }
    });

    await Payment.create({
        eventId: event._id,
        userId: req.user.id,
        razorpayOrderId: order.id,
        amount: amountPaise,
        currency: "INR",
        status: "created"
    });

    res.json({
        orderId: order.id,
        amount: amountPaise,
        currency: "INR",
        keyId: process.env.RAZORPAY_KEY_ID,
        eventTitle: event.title
    });
}));

router.post("/verify", auth, role("student"), asyncHandler(async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: "Missing payment verification fields" });
    }

    const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id, userId: req.user.id });
    if (!payment) return res.status(404).json({ error: "Payment order not found" });
    if (payment.status === "paid") {
        return res.status(409).json({ error: "This payment has already been processed" });
    }

    const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

    if (expectedSignature !== razorpay_signature) {
        payment.status = "failed";
        await payment.save();
        return res.status(400).json({ error: "Payment verification failed. If money was deducted, contact support with your order id." });
    }

    const event = await Event.findById(payment.eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    try {
        const registration = await completeRegistration(event, req.user, req.app.get("io"), {
            amount: payment.amount,
            paymentId: razorpay_payment_id,
            orderId: razorpay_order_id
        });
        payment.status = "paid";
        payment.razorpayPaymentId = razorpay_payment_id;
        payment.razorpaySignature = razorpay_signature;
        payment.registrationId = registration._id;
        await payment.save();

        res.json({ message: "Payment verified and registration confirmed", registration });
    } catch (err) {
        payment.status = "failed";
        await payment.save();
        if (err.statusCode) return res.status(err.statusCode).json({ error: `Payment received but registration failed: ${err.message}. Contact support with order id ${razorpay_order_id} for a refund.` });
        throw err;
    }
}));

router.get("/receipt/:registrationId", auth, asyncHandler(async (req, res) => {
    const registration = await Registration.findById(req.params.registrationId);
    if (!registration) return res.status(404).json({ error: "Registration not found" });

    if (String(registration.userId) !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "Permission denied" });
    }

    const payment = await Payment.findOne({ registrationId: registration._id, status: "paid" });
    if (!payment) return res.status(404).json({ error: "No completed payment found for this registration" });

    const event = await Event.findById(registration.eventId);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=receipt-${registration._id}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).font("Helvetica-Bold").fillColor("#17233c").text("College Event Portal", { align: "center" });
    doc.fontSize(14).font("Helvetica").fillColor("#666").text("Payment Receipt", { align: "center" });
    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#d4a73d").lineWidth(2).stroke();
    doc.moveDown(1);

    function row(label, value) {
        const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#333").text(label, 50, y, { width: 160 });
        doc.font("Helvetica").fontSize(11).fillColor("#333").text(String(value), 220, y, { width: 325 });
        doc.moveDown(0.7);
    }

    row("Receipt No.", String(payment._id));
    row("Payment ID", payment.razorpayPaymentId || "-");
    row("Order ID", payment.razorpayOrderId);
    row("Paid On", new Date(payment.updatedAt).toLocaleString("en-IN"));
    row("Status", "PAID");
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#ddd").lineWidth(1).stroke();
    doc.moveDown(0.5);

    row("Student Name", registration.userName);
    row("Email", registration.userEmail);
    row("Event", event ? event.title : registration.eventTitle);
    if (event) {
        row("Event Date", event.date);
        row("Venue", event.venue);
    }
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#ddd").lineWidth(1).stroke();
    doc.moveDown(1);

    doc.font("Helvetica-Bold").fontSize(14).fillColor("#17233c").text(`Amount Paid: Rs. ${(payment.amount / 100).toFixed(2)}`, 50);
    doc.moveDown(2);
    doc.font("Helvetica").fontSize(9).fillColor("#999").text(
        "This is a computer-generated receipt for a registration fee paid via Razorpay and does not require a physical signature.",
        50, doc.y, { width: 495 }
    );

    doc.end();
}));

module.exports = router;