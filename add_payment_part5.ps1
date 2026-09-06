# ============================================================
# Add Email Testing Override - Part 5
# ============================================================
# What this adds:
#  An optional EMAIL_OVERRIDE_TO setting. When set in .env, every
#  outgoing email (OTP codes, registration confirmations, etc) is
#  redirected to that one real inbox instead of the actual
#  recipient - useful for testing with the seeded demo accounts
#  (admin@college.edu, organizer@college.edu, student1@college.edu),
#  which use fake addresses that can never receive real mail.
#  The original intended recipient is kept in the subject line
#  (e.g. "[to: admin@college.edu] Your 2-Step Verification Code")
#  so you can tell multiple redirected emails apart.
#
#  Leave EMAIL_OVERRIDE_TO unset for real users to get their own
#  emails normally - this is a local testing convenience only.
#
# Run this from your project root, AFTER part 4 has already been
# applied. USAGE:  .\add_payment_part5.ps1
# ============================================================

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\package.json")) {
    Write-Host "ERROR: Run this script from your project root (the folder containing package.json)." -ForegroundColor Red
    exit 1
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = ".\_pre_emailoverride_backup_$stamp"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
foreach ($item in @("utils\email.js", ".env.example")) {
    if (Test-Path $item) {
        $dest = Join-Path $backupDir $item
        New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
        Copy-Item $item -Destination $dest -Force
    }
}
Write-Host "Backed up existing files to $backupDir" -ForegroundColor Yellow

function Write-Utf8NoBom($Path, $Content) {
    $dir = Split-Path $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Join-Path (Get-Location) $Path), $Content, $enc)
}

$emailJs = @'
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

'@

$envExample = @'
PORT=5000

JWT_SECRET=replace_with_a_long_random_string
QR_SECRET=replace_with_a_different_long_random_string

MONGO_URI=mongodb+srv://your_db_user:your_db_password@your-cluster.mongodb.net/?retryWrites=true&w=majority

# Email sending via Brevo's HTTPS API (not SMTP - see utils/email.js for
# why). Sign up free at brevo.com, verify a sender email under Settings ->
# Senders, Domains & Dedicated IPs -> Senders, then create an API key
# under Settings -> SMTP & API -> API Keys.
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=your_verified_sender@gmail.com
BREVO_SENDER_NAME=College Event Portal

# Optional, for local testing only: redirects every outgoing email to this
# one inbox regardless of the actual recipient. Useful for testing with the
# seeded demo accounts (admin@college.edu etc), which use fake addresses
# that can never receive real mail. Leave this unset/commented out in
# production so real users get their own emails.
# EMAIL_OVERRIDE_TO=your_real_email@gmail.com

# Comma-separated list of allowed frontend origins in production.
# Leave unset in local development.
CORS_ORIGIN=

# Razorpay dashboard -> Settings -> API Keys. Use the Test Mode keys while
# developing; switch to Live Mode keys only once you're ready to accept real
# payments.
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

'@


Write-Utf8NoBom "utils\email.js" $emailJs
Write-Utf8NoBom ".env.example" $envExample
Write-Host "Wrote updated files." -ForegroundColor Green

Write-Host ""
Write-Host "Part 5 (email testing override) complete." -ForegroundColor Green
Write-Host "To test with demo accounts and see the emails in your own inbox," -ForegroundColor Green
Write-Host "add this line to your LOCAL .env only (not Render):" -ForegroundColor Green
Write-Host "  EMAIL_OVERRIDE_TO=jeeva311204@gmail.com" -ForegroundColor Cyan
Write-Host "Then restart your server (Ctrl+C, then npm start) and log in as any demo account." -ForegroundColor Green
