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

// ========== DEFINE protectHRorAdmin ==========
const protectHRorAdmin = async (req, res, next) => {
    try {
        const jwt = require("jsonwebtoken");

        let token = req.cookies.employeeToken;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded.role === "HR") {
                req.user = decoded;
                req.userType = "HR";
                return next();
            }
        }

        token = req.cookies.adminToken;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = {
                employeeId: decoded.adminId,
                name: "Admin",
                role: "ADMIN"
            };
            req.userType = "ADMIN";
            return next();
        }

        return res.status(401).json({ success: false, message: "Not authorized" });
    } catch (error) {
        return res.status(401).json({ success: false, message: "Invalid token" });
    }
};

router.use(protectHRorAdmin);

// ========== GET HR DASHBOARD DATA ==========
router.get("/", async (req, res) => {
    try {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const currentYear = new Date().getFullYear();
        const currentMonthNum = new Date().getMonth();
        const currentMonth = `${currentYear}-${String(currentMonthNum + 1).padStart(2, '0')}`;
        
        // Get policy for holiday/weekend check
        const policy = await Policy.findOne({ isActive: true });
        
        // Check if today is holiday or weekend
        const holidayCheck = checkHolidayOrWeekend(today, policy);
        
        // ========== 1. EMPLOYEE OVERVIEW ==========
        const allEmployees = await User.find({ role: { $in: ["HR", "MANAGER", "EMPLOYEE"] } });

        const totalEmployees = allEmployees.length;
        const activeEmployees = allEmployees.filter(emp => emp.isActive).length;

        // Department-wise count
        const departmentCount = {};
        allEmployees.forEach(emp => {
            if (emp.department && emp.department !== "") {
                departmentCount[emp.department] = (departmentCount[emp.department] || 0) + 1;
            }
        });

        // New joiners this month
        const firstDayOfMonth = new Date();
        firstDayOfMonth.setDate(1);
        firstDayOfMonth.setHours(0, 0, 0, 0);
        const newJoinersThisMonth = allEmployees.filter(emp => new Date(emp.joinDate) >= firstDayOfMonth).length;

        const incompleteProfiles = allEmployees.filter(emp => !emp.phone || !emp.address).length;

        // ========== 2. LEAVE MANAGEMENT WITH HOLIDAY CHECK ==========
        const pendingLeaves = await Leave.find({ status: "PENDING" })
            .sort({ appliedOn: 1 })
            .limit(10);

        const pendingCount = await Leave.countDocuments({ status: "PENDING" });

        // Today's absent employees (excluding holidays, weekends, approved leaves)
        const attendanceRecords = await Attendance.find({});
        const absentToday = [];
        
        for (const employee of allEmployees) {
            if (!employee.isActive) continue;
            
            // Check if on approved leave
            const isOnLeave = await isOnApprovedLeave(employee.employeeId, todayStr, Leave);
            
            // If on leave, skip
            if (isOnLeave) continue;
            
            // If holiday or weekend, skip (not considered absent)
            if (holidayCheck.isOff) continue;
            
            const empAttendance = attendanceRecords.find(rec => rec.employeeId === employee.employeeId);
            const todayRecord = empAttendance?.records.find(r => r.date === todayStr);
            
            // If no check-in record, mark as absent
            if (!todayRecord || !todayRecord.checkInTime) {
                absentToday.push({
                    employeeId: employee.employeeId,
                    name: employee.name,
                    department: employee.department,
                    role: employee.role
                });
            }
        }

        // Leave balance alerts
        const leaveBalances = await LeaveBalance.find({});
        const lowBalanceAlerts = leaveBalances.filter(lb => {
            const totalRemaining = lb.balances.reduce((sum, b) => sum + b.remaining, 0);
            return totalRemaining < 3 && totalRemaining > 0;
        }).map(lb => ({
            employeeId: lb.employeeId,
            employeeName: lb.employeeName,
            remainingBalance: lb.balances.reduce((sum, b) => sum + b.remaining, 0)
        }));

        // ========== 3. ATTENDANCE RATES ==========
        const employeeAttendanceRates = [];
        
        for (const employee of allEmployees) {
            if (!employee.isActive) continue;
            
            const empAttendance = await Attendance.findOne({ employeeId: employee.employeeId });
            const thisMonthRecords = empAttendance?.records.filter(r => r.date.startsWith(currentMonth)) || [];
            
            const workingDays = await getWorkingDaysInMonth(currentYear, currentMonthNum, employee.employeeId, policy);
            const attendanceRate = calculateAttendanceRate(thisMonthRecords, workingDays);
            
            employeeAttendanceRates.push({
                employeeId: employee.employeeId,
                employeeName: employee.name,
                role: employee.role,
                attendanceRate: attendanceRate.toFixed(1),
                workingDays: workingDays,
                presentDays: thisMonthRecords.filter(r => r.checkInTime).length
            });
        }

        // ========== 4. SALARY MANAGEMENT ==========
        const salaryRecords = await Salary.find({});

        let totalSalaryToProcess = 0;
        let processedCount = 0;
        let pendingCountSalary = 0;

        salaryRecords.forEach(employee => {
            const currentMonthRecord = employee.records.find(r => r.month === currentMonth);
            if (currentMonthRecord) {
                if (currentMonthRecord.status === "PAID") processedCount++;
                else {
                    pendingCountSalary++;
                    totalSalaryToProcess += currentMonthRecord.netSalary || employee.basicSalary;
                }
            } else {
                pendingCountSalary++;
                totalSalaryToProcess += employee.basicSalary;
            }
        });

        const salaryTrend = [];
        for (let i = 5; i >= 0; i--) {
            const monthDate = new Date();
            monthDate.setMonth(monthDate.getMonth() - i);
            const monthStr = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
            const monthName = monthDate.toLocaleString('default', { month: 'short' });

            let monthTotal = 0;
            salaryRecords.forEach(emp => {
                const record = emp.records.find(r => r.month === monthStr);
                if (record && record.status === "PAID") {
                    monthTotal += record.netSalary;
                } else if (!record) {
                    monthTotal += emp.basicSalary;
                }
            });

            salaryTrend.push({ month: monthName, total: monthTotal });
        }

        // ========== 5. PERFORMANCE OVERVIEW ==========
        const performanceRecords = await Performance.find({});

        let pendingReviews = 0;
        let averageRating = 0;
        let totalRatings = 0;

        performanceRecords.forEach(emp => {
            const currentMonthReview = emp.reviews.find(r => r.reviewMonth === currentMonth);
            if (!currentMonthReview) {
                pendingReviews++;
            } else {
                averageRating += currentMonthReview.overallRating;
                totalRatings++;
            }
        });

        const avgRating = totalRatings > 0 ? (averageRating / totalRatings).toFixed(1) : 0;

        const recentReviews = [];
        performanceRecords.forEach(emp => {
            if (emp.reviews.length > 0) {
                const lastReview = emp.reviews[emp.reviews.length - 1];
                recentReviews.push({
                    employeeId: emp.employeeId,
                    employeeName: emp.employeeName,
                    reviewMonth: lastReview.reviewMonth,
                    overallRating: lastReview.overallRating,
                    reviewedBy: lastReview.reviewedByName
                });
            }
        });
        recentReviews.sort((a, b) => b.reviewMonth.localeCompare(a.reviewMonth)).slice(0, 5);

        // ========== 6. JOINING ANNIVERSARIES ==========
        const currentMonthNumOnly = new Date().getMonth() + 1;
        const joiningAnniversariesThisMonth = allEmployees.filter(emp => {
            const joinDate = new Date(emp.joinDate);
            return joinDate.getMonth() + 1 === currentMonthNumOnly;
        }).map(emp => ({
            name: emp.name,
            joinDate: emp.joinDate,
            employeeId: emp.employeeId,
            department: emp.department,
            type: "Joining Anniversary"
        }));

        // ========== RESPONSE ==========
        res.json({
            success: true,
            dashboard: {
                employeeOverview: {
                    total: totalEmployees,
                    active: activeEmployees,
                    newJoinersThisMonth: newJoinersThisMonth,
                    incompleteProfiles: incompleteProfiles,
                    departmentDistribution: departmentCount,
                    attendanceRates: employeeAttendanceRates
                },
                leaveManagement: {
                    pendingCount: pendingCount,
                    pendingLeaves: pendingLeaves,
                    absentToday: absentToday.slice(0, 10),
                    lowBalanceAlerts: lowBalanceAlerts,
                    isTodayHolidayOrWeekend: holidayCheck.isOff,
                    todayType: holidayCheck.type
                },
                salaryManagement: {
                    totalToProcess: totalSalaryToProcess,
                    processedCount: processedCount,
                    pendingCount: pendingCountSalary,
                    monthlyTrend: salaryTrend,
                    currentMonth: currentMonth
                },
                performanceOverview: {
                    pendingReviews: pendingReviews,
                    averageRating: avgRating,
                    recentReviews: recentReviews
                },
                upcomingEvents: {
                    joiningAnniversaries: joiningAnniversariesThisMonth
                }
            }
        });

    } catch (error) {
        console.error("HR Dashboard Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});

module.exports = router;