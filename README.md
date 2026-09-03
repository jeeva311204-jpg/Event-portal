# College Event Portal

A Node.js/Express/MongoDB application for managing college events, registrations, QR-based check-ins, and real-time notifications. Supports three user roles: Student, Organizer, and Admin.

## Features

- **User Authentication**: Email + OTP-based 2-step verification (requires SMTP)
- **Event Management**: Create, edit, and manage events with seat limits and categories
- **Registration & Check-in**: Student registration with QR-based ticket check-in and live scanner
- **Certificates**: PDF certificate generation and download
- **Real-time Notifications**: Socket.io-based notifications for seats, check-ins, and updates
- **Role-based Dashboard**: Separate views for Student, Organizer, and Admin
- **Notifications & Messaging**: Track event updates and user communications
- **Reviews & Ratings**: Students can review events after attendance

## Requirements

- Node.js 18+
- MongoDB

## Installation

```bash
npm install
```

## Setup

1. Create a `.env` file in the project root:

```bash
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/college_event_portal
JWT_SECRET=your_jwt_secret_min_32_chars
QR_SECRET=your_qr_secret_min_32_chars
CORS_ORIGIN=http://localhost:5000
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your@example.com
SMTP_PASS=your_email_password
SMTP_FROM="College Event Portal <your@example.com>"
```

2. Start the server:

```bash
npm start
```

The application will seed demo accounts automatically on first run.

## Demo Accounts

| Email | Password | Role |
|-------|----------|------|
| admin@college.edu | password123 | Admin |
| organizer@college.edu | password123 | Organizer |
| student1@college.edu | password123 | Student |

**Note:** First login requires email OTP verification via configured SMTP.

## Security

⚠️ **Never commit `.env` or share credentials.**

- `JWT_SECRET` and `QR_SECRET` are required and must be strong (min 32 chars in production)
- If credentials were ever publicly exposed, rotate them immediately
- CORS is restricted to `CORS_ORIGIN` (configure for production)
- JWTs use httpOnly cookies (XSS-resistant)

## License

Proprietary — College Event Portal
