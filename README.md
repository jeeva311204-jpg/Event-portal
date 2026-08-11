<<<<<<< HEAD
# College Event Portal

College Event Portal

## Description

College Event Portal is a Node.js/Express application for managing events, registrations, certificates, and notifications.

## Features

- User authentication
- Event creation and registration
- PDF certificates generation
- QR code scanning
- Real-time notifications via Socket.io

## Requirements

- Node.js 18+ (or compatible)
- MongoDB

## Install

```bash
npm install
```

## Run

Start the server:

```bash
npm start
# or for development
npm run dev
```

## Environment

Create a `.env` with values for MongoDB connection, JWT secret, and email credentials. Example keys:

- `MONGODB_URI`
- `JWT_SECRET`
- `EMAIL_USER`
- `EMAIL_PASS`

## License

Add a license if desired.
=======
# College Event Portal — Functional Edition

## What was fixed/added
- Student: Events, search/filter, event details, registration, QR ticket, certificate download, reviews, notifications and profile.
- Organizer: Dashboard statistics, create/edit/delete events, attendee list, live QR scanner, notifications and profile.
- Admin: Full dashboard, all events, user management, role changes, add/delete users, notifications and profile.
- Event edit API and validation.
- Admin statistics/user APIs.
- Profile update/password-change API.
- Better error handling, empty states and mobile-friendly UI.
- Real-time notifications, seat updates and live check-in feed retained.

## Run
1. Copy `.env.example` to `.env` and fill in MongoDB, JWT/QR secrets and SMTP settings.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:5000`.

## Demo accounts
- admin@college.edu
- organizer@college.edu
- student1@college.edu
- Password: `password123`

The first login uses email OTP 2-step verification, so SMTP must be configured.

## Important
Never commit `.env` or expose SMTP/MongoDB credentials. If credentials from an older local `.env` were shared publicly, rotate them.
>>>>>>> 83ad66c (Initial commit)
