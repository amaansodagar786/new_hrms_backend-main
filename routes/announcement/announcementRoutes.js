const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Announcement = require("../../models/Announcement/Announcement");
const AnnouncementRead = require("../../models/Announcement/AnnouncementRead");
const User = require("../../models/User");
const { sendAnnouncementEmail, getUserEmail } = require("../../utils/announcementEmailService");

const router = express.Router();

// ========== CUSTOM AUTH MIDDLEWARE (Accepts both employeeToken AND adminToken) ==========
router.use(async (req, res, next) => {
    try {
        const jwt = require("jsonwebtoken");
        let token = req.cookies.employeeToken;

        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
            return next();
        }

        token = req.cookies.adminToken;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = {
                employeeId: decoded.adminId,
                name: "Admin",
                role: "ADMIN"
            };
            return next();
        }

        return res.status(401).json({ success: false, message: "Not authorized" });
    } catch (error) {
        return res.status(401).json({ success: false, message: "Invalid token" });
    }
});

// ========== HELPER: Check if user can manage announcements ==========
const canManageAnnouncements = (role) => {
    return role === "HR" || role === "ADMIN";
};

// ========== HELPER: Check if user can edit/delete announcement ==========
const canModifyAnnouncement = (announcement, userRole, userId) => {
    if (userRole === "ADMIN") return true;
    if (userRole === "HR" && announcement.createdBy === userId) return true;
    return false;
};

// ========== CREATE ANNOUNCEMENT ==========
router.post("/", async (req, res) => {
    try {
        const { title, content, type, priority, targetAudience, isPinned, expiresAt } = req.body;
        const userId = req.user.employeeId;
        const userName = req.user.name;
        const userRole = req.user.role;

        // Only HR and Admin can create announcements
        if (!canManageAnnouncements(userRole)) {
            return res.status(403).json({
                success: false,
                message: "Only HR and Admin can create announcements",
            });
        }

        if (!title || !content) {
            return res.status(400).json({
                success: false,
                message: "Title and content are required",
            });
        }

        const announcementId = `ANN_${uuidv4()}`;

        const announcement = new Announcement({
            announcementId,
            title,
            content,
            type: type || "general",
            priority: priority || "medium",
            targetAudience: targetAudience || ["HR", "MANAGER", "EMPLOYEE", "ADMIN"],
            isPinned: isPinned || false,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            createdBy: userId,
            createdByName: userName,
            createdByRole: userRole === "ADMIN" ? "ADMIN" : "HR",
        });

        await announcement.save();

        // Send email notifications to all active employees
        const allEmployees = await User.find({ isActive: true }).select("employeeId name email role");
        
        // Filter by target audience
        const targetEmployees = allEmployees.filter(emp => 
            announcement.targetAudience.includes(emp.role)
        );

        for (const emp of targetEmployees) {
            const employeeEmail = await getUserEmail(emp.employeeId);
            if (employeeEmail) {
                await sendAnnouncementEmail(announcement, emp, userName);
            }
        }

        res.status(201).json({
            success: true,
            message: "Announcement created successfully",
            announcement,
        });
    } catch (error) {
        console.error("Create announcement error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET ALL ACTIVE ANNOUNCEMENTS (for users) ==========
router.get("/", async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const role = req.user.role;
        const currentDate = new Date();

        // Get active announcements (not expired, isActive true)
        let filter = {
            isActive: true,
            $or: [
                { expiresAt: null },
                { expiresAt: { $gt: currentDate } }
            ],
            targetAudience: { $in: [role] }
        };

        let announcements = await Announcement.find(filter)
            .sort({ isPinned: -1, createdAt: -1 })
            .lean();

        // Get read status for this user
        const readRecords = await AnnouncementRead.find({ 
            employeeId,
            announcementId: { $in: announcements.map(a => a.announcementId) }
        }).lean();

        const readMap = new Map();
        readRecords.forEach(r => readMap.set(r.announcementId, true));

        // Add read status to each announcement
        announcements = announcements.map(announcement => ({
            ...announcement,
            isRead: readMap.has(announcement.announcementId) || false,
        }));

        res.json({
            success: true,
            announcements,
            unreadCount: announcements.filter(a => !a.isRead).length,
        });
    } catch (error) {
        console.error("Get announcements error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET ALL ANNOUNCEMENTS (HR/Admin only - for management) ==========
router.get("/all", async (req, res) => {
    try {
        const role = req.user.role;

        if (!canManageAnnouncements(role)) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }

        const { status, type, page = 1, limit = 20 } = req.query;
        const currentDate = new Date();

        let filter = {};
        
        if (status === "active") {
            filter.isActive = true;
            filter.$or = [
                { expiresAt: null },
                { expiresAt: { $gt: currentDate } }
            ];
        } else if (status === "expired") {
            filter.isActive = true;
            filter.expiresAt = { $lte: currentDate };
        } else if (status === "inactive") {
            filter.isActive = false;
        }

        if (type) filter.type = type;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const announcements = await Announcement.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await Announcement.countDocuments(filter);

        res.json({
            success: true,
            announcements,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error("Get all announcements error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET SINGLE ANNOUNCEMENT ==========
router.get("/:announcementId", async (req, res) => {
    try {
        const { announcementId } = req.params;
        const role = req.user.role;

        const announcement = await Announcement.findOne({ announcementId }).lean();

        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found",
            });
        }

        // Check if user can view this announcement
        if (!announcement.targetAudience.includes(role)) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }

        res.json({
            success: true,
            announcement,
        });
    } catch (error) {
        console.error("Get announcement error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== MARK ANNOUNCEMENT AS READ ==========
router.post("/:announcementId/read", async (req, res) => {
    try {
        const { announcementId } = req.params;
        const employeeId = req.user.employeeId;

        // Check if announcement exists
        const announcement = await Announcement.findOne({ announcementId });
        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found",
            });
        }

        // Create read record (upsert to avoid duplicates)
        await AnnouncementRead.updateOne(
            { announcementId, employeeId },
            { announcementId, employeeId, readAt: new Date() },
            { upsert: true }
        );

        res.json({
            success: true,
            message: "Marked as read",
        });
    } catch (error) {
        console.error("Mark read error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET READ RECEIPTS FOR ANNOUNCEMENT (HR/Admin only) ==========
router.get("/:announcementId/readers", async (req, res) => {
    try {
        const { announcementId } = req.params;
        const role = req.user.role;

        if (!canManageAnnouncements(role)) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }

        const announcement = await Announcement.findOne({ announcementId });
        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found",
            });
        }

        // Get all users who should see this announcement (based on target audience)
        const allTargetUsers = await User.find({
            role: { $in: announcement.targetAudience },
            isActive: true,
        }).select("employeeId name email role");

        // Get users who have read
        const readRecords = await AnnouncementRead.find({ announcementId }).lean();
        const readEmployeeIds = new Set(readRecords.map(r => r.employeeId));

        const readers = allTargetUsers.filter(u => readEmployeeIds.has(u.employeeId)).map(u => ({
            employeeId: u.employeeId,
            name: u.name,
            email: u.email,
            role: u.role,
            readAt: readRecords.find(r => r.employeeId === u.employeeId)?.readAt,
        }));

        const nonReaders = allTargetUsers.filter(u => !readEmployeeIds.has(u.employeeId)).map(u => ({
            employeeId: u.employeeId,
            name: u.name,
            email: u.email,
            role: u.role,
        }));

        res.json({
            success: true,
            totalTarget: allTargetUsers.length,
            readCount: readers.length,
            unreadCount: nonReaders.length,
            readers,
            nonReaders,
        });
    } catch (error) {
        console.error("Get readers error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== UPDATE ANNOUNCEMENT ==========
router.put("/:announcementId", async (req, res) => {
    try {
        const { announcementId } = req.params;
        const { title, content, type, priority, targetAudience, isPinned, expiresAt, isActive } = req.body;
        const userId = req.user.employeeId;
        const userRole = req.user.role;

        const announcement = await Announcement.findOne({ announcementId });
        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found",
            });
        }

        // Check permission
        if (!canModifyAnnouncement(announcement, userRole, userId)) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to edit this announcement",
            });
        }

        // Update fields
        if (title) announcement.title = title;
        if (content) announcement.content = content;
        if (type) announcement.type = type;
        if (priority) announcement.priority = priority;
        if (targetAudience) announcement.targetAudience = targetAudience;
        if (isPinned !== undefined) announcement.isPinned = isPinned;
        if (expiresAt !== undefined) announcement.expiresAt = expiresAt ? new Date(expiresAt) : null;
        if (isActive !== undefined) announcement.isActive = isActive;

        await announcement.save();

        res.json({
            success: true,
            message: "Announcement updated successfully",
            announcement,
        });
    } catch (error) {
        console.error("Update announcement error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== DELETE ANNOUNCEMENT ==========
router.delete("/:announcementId", async (req, res) => {
    try {
        const { announcementId } = req.params;
        const userId = req.user.employeeId;
        const userRole = req.user.role;

        const announcement = await Announcement.findOne({ announcementId });
        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found",
            });
        }

        // Check permission
        if (!canModifyAnnouncement(announcement, userRole, userId)) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to delete this announcement",
            });
        }

        // Delete read receipts first
        await AnnouncementRead.deleteMany({ announcementId });
        
        // Delete announcement
        await Announcement.deleteOne({ announcementId });

        res.json({
            success: true,
            message: "Announcement deleted successfully",
        });
    } catch (error) {
        console.error("Delete announcement error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET UNREAD COUNT FOR USER ==========
router.get("/unread/count", async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const role = req.user.role;
        const currentDate = new Date();

        // Get active announcements for this user's role
        const filter = {
            isActive: true,
            $or: [
                { expiresAt: null },
                { expiresAt: { $gt: currentDate } }
            ],
            targetAudience: { $in: [role] }
        };

        const announcements = await Announcement.find(filter).select("announcementId").lean();
        const announcementIds = announcements.map(a => a.announcementId);

        // Get read records for this user
        const readRecords = await AnnouncementRead.find({
            employeeId,
            announcementId: { $in: announcementIds }
        }).lean();

        const unreadCount = announcementIds.length - readRecords.length;

        res.json({
            success: true,
            unreadCount,
        });
    } catch (error) {
        console.error("Get unread count error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

module.exports = router;