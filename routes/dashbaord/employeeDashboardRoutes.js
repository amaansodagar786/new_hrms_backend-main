const express = require("express");
const User = require("../../models/User");
const Attendance = require("../../models/Attendance/Attendance");
const Leave = require("../../models/Leave/Leave");
const LeaveBalance = require("../../models/Leave/LeaveBalance");
const Salary = require("../../models/Salary/Salary");
const Task = require("../../models/Task/Task");
const Performance = require("../../models/Task/Performance");
const Policy = require("../../models/Policy");
const { getWorkingDaysInMonth, calculateAttendanceRate } = require("../../utils/attendanceHelper");
const { checkHolidayOrWeekend, isOnApprovedLeave, getAttendanceStatus } = require("../../utils/dateHelper");

const router = express.Router();

// ========== MIDDLEWARE to get logged-in employee ==========
const getEmployeeFromToken = async (req, res, next) => {
    try {
        const jwt = require("jsonwebtoken");
        let token = req.cookies.employeeToken;
        
        if (!token) {
            return res.status(401).json({ success: false, message: "Not authenticated" });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.employeeId = decoded.employeeId;
        req.employeeRole = decoded.role;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: "Invalid token" });
    }
};

router.use(getEmployeeFromToken);

// ========== GET EMPLOYEE DASHBOARD DATA ==========
router.get("/", async (req, res) => {
    try {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const employeeId = req.employeeId;
        const currentYear = new Date().getFullYear();
        const currentMonthNum = new Date().getMonth();
        const currentMonth = `${currentYear}-${String(currentMonthNum + 1).padStart(2, '0')}`;
        
        // Get policy for holiday/weekend check
        const policy = await Policy.findOne({ isActive: true });
        
        // ========== CHECK IF TODAY IS HOLIDAY OR WEEKEND ==========
        const holidayCheck = checkHolidayOrWeekend(today, policy);
        const isOnLeaveToday = await isOnApprovedLeave(employeeId, todayStr, Leave);
        
        // ========== 1. EMPLOYEE BASIC INFO ==========
        const employee = await User.findOne({ employeeId }).select("-password");
        
        if (!employee) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }
        
        // ========== 2. TODAY'S ATTENDANCE WITH HOLIDAY CHECK ==========
        const attendanceRecord = await Attendance.findOne({ employeeId });
        const todayAttendanceRaw = attendanceRecord?.records.find(r => r.date === todayStr) || null;
        
        // Use helper to get proper status
        const todayAttendance = getAttendanceStatus(todayAttendanceRaw, holidayCheck, isOnLeaveToday);
        
        // ========== 3. MONTHLY ATTENDANCE ==========
        const thisMonthRecords = attendanceRecord?.records.filter(r => r.date.startsWith(currentMonth)) || [];
        
        const workingDays = await getWorkingDaysInMonth(currentYear, currentMonthNum, employeeId, policy);
        const attendanceRate = calculateAttendanceRate(thisMonthRecords, workingDays);
        
        const thisMonthSummary = {
            totalDays: thisMonthRecords.length,
            presentDays: thisMonthRecords.filter(r => r.checkInTime).length,
            onTimeDays: thisMonthRecords.filter(r => r.status === "ON_TIME").length,
            lateDays: thisMonthRecords.filter(r => r.status === "LATE").length,
            halfDays: thisMonthRecords.filter(r => r.status === "HALF_DAY").length,
            absentDays: thisMonthRecords.filter(r => r.status === "ABSENT").length,
            workingDays: workingDays,
            attendanceRate: attendanceRate.toFixed(1)
        };
        
        // Monthly attendance trend
        const attendanceTrend = [];
        for (let i = 5; i >= 0; i--) {
            const monthDate = new Date();
            monthDate.setMonth(monthDate.getMonth() - i);
            const monthYear = monthDate.getFullYear();
            const monthIndex = monthDate.getMonth();
            const monthStr = `${monthYear}-${String(monthIndex + 1).padStart(2, '0')}`;
            const monthName = monthDate.toLocaleString('default', { month: 'short' });
            
            const monthRecords = attendanceRecord?.records.filter(r => r.date.startsWith(monthStr)) || [];
            const monthWorkingDays = await getWorkingDaysInMonth(monthYear, monthIndex, employeeId, policy);
            const monthRate = calculateAttendanceRate(monthRecords, monthWorkingDays);
            
            attendanceTrend.push({ 
                month: monthName, 
                present: monthRecords.filter(r => r.checkInTime).length, 
                total: monthRecords.length,
                workingDays: monthWorkingDays,
                rate: monthRate.toFixed(1)
            });
        }

        // ========== 4. LEAVE BALANCE ==========
        let leaveBalance = await LeaveBalance.findOne({ employeeId, year: currentYear });
        if (!leaveBalance) {
            leaveBalance = await LeaveBalance.findOne({ employeeId });
        }
        const leaveBalances = leaveBalance?.balances || [];
        
        const recentLeaves = await Leave.find({ employeeId })
            .sort({ appliedOn: -1 })
            .limit(5);
        
        const upcomingLeaves = await Leave.find({
            employeeId,
            status: "APPROVED",
            fromDate: { $gte: todayStr }
        }).sort({ fromDate: 1 }).limit(3);

        // ========== 5. MY TASKS ==========
        const myTasks = await Task.find({
            "assignedTo.employeeId": employeeId
        }).sort({ createdAt: -1 });
        
        const taskSummary = {
            total: myTasks.length,
            completed: myTasks.filter(t => t.status === "COMPLETE").length,
            pending: myTasks.filter(t => t.status === "INCOMPLETE").length,
            overdue: 0
        };
        
        const todayDate = new Date();
        taskSummary.overdue = myTasks.filter(task => {
            if (task.status === "COMPLETE") return false;
            if (!task.deadline) return false;
            const deadlineDate = new Date(task.deadline);
            return deadlineDate < todayDate;
        }).length;
        
        const pendingTasks = myTasks.filter(t => t.status === "INCOMPLETE").slice(0, 5);
        const recentCompletedTasks = myTasks.filter(t => t.status === "COMPLETE").slice(0, 3);

        // ========== 6. SALARY DETAILS ==========
        const salaryRecord = await Salary.findOne({ employeeId });
        const currentSalaryRecord = salaryRecord?.records.find(r => r.month === currentMonth);
        
        let salaryInfo = {
            basicSalary: employee.salary,
            netSalary: null,
            deductions: null,
            status: "UNPAID",
            lastPaidMonth: null
        };
        
        if (currentSalaryRecord) {
            salaryInfo.netSalary = currentSalaryRecord.netSalary;
            salaryInfo.deductions = currentSalaryRecord.totalDeductions;
            salaryInfo.status = currentSalaryRecord.status;
        }
        
        const lastPaidRecord = salaryRecord?.records
            .filter(r => r.status === "PAID")
            .sort((a, b) => b.month.localeCompare(a.month))[0];
        
        if (lastPaidRecord) {
            salaryInfo.lastPaidMonth = lastPaidRecord.month;
        }

        // ========== 7. PERFORMANCE REVIEW ==========
        const performanceRecord = await Performance.findOne({ employeeId });
        const lastReview = performanceRecord?.reviews
            .sort((a, b) => b.reviewMonth.localeCompare(a.reviewMonth))[0] || null;
        
        const performanceTrend = performanceRecord?.reviews
            .sort((a, b) => a.reviewMonth.localeCompare(b.reviewMonth))
            .slice(-6)
            .map(r => ({
                month: r.reviewMonth,
                rating: r.overallRating,
                quarter: r.quarter
            })) || [];

        // ========== 8. UPCOMING HOLIDAYS ==========
        let upcomingHolidays = [];
        
        if (policy && policy.holidays) {
            const todayDateObj = new Date();
            upcomingHolidays = policy.holidays
                .filter(h => {
                    let holidayDate;
                    if (h.isRange && h.startDate) {
                        holidayDate = new Date(h.startDate);
                    } else if (h.date) {
                        holidayDate = new Date(h.date);
                    }
                    return holidayDate >= todayDateObj;
                })
                .sort((a, b) => {
                    const dateA = a.isRange ? new Date(a.startDate) : new Date(a.date);
                    const dateB = b.isRange ? new Date(b.startDate) : new Date(b.date);
                    return dateA - dateB;
                })
                .slice(0, 5)
                .map(h => ({
                    name: h.name,
                    date: h.isRange ? `${new Date(h.startDate).toLocaleDateString()} - ${new Date(h.endDate).toLocaleDateString()}` : new Date(h.date).toLocaleDateString()
                }));
        }

        // ========== 9. QUICK STATS ==========
        const quickStats = {
            attendanceRate: attendanceRate.toFixed(1),
            pendingTasks: taskSummary.pending,
            overdueTasks: taskSummary.overdue,
            leaveBalance: leaveBalances.reduce((sum, b) => sum + b.remaining, 0),
            lastPerformanceRating: lastReview?.overallRating || null,
            workingDays: workingDays
        };

        // ========== RESPONSE ==========
        res.json({
            success: true,
            dashboard: {
                employee: {
                    name: employee.name,
                    employeeId: employee.employeeId,
                    email: employee.email,
                    designation: employee.designation,
                    department: employee.department,
                    joinDate: employee.joinDate,
                    role: employee.role
                },
                
                quickStats: quickStats,
                
                todayStatus: {
                    hasCheckedIn: todayAttendance.checkInTime ? true : false,
                    checkInTime: todayAttendance.checkInTime,
                    checkOutTime: todayAttendance.checkOutTime,
                    status: todayAttendance.status,
                    totalHours: todayAttendance.totalHours,
                    isHoliday: holidayCheck.isOff && holidayCheck.type === "HOLIDAY",
                    isWeekend: holidayCheck.isOff && holidayCheck.type === "WEEKEND",
                    isOnLeave: isOnLeaveToday,
                    message: todayAttendance.message
                },
                
                attendance: {
                    thisMonth: thisMonthSummary,
                    trend: attendanceTrend
                },
                
                leave: {
                    balances: leaveBalances,
                    recentRequests: recentLeaves,
                    upcomingLeaves: upcomingLeaves
                },
                
                tasks: {
                    summary: taskSummary,
                    pending: pendingTasks,
                    recentCompleted: recentCompletedTasks
                },
                
                salary: salaryInfo,
                
                performance: {
                    lastReview: lastReview,
                    trend: performanceTrend
                },
                
                upcomingHolidays: upcomingHolidays,
                
                // Add policy info for frontend
                policy: {
                    canCheckIn: !holidayCheck.isOff && !isOnLeaveToday,
                    workingHoursStart: policy?.attendanceRules?.workingHoursStart,
                    workingHoursEnd: policy?.attendanceRules?.workingHoursEnd
                }
            }
        });
        
    } catch (error) {
        console.error("Employee Dashboard Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});

module.exports = router;