require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

console.log("Testing SMTP connection for:", process.env.SMTP_USER);

transporter.sendMail({
  from: process.env.SMTP_USER,
  to: 'jeeva311204@gmail.com',
  subject: 'Direct Test OTP Mail',
  text: 'If you see this, your Gmail SMTP setup is working! OTP Code: 999888'
}, (err, info) => {
  if (err) {
    console.error("? SMTP ERROR:", err.message);
  } else {
    console.log("? SUCCESS! Mail sent ID:", info.messageId);
  }
});
