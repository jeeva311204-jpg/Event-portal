const jwt = require("jsonwebtoken");

function auth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Please login first" });
    }

    try {
        req.user = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: "Invalid or expired token" });
    }
}

function role(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: "Permission denied" });
        }
        next();
    };
}

function issueToken(user) {
    return jwt.sign(
        {
            id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            department: user.department
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
}

module.exports = { auth, role, issueToken };
