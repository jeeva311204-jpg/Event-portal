# ============================================================
# Make Email Override Selective - Part 6
# ============================================================
# Fixes a problem with the Part 5 override: it was redirecting
# ALL emails (real and fake) to one inbox. This makes it
# selective - only emails to a fake/demo domain get redirected;
# real addresses (Gmail, your college domain, etc.) always get
# their own email normally.
#
# On RENDER, set BOTH of these env vars to test demo accounts
# while keeping real accounts working normally:
#   EMAIL_OVERRIDE_TO=jeeva311204@gmail.com
#   EMAIL_OVERRIDE_FAKE_DOMAINS=college.edu
#
# (Comma-separate multiple fake domains if needed, e.g.
#  "college.edu,example.com")
#
# Remove both before letting real students use the site for real,
# since leaving them in production is otherwise harmless (real
# addresses are never touched) but there's no reason to keep
# testing infrastructure active once you're done with it.
#
# Run this from your project root, AFTER part 5 has already been
# applied. USAGE:  .\add_payment_part6.ps1
# ============================================================

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\package.json")) {
    Write-Host "ERROR: Run this script from your project root (the folder containing package.json)." -ForegroundColor Red
    exit 1
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = ".\_pre_selectiveemail_backup_$stamp"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
if (Test-Path "utils\email.js") {
    New-Item -ItemType Directory -Path (Join-Path $backupDir "utils") -Force | Out-Null
    Copy-Item "utils\email.js" -Destination (Join-Path $backupDir "utils\email.js") -Force
    Write-Host "Backed up utils\email.js to $backupDir" -ForegroundColor Yellow
}

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
    // organizer@college.edu, student1@college.edu) use a fake domain that
    // can never receive real mail. Setting BOTH EMAIL_OVERRIDE_TO and
    // EMAIL_OVERRIDE_FAKE_DOMAINS in .env redirects ONLY emails to those
    // fake domains to one real inbox, so you can see what a demo account
    // "would have" received - every other (real) recipient still gets
    // their own email normally, exactly as production users should. The
    // original intended recipient is kept in the subject line so you can
    // tell multiple redirected emails apart.
    // EMAIL_OVERRIDE_FAKE_DOMAINS is a comma-separated list, e.g.
    // "college.edu,example.com". Leave both unset in production.
    const override = process.env.EMAIL_OVERRIDE_TO;
    const fakeDomains = (process.env.EMAIL_OVERRIDE_FAKE_DOMAINS || "")
        .split(",")
        .map(d => d.trim().toLowerCase())
        .filter(Boolean);
    const toDomain = (to.split("@")[1] || "").toLowerCase();
    const shouldRedirect = override && fakeDomains.includes(toDomain);
    const actualTo = shouldRedirect ? override : to;
    const actualSubject = shouldRedirect ? `[to: ${to}] ${subject}` : subject;

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

        console.log(`[EMAIL SENT] To: ${actualTo}${shouldRedirect ? ` (redirected from ${to})` : ""} | Subject: ${actualSubject} | MessageId: ${data.messageId || "n/a"}`);
        return data;
    } catch (err) {
        console.error(`[EMAIL ERROR] Failed to send to ${actualTo}:`, err.message);
        throw err;
    }
}

module.exports = { sendEmail };

'@


Write-Utf8NoBom "utils\email.js" $emailJs
Write-Host "Wrote utils\email.js." -ForegroundColor Green

Write-Host ""
Write-Host "Part 6 (selective email override) complete." -ForegroundColor Green
Write-Host "On Render, set EMAIL_OVERRIDE_FAKE_DOMAINS=college.edu alongside your existing EMAIL_OVERRIDE_TO." -ForegroundColor Green
Write-Host "Real email addresses (Gmail, your college domain, etc) will now always get their own email - only college.edu addresses redirect to you." -ForegroundColor Green
