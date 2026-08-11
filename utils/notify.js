const Notification = require("../models/Notification");

let ioInstance = null;

function setIo(io) {
    ioInstance = io;
}

async function addNotification(userId, title, message) {
    const notif = await Notification.create({ userId, title, message });

    if (ioInstance) {
        ioInstance.to(String(userId)).emit("realtime_notification", notif);
    }

    return notif;
}

module.exports = { setIo, addNotification };
