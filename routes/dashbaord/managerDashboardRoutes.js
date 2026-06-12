const express = require("express");
const User = require("../../models/User");
const Attendance = require("../../models/Attendance/Attendance");
const Leave = require("../../models/Leave/Leave");
const Task = require("../../models/Task/Task");
const Performance = require("../../models/Task/Performance");
const Policy = require("../../models/Policy");
const { getWorkingDaysInMonth, calculateAttendanceRate } = require("../../utils/attendanceHelper");
const { checkHolidayOrWeekend, isOnApprovedLeave, getAttendanceStatus } = require("../../utils/dateHelper");

const router = express.Router();

// ========== MIDDLEWARE to get logged-in manager ==========
const getManagerFromToken = async (req, res, next) => {
    try {
        const jwt = require("jsonwebtoken");
        let token = req.cookies.employeeToken;
        
        if (!token) {
            token = req.cookies.adminToken;
        }
        
        if (!token) {
            return res.status(401).json({ success: false, message: "Not authenticated" });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.managerId = decoded.employeeId || decoded.adminId;
        req.managerRole = decoded.role || "ADMIN";
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: "Invalid token" });
    }
};

router.use(getManagerFromToken);

// ========== GET MANAGER DASHBOARD DATA ==========
router.get("/", async (req, res) => {
    try {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const currentYear = new Date().getFullYear();
        const currentMonthNum = new Date().getMonth();
        const managerId = req.managerId;
        
        // Get policy for holiday/weekend check
        const policy = await Policy.findOne({ isActive: true });
        
        // Check if today is holiday or weekend (global check)
        const holidayCheck = checkHolidayOrWeekend(today, policy);
        
        // ========== 1. GET MANAGER'S TEAM ==========
        const manager = await User.findOne({ employeeId: managerId });
        
        if (!manager) {
            return res.status(404).json({ success: false, message: "Manager not found" });
        }
        
        const teamEmployeeIds = manager.assignedEmployees?.map(emp => emp.employeeId) || [];
        
        // Include MANAGER themselves in team? Yes, manager is also employee
        const allTeamMembers = await User.find({ 
            employeeId: { $in: [...teamEmployeeIds, managerId] },
            isActive: true 
        }).select("employeeId name email department designation phone role");
        
        const teamSize = allTeamMembers.length;

        // ========== 2. TODAY'S TEAM ATTENDANCE WITH HOLIDAY CHECK ==========
        const attendanceRecords = await Attendance.find({ 
            employeeId: { $in: allTeamMembers.map(m => m.employeeId) } 
        });
        
        const teamAttendance = [];
        let presentToday = 0;
        let lateToday = 0;
        let absentToday = 0;
        let holidayToday = 0;
        let weekendToday = 0;
        let onLeaveToday = 0;
        
        for (const member of allTeamMembers) {
            const empAttendance = attendanceRecords.find(rec => rec.employeeId === member.employeeId);
            const todayRecord = empAttendance?.records.find(r => r.date === todayStr) || null;
            
            // Check if employee is on approved leave
            const isOnLeave = await isOnApprovedLeave(member.employeeId, todayStr, Leave);
            
            // Get attendance status with holiday check
            const attendanceStatus = getAttendanceStatus(todayRecord, holidayCheck, isOnLeave);
            
            // Count based on status
            if (attendanceStatus.status === "HOLIDAY") {
                holidayToday++;
            } else if (attendanceStatus.status === "WEEKEND") {
                weekendToday++;
            } else if (attendanceStatus.status === "ON_LEAVE") {
                onLeaveToday++;
            } else if (attendanceStatus.checkInTime) {
                presentToday++;
                if (attendanceStatus.status === "LATE") lateToday++;
            } else if (attendanceStatus.status === "ABSENT") {
                absentToday++;
            }
            
            teamAttendance.push({
                employeeId: member.employeeId,
                name: member.name,
                role: member.role,
                checkInTime: attendanceStatus.checkInTime,
                checkOutTime: attendanceStatus.checkOutTime,
                status: attendanceStatus.status,
                totalHours: attendanceStatus.totalHours,
                message: attendanceStatus.message
            });
        }
        
        const attendancePercentage = teamSize > 0 ? ((presentToday / teamSize) * 100).toFixed(1) : 0;

        // ========== 3. MONTHLY ATTENDANCE RATES ==========
        const teamAttendanceRates = [];
        
        for (const member of allTeamMembers) {
            const empAttendance = await Attendance.findOne({ employeeId: member.employeeId });
            const currentMonthStr = `${currentYear}-${String(currentMonthNum + 1).padStart(2, '0')}`;
            const thisMonthRecords = empAttendance?.records.filter(r => r.date.startsWith(currentMonthStr)) || [];
            
            const workingDays = await getWorkingDaysInMonth(currentYear, currentMonthNum, member.employeeId, policy);
            const rate = calculateAttendanceRate(thisMonthRecords, workingDays);
            
            teamAttendanceRates.push({
                employeeId: member.employeeId,
                employeeName: member.name,
                role: member.role,
                attendanceRate: rate.toFixed(1),
                workingDays: workingDays,
                presentDays: thisMonthRecords.filter(r => r.checkInTime).length
            });
        }
        
        const avgTeamAttendanceRate = teamAttendanceRates.length > 0 
            ? (teamAttendanceRates.reduce((sum, t) => sum + parseFloat(t.attendanceRate), 0) / teamAttendanceRates.length).toFixed(1)
            : 0;

        // ========== 4. TEAM LEAVE REQUESTS ==========
        const pendingLeaves = await Leave.find({
            employeeId: { $in: allTeamMembers.map(m => m.employeeId) },
            status: "PENDING"
        }).sort({ appliedOn: 1 });
        
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        const nextWeekStr = nextWeek.toISOString().split('T')[0];
        
        const upcomingLeaves = await Leave.find({
            employeeId: { $in: allTeamMembers.map(m => m.employeeId) },
            status: "APPROVED",
            fromDate: { $gte: todayStr, $lte: nextWeekStr }
        }).sort({ fromDate: 1 });

        // ========== 5. TEAM TASKS ==========
        const allTasks = await Task.find({
            "assignedTo.employeeId": { $in: allTeamMembers.map(m => m.employeeId) }
        });
        
        const tasksByStatus = {
            total: allTasks.length,
            completed: allTasks.filter(t => t.status === "COMPLETE").length,
            pending: allTasks.filter(t => t.status === "INCOMPLETE").length,
            overdue: 0
        };
        
        const todayDate = new Date();
        tasksByStatus.overdue = allTasks.filter(task => {
            if (task.status === "COMPLETE") return false;
            if (!task.deadline) return false;
            const deadlineDate = new Date(task.deadline);
            return deadlineDate < todayDate;
        }).length;
        
        const recentTasks = await Task.find({
            "assignedTo.employeeId": { $in: allTeamMembers.map(m => m.employeeId) }
        }).sort({ createdAt: -1 }).limit(5);

        // ========== 6. TEAM PERFORMANCE ==========
        const performanceRecords = await Performance.find({
            employeeId: { $in: allTeamMembers.map(m => m.employeeId) }
        });
        
        let totalRating = 0;
        let ratedMembers = 0;
        const teamPerformance = [];
        
        for (const member of allTeamMembers) {
            const perf = performanceRecords.find(p => p.employeeId === member.employeeId);
            if (perf && perf.reviews.length > 0) {
                const lastReview = perf.reviews[perf.reviews.length - 1];
                totalRating += lastReview.overallRating;
                ratedMembers++;
                teamPerformance.push({
                    employeeId: member.employeeId,
                    name: member.name,
                    role: member.role,
                    lastRating: lastReview.overallRating,
                    reviewMonth: lastReview.reviewMonth
                });
            } else {
                teamPerformance.push({
                    employeeId: member.employeeId,
                    name: member.name,
                    role: member.role,
                    lastRating: null,
                    reviewMonth: null
                });
            }
        }
        
        const avgTeamRating = ratedMembers > 0 ? (totalRating / ratedMembers).toFixed(1) : 0;
        
        const topPerformer = teamPerformance
            .filter(p => p.lastRating)
            .sort((a, b) => b.lastRating - a.lastRating)[0] || null;

        // ========== 7. QUICK STATS ==========
        const stats = {
            teamSize: teamSize,
            presentToday: presentToday,
            absentToday: absentToday,
            lateToday: lateToday,
            holidayToday: holidayToday,
            weekendToday: weekendToday,
            onLeaveToday: onLeaveToday,
            attendancePercentage: attendancePercentage,
            pendingLeaveRequests: pendingLeaves.length,
            pendingTasks: tasksByStatus.pending,
            overdueTasks: tasksByStatus.overdue,
            avgTeamRating: avgTeamRating,
            isTodayHoliday: holidayCheck.isOff && holidayCheck.type === "HOLIDAY",
            isTodayWeekend: holidayCheck.isOff && holidayCheck.type === "WEEKEND",
            todayType: holidayCheck.type
        };

        // ========== RESPONSE ==========
        res.json({
            success: true,
            dashboard: {
                stats: stats,
                teamAttendance: teamAttendance,
                teamAttendanceRates: teamAttendanceRates,
                pendingLeaves: pendingLeaves,
                upcomingLeaves: upcomingLeaves,
                tasks: {
                    summary: tasksByStatus,
                    recent: recentTasks
                },
                performance: {
                    teamRatings: teamPerformance,
                    topPerformer: topPerformer,
                    averageRating: avgTeamRating
                },
                todayInfo: {
                    isHoliday: holidayCheck.isOff && holidayCheck.type === "HOLIDAY",
                    isWeekend: holidayCheck.isOff && holidayCheck.type === "WEEKEND",
                    type: holidayCheck.type
                }
            }
        });
        
    } catch (error) {
        console.error("Manager Dashboard Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});

module.exports = router;