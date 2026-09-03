module.exports = {
    testEnvironment: "node",
    // utils/email.js verifies the SMTP connection as soon as it's required,
    // which can leave a pending timer open in test runs where no real SMTP
    // server is reachable. forceExit ensures the test run still terminates
    // instead of hanging.
    forceExit: true,
    testTimeout: 10000
};
