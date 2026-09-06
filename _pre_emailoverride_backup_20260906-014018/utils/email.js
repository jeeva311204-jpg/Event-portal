// Render's free tier blocks all outbound SMTP traffic (ports 25, 465, 587)
// as of a September 2025 policy change, so nodemailer over SMTP can never
// work there, no matter how correct the credentials are. Brevo's
// transactional email API sends over plain HTTPS instead, which Render
// does not block. The sender email below must be verified as a "Sender"
// in your Brevo dashboard first (Settings -> Senders, Domains & Dedicated
// IPs -> Senders -> Add a Sender) - this only requires proving you own
// that one address (a confirmation email/link), not a whole domain, so it
// works fine with a plain Gmail address. Once verified, Brevo will deliver
// to any recipient address, not just your own.
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

async function sendEmail(to, subject, text, html) {
    if (!process.env.BREVO_API_KEY) {
        console.warn("[EMAIL] BREVO_API_KEY not set - skipping email send. Set it in .env to enable real emails.");
        return null;
    }

    try {
        const res = await fetch(BREVO_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "api-key": process.env.BREVO_API_KEY
            },
            body: JSON.stringify({
                sender: {
                    email: process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER,
                    name: process.env.BREVO_SENDER_NAME || "College Event Portal"
                },
                to: [{ email: to }],
                subject,
                textContent: text,
                htmlContent: html || `<p>${text}</p>`
            })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.message || `Brevo API responded with status ${res.status}`);
        }

        console.log(`[EMAIL SENT] To: ${to} | Subject: ${subject} | MessageId: ${data.messageId || "n/a"}`);
        return data;
    } catch (err) {
        console.error(`[EMAIL ERROR] Failed to send to ${to}:`, err.message);
        throw err;
    }
}

module.exports = { sendEmail };
