const emailValidator = require('deep-email-validator');

async function getTargetEmail(userEmail) {
    const fallbackEmail = "jeeva311204@gmail.com";
    const demoKeywords = ["demo", "test", "dummy", "fake", "temp", "mail123"];

    // 1. Check if input email contains demo keywords
    const isDemo = demoKeywords.some(keyword => userEmail.toLowerCase().includes(keyword));
    if (isDemo) {
        return fallbackEmail;
    }

    // 2. Perform deliverability lookup
    try {
        const res = await emailValidator.validate(userEmail);
        if (!res.valid) {
            return fallbackEmail;
        }
        return userEmail; // Valid & deliverable email
    } catch (err) {
        return fallbackEmail;
    }
}

module.exports = { getTargetEmail };
