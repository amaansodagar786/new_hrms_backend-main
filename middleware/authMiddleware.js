const jwt = require("jsonwebtoken");

// For Admin
const protectAdmin = (req, res, next) => {
    try {
        const token = req.cookies.adminToken;

        if (!token) {
            return res.status(401).json({ message: "Not authorized, no token" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== "ADMIN") {
            return res.status(403).json({ message: "Not authorized as admin" });
        }

        req.admin = decoded;
        next();
    } catch (error) {
        res.status(401).json({ message: "Not authorized, token failed" });
    }
};

// For Employee/HR/Manager
const protectEmployee = (req, res, next) => {
    try {
        const token = req.cookies.employeeToken;

        if (!token) {
            return res.status(401).json({ message: "Not authorized, no token" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ message: "Not authorized, token failed" });
    }
};

module.exports = { protectAdmin, protectEmployee };