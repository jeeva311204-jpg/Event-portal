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
