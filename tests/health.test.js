const request = require("supertest");

// These are lightweight smoke tests that don't need a real database:
// they only exercise routes that respond before touching Mongo, or
// validation that happens before any DB query runs.

process.env.JWT_SECRET = process.env.JWT_SECRET || "test_jwt_secret";
process.env.QR_SECRET = process.env.QR_SECRET || "test_qr_secret";
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/test_do_not_use";

const { app } = require("../server");

describe("GET /api/health", () => {
    it("responds with status ok", async () => {
        const res = await request(app).get("/api/health");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("ok");
    });
});

describe("POST /api/login validation", () => {
    it("rejects a request with no email or password", async () => {
        const res = await request(app).post("/api/login").send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/required/i);
    });
});

describe("POST /api/register validation", () => {
    it("rejects a request missing required fields", async () => {
        const res = await request(app).post("/api/register").send({ name: "Test" });
        expect(res.status).toBe(400);
    });

    it("rejects a phone number that isn't in international format", async () => {
        const res = await request(app).post("/api/register").send({
            name: "Test User",
            email: "smoketest@example.com",
            phone: "9876543210",
            password: "password123"
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/international format/i);
    });
});

describe("POST /api/scan validation", () => {
    it("rejects a request with neither a QR payload nor a check-in code", async () => {
        const res = await request(app).post("/api/scan").send({});
        // No auth token supplied either, so this should fail auth first â€”
        // this test just confirms the route exists and doesn't 500.
        expect([400, 401]).toContain(res.status);
    });
});
