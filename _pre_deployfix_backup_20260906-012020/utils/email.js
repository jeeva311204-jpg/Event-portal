const nodemailer = require("nodemailer");

// Render's containers frequently lack a working IPv6 route, but Gmail (and
// many SMTP hosts) advertise both A (IPv4) and AAAA (IPv6) records. Node
// prefers IPv6 by default when both exist, so without forcing IPv4 here,
// the connection fails with ENETUNREACH in that environment even though
// the exact same code works fine locally. `family: 4` pins the connection
// to IPv4 and fixes this without needing any DNS/network config on Render.
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    family: 4,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

transporter.verify((err) => {
    if (err) {
        console.warn("[EMAIL] SMTP not verified - check SMTP_* values in .env:", err.message);
    } else {
        console.log("[EMAIL] SMTP connection verified, ready to send real emails.");
    }
});

async function sendEmail(to, subject, text, html) {
    try {
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || `"College Event Portal" <${process.env.SMTP_USER}>`,
            to,
            subject,
            text,
            html: html || `<p>${text}</p>`
        });
        console.log(`[EMAIL SENT] To: ${to} | Subject: ${subject} | MessageId: ${info.messageId}`);
        return info;
    } catch (err) {
        console.error(`[EMAIL ERROR] Failed to send to ${to}:`, err.message);
        throw err;
    }
}

module.exports = { sendEmail };
