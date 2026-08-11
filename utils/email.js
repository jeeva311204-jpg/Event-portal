const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
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
