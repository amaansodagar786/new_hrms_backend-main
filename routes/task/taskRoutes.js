const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Task = require("../../models/Task/Task");
const User = require("../../models/User");
const { sendTaskAssignedEmail, getUserEmail } = require("../../utils/taskEmailService");

const router = express.Router();

// ========== CUSTOM AUTH MIDDLEWARE ==========
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

// ========== CREATE TASK ==========
router.post("/create", async (req, res) => {
    try {
        const { title, description, deadline, notes } = req.body;
        const userId = req.user.employeeId;
        const userName = req.user.name;
        const role = req.user.role;

        // Only Manager, HR, Admin can create tasks
        if (role !== "MANAGER" && role !== "HR" && role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Only Managers, HR, and Admin can create tasks",
            });
        }

        if (!title) {
            return res.status(400).json({
                success: false,
                message: "Task title is required",
            });
        }

        const taskId = `TASK_${uuidv4()}`;

        const task = new Task({
            taskId,
            title,
            description: description || "",
            deadline: deadline || null,
            createdBy: userId,
            createdByName: userName,
            assignedTo: [],
            notes: notes || "",
        });

        await task.save();

        res.status(201).json({
            success: true,
            message: "Task created successfully",
            task,
        });
    } catch (error) {
        console.error("Create task error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== ASSIGN TASK TO EMPLOYEES ==========
router.put("/:taskId/assign", async (req, res) => {
    try {
        const { taskId } = req.params;
        const { employeeIds } = req.body; // Array of employeeIds
        const role = req.user.role;
        const userId = req.user.employeeId;

        const task = await Task.findOne({ taskId });
        if (!task) {
            return res.status(404).json({
                success: false,
                message: "Task not found",
            });
        }

        // Check permission - only creator or admin/hr can assign
        if (task.createdBy !== userId && role !== "ADMIN" && role !== "HR") {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to assign this task",
            });
        }

        if (!employeeIds || employeeIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please select at least one employee",
            });
        }

        // Get employee details
        const employees = await User.find({
            employeeId: { $in: employeeIds },
            role: "EMPLOYEE"
        }).select("employeeId name email");

        const newAssignments = [];
        for (const emp of employees) {
            // Check if already assigned
            const alreadyAssigned = task.assignedTo.some(a => a.employeeId === emp.employeeId);
            if (!alreadyAssigned) {
                newAssignments.push({
                    employeeId: emp.employeeId,
                    employeeName: emp.name,
                    assignedAt: new Date(),
                });

                // Send email notification
                const employeeEmail = await getUserEmail(emp.employeeId);
                if (employeeEmail) {
                    await sendTaskAssignedEmail(task, { employeeId: emp.employeeId, employeeName: emp.name, employeeEmail }, task.createdByName);
                }
            }
        }

        task.assignedTo.push(...newAssignments);
        await task.save();

        res.json({
            success: true,
            message: `Task assigned to ${newAssignments.length} employee(s)`,
            assignedCount: newAssignments.length,
        });
    } catch (error) {
        console.error("Assign task error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== MARK TASK COMPLETE ==========
router.put("/:taskId/complete", async (req, res) => {
    try {
        const { taskId } = req.params;
        const userId = req.user.employeeId;
        const role = req.user.role;

        const task = await Task.findOne({ taskId });
        if (!task) {
            return res.status(404).json({
                success: false,
                message: "Task not found",
            });
        }

        // Only creator or admin/hr can mark complete
        if (task.createdBy !== userId && role !== "ADMIN" && role !== "HR") {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to mark this task as complete",
            });
        }

        if (task.status === "COMPLETE") {
            return res.status(400).json({
                success: false,
                message: "Task is already marked as complete",
            });
        }

        task.status = "COMPLETE";
        task.completedAt = new Date();
        task.completedBy = userId;
        await task.save();

        res.json({
            success: true,
            message: "Task marked as complete",
            task,
        });
    } catch (error) {
        console.error("Complete task error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET TASKS CREATED BY ME (Manager/HR/Admin) ==========
router.get("/created-by-me", async (req, res) => {
    try {
        const userId = req.user.employeeId;
        const { status, page = 1, limit = 20 } = req.query;

        let filter = { createdBy: userId };
        if (status) filter.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const tasks = await Task.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await Task.countDocuments(filter);

        res.json({
            success: true,
            tasks,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error("Get created tasks error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET TASKS ASSIGNED TO ME (Employee) ==========
router.get("/assigned-to-me", async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const { status, page = 1, limit = 20 } = req.query;

        let filter = { "assignedTo.employeeId": employeeId };
        if (status) filter.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const tasks = await Task.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await Task.countDocuments(filter);

        res.json({
            success: true,
            tasks,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error("Get assigned tasks error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET ALL TASKS (HR/Admin only) ==========
router.get("/all", async (req, res) => {
    try {
        const role = req.user.role;

        if (role !== "HR" && role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Access denied. Only HR and Admin can view all tasks.",
            });
        }

        const { status, createdBy, page = 1, limit = 20 } = req.query;

        let filter = {};
        if (status) filter.status = status;
        if (createdBy) filter.createdBy = createdBy;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const tasks = await Task.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await Task.countDocuments(filter);

        res.json({
            success: true,
            tasks,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error("Get all tasks error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

module.exports = router;