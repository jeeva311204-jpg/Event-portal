const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const { addNotification } = require("./notify");
const { sendEmail } = require("./email");

function generateCheckinCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Shared by the free-event registration route (routes/registrations.js) and
// the post-payment verification route (routes/payments.js) so both paths
// reserve seats, generate QR tickets and send confirmation email/sockets in
// exactly the same way. `paymentInfo` is only passed for paid events and
// adds a payment receipt section to the confirmation email.
async function completeRegistration(event, user, io, paymentInfo = null) {
    const already = await Registration.findOne({ eventId: event._id, userId: user.id });
    if (already) {
        const err = new Error("Already registered for this event");
        err.statusCode = 409;
        throw err;
    }

    const reserved = await Event.findOneAndUpdate(
        { _id: event._id, $expr: { $lt: ["$seatsBooked", "$maxSeats"] } },
        { $inc: { seatsBooked: 1 } },
        { new: true }
    );
    if (!reserved) {
        const err = new Error("Event is fully booked");
        err.statusCode = 400;
        throw err;
    }

    let registration;
    try {
        registration = await Registration.create({
            eventId: event._id,
            eventTitle: event.title,
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            userPhone: user.phone,
            qrToken: "pending",
            qrCode: "pending",
            checkinCode: generateCheckinCode()
        });
    } catch (err) {
        await Event.findByIdAndUpdate(event._id, { $inc: { seatsBooked: -1 } });
        if (err.code === 11000) {
            const dup = new Error("Already registered for this event");
            dup.statusCode = 409;
            throw dup;
        }
        throw err;
    }

    const qrToken = jwt.sign(
        { registrationId: registration._id.toString(), eventId: event._id.toString() },
        process.env.QR_SECRET,
        { expiresIn: "90d" }
    );
    const qrCode = await QRCode.toDataURL(qrToken, { errorCorrectionLevel: "H", width: 320 });

    registration.qrToken = qrToken;
    registration.qrCode = qrCode;
    await registration.save();

    await addNotification(user.id, "Registration Confirmed", `You are registered for "${event.title}".`);

    const paymentTextBlock = paymentInfo
        ? `\n\n--- Payment Receipt ---\nAmount Paid: ₹${(paymentInfo.amount / 100).toFixed(2)}\nPayment ID: ${paymentInfo.paymentId}\nOrder ID: ${paymentInfo.orderId}\nPaid On: ${new Date().toLocaleString("en-IN")}\nStatus: PAID\n(A downloadable PDF receipt is also available under "My Registrations" in the portal.)`
        : "";
    const paymentHtmlBlock = paymentInfo
        ? `<hr><h3>Payment Receipt</h3>
           <table style="font-size:14px;color:#333">
             <tr><td style="padding:4px 12px 4px 0"><b>Amount Paid</b></td><td>₹${(paymentInfo.amount / 100).toFixed(2)}</td></tr>
             <tr><td style="padding:4px 12px 4px 0"><b>Payment ID</b></td><td>${paymentInfo.paymentId}</td></tr>
             <tr><td style="padding:4px 12px 4px 0"><b>Order ID</b></td><td>${paymentInfo.orderId}</td></tr>
             <tr><td style="padding:4px 12px 4px 0"><b>Paid On</b></td><td>${new Date().toLocaleString("en-IN")}</td></tr>
             <tr><td style="padding:4px 12px 4px 0"><b>Status</b></td><td style="color:#16a34a;font-weight:700">PAID</td></tr>
           </table>
           <p class="small" style="color:#666">A downloadable PDF receipt is also available under "My Registrations" in the portal.</p>`
        : "";

    sendEmail(
        user.email,
        `Ticket Confirmation: ${event.title}`,
        `Hello ${user.name},\n\nYour spot for "${event.title}" is confirmed!\nDate: ${event.date}\nVenue: ${event.venue}\nTicket ID: ${registration._id}\n\nCheck-in code: ${registration.checkinCode}\nShow your QR ticket at the door. If the QR scanner isn't working, give the organizer this 6-digit check-in code instead.${paymentTextBlock}`,
        `<div style="font-family:sans-serif;padding:20px;background:#f4f4f4;">
            <h2>You're registered for ${event.title}!</h2>
            <p>Hello ${user.name},</p>
            <p><b>Date:</b> ${event.date}<br><b>Venue:</b> ${event.venue}</p>
            <p>Show your QR ticket at the door. If the scanner isn't working, give the organizer this code instead:</p>
            <h1 style="color:#d4a73d;letter-spacing:4px;">${registration.checkinCode}</h1>
            ${paymentHtmlBlock}
         </div>`
    ).catch(() => {});

    if (io) {
        const count = await Registration.countDocuments({ eventId: event._id });
        io.emit("seat_update", {
            eventId: event._id,
            seatsLeft: event.maxSeats - count
        });
    }

    return registration;
}

module.exports = { completeRegistration };