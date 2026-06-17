const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../../models/User");
const { sendPasswordChangeNotification } = require("../../utils/emailService");

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
            sameSite: "strict",
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

// ========== CHANGE PASSWORD (NEW) ==========
router.put("/change-password", async (req, res) => {
    try {
        const token = req.cookies.employeeToken;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Not authenticated",
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { currentPassword, newPassword } = req.body;

        // Validation
        if (!currentPassword) {
            return res.status(400).json({
                success: false,
                message: "Current password is required",
            });
        }

        if (!newPassword) {
            return res.status(400).json({
                success: false,
                message: "New password is required",
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "New password must be at least 6 characters long",
            });
        }

        // Find employee
        const user = await User.findOne({ employeeId: decoded.employeeId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Employee not found",
            });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: "Current password is incorrect",
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        user.password = hashedPassword;
        await user.save();

        // Send email notification (without new password)
        try {
            await sendPasswordChangeNotification(user);
            console.log(`Password change notification sent to ${user.email}`);
        } catch (emailError) {
            console.error("Failed to send password change email:", emailError);
            // Don't fail the request if email fails
        }

        res.json({
            success: true,
            message: "Password changed successfully. A notification email has been sent.",
        });

    } catch (error) {
        console.error("Change password error:", error);
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

        if (role !== "MANAGER") {
            return res.status(403).json({
                success: false,
                message: "Access denied. Only managers can view team members.",
            });
        }

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