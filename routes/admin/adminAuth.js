const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const Admin = require("../../models/Admin");

const router = express.Router();

// ========== ADMIN REGISTER ==========
router.post("/register", async (req, res) => {
    try {
        const { name, email, password, phone, address } = req.body;

        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ email });
        if (existingAdmin) {
            return res.status(400).json({ message: "Admin already exists" });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Generate adminId with UUID
        const adminId = `ADMIN_${uuidv4()}`;

        // Create admin
        const admin = new Admin({
            adminId,
            name,
            email,
            password: hashedPassword,
            phone,
            address,
        });

        await admin.save();

        res.status(201).json({
            success: true,
            message: "Admin created successfully",
            admin: {
                adminId: admin.adminId,
                name: admin.name,
                email: admin.email,
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// ========== ADMIN LOGIN ==========
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check if admin exists
        const admin = await Admin.findOne({ email });
        if (!admin) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        // ========== CLEAR EMPLOYEE TOKEN (if exists) ==========
        res.clearCookie("employeeToken");

        // Create JWT token
        const token = jwt.sign(
            { id: admin._id, adminId: admin.adminId, role: "ADMIN" },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        // Set cookie with SPECIFIC NAME: adminToken
        res.cookie("adminToken", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            // sameSite: "strict",
            sameSite: "none",
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        res.json({
            success: true,
            message: "Login successful",
            admin: {
                adminId: admin.adminId,
                name: admin.name,
                email: admin.email,
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// ========== ADMIN LOGOUT ==========
router.post("/logout", (req, res) => {
    res.clearCookie("adminToken");  // Clear specific adminToken
    res.json({ success: true, message: "Logged out successfully" });
});

router.get("/me", async (req, res) => {
    try {
        const token = req.cookies.adminToken;  // Check adminToken
        if (!token) {
            return res.status(401).json({ message: "Not authenticated" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const admin = await Admin.findById(decoded.id).select("-password");

        if (!admin) {
            return res.status(401).json({ message: "Admin not found" });
        }

        res.json({ success: true, admin });
    } catch (error) {
        res.status(401).json({ message: "Invalid token" });
    }
});

module.exports = router;