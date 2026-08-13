const express = require("express");
const PDFDocument = require("pdfkit");
const Registration = require("../models/Registration");
const Event = require("../models/Event");
const { auth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.get("/events/:eventId/export-ics", asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.eventId).lean();
    if (!event) return res.status(404).send("Event not found");

    const startDate = event.date.replace(/-/g, "") + "T" + event.time.replace(":", "") + "00Z";

    const icsData = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//College Event Portal//EN",
        "BEGIN:VEVENT",
        `SUMMARY:${event.title}`,
        `DESCRIPTION:${event.description}`,
        `LOCATION:${event.venue}`,
        `DTSTART:${startDate}`,
        `DTEND:${startDate}`,
        "END:VEVENT",
        "END:VCALENDAR"
    ].join("\r\n");

    res.setHeader("Content-Type", "text/calendar");
    res.setHeader("Content-Disposition", `attachment; filename="event-${event._id}.ics"`);
    res.send(icsData);
}));

router.get("/certificate/:registrationId", auth, asyncHandler(async (req, res) => {
    const registration = await Registration.findById(req.params.registrationId);
    if (!registration) return res.status(404).json({ error: "Registration not found" });

    if (String(registration.userId) !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "Permission denied" });
    }

    if (!registration.attended) {
        return res.status(400).json({ error: "Certificate available only after verified attendance" });
    }

    const event = await Event.findById(registration.eventId);
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=certificate-${registration._id}.pdf`);
    doc.pipe(res);

    const width = doc.page.width;
    const height = doc.page.height;

    doc.rect(25, 25, width - 50, height - 50).lineWidth(4).stroke("#17233c");
    doc.rect(40, 40, width - 80, height - 80).lineWidth(2).stroke("#c9a227");

    doc.fontSize(18).fillColor("#17233c").font("Helvetica-Bold").text("COLLEGE EVENT PORTAL", 0, 85, { align: "center" });
    doc.fontSize(36).text("CERTIFICATE OF PARTICIPATION", 0, 130, { align: "center" });
    doc.fontSize(16).fillColor("#333").font("Helvetica").text("This certificate is proudly presented to", 0, 205, { align: "center" });
    doc.fontSize(32).fillColor("#c9a227").font("Helvetica-Bold").text(registration.userName, 0, 245, { align: "center" });
    doc.fontSize(15).fillColor("#333").font("Helvetica").text(`for participating in "${event.title}"`, 0, 305, { align: "center" });
    doc.fontSize(13).text(`Date: ${event.date} | Venue: ${event.venue}`, 0, 340, { align: "center" });

    doc.end();
}));

module.exports = router;
