const express = require("express");
const Policy = require("../models/Policy");

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

        return res.status(401).json({
            success: false,
            message: "Not authorized. Please login."
        });

    } catch (error) {
        console.error("Auth error:", error);
        return res.status(401).json({
            success: false,
            message: "Invalid token"
        });
    }
});

// ========== HELPER: CREATE DEFAULT POLICY WITH DEFAULT SALARY COMPONENTS ==========
async function createDefaultPolicy() {
    const defaultPolicy = new Policy({
        isActive: true,
        attendanceRules: {
            workingHoursStart: "09:00",
            workingHoursEnd: "18:00",
            gracePeriodMinutes: 15,
            halfDayAfterMinutes: 60,
            halfDayEndTime: "12:00",
            breakStart: "13:00",
            breakEnd: "14:00",
            weeklyOffDays: [0],
            saturdayRule: "half_day",
        },
        holidays: [],
        leaveTypes: [
            {
                name: "Casual Leave",
                code: "CL",
                description: "For personal emergencies and casual needs",
                yearlyLimit: 12,
                minDaysToApply: 1,
                maxDaysAtOnce: 3,
                isUnpaid: false,
                applicableRoles: ["HR", "MANAGER", "EMPLOYEE"],
                isActive: true,
                createdBy: "SYSTEM",
            },
            {
                name: "Sick Leave",
                code: "SL",
                description: "For medical reasons and health issues",
                yearlyLimit: 12,
                minDaysToApply: 1,
                maxDaysAtOnce: 3,
                isUnpaid: false,
                applicableRoles: ["HR", "MANAGER", "EMPLOYEE"],
                isActive: true,
                createdBy: "SYSTEM",
            },
            {
                name: "Earned Leave",
                code: "EL",
                description: "Accrued leave based on service",
                yearlyLimit: 15,
                minDaysToApply: 1,
                maxDaysAtOnce: 5,
                isUnpaid: false,
                applicableRoles: ["HR", "MANAGER", "EMPLOYEE"],
                isActive: true,
                createdBy: "SYSTEM",
            },
            {
                name: "Paid Leave",
                code: "PL",
                description: "Paid time off / Annual leave",
                yearlyLimit: 20,
                minDaysToApply: 1,
                maxDaysAtOnce: 10,
                isUnpaid: false,
                applicableRoles: ["HR", "MANAGER", "EMPLOYEE"],
                isActive: true,
                createdBy: "SYSTEM",
            },
            {
                name: "Unpaid Leave",
                code: "LOP",
                description: "Loss of pay - when all paid leaves are exhausted",
                yearlyLimit: null,
                minDaysToApply: 1,
                maxDaysAtOnce: null,
                isUnpaid: true,
                applicableRoles: ["HR", "MANAGER", "EMPLOYEE"],
                isActive: true,
                createdBy: "SYSTEM",
            },
        ],
        // ========== DEFAULT SALARY COMPONENTS (NO BASIC SALARY) ==========
        salaryComponents: [
            // ADDITIONS (Earnings)
            {
                name: "House Rent Allowance",
                code: "HRA",
                type: "addition",
                calculationType: "percentage",
                value: 40,
                isActive: true,
                description: "House Rent Allowance - 40% of basic salary",
                order: 1,
                createdBy: "SYSTEM",
            },
            {
                name: "Dearness Allowance",
                code: "DA",
                type: "addition",
                calculationType: "percentage",
                value: 10,
                isActive: true,
                description: "Dearness Allowance - 10% of basic salary",
                order: 2,
                createdBy: "SYSTEM",
            },
            {
                name: "Conveyance Allowance",
                code: "CONVEYANCE",
                type: "addition",
                calculationType: "percentage",
                value: 5,
                isActive: true,
                description: "Conveyance Allowance - 5% of basic salary",
                order: 3,
                createdBy: "SYSTEM",
            },
            {
                name: "Medical Allowance",
                code: "MEDICAL",
                type: "addition",
                calculationType: "percentage",
                value: 3,
                isActive: true,
                description: "Medical Allowance - 3% of basic salary",
                order: 4,
                createdBy: "SYSTEM",
            },
            {
                name: "Special Allowance",
                code: "SPECIAL",
                type: "addition",
                calculationType: "percentage",
                value: 7,
                isActive: true,
                description: "Special Allowance - 7% of basic salary",
                order: 5,
                createdBy: "SYSTEM",
            },
            // DEDUCTIONS
            {
                name: "Provident Fund",
                code: "PF",
                type: "deduction",
                calculationType: "percentage",
                value: 12,
                isActive: true,
                description: "Provident Fund - 12% of basic salary",
                order: 1,
                createdBy: "SYSTEM",
            },
            {
                name: "Professional Tax",
                code: "PT",
                type: "deduction",
                calculationType: "fixed",
                value: 200,
                isActive: true,
                description: "Professional Tax - Fixed ₹200 per month",
                order: 2,
                createdBy: "SYSTEM",
            },
            {
                name: "ESI",
                code: "ESI",
                type: "deduction",
                calculationType: "percentage",
                value: 0.75,
                isActive: true,
                description: "ESI - 0.75% of basic salary",
                order: 3,
                createdBy: "SYSTEM",
            },
        ],
        updatedBy: "SYSTEM",
        version: 1,
    });

    await defaultPolicy.save();
    return defaultPolicy;
}

// ========== GET CURRENT ACTIVE POLICY ==========
router.get("/", async (req, res) => {
    try {
        let policy = await Policy.findOne({ isActive: true });

        if (!policy) {
            policy = await createDefaultPolicy();
        }

        res.json({ success: true, policy });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========== UPDATE ATTENDANCE RULES ==========
router.put("/attendance-rules", async (req, res) => {
    if (req.user.role !== "ADMIN") {
        return res.status(403).json({ success: false, message: "Access denied. Admin only." });
    }

    try {
        const policy = await Policy.findOne({ isActive: true });
        if (!policy) {
            return res.status(404).json({ success: false, message: "No active policy found" });
        }

        policy.attendanceRules = {
            ...policy.attendanceRules.toObject(),
            ...req.body,
            updatedAt: new Date(),
            updatedBy: req.user.employeeId || "ADMIN"
        };
        policy.updatedBy = req.user.employeeId || "ADMIN";
        policy.version += 1;

        await policy.save();
        res.json({ success: true, policy });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========== ADD HOLIDAY ==========
router.post("/holidays", async (req, res) => {
    if (req.user.role !== "ADMIN" && req.user.role !== "HR") {
        return res.status(403).json({ success: false, message: "Access denied. Admin/HR only." });
    }

    try {
        const { name, date, startDate, endDate, type, description, isRange } = req.body;
        const policy = await Policy.findOne({ isActive: true });

        if (!policy) {
            return res.status(404).json({ success: false, message: "No active policy found" });
        }

        const newHoliday = {
            name,
            type: type || "public",
            description: description || "",
            createdBy: req.user.employeeId || "ADMIN"
        };

        if (isRange) {
            newHoliday.startDate = new Date(startDate);
            newHoliday.endDate = new Date(endDate);
            newHoliday.isRange = true;
        } else {
            newHoliday.date = new Date(date);
            newHoliday.isRange = false;
        }

        policy.holidays.push(newHoliday);
        policy.updatedBy = req.user.employeeId || "ADMIN";
        policy.version += 1;
        await policy.save();

        res.json({ success: true, message: "Holiday added successfully", holiday: newHoliday });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========== DELETE HOLIDAY ==========
router.delete("/holidays/:holidayId", async (req, res) => {
    if (req.user.role !== "ADMIN" && req.user.role !== "HR") {
        return res.status(403).json({ success: false, message: "Access denied. Admin/HR only." });
    }

    try {
        const policy = await Policy.findOne({ isActive: true });
        if (!policy) {
            return res.status(404).json({ success: false, message: "No active policy found" });
        }

        const holidayIndex = policy.holidays.findIndex(h => h._id.toString() === req.params.holidayId);
        if (holidayIndex === -1) {
            return res.status(404).json({ success: false, message: "Holiday not found" });
        }

        policy.holidays.splice(holidayIndex, 1);
        policy.updatedBy = req.user.employeeId || "ADMIN";
        policy.version += 1;
        await policy.save();

        res.json({ success: true, message: "Holiday deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========== GET ALL LEAVE TYPES ==========
router.get("/leave-types", async (req, res) => {
    try {
        const policy = await Policy.findOne({ isActive: true });
        if (!policy) {
            return res.status(404).json({ success: false, message: "No active policy found" });
        }

        res.json({
            success: true,
            leaveTypes: policy.leaveTypes.filter(lt => lt.isActive !== false)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========== ADD NEW LEAVE TYPE ==========
router.post("/leave-types", async (req, res) => {
    if (req.user.role !== "ADMIN" && req.user.role !== "HR") {
        return res.status(403).json({ success: false, message: "Access denied. Admin/HR only." });
    }

    try {
        const { name, code, description, yearlyLimit, minDaysToApply, maxDaysAtOnce, applicableRoles } = req.body;

        const policy = await Policy.findOne({ isActive: true });
        if (!policy) {
            return res.status(404).json({ success: false, message: "No active policy found" });
        }

        if (policy.leaveTypes.some(lt => lt.code === code)) {
            return res.status(400).json({ success: false, message: "Leave type code already exists" });
        }

        const newLeaveType = {
            name,
            code,
            description: description || "",
            yearlyLimit,
            minDaysToApply: minDaysToApply || 1,
            maxDaysAtOnce: maxDaysAtOnce || 5,
            applicableRoles: applicableRoles || ["HR", "MANAGER", "EMPLOYEE"],
            isActive: true,
            createdBy: req.user.employeeId || "ADMIN",
            createdAt: new Date(),
        };

        policy.leaveTypes.push(newLeaveType);
        policy.updatedBy = req.user.employeeId || "ADMIN";
        policy.version += 1;
        await policy.save();

        res.json({ success: true, message: "Leave type added successfully", leaveType: newLeaveType });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========== UPDATE LEAVE TYPE ==========
router.put("/leave-types/:code", async (req, res) => {
    if (req.user.role !== "ADMIN" && req.user.role !== "HR") {
        return res.status(403).json({ success: false, message: "Access denied. Admin/HR only." });
    }

    try {
        const { code } = req.params;
        const { name, description, yearlyLimit, minDaysToApply, maxDaysAtOnce, applicableRoles, isActive } = req.body;

        const policy = await Policy.findOne({ isActive: true });
        if (!policy) {
            return res.status(404).json({ success: false, message: "No active policy found" });
        }

        const index = policy.leaveTypes.findIndex(lt => lt.code === code);
        if (index === -1) {
            return res.status(404).json({ success: false, message: "Leave type not found" });
        }

        if (name) policy.leaveTypes[index].name = name;
        if (description !== undefined) policy.leaveTypes[index].description = description;
        if (yearlyLimit) policy.leaveTypes[index].yearlyLimit = yearlyLimit;
        if (minDaysToApply) policy.leaveTypes[index].minDaysToApply = minDaysToApply;
        if (maxDaysAtOnce) policy.leaveTypes[index].maxDaysAtOnce = maxDaysAtOnce;
        if (applicableRoles) policy.leaveTypes[index].applicableRoles = applicableRoles;
        if (isActive !== undefined) policy.leaveTypes[index].isActive = isActive;

        policy.leaveTypes[index].updatedBy = req.user.employeeId || "ADMIN";
        policy.leaveTypes[index].updatedAt = new Date();
        policy.updatedBy = req.user.employeeId || "ADMIN";
        policy.version += 1;

        await policy.save();

        res.json({ success: true, message: "Leave type updated successfully", leaveType: policy.leaveTypes[index] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========== DELETE LEAVE TYPE (Soft Delete) ==========
router.delete("/leave-types/:code", async (req, res) => {
    if (req.user.role !== "ADMIN" && req.user.role !== "HR") {
        return res.status(403).json({ success: false, message: "Access denied. Admin/HR only." });
    }

    try {
        const { code } = req.params;

        const policy = await Policy.findOne({ isActive: true });
        if (!policy) {
            return res.status(404).json({ success: false, message: "No active policy found" });
        }

        const index = policy.leaveTypes.findIndex(lt => lt.code === code);
        if (index === -1) {
            return res.status(404).json({ success: false, message: "Leave type not found" });
        }

        policy.leaveTypes[index].isActive = false;
        policy.leaveTypes[index].updatedBy = req.user.employeeId || "ADMIN";
        policy.leaveTypes[index].updatedAt = new Date();
        policy.updatedBy = req.user.employeeId || "ADMIN";
        policy.version += 1;

        await policy.save();

        res.json({ success: true, message: "Leave type disabled successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========== SALARY COMPONENTS CRUD (NEW - ADMIN ONLY) ==========

// GET all salary components
router.get("/salary-components", async (req, res) => {
    try {
        let policy = await Policy.findOne({ isActive: true });

        if (!policy) {
            policy = await createDefaultPolicy();
        }

        const { showInactive } = req.query;
        let components = policy.salaryComponents || [];

        if (showInactive !== 'true') {
            components = components.filter(c => c.isActive !== false);
        }

        components.sort((a, b) => (a.order || 0) - (b.order || 0));

        res.json({
            success: true,
            salaryComponents: components
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ADD new salary component (ADMIN ONLY)
router.post("/salary-components", async (req, res) => {
    if (req.user.role !== "ADMIN") {
        return res.status(403).json({
            success: false,
            message: "Access denied. Admin only."
        });
    }

    try {
        const {
            name, code, type, calculationType, value,
            description, order
        } = req.body;

        if (!name || !code || !type || value === undefined) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields: name, code, type, value"
            });
        }

        const policy = await Policy.findOne({ isActive: true });
        if (!policy) {
            return res.status(404).json({
                success: false,
                message: "No active policy found"
            });
        }

        const existingComponent = policy.salaryComponents?.find(c => c.code === code.toUpperCase());
        if (existingComponent) {
            return res.status(400).json({
                success: false,
                message: `Salary component with code '${code}' already exists`
            });
        }

        const newComponent = {
            name,
            code: code.toUpperCase(),
            type,
            calculationType: calculationType || "percentage",
            value: parseFloat(value),
            isActive: true,
            description: description || "",
            order: order || 0,
            createdBy: req.user.employeeId || "ADMIN"
        };

        if (!policy.salaryComponents) {
            policy.salaryComponents = [];
        }

        policy.salaryComponents.push(newComponent);
        policy.updatedBy = req.user.employeeId || "ADMIN";
        policy.version += 1;

        await policy.save();

        res.json({
            success: true,
            message: "Salary component added successfully",
            salaryComponent: newComponent
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// UPDATE salary component (ADMIN ONLY)
router.put("/salary-components/:code", async (req, res) => {
    if (req.user.role !== "ADMIN") {
        return res.status(403).json({
            success: false,
            message: "Access denied. Admin only."
        });
    }

    try {
        const { code } = req.params;
        const {
            name, type, calculationType, value,
            description, order, isActive
        } = req.body;

        const policy = await Policy.findOne({ isActive: true });
        if (!policy) {
            return res.status(404).json({
                success: false,
                message: "No active policy found"
            });
        }

        const componentIndex = policy.salaryComponents.findIndex(c => c.code === code);
        if (componentIndex === -1) {
            return res.status(404).json({
                success: false,
                message: "Salary component not found"
            });
        }

        if (name) policy.salaryComponents[componentIndex].name = name;
        if (type) policy.salaryComponents[componentIndex].type = type;
        if (calculationType) policy.salaryComponents[componentIndex].calculationType = calculationType;
        if (value !== undefined) policy.salaryComponents[componentIndex].value = parseFloat(value);
        if (description !== undefined) policy.salaryComponents[componentIndex].description = description;
        if (order !== undefined) policy.salaryComponents[componentIndex].order = order;
        if (isActive !== undefined) policy.salaryComponents[componentIndex].isActive = isActive;

        policy.salaryComponents[componentIndex].updatedBy = req.user.employeeId || "ADMIN";
        policy.updatedBy = req.user.employeeId || "ADMIN";
        policy.version += 1;

        await policy.save();

        res.json({
            success: true,
            message: "Salary component updated successfully",
            salaryComponent: policy.salaryComponents[componentIndex]
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE (Soft Delete) salary component (ADMIN ONLY)
router.delete("/salary-components/:code", async (req, res) => {
    if (req.user.role !== "ADMIN") {
        return res.status(403).json({
            success: false,
            message: "Access denied. Admin only."
        });
    }

    try {
        const { code } = req.params;

        const policy = await Policy.findOne({ isActive: true });
        if (!policy) {
            return res.status(404).json({
                success: false,
                message: "No active policy found"
            });
        }

        const componentIndex = policy.salaryComponents.findIndex(c => c.code === code);
        if (componentIndex === -1) {
            return res.status(404).json({
                success: false,
                message: "Salary component not found"
            });
        }

        policy.salaryComponents[componentIndex].isActive = false;
        policy.salaryComponents[componentIndex].updatedBy = req.user.employeeId || "ADMIN";
        policy.updatedBy = req.user.employeeId || "ADMIN";
        policy.version += 1;

        await policy.save();

        res.json({
            success: true,
            message: "Salary component disabled successfully"
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// REORDER salary components (ADMIN ONLY)
router.put("/salary-components/reorder", async (req, res) => {
    if (req.user.role !== "ADMIN") {
        return res.status(403).json({
            success: false,
            message: "Access denied. Admin only."
        });
    }

    try {
        const { components } = req.body;

        const policy = await Policy.findOne({ isActive: true });
        if (!policy) {
            return res.status(404).json({
                success: false,
                message: "No active policy found"
            });
        }

        for (const item of components) {
            const component = policy.salaryComponents.find(c => c.code === item.code);
            if (component) {
                component.order = item.order;
            }
        }

        policy.updatedBy = req.user.employeeId || "ADMIN";
        policy.version += 1;
        await policy.save();

        res.json({
            success: true,
            message: "Salary components reordered successfully"
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;