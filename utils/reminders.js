const cron = require("node-cron");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const { sendEmail } = require("./email");
const { addNotification } = require("./notify");

// Finds events starting between 23 and 25 hours from now (a 2-hour window,
// matching the every-30-minutes cron schedule below with margin either
// side) and emails everyone registered who hasn't already gotten a
// reminder for that event.
async function sendUpcomingEventReminders() {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const events = await Event.find({ status: { $in: ["upcoming", "ongoing"] } }).lean();

    for (const event of events) {
        const eventDateTime = new Date(`${event.date}T${event.time || "00:00"}:00`);
        if (isNaN(eventDateTime) || eventDateTime < windowStart || eventDateTime > windowEnd) continue;

        const pending = await Registration.find({ eventId: event._id, reminderSent: { $ne: true } });
        for (const reg of pending) {
            try {
                await sendEmail(
                    reg.userEmail,
                    `Reminder: ${event.title} is tomorrow`,
                    `Hello ${reg.userName},\n\nThis is a reminder that "${event.title}" is happening soon.\nDate: ${event.date}\nTime: ${event.time}\nVenue: ${event.venue}\n\nSee you there!`
                );
                await addNotification(reg.userId, "Event Reminder", `"${event.title}" is coming up soon â€” ${event.date} at ${event.venue}.`);
                reg.reminderSent = true;
                await reg.save();
            } catch (err) {
                console.error(`[Reminder] Failed to email ${reg.userEmail} for event ${event._id}:`, err.message);
            }
        }
    }
}

// Runs every 30 minutes. A 30-minute cadence against a 2-hour matching
// window means every registration gets exactly one reminder without
// needing a separate lock/scheduler table.
function startReminderScheduler() {
    cron.schedule("*/30 * * * *", () => {
        sendUpcomingEventReminders().catch(err => console.error("[Reminder] Scheduler run failed:", err.message));
    });
    console.log("Event reminder scheduler started (checks every 30 minutes).");
}

module.exports = { startReminderScheduler, sendUpcomingEventReminders };
