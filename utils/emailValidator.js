const dns = require("dns").promises;

// Simple in-memory cache so we don't re-query DNS for the same domain
// over and over (login, resend-otp, register can all trigger a check).
const mxCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Common domains people type into test/demo forms that are syntactically
// valid but are known to never be real inboxes. Extend this list as needed.
const KNOWN_FAKE_DOMAINS = new Set([
    "test.com",
    "example.com",
    "example.org",
    "example.net",
    "fake.com",
    "notreal.com",
    "abc.com",
    "xyz.com",
    "asdf.com",
    "sample.com"
]);

/**
 * Checks whether a domain has usable mail (MX or fallback A) records.
 * Returns true/false. Never throws.
 */
async function domainAcceptsMail(domain) {
    const cached = mxCache.get(domain);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        return cached.value;
    }

    let result = false;
    try {
        const mxRecords = await dns.resolveMx(domain);
        result = Array.isArray(mxRecords) && mxRecords.length > 0;
    } catch (err) {
        // No MX record. Some domains (rare) accept mail via a plain A/AAAA
        // record instead of MX, so give them one more chance before giving up.
        try {
            await dns.resolve(domain);
            result = true;
        } catch (err2) {
            result = false;
        }
    }

    mxCache.set(domain, { value: result, ts: Date.now() });
    return result;
}

/**
 * Best-effort "is this a real, deliverable-looking email" check.
 * - Confirms basic syntax
 * - Confirms the domain actually exists and is configured to receive mail
 *
 * NOTE: This cannot guarantee the specific mailbox (e.g. john123@gmail.com)
 * really exists -- that requires an SMTP handshake or a paid verification
 * API (AbstractAPI, ZeroBounce, Mailboxlayer, etc.), and most providers
 * throttle/block that kind of probing. MX-record verification is the
 * standard, safe, no-API-key way to filter out obviously fake/typo'd
 * domains, which covers the vast majority of "fake email" cases in a
 * student registration form.
 */
async function isRealEmail(email) {
    if (!email || typeof email !== "string") return false;

    const normalized = email.trim().toLowerCase();
    if (!EMAIL_FORMAT.test(normalized)) return false;

    const domain = normalized.split("@")[1];
    if (!domain) return false;
    if (KNOWN_FAKE_DOMAINS.has(domain)) return false;

    return domainAcceptsMail(domain);
}

module.exports = { isRealEmail };
