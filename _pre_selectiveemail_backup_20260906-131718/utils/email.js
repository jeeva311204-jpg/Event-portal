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

    // Optional testing aid: the seeded demo accounts (admin@college.edu,
    // organizer@college.edu, student1@college.edu) use fake addresses that
    // can never receive real mail. Setting EMAIL_OVERRIDE_TO in .env
    // redirects every outgoing email to that one real inbox instead, so
    // you can see what a demo account "would have" received. The original
    // intended recipient is kept in the subject line so you can tell
    // multiple redirected emails apart. Leave EMAIL_OVERRIDE_TO unset in
    // production so real users get their own emails.
    const override = process.env.EMAIL_OVERRIDE_TO;
    const actualTo = override || to;
    const actualSubject = (override && override !== to) ? `[to: ${to}] ${subject}` : subject;

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
                to: [{ email: actualTo }],
                subject: actualSubject,
                textContent: text,
                htmlContent: html || `<p>${text}</p>`
            })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.message || `Brevo API responded with status ${res.status}`);
        }

        console.log(`[EMAIL SENT] To: ${actualTo}${override && override !== to ? ` (redirected from ${to})` : ""} | Subject: ${actualSubject} | MessageId: ${data.messageId || "n/a"}`);
        return data;
    } catch (err) {
        console.error(`[EMAIL ERROR] Failed to send to ${actualTo}:`, err.message);
        throw err;
    }
}

module.exports = { sendEmail };
