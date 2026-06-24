const express = require("express");
const Leave = require("../../models/Leave/Leave");
const LeaveBalance = require("../../models/Leave/LeaveBalance");
const User = require("../../models/User");
const Policy = require("../../models/Policy");
const { sendLeaveStatusEmail, getUserEmail } = require("../../utils/leaveEmailService");

const router = express.Router();

// ========== CUSTOM AUTH MIDDLEWARE (Accepts both employeeToken AND adminToken) ==========
router.use(async (req, res, next) => {
    try {
        const jwt = require("jsonwebtoken");

        // First try employeeToken
        let token = req.cookies.employeeToken;

        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
            return next();
        }

        // If no employeeToken, try adminToken
        token = req.cookies.adminToken;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            // IMPORTANT: Set ALL required fields!
            req.user = {
                employeeId: decoded.adminId,
                name: "Admin",
                role: "ADMIN",
                adminId: decoded.adminId  // Add this
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

// ========== HELPER: Get policy (leave types) ==========
const getPolicyLeaveTypes = async () => {
    const policy = await Policy.findOne({ isActive: true });
    if (!policy) return [];
    return policy.leaveTypes.filter(lt => lt.isActive !== false);
};

// ========== HELPER: Check if date is holiday ==========
const isHoliday = (dateStr, policy) => {
    const dateString = dateStr;
    return policy.holidays.some(holiday => {
        if (holiday.isRange) {
            const startDate = new Date(holiday.startDate).toISOString().split("T")[0];
            const endDate = new Date(holiday.endDate).toISOString().split("T")[0];
            return dateString >= startDate && dateString <= endDate;
        } else {
            const holidayDate = new Date(holiday.date).toISOString().split("T")[0];
            return dateString === holidayDate;
        }
    });
};

// ========== HELPER: Check if date is weekend ==========
const isWeekend = (dateStr, policy) => {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const weeklyOffDays = policy.attendanceRules?.weeklyOffDays || [0];
    if (dayOfWeek === 6) {
        const saturdayRule = policy.attendanceRules?.saturdayRule || "half_day";
        return saturdayRule === "off";
    }
    return weeklyOffDays.includes(dayOfWeek);
};

// ========== HELPER: Calculate working days excluding holidays/weekends (UPDATED for half-day) ==========
const calculateWorkingDays = (fromDate, toDate, daysArray, policy) => {
    const start = new Date(fromDate);
    const end = new Date(toDate);
    let workingDays = 0;
    const current = new Date(start);

    // Create map for half-day info
    const halfDayMap = new Map();
    for (const day of daysArray) {
        if (day.isHalfDay) {
            halfDayMap.set(day.date, true);
        }
    }

    while (current <= end) {
        const dateStr = current.toISOString().split("T")[0];
        if (!isHoliday(dateStr, policy) && !isWeekend(dateStr, policy)) {
            if (halfDayMap.has(dateStr)) {
                workingDays += 0.5;  // Half day
            } else {
                workingDays += 1;     // Full day
            }
        }
        current.setDate(current.getDate() + 1);
    }
    return workingDays;
};

// ========== HELPER: Get or create leave balance for employee ==========
const getOrCreateLeaveBalance = async (employeeId, employeeName, year = new Date().getFullYear()) => {
    let balance = await LeaveBalance.findOne({ employeeId, year });
    if (!balance) {
        const policy = await getPolicyLeaveTypes();
        const balances = [];
        for (const lt of policy) {
            balances.push({
                leaveType: lt.code,
                total: lt.yearlyLimit || 0,
                used: 0,
                remaining: lt.yearlyLimit || 0,
            });
        }
        balance = new LeaveBalance({
            employeeId,
            employeeName,
            year,
            balances,
        });
        await balance.save();
    }
    return balance;
};

// ========== HELPER: Update leave balance after approval (UPDATED for half-day & unpaid leaves) ==========
const updateLeaveBalance = async (employeeId, leaveTypeSummary, isAdding = false) => {
    const year = new Date().getFullYear();
    const balance = await LeaveBalance.findOne({ employeeId, year });
    if (!balance) return null;

    // Get policy to know which leave types are unpaid
    const policy = await Policy.findOne({ isActive: true });

    for (const summary of leaveTypeSummary) {
        // Find if this leave type is unpaid
        const policyLeaveType = policy?.leaveTypes?.find(lt => lt.code === summary.leaveType);

        // SKIP balance update for unpaid leaves (LOP)
        if (policyLeaveType?.isUnpaid === true) {
            continue;
        }

        const balanceIndex = balance.balances.findIndex(b => b.leaveType === summary.leaveType);
        if (balanceIndex !== -1) {
            if (isAdding) {
                balance.balances[balanceIndex].used -= summary.daysCount;
                balance.balances[balanceIndex].remaining += summary.daysCount;
            } else {
                balance.balances[balanceIndex].used += summary.daysCount;
                balance.balances[balanceIndex].remaining -= summary.daysCount;
            }
        }
    }
    balance.lastUpdated = new Date();
    await balance.save();
    return balance;
};

const getApproverRole = (applicantRole) => {
    switch (applicantRole) {
        case "EMPLOYEE": return ["MANAGER", "HR"];  // Both can approve
        case "MANAGER": return "HR";
        case "HR": return "ADMIN";
        default: return "ADMIN";
    }
};

// ========== APPLY FOR LEAVE (UPDATED for half-day) ==========
router.post("/apply", async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const employeeName = req.user.name;
        const role = req.user.role;
        const { fromDate, toDate, days, reason } = req.body;

        if (!fromDate || !toDate || !days || days.length === 0 || !reason) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields: fromDate, toDate, days, reason",
            });
        }

        const policy = await Policy.findOne({ isActive: true });
        if (!policy) {
            return res.status(400).json({
                success: false,
                message: "No active policy found",
            });
        }

        // UPDATED: Pass days array to calculateWorkingDays
        const totalDays = calculateWorkingDays(fromDate, toDate, days, policy);

        if (totalDays === 0) {
            return res.status(400).json({
                success: false,
                message: "No working days selected. All dates are holidays or weekends.",
            });
        }

        if (totalDays > 10) {
            return res.status(400).json({
                success: false,
                message: `Cannot apply for more than 10 consecutive days. You requested ${totalDays} days.`,
            });
        }

        const today = new Date().toISOString().split("T")[0];
        if (fromDate < today) {
            return res.status(400).json({
                success: false,
                message: "Cannot apply for leave in the past.",
            });
        }

        const existingLeave = await Leave.findOne({
            employeeId,
            status: { $in: ["PENDING", "APPROVED"] },
            $or: [{ fromDate: { $lte: toDate }, toDate: { $gte: fromDate } }]
        });

        if (existingLeave) {
            return res.status(400).json({
                success: false,
                message: "You already have a pending or approved leave request for these dates.",
            });
        }

        const policyLeaveTypes = await getPolicyLeaveTypes();
        const leaveTypeSummary = [];
        let hasError = false;
        let errorMessage = "";

        // UPDATED: Calculate with half-day support (0.5 for half-day, 1 for full day)
        const leaveTypeMap = new Map();
        for (const day of days) {
            const lt = policyLeaveTypes.find(p => p.code === day.leaveType);
            if (!lt) {
                hasError = true;
                errorMessage = `Invalid leave type: ${day.leaveType}`;
                break;
            }
            if (!lt.applicableRoles.includes(role)) {
                hasError = true;
                errorMessage = `${day.leaveType} is not applicable for ${role}`;
                break;
            }
            const dayValue = day.isHalfDay ? 0.5 : 1;
            leaveTypeMap.set(day.leaveType, (leaveTypeMap.get(day.leaveType) || 0) + dayValue);
        }

        if (hasError) {
            return res.status(400).json({ success: false, message: errorMessage });
        }

        const balance = await getOrCreateLeaveBalance(employeeId, employeeName);

        for (const [leaveType, count] of leaveTypeMap) {
            const policyLt = policyLeaveTypes.find(p => p.code === leaveType);
            const balanceLt = balance.balances.find(b => b.leaveType === leaveType);

            if (policyLt.maxDaysAtOnce && count > policyLt.maxDaysAtOnce) {
                hasError = true;
                errorMessage = `${leaveType} cannot be taken for more than ${policyLt.maxDaysAtOnce} days at once. You requested ${count} days.`;
                break;
            }

            // Only check balance for paid leaves (not unpaid)
            if (!policyLt.isUnpaid && balanceLt && count > balanceLt.remaining) {
                hasError = true;
                errorMessage = `Insufficient ${leaveType} balance. Available: ${balanceLt.remaining}, Requested: ${count}`;
                break;
            }

            leaveTypeSummary.push({ leaveType, daysCount: count });
        }

        if (hasError) {
            return res.status(400).json({ success: false, message: errorMessage });
        }

        const leave = new Leave({
            employeeId,
            employeeName,
            role,
            fromDate,
            toDate,
            totalDays,
            days,
            leaveTypeSummary,
            reason,
            status: "PENDING",
        });

        await leave.save();

        res.status(201).json({
            success: true,
            message: "Leave request submitted successfully",
            leave: {
                id: leave._id,
                fromDate: leave.fromDate,
                toDate: leave.toDate,
                totalDays: leave.totalDays,
                leaveTypeSummary: leave.leaveTypeSummary,
                reason: leave.reason,
                status: leave.status,
            },
        });
    } catch (error) {
        console.error("Apply leave error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET MY LEAVE BALANCE ==========
router.get("/balance", async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const year = parseInt(req.query.year) || new Date().getFullYear();

        let balance = await LeaveBalance.findOne({ employeeId, year });

        if (!balance) {
            const policy = await getPolicyLeaveTypes();
            const balances = [];
            for (const lt of policy) {
                balances.push({
                    leaveType: lt.code,
                    total: lt.yearlyLimit || 0,
                    used: 0,
                    remaining: lt.yearlyLimit || 0,
                });
            }
            return res.json({
                success: true,
                balance: { employeeId, employeeName: req.user.name, year, balances },
            });
        }

        res.json({
            success: true,
            balance,
        });
    } catch (error) {
        console.error("Get leave balance error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});


// ========== GET TEAM LEAVE HISTORY (Manager only) ==========
router.get("/team-history", async (req, res) => {
    try {
        const managerId = req.user.employeeId;
        const role = req.user.role;

        if (role !== "MANAGER") {
            return res.status(403).json({
                success: false,
                message: "Only managers can view team history",
            });
        }

        const { status, limit = 20, page = 1 } = req.query;

        // Get all employees under this manager
        const team = await User.find({ managerId, role: "EMPLOYEE" }).select("employeeId");
        const teamIds = team.map(m => m.employeeId);

        let filter = { employeeId: { $in: teamIds } };
        if (status) filter.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const leaves = await Leave.find(filter)
            .sort({ appliedOn: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await Leave.countDocuments(filter);

        res.json({
            success: true,
            leaves,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error("Get team history error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET MY LEAVE REQUESTS ==========
router.get("/my-requests", async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const { status, limit = 20, page = 1 } = req.query;

        let filter = { employeeId };
        if (status) filter.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const leaves = await Leave.find(filter)
            .sort({ appliedOn: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await Leave.countDocuments(filter);

        res.json({
            success: true,
            leaves,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error("Get my requests error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET TEAM LEAVE REQUESTS (Manager only) ==========
router.get("/team-requests", async (req, res) => {
    try {
        const managerId = req.user.employeeId;
        const role = req.user.role;

        if (role !== "MANAGER") {
            return res.status(403).json({
                success: false,
                message: "Only managers can view team requests",
            });
        }

        const team = await User.find({ managerId, role: "EMPLOYEE" }).select("employeeId");
        const teamIds = team.map(m => m.employeeId);

        const leaves = await Leave.find({
            employeeId: { $in: teamIds },
            status: "PENDING",
        }).sort({ appliedOn: -1 }).lean();

        res.json({
            success: true,
            leaves,
            count: leaves.length,
        });
    } catch (error) {
        console.error("Get team requests error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET ALL LEAVE REQUESTS (HR/Admin only) ==========
router.get("/all-requests", async (req, res) => {
    try {
        const role = req.user.role;

        if (role !== "HR" && role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Access denied. Only HR and Admin can view all requests.",
            });
        }

        const { status, month, year, limit = 20, page = 1 } = req.query;

        let filter = {};

        // Status filter
        if (status) filter.status = status;

        // Month/Year filter (FIXED)
        if (month && year) {
            const monthStr = String(month).padStart(2, '0');
            const yearStr = String(year);

            // Use $and to combine with status filter
            filter = {
                ...filter,
                $or: [
                    { fromDate: { $regex: `^${yearStr}-${monthStr}` } },
                    { toDate: { $regex: `^${yearStr}-${monthStr}` } }
                ]
            };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const leaves = await Leave.find(filter)
            .sort({ appliedOn: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await Leave.countDocuments(filter);

        res.json({
            success: true,
            leaves,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error("Get all requests error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== APPROVE LEAVE ==========
router.put("/:id/approve", async (req, res) => {
    try {
        console.log("=== APPROVE ROUTE ===");
        console.log("req.user:", req.user);
        console.log("req.user.role:", req.user.role);

        const { id } = req.params;
        const approverId = req.user.employeeId;
        const approverName = req.user.name;
        const approverRole = req.user.role;

        const leave = await Leave.findById(id);
        if (!leave) {
            return res.status(404).json({
                success: false,
                message: "Leave request not found",
            });
        }

        // ✅ ADMIN can override - skip status check for ADMIN
        if (approverRole !== "ADMIN") {
            if (leave.status !== "PENDING") {
                return res.status(400).json({
                    success: false,
                    message: `Leave request is already ${leave.status.toLowerCase()}`,
                });
            }
        } else {
            // For Admin override, log that override is happening
            console.log(`🔄 Admin override: ${leave.status} → APPROVED`);
        }

        const requiredApproverRole = getApproverRole(leave.role);
        let hasPermission = false;

        // ✅ SUPER ADMIN - Can approve ANY leave (OVERRIDE all rules)
        if (approverRole === "ADMIN") {
            hasPermission = true;
        }
        // For EMPLOYEE leave: MANAGER or HR can approve
        else if (Array.isArray(requiredApproverRole)) {
            if (requiredApproverRole.includes(approverRole)) {
                if (approverRole === "MANAGER") {
                    // Check if this employee reports to this manager
                    const employee = await User.findOne({ employeeId: leave.employeeId });
                    if (employee && employee.managerId === approverId) {
                        hasPermission = true;
                    }
                } else if (approverRole === "HR") {
                    // HR can approve any employee leave
                    hasPermission = true;
                }
            }
        }
        // For MANAGER leave: Only HR can approve
        else if (requiredApproverRole === "HR" && approverRole === "HR") {
            hasPermission = true;
        }
        // For HR leave: Only ADMIN can approve (handled by ADMIN check above)

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to approve this leave",
            });
        }

        // ✅ Update leave balance only if it was PENDING (not for override)
        if (leave.status === "PENDING") {
            await updateLeaveBalance(leave.employeeId, leave.leaveTypeSummary, false);
        }

        // Store previous status for logging
        const previousStatus = leave.status;
        const isOverride = previousStatus !== "PENDING";

        leave.status = "APPROVED";
        leave.approvedBy = approverId;
        leave.approvedByName = approverName;
        leave.approvedByRole = Array.isArray(requiredApproverRole) ? approverRole : requiredApproverRole;
        leave.approvedAt = new Date();
        await leave.save();

        // ========== SEND EMAIL FOR BOTH CASES ==========
        const employeeEmail = await getUserEmail(leave.employeeId);
        if (employeeEmail) {
            await sendLeaveStatusEmail(
                leave,
                "APPROVED",
                approverName,
                null,
                isOverride,
                isOverride ? previousStatus : null
            );
        }

        if (isOverride) {
            console.log(`🔄 Admin override: ${previousStatus} → APPROVED for ${leave.employeeName}`);
        }

        res.json({
            success: true,
            message: previousStatus === "PENDING"
                ? "Leave approved successfully"
                : `Leave overridden to APPROVED (was ${previousStatus})`,
            leave: {
                id: leave._id,
                status: leave.status,
                approvedBy: leave.approvedByName,
                approvedAt: leave.approvedAt,
                wasOverride: isOverride
            },
        });
    } catch (error) {
        console.error("Approve leave error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== REJECT LEAVE ==========
router.put("/:id/reject", async (req, res) => {
    try {
        console.log("=== REJECT ROUTE ===");
        console.log("req.user:", req.user);
        console.log("req.user.role:", req.user.role);

        const { id } = req.params;
        const { rejectionReason } = req.body;
        const approverId = req.user.employeeId;
        const approverName = req.user.name;
        const approverRole = req.user.role;

        if (!rejectionReason) {
            return res.status(400).json({
                success: false,
                message: "Rejection reason is required",
            });
        }

        const leave = await Leave.findById(id);
        if (!leave) {
            return res.status(404).json({
                success: false,
                message: "Leave request not found",
            });
        }

        // ✅ ADMIN can override - skip status check for ADMIN
        if (approverRole !== "ADMIN") {
            if (leave.status !== "PENDING") {
                return res.status(400).json({
                    success: false,
                    message: `Leave request is already ${leave.status.toLowerCase()}`,
                });
            }
        } else {
            // For Admin override, log that override is happening
            console.log(`🔄 Admin override: ${leave.status} → REJECTED`);
        }

        const requiredApproverRole = getApproverRole(leave.role);
        let hasPermission = false;

        // ✅ SUPER ADMIN - Can reject ANY leave (OVERRIDE all rules)
        if (approverRole === "ADMIN") {
            hasPermission = true;
        }
        // For EMPLOYEE leave: MANAGER or HR can reject
        else if (Array.isArray(requiredApproverRole)) {
            if (requiredApproverRole.includes(approverRole)) {
                if (approverRole === "MANAGER") {
                    // Check if this employee reports to this manager
                    const employee = await User.findOne({ employeeId: leave.employeeId });
                    if (employee && employee.managerId === approverId) {
                        hasPermission = true;
                    }
                } else if (approverRole === "HR") {
                    // HR can reject any employee leave
                    hasPermission = true;
                }
            }
        }
        // For MANAGER leave: Only HR can reject
        else if (requiredApproverRole === "HR" && approverRole === "HR") {
            hasPermission = true;
        }
        // For HR leave: Only ADMIN can reject (handled by ADMIN check above)

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to reject this leave",
            });
        }

        // ✅ Update leave balance only if it was PENDING or APPROVED (restore balance)
        if (leave.status === "APPROVED") {
            // If overriding an approved leave, restore the balance
            await updateLeaveBalance(leave.employeeId, leave.leaveTypeSummary, true);
        }

        // Store previous status for logging
        const previousStatus = leave.status;
        const isOverride = previousStatus !== "PENDING";

        leave.status = "REJECTED";
        leave.rejectionReason = rejectionReason;
        leave.approvedBy = approverId;
        leave.approvedByName = approverName;
        leave.approvedByRole = Array.isArray(requiredApproverRole) ? approverRole : requiredApproverRole;
        leave.approvedAt = new Date();
        await leave.save();

        // ========== SEND EMAIL FOR BOTH CASES ==========
        const employeeEmail = await getUserEmail(leave.employeeId);
        if (employeeEmail) {
            await sendLeaveStatusEmail(
                leave,
                "REJECTED",
                approverName,
                rejectionReason,
                isOverride,
                isOverride ? previousStatus : null
            );
        }

        if (isOverride) {
            console.log(`🔄 Admin override: ${previousStatus} → REJECTED for ${leave.employeeName}`);
        }

        res.json({
            success: true,
            message: previousStatus === "PENDING"
                ? "Leave rejected"
                : `Leave overridden to REJECTED (was ${previousStatus})`,
            leave: {
                id: leave._id,
                status: leave.status,
                rejectionReason: leave.rejectionReason,
                wasOverride: isOverride
            },
        });
    } catch (error) {
        console.error("Reject leave error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== CANCEL LEAVE (Employee) ==========
router.put("/:id/cancel", async (req, res) => {
    try {
        const { id } = req.params;
        const { cancellationReason } = req.body;
        const employeeId = req.user.employeeId;

        if (!cancellationReason) {
            return res.status(400).json({
                success: false,
                message: "Cancellation reason is required",
            });
        }

        const leave = await Leave.findById(id);
        if (!leave) {
            return res.status(404).json({
                success: false,
                message: "Leave request not found",
            });
        }

        if (leave.employeeId !== employeeId) {
            return res.status(403).json({
                success: false,
                message: "You can only cancel your own leave requests",
            });
        }

        if (leave.status === "CANCELLED") {
            return res.status(400).json({
                success: false,
                message: "Leave already cancelled",
            });
        }

        const today = new Date().toISOString().split("T")[0];
        if (leave.fromDate === today) {
            return res.status(400).json({
                success: false,
                message: "Cannot cancel leave on the same day. Please contact HR.",
            });
        }

        if (leave.status === "APPROVED") {
            await updateLeaveBalance(leave.employeeId, leave.leaveTypeSummary, true);
        }

        leave.status = "CANCELLED";
        leave.cancelledBy = employeeId;
        leave.cancelledAt = new Date();
        leave.cancellationReason = cancellationReason;
        await leave.save();

        res.json({
            success: true,
            message: "Leave cancelled successfully",
            leave: {
                id: leave._id,
                status: leave.status,
                cancellationReason: leave.cancellationReason,
            },
        });
    } catch (error) {
        console.error("Cancel leave error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET SINGLE LEAVE REQUEST ==========
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const employeeId = req.user.employeeId;
        const role = req.user.role;

        const leave = await Leave.findById(id).lean();
        if (!leave) {
            return res.status(404).json({
                success: false,
                message: "Leave request not found",
            });
        }

        const canView = leave.employeeId === employeeId || ["HR", "ADMIN"].includes(role);
        if (!canView) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }

        res.json({
            success: true,
            leave,
        });
    } catch (error) {
        console.error("Get leave error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ========== GET LEAVE USAGE FOR A SPECIFIC MONTH ==========
router.get("/usage/:year/:month", async (req, res) => {
    try {
        const { year, month } = req.params;
        const employeeId = req.user.employeeId;
        const role = req.user.role;
        const targetEmployeeId = req.query.employeeId;

        let targetId = employeeId;

        // HR/Admin can view other employees
        if ((role === "HR" || role === "ADMIN") && targetEmployeeId) {
            targetId = targetEmployeeId;
        }

        const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
        const endDate = `${year}-${String(month).padStart(2, "0")}-31`;

        // Get all approved leaves for the employee in this month
        const leaves = await Leave.find({
            employeeId: targetId,
            status: "APPROVED",
            $or: [
                { fromDate: { $gte: startDate, $lte: endDate } },
                { toDate: { $gte: startDate, $lte: endDate } },
                { fromDate: { $lte: startDate }, toDate: { $gte: endDate } }
            ]
        });

        // Calculate leave usage by type
        const leaveUsage = {
            CL: { taken: 0, isPaid: true },
            SL: { taken: 0, isPaid: true },
            PL: { taken: 0, isPaid: true },
            EL: { taken: 0, isPaid: true },
            LOP: { taken: 0, isPaid: false },
        };

        for (const leave of leaves) {
            for (const summary of leave.leaveTypeSummary) {
                if (leaveUsage[summary.leaveType]) {
                    leaveUsage[summary.leaveType].taken += summary.daysCount;
                }
            }
        }

        // Get leave balance for the employee
        const balance = await LeaveBalance.findOne({
            employeeId: targetId,
            year: parseInt(year)
        });

        const leaveBalance = {};
        if (balance) {
            for (const b of balance.balances) {
                leaveBalance[b.leaveType] = {
                    total: b.total,
                    used: b.used,
                    remaining: b.remaining,
                };
            }
        }

        res.json({
            success: true,
            leaveUsage,
            leaveBalance,
            employeeId: targetId,
        });
    } catch (error) {
        console.error("Get leave usage error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

module.exports = router;