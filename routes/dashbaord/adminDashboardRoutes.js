const express = require("express");
const User = require("../../models/User");
const Attendance = require("../../models/Attendance/Attendance");
const Leave = require("../../models/Leave/Leave");
const Salary = require("../../models/Salary/Salary");
const Task = require("../../models/Task/Task");
const Policy = require("../../models/Policy");
const { protectAdmin } = require("../../middleware/authMiddleware");
const { getWorkingDaysInMonth, calculateAttendanceRate } = require("../../utils/attendanceHelper");
const { checkHolidayOrWeekend, isOnApprovedLeave } = require("../../utils/dateHelper");

const router = express.Router();

router.use(protectAdmin);

router.get("/", async (req, res) => {
    try {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const currentYear = new Date().getFullYear();
        const currentMonthNum = new Date().getMonth();
        const currentMonth = new Date().toLocaleString('default', { month: 'long' });
        
        const policy = await Policy.findOne({ isActive: true });
        const holidayCheck = checkHolidayOrWeekend(today, policy);
        
        // ========== 1. EMPLOYEE STATISTICS ==========
        const allEmployees = await User.find({ role: { $in: ["HR", "MANAGER", "EMPLOYEE"] } });

        const totalEmployees = allEmployees.length;
        const activeEmployees = allEmployees.filter(emp => emp.isActive).length;
        const inactiveEmployees = totalEmployees - activeEmployees;

        const hrCount = allEmployees.filter(emp => emp.role === "HR").length;
        const managerCount = allEmployees.filter(emp => emp.role === "MANAGER").length;
        const employeeCount = allEmployees.filter(emp => emp.role === "EMPLOYEE").length;

        const departments = {};
        allEmployees.forEach(emp => {
            if (emp.department && emp.department !== "") {
                departments[emp.department] = (departments[emp.department] || 0) + 1;
            }
        });

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const newJoiners = allEmployees.filter(emp => new Date(emp.joinDate) >= thirtyDaysAgo).length;

        // ========== 2. TODAY'S ATTENDANCE WITH HOLIDAY CHECK ==========
        // If today is holiday or weekend, no one is considered absent
        let presentToday = 0;
        let lateToday = 0;
        let absentToday = 0;
        let halfDayToday = 0;
        
        if (!holidayCheck.isOff) {
            const todayAttendanceRecords = await Attendance.find({});
            
            for (const employee of allEmployees) {
                if (!employee.isActive) continue;
                
                const isOnLeave = await isOnApprovedLeave(employee.employeeId, todayStr, Leave);
                if (isOnLeave) continue;
                
                const empAttendance = todayAttendanceRecords.find(rec => rec.employeeId === employee.employeeId);
                const todayRecord = empAttendance?.records.find(r => r.date === todayStr);
                
                if (todayRecord && todayRecord.checkInTime) {
                    presentToday++;
                    if (todayRecord.status === "LATE") lateToday++;
                    if (todayRecord.status === "HALF_DAY") halfDayToday++;
                } else {
                    absentToday++;
                }
            }
        }
        
        const attendancePercentage = totalEmployees > 0 ? ((presentToday / totalEmployees) * 100).toFixed(1) : 0;

        // ========== 3. LEAVE STATISTICS ==========
        const pendingLeaves = await Leave.countDocuments({ status: "PENDING" });
        const approvedLeaves = await Leave.countDocuments({ status: "APPROVED" });
        const rejectedLeaves = await Leave.countDocuments({ status: "REJECTED" });

        const leaveTrend = [];
        for (let i = 5; i >= 0; i--) {
            const monthDate = new Date();
            monthDate.setMonth(monthDate.getMonth() - i);
            const monthName = monthDate.toLocaleString('default', { month: 'short' });
            const monthStart = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;

            const leavesCount = await Leave.countDocuments({
                fromDate: { $regex: `^${monthStart}` },
                status: "APPROVED"
            });

            leaveTrend.push({ month: monthName, count: leavesCount });
        }

        // ========== 4. SALARY OVERVIEW ==========
        const salaryRecords = await Salary.find({});

        let totalMonthlySalary = 0;
        let paidSalaryCount = 0;
        let unpaidSalaryCount = 0;

        salaryRecords.forEach(employee => {
            const currentMonthRecord = employee.records.find(r => r.month === `${currentYear}-${String(currentMonthNum + 1).padStart(2, '0')}`);
            if (currentMonthRecord) {
                totalMonthlySalary += currentMonthRecord.netSalary || employee.basicSalary;
                if (currentMonthRecord.status === "PAID") paidSalaryCount++;
                else unpaidSalaryCount++;
            } else {
                totalMonthlySalary += employee.basicSalary;
                unpaidSalaryCount++;
            }
        });

        const avgSalary = totalEmployees > 0 ? totalMonthlySalary / totalEmployees : 0;

        // ========== 5. TASK STATISTICS ==========
        const totalTasks = await Task.countDocuments({});
        const completedTasks = await Task.countDocuments({ status: "COMPLETE" });
        const pendingTasks = totalTasks - completedTasks;
        const taskCompletionRate = totalTasks > 0 ? ((completedTasks / totalTasks) * 100).toFixed(1) : 0;

        // ========== 6. UPCOMING HOLIDAYS ==========
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
                    date: h.isRange ? `${new Date(h.startDate).toLocaleDateString()} - ${new Date(h.endDate).toLocaleDateString()}` : new Date(h.date).toLocaleDateString(),
                    type: h.type
                }));
        }

        // ========== 7. RECENT ACTIVITIES ==========
        const recentLeaves = await Leave.find({ status: "PENDING" })
            .sort({ appliedOn: -1 })
            .limit(5)
            .select("employeeName fromDate toDate status reason");

        const recentTasks = await Task.find({ status: "INCOMPLETE" })
            .sort({ createdAt: -1 })
            .limit(5)
            .select("title assignedTo deadline status");

        // ========== RESPONSE ==========
        res.json({
            success: true,
            dashboard: {
                employeeStats: {
                    total: totalEmployees,
                    active: activeEmployees,
                    inactive: inactiveEmployees,
                    newJoiners: newJoiners,
                    roleDistribution: { HR: hrCount, MANAGER: managerCount, EMPLOYEE: employeeCount },
                    departmentDistribution: departments
                },
                attendanceStats: {
                    presentToday: presentToday,
                    lateToday: lateToday,
                    absentToday: absentToday,
                    halfDayToday: halfDayToday,
                    totalEmployees: totalEmployees,
                    attendancePercentage: attendancePercentage,
                    isTodayHolidayOrWeekend: holidayCheck.isOff,
                    todayType: holidayCheck.type
                },
                leaveStats: {
                    pending: pendingLeaves,
                    approved: approvedLeaves,
                    rejected: rejectedLeaves,
                    trend: leaveTrend
                },
                salaryStats: {
                    totalMonthlySalary: totalMonthlySalary,
                    averageSalary: Math.round(avgSalary),
                    paidCount: paidSalaryCount,
                    unpaidCount: unpaidSalaryCount,
                    month: currentMonth
                },
                taskStats: {
                    total: totalTasks,
                    completed: completedTasks,
                    pending: pendingTasks,
                    completionRate: taskCompletionRate
                },
                upcomingHolidays: upcomingHolidays,
                recentActivities: {
                    pendingLeaves: recentLeaves,
                    pendingTasks: recentTasks
                }
            }
        });

    } catch (error) {
        console.error("Admin Dashboard Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});

module.exports = router;