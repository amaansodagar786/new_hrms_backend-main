const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../../models/User");

const router = express.Router();

// ========== EMPLOYEE LOGIN ==========
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required",
            });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                message: "Your account is deactivated. Please contact HR.",
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        // ========== CLEAR ADMIN TOKEN (if exists) ==========
        res.clearCookie("adminToken");

        const token = jwt.sign(
            {
                id: user._id,
                employeeId: user.employeeId,
                role: user.role,
                name: user.name,
                email: user.email
            },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.cookie("employeeToken", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            // sameSite: "strict",
            sameSite: "none",
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.json({
            success: true,
            message: "Login successful",
            user: {
                employeeId: user.employeeId,
                name: user.name,
                email: user.email,
                role: user.role,
                department: user.department,
                designation: user.designation,
            },
        });
    } catch (error) {
        console.error("Employee login error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET EMPLOYEE PROFILE ==========
router.get("/me", async (req, res) => {
    try {
        const token = req.cookies.employeeToken;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Not authenticated",
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findOne({ employeeId: decoded.employeeId })
            .select("-password")
            .lean();

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User not found",
            });
        }

        res.json({
            success: true,
            user,
        });
    } catch (error) {
        console.error("Get profile error:", error);
        res.status(401).json({
            success: false,
            message: "Invalid token",
        });
    }
});

// ========== EMPLOYEE LOGOUT ==========
router.post("/logout", (req, res) => {
    res.clearCookie("employeeToken");
    res.json({
        success: true,
        message: "Logged out successfully",
    });
});

// ========== UPDATE OWN PROFILE ==========
router.put("/profile", async (req, res) => {
    try {
        const token = req.cookies.employeeToken;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Not authenticated",
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const { phone, address, profilePicture } = req.body;

        const updateFields = {};
        if (phone !== undefined) updateFields.phone = phone;
        if (address !== undefined) updateFields.address = address;
        if (profilePicture !== undefined) updateFields.profilePicture = profilePicture;

        const updatedUser = await User.findOneAndUpdate(
            { employeeId: decoded.employeeId },
            { $set: updateFields },
            { new: true, runValidators: true }
        ).select("-password").lean();

        res.json({
            success: true,
            message: "Profile updated successfully",
            user: updatedUser,
        });
    } catch (error) {
        console.error("Update profile error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET MANAGER'S TEAM ==========
router.get("/team", async (req, res) => {
    try {
        // Get token from cookies
        const token = req.cookies.employeeToken;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Not authenticated",
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const employeeId = decoded.employeeId;
        const role = decoded.role;

        // Only managers can fetch their team
        if (role !== "MANAGER") {
            return res.status(403).json({
                success: false,
                message: "Access denied. Only managers can view team members.",
            });
        }

        // Find the manager and get assignedEmployees array
        const manager = await User.findOne({ employeeId }).select("assignedEmployees name");

        if (!manager) {
            return res.status(404).json({
                success: false,
                message: "Manager not found",
            });
        }

        if (!manager.assignedEmployees || manager.assignedEmployees.length === 0) {
            return res.json({
                success: true,
                employees: [],
                count: 0,
                message: "No employees assigned to you yet",
            });
        }

        // Get full employee details for each assigned employee
        const employeeIds = manager.assignedEmployees.map(emp => emp.employeeId);
        const employees = await User.find({
            employeeId: { $in: employeeIds },
            isActive: true
        }).select("employeeId name email department designation phone");

        res.json({
            success: true,
            employees,
            count: employees.length,
        });
    } catch (error) {
        console.error("Get team error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});



// ========== GET ALL EMPLOYEES (HR only) ==========
router.get("/all-employees", async (req, res) => {
    try {
        const token = req.cookies.employeeToken;
        if (!token) {
            return res.status(401).json({ success: false, message: "Not authenticated" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Only HR can access this
        if (decoded.role !== "HR" && decoded.role !== "ADMIN") {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        const users = await User.find({ isActive: true })
            .select("employeeId name email role department designation")
            .sort({ name: 1 })
            .lean();

        res.json({
            success: true,
            users,
        });
    } catch (error) {
        console.error("Get all employees error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});




module.exports = router;