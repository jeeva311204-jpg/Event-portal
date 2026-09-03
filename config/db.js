const mongoose = require("mongoose");

async function connectDB() {
    const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/college_event_portal";
    try {
        await mongoose.connect(uri);
        console.log(`[MongoDB] Connected -> ${mongoose.connection.host}/${mongoose.connection.name}`);
    } catch (err) {
        console.error("[MongoDB] Connection failed:", err.message);
        console.error("Make sure MongoDB is running locally, or MONGO_URI in .env points to a valid Atlas cluster.");
        process.exit(1);
    }
}

module.exports = connectDB;
