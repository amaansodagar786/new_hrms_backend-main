const express = require("express");
const User = require("../../models/User");
const Attendance = require("../../models/Attendance/Attendance");
const Leave = require("../../models/Leave/Leave");
const LeaveBalance = require("../../models/Leave/LeaveBalance");
const Salary = require("../../models/Salary/Salary");
const Performance = require("../../models/Task/Performance");
const Task = require("../../models/Task/Task");
const Policy = require("../../models/Policy");
const { protectAdmin } = require("../../middleware/authMiddleware");

const router = express.Router();

// Apply admin protection
router.use(protectAdmin);

// ============================================================
// 1. EMPLOYEE LIST REPORT
// ============================================================
router.get("/employees", async (req, res) => {
    try {
        const { department, role, status, search, page = 1, limit = 1000 } = req.query;

        let filter = {};
        if (department) filter.department = department;
        if (role) filter.role = role;
        if (status === "active") filter.isActive = true;
        else if (status === "inactive") filter.isActive = false;
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } },
                { employeeId: { $regex: search, $options: "i" } }
            ];
        }

        const employees = await User.find(filter)
            .select("employeeId name email role department designation managerId joinDate phone address bloodGroup isActive")
            .sort({ name: 1 })
            .lean();

        // Get manager names
        const managerIds = employees.map(e => e.managerId).filter(Boolean);
        const managers = await User.find({ employeeId: { $in: managerIds } })
            .select("employeeId name")
            .lean();
        const managerMap = new Map(managers.map(m => [m.employeeId, m.name]));

        const result = employees.map(emp => ({
            EmployeeID: emp.employeeId,
            Name: emp.name,
            Email: emp.email,
            Role: emp.role,
            Department: emp.department || '—',
            Designation: emp.designation || '—',
            Manager: emp.managerId ? managerMap.get(emp.managerId) || '—' : '—',
            JoinDate: emp.joinDate ? new Date(emp.joinDate).toLocaleDateString() : '—',
            Phone: emp.phone || '—',
            Address: emp.address || '—',
            BloodGroup: emp.bloodGroup || '—',
            Status: emp.isActive ? 'Active' : 'Inactive'
        }));

        res.json({ success: true, data: result, total: result.length });
    } catch (error) {
        console.error("Employee report error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// 2. DAILY ATTENDANCE REPORT
// ============================================================
router.get("/attendance/daily", async (req, res) => {
    try {
        const { date, fromDate, toDate, month, year, role, search, department } = req.query;

        // Build date filter
        let dateFilter = {};
        if (date) {
            dateFilter = { date };
        } else if (fromDate && toDate) {
            dateFilter = { date: { $gte: fromDate, $lte: toDate } };
        } else if (month && year) {
            const monthStr = String(month).padStart(2, '0');
            dateFilter = { date: { $regex: `^${year}-${monthStr}` } };
        } else if (year) {
            dateFilter = { date: { $regex: `^${year}` } };
        } else {
            // Default: today
            const today = new Date().toISOString().split('T')[0];
            dateFilter = { date: today };
        }

        // Get all employees with filters
        let userFilter = { isActive: true };
        if (role) userFilter.role = role;
        if (department) userFilter.department = department;
        if (search) {
            userFilter.$or = [
                { name: { $regex: search, $options: "i" } },
                { employeeId: { $regex: search, $options: "i" } }
            ];
        }

        const users = await User.find(userFilter)
            .select("employeeId name email role department")
            .lean();
        const userIds = users.map(u => u.employeeId);
        const userMap = new Map(users.map(u => [u.employeeId, u]));

        // Get attendance records
        const attendances = await Attendance.find({
            employeeId: { $in: userIds }
        }).lean();

        const result = [];
        for (const user of users) {
            const attendance = attendances.find(a => a.employeeId === user.employeeId);
            let records = attendance?.records || [];

            // Apply date filter
            if (date) {
                records = records.filter(r => r.date === date);
            } else if (fromDate && toDate) {
                records = records.filter(r => r.date >= fromDate && r.date <= toDate);
            } else if (month && year) {
                const monthStr = String(month).padStart(2, '0');
                records = records.filter(r => r.date && r.date.startsWith(`${year}-${monthStr}`));
            } else if (year) {
                records = records.filter(r => r.date && r.date.startsWith(`${year}`));
            } else {
                const today = new Date().toISOString().split('T')[0];
                records = records.filter(r => r.date === today);
            }

            if (records.length === 0) {
                result.push({
                    EmployeeID: user.employeeId,
                    Name: user.name,
                    Email: user.email,
                    Department: user.department || '—',
                    Date: date || '—',
                    CheckIn: '—',
                    CheckOut: '—',
                    Status: 'ABSENT',
                    TotalHours: 0
                });
            } else {
                for (const record of records) {
                    result.push({
                        EmployeeID: user.employeeId,
                        Name: user.name,
                        Email: user.email,
                        Department: user.department || '—',
                        Date: record.date || '—',
                        CheckIn: record.checkInTime || '—',
                        CheckOut: record.checkOutTime || '—',
                        Status: record.status || 'ABSENT',
                        TotalHours: record.totalHours || 0
                    });
                }
            }
        }

        res.json({ success: true, data: result, total: result.length });
    } catch (error) {
        console.error("Daily attendance report error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// 3. MONTHLY ATTENDANCE SUMMARY
// ============================================================
router.get("/attendance/monthly-summary", async (req, res) => {
    try {
        const { month, year, department, role, search } = req.query;

        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();
        const monthStr = String(targetMonth).padStart(2, '0');
        const datePrefix = `${targetYear}-${monthStr}`;

        // Get employees with filters
        let userFilter = { isActive: true };
        if (department) userFilter.department = department;
        if (role) userFilter.role = role;
        if (search) {
            userFilter.$or = [
                { name: { $regex: search, $options: "i" } },
                { employeeId: { $regex: search, $options: "i" } }
            ];
        }

        const users = await User.find(userFilter)
            .select("employeeId name email role department")
            .lean();
        const userIds = users.map(u => u.employeeId);

        // Get attendance records
        const attendances = await Attendance.find({
            employeeId: { $in: userIds }
        }).lean();

        const result = [];
        for (const user of users) {
            const attendance = attendances.find(a => a.employeeId === user.employeeId);
            const records = attendance?.records?.filter(r => r.date && r.date.startsWith(datePrefix)) || [];

            let present = 0, onTime = 0, late = 0, halfDay = 0, absent = 0;
            let totalWorkingDays = records.length || 0;

            for (const record of records) {
                if (record.checkInTime) {
                    present++;
                    if (record.status === 'ON_TIME') onTime++;
                    else if (record.status === 'LATE') late++;
                    else if (record.status === 'HALF_DAY') halfDay++;
                } else if (record.status === 'ABSENT') {
                    absent++;
                }
            }

            const attendanceRate = totalWorkingDays > 0 ? ((present / totalWorkingDays) * 100).toFixed(1) : 0;

            result.push({
                EmployeeID: user.employeeId,
                Name: user.name,
                Email: user.email,
                Department: user.department || '—',
                Role: user.role,
                WorkingDays: totalWorkingDays || 0,
                Present: present || 0,
                OnTime: onTime || 0,
                Late: late || 0,
                HalfDay: halfDay || 0,
                Absent: absent || 0,
                AttendanceRate: parseFloat(attendanceRate)
            });
        }

        res.json({ success: true, data: result, total: result.length });
    } catch (error) {
        console.error("Monthly attendance summary error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// 4. LEAVE SUMMARY REPORT
// ============================================================
router.get("/leave/summary", async (req, res) => {
    try {
        const { month, year, department, leaveType, role, search } = req.query;

        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();
        const monthStr = String(targetMonth).padStart(2, '0');
        const datePrefix = `${targetYear}-${monthStr}`;

        // Get employees with filters
        let userFilter = { isActive: true };
        if (department) userFilter.department = department;
        if (role) userFilter.role = role;
        if (search) {
            userFilter.$or = [
                { name: { $regex: search, $options: "i" } },
                { employeeId: { $regex: search, $options: "i" } }
            ];
        }

        const users = await User.find(userFilter)
            .select("employeeId name email role department")
            .lean();
        const userIds = users.map(u => u.employeeId);

        // Get leaves for the month
        const leaves = await Leave.find({
            employeeId: { $in: userIds },
            status: "APPROVED",
            $or: [
                { fromDate: { $regex: `^${datePrefix}` } },
                { toDate: { $regex: `^${datePrefix}` } }
            ]
        }).lean();

        // Get leave balances
        const balances = await LeaveBalance.find({
            employeeId: { $in: userIds },
            year: parseInt(targetYear)
        }).lean();
        const balanceMap = new Map();
        for (const b of balances) {
            balanceMap.set(b.employeeId, b);
        }

        // Leave type mapping
        const leaveTypeMap = { CL: 'Casual Leave', SL: 'Sick Leave', PL: 'Paid Leave', EL: 'Earned Leave', LOP: 'Unpaid Leave' };

        const result = [];
        for (const user of users) {
            const userLeaves = leaves.filter(l => l.employeeId === user.employeeId);
            const balance = balanceMap.get(user.employeeId);

            const leaveSummary = {};
            let totalDays = 0;

            for (const leave of userLeaves) {
                for (const summary of leave.leaveTypeSummary || []) {
                    const type = summary.leaveType;
                    const days = summary.daysCount || 0;
                    leaveSummary[type] = (leaveSummary[type] || 0) + days;
                    totalDays += days;
                }
            }

            // Filter by leave type if specified
            if (leaveType && !leaveSummary[leaveType]) continue;

            const row = {
                EmployeeID: user.employeeId,
                Name: user.name,
                Email: user.email,
                Department: user.department || '—',
                Role: user.role,
                TotalLeavesTaken: totalDays || 0
            };

            // Add leave type columns
            for (const [code, name] of Object.entries(leaveTypeMap)) {
                row[name] = leaveSummary[code] || 0;
            }

            // Add remaining balance
            if (balance) {
                for (const b of balance.balances || []) {
                    const name = leaveTypeMap[b.leaveType] || b.leaveType;
                    row[`${name} Remaining`] = b.remaining || 0;
                }
            }

            result.push(row);
        }

        res.json({ success: true, data: result, total: result.length });
    } catch (error) {
        console.error("Leave summary error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// 5. MONTHLY SALARY REPORT
// ============================================================
router.get("/salary/monthly", async (req, res) => {
    try {
        const { month, year, department, status, search } = req.query;

        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();
        const monthStr = String(targetMonth).padStart(2, '0');
        const monthYear = `${targetYear}-${monthStr}`;

        // Get employees with filters
        let userFilter = { isActive: true };
        if (department) userFilter.department = department;
        if (search) {
            userFilter.$or = [
                { name: { $regex: search, $options: "i" } },
                { employeeId: { $regex: search, $options: "i" } }
            ];
        }

        const users = await User.find(userFilter)
            .select("employeeId name email role department salary")
            .lean();
        const userIds = users.map(u => u.employeeId);

        // Get salary records
        const salaries = await Salary.find({
            employeeId: { $in: userIds }
        }).lean();
        const salaryMap = new Map();
        for (const s of salaries) {
            salaryMap.set(s.employeeId, s);
        }

        const result = [];
        for (const user of users) {
            const salaryDoc = salaryMap.get(user.employeeId);
            const record = salaryDoc?.records?.find(r => r.month === monthYear);

            // Apply status filter
            if (status && record && record.status !== status) continue;
            if (status === "PAID" && !record) continue;

            const additions = record?.totalAdditions || 0;
            const deductions = record?.totalDeductions || 0;

            result.push({
                EmployeeID: user.employeeId,
                Name: user.name,
                Email: user.email,
                Department: user.department || '—',
                Role: user.role || 'EMPLOYEE',
                BasicSalary: user.salary || 0,
                TotalAdditions: additions,
                TotalDeductions: deductions,
                NetSalary: record?.netSalary || 0,
                Status: record?.status || 'UNPAID',
                Month: monthStr,
                Year: targetYear
            });
        }

        res.json({ success: true, data: result, total: result.length });
    } catch (error) {
        console.error("Monthly salary report error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// 6. PAYSLIP REPORT (Individual)
// ============================================================
router.get("/salary/payslip/:employeeId/:year/:month", async (req, res) => {
    try {
        const { employeeId, year, month } = req.params;
        const targetYear = parseInt(year);
        const targetMonth = parseInt(month);
        const monthStr = String(targetMonth).padStart(2, '0');
        const monthYear = `${targetYear}-${monthStr}`;

        // Get employee
        const employee = await User.findOne({ employeeId })
            .select("-password")
            .lean();
        if (!employee) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        // Get salary record
        const salaryDoc = await Salary.findOne({ employeeId }).lean();
        if (!salaryDoc) {
            return res.status(404).json({ success: false, message: "Salary record not found" });
        }

        const record = salaryDoc.records?.find(r => r.month === monthYear);
        if (!record) {
            return res.status(404).json({ success: false, message: "Salary record not found for this month" });
        }

        // Prepare payslip data
        const additions = [];
        const deductions = [];
        let totalAdditions = 0;
        let totalDeductions = 0;

        if (record.usedComponents) {
            for (const comp of record.usedComponents) {
                if (comp.type === "addition") {
                    additions.push({
                        name: comp.name,
                        code: comp.code,
                        amount: comp.amount || 0
                    });
                    totalAdditions += comp.amount || 0;
                } else {
                    deductions.push({
                        name: comp.name,
                        code: comp.code,
                        amount: comp.amount || 0
                    });
                    totalDeductions += comp.amount || 0;
                }
            }
        }

        // Add attendance deductions
        if (record.lateDeduction > 0) {
            deductions.push({ name: "Late Deduction", amount: record.lateDeduction });
            totalDeductions += record.lateDeduction;
        }
        if (record.halfDayDeduction > 0) {
            deductions.push({ name: "Half Day Deduction", amount: record.halfDayDeduction });
            totalDeductions += record.halfDayDeduction;
        }
        if (record.absentDeduction > 0) {
            deductions.push({ name: "Absent Deduction", amount: record.absentDeduction });
            totalDeductions += record.absentDeduction;
        }
        if (record.leaveDeduction > 0) {
            deductions.push({ name: "Leave Deduction", amount: record.leaveDeduction });
            totalDeductions += record.leaveDeduction;
        }

        // Get manager name
        let managerName = null;
        if (employee.managerId) {
            const manager = await User.findOne({ employeeId: employee.managerId }).select("name").lean();
            managerName = manager?.name || null;
        }

        res.json({
            success: true,
            data: {
                employee: {
                    employeeId: employee.employeeId,
                    name: employee.name,
                    email: employee.email,
                    role: employee.role,
                    department: employee.department || '—',
                    designation: employee.designation || '—',
                    managerName: managerName || '—',
                    joinDate: employee.joinDate ? new Date(employee.joinDate).toLocaleDateString() : '—',
                    panNumber: employee.panNumber || '—',
                    bankName: employee.bankName || '—',
                    bankAccountNo: employee.bankAccountNo || '—'
                },
                salary: {
                    basicSalary: salaryDoc.basicSalary,
                    grossSalary: record.grossSalary || (salaryDoc.basicSalary + totalAdditions),
                    totalAdditions: totalAdditions,
                    totalDeductions: totalDeductions,
                    netSalary: record.netSalary || 0,
                    status: record.status || 'UNPAID',
                    month: record.month,
                    year: record.year
                },
                additions: additions,
                deductions: deductions,
                attendanceSummary: record.attendanceSummary || {},
                paymentInfo: {
                    paidOn: record.paidAt ? new Date(record.paidAt).toLocaleDateString() : '—',
                    paidBy: record.paidByName || '—'
                }
            }
        });
    } catch (error) {
        console.error("Payslip report error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// 7. PERFORMANCE REVIEW REPORT
// ============================================================
router.get("/performance/reviews", async (req, res) => {
    try {
        const { month, year, department, role, search } = req.query;

        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();
        const monthStr = String(targetMonth).padStart(2, '0');
        const monthYear = `${targetYear}-${monthStr}`;

        // Get employees with filters
        let userFilter = { isActive: true };
        if (department) userFilter.department = department;
        if (role) userFilter.role = role;
        if (search) {
            userFilter.$or = [
                { name: { $regex: search, $options: "i" } },
                { employeeId: { $regex: search, $options: "i" } }
            ];
        }

        const users = await User.find(userFilter)
            .select("employeeId name email role department designation")
            .lean();
        const userIds = users.map(u => u.employeeId);

        // Get performance records
        const performances = await Performance.find({
            employeeId: { $in: userIds }
        }).lean();
        const perfMap = new Map();
        for (const p of performances) {
            perfMap.set(p.employeeId, p);
        }

        const result = [];
        for (const user of users) {
            const perfDoc = perfMap.get(user.employeeId);
            if (!perfDoc || !perfDoc.reviews || perfDoc.reviews.length === 0) {
                result.push({
                    EmployeeID: user.employeeId,
                    Name: user.name,
                    Email: user.email,
                    Department: user.department || '—',
                    Role: user.role,
                    Designation: user.designation || '—',
                    ReviewMonth: '—',
                    Quarter: '—',
                    TaskCompletion: 0,
                    QualityOfWork: 0,
                    DeadlinesMet: 0,
                    BehaviorTeamwork: 0,
                    OverallRating: 0,
                    ReviewedBy: '—'
                });
                continue;
            }

            const review = perfDoc.reviews.find(r => r.reviewMonth === monthYear) || perfDoc.reviews[perfDoc.reviews.length - 1];

            result.push({
                EmployeeID: user.employeeId,
                Name: user.name,
                Email: user.email,
                Department: user.department || '—',
                Role: user.role,
                Designation: user.designation || '—',
                ReviewMonth: review.reviewMonth || '—',
                Quarter: review.quarter || '—',
                TaskCompletion: review.taskCompletion || 0,
                QualityOfWork: review.qualityOfWork || 0,
                DeadlinesMet: review.deadlinesMet || 0,
                BehaviorTeamwork: review.behaviorTeamwork || 0,
                OverallRating: review.overallRating || 0,
                ReviewedBy: review.reviewedByName || '—'
            });
        }

        res.json({ success: true, data: result, total: result.length });
    } catch (error) {
        console.error("Performance review report error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// 8. TASK COMPLETION REPORT
// ============================================================
router.get("/tasks/completion", async (req, res) => {
    try {
        const { status, fromDate, toDate, assignedTo, createdBy, department } = req.query;

        let filter = {};
        if (status) filter.status = status;
        if (fromDate && toDate) {
            filter.createdAt = { $gte: new Date(fromDate), $lte: new Date(toDate) };
        }
        if (assignedTo) filter["assignedTo.employeeId"] = assignedTo;
        if (createdBy) filter.createdBy = createdBy;

        // Get tasks
        let tasks = await Task.find(filter)
            .sort({ createdAt: -1 })
            .lean();

        // Filter by department if specified
        if (department) {
            const deptUsers = await User.find({ department, isActive: true })
                .select("employeeId")
                .lean();
            const deptUserIds = deptUsers.map(u => u.employeeId);
            tasks = tasks.filter(t =>
                t.assignedTo?.some(a => deptUserIds.includes(a.employeeId))
            );
        }

        const result = tasks.map(task => ({
            TaskID: task.taskId,
            Title: task.title,
            Description: task.description || '—',
            AssignedTo: task.assignedTo?.map(a => a.employeeName).join(', ') || '—',
            CreatedBy: task.createdByName || '—',
            Deadline: task.deadline || '—',
            Status: task.status || 'INCOMPLETE',
            CompletedAt: task.completedAt ? new Date(task.completedAt).toLocaleDateString() : '—',
            CompletedBy: task.completedBy || '—',
            CreatedAt: new Date(task.createdAt).toLocaleDateString()
        }));

        res.json({ success: true, data: result, total: result.length });
    } catch (error) {
        console.error("Task completion report error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// 9. TEAM TASK REPORT (Manager)
// ============================================================
router.get("/tasks/team", async (req, res) => {
    try {
        const { managerId, department } = req.query;

        if (!managerId) {
            return res.status(400).json({ success: false, message: "managerId is required" });
        }

        // Get team members
        let teamFilter = { managerId, isActive: true };
        if (department) teamFilter.department = department;

        const teamMembers = await User.find(teamFilter)
            .select("employeeId name email department role")
            .lean();
        const teamIds = teamMembers.map(m => m.employeeId);

        // Get tasks assigned to team
        const tasks = await Task.find({
            "assignedTo.employeeId": { $in: teamIds }
        }).lean();

        const result = teamMembers.map(member => {
            const memberTasks = tasks.filter(t =>
                t.assignedTo?.some(a => a.employeeId === member.employeeId)
            );
            const total = memberTasks.length;
            const completed = memberTasks.filter(t => t.status === "COMPLETE").length;
            const pending = total - completed;
            const overdue = memberTasks.filter(t =>
                t.status !== "COMPLETE" && t.deadline && new Date(t.deadline) < new Date()
            ).length;

            return {
                EmployeeID: member.employeeId,
                Name: member.name,
                Email: member.email,
                Department: member.department || '—',
                Role: member.role || 'EMPLOYEE',
                TotalTasks: total,
                Completed: completed,
                Pending: pending,
                Overdue: overdue,
                CompletionRate: total > 0 ? ((completed / total) * 100).toFixed(1) : 0
            };
        });

        res.json({ success: true, data: result, total: result.length });
    } catch (error) {
        console.error("Team task report error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// 10. HOLIDAY LIST REPORT
// ============================================================
router.get("/holidays", async (req, res) => {
    try {
        const { year, month } = req.query;

        const policy = await Policy.findOne({ isActive: true }).lean();
        if (!policy || !policy.holidays || policy.holidays.length === 0) {
            return res.json({ success: true, data: [], total: 0 });
        }

        let holidays = policy.holidays;

        // Filter by year
        if (year) {
            const yearNum = parseInt(year);
            holidays = holidays.filter(h => {
                if (h.isRange && h.startDate) {
                    return new Date(h.startDate).getFullYear() === yearNum;
                } else if (h.date) {
                    return new Date(h.date).getFullYear() === yearNum;
                }
                return false;
            });
        }

        // Filter by month
        if (month && year) {
            const monthNum = parseInt(month);
            holidays = holidays.filter(h => {
                if (h.isRange && h.startDate) {
                    return new Date(h.startDate).getMonth() + 1 === monthNum;
                } else if (h.date) {
                    return new Date(h.date).getMonth() + 1 === monthNum;
                }
                return false;
            });
        }

        const result = holidays.map(h => ({
            Name: h.name || '—',
            Type: h.type || 'public',
            Date: h.isRange
                ? `${h.startDate ? new Date(h.startDate).toLocaleDateString() : '—'} - ${h.endDate ? new Date(h.endDate).toLocaleDateString() : '—'}`
                : h.date ? new Date(h.date).toLocaleDateString() : '—',
            IsRange: h.isRange ? 'Yes' : 'No',
            Description: h.description || '—'
        }));

        res.json({ success: true, data: result, total: result.length });
    } catch (error) {
        console.error("Holiday list report error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// 11. COMPANY DASHBOARD SUMMARY
// ============================================================
router.get("/company-summary", async (req, res) => {
    try {
        const { month, year } = req.query;
        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();
        const monthStr = String(targetMonth).padStart(2, '0');
        const datePrefix = `${targetYear}-${monthStr}`;
        const monthYear = `${targetYear}-${monthStr}`;

        // Employee stats
        const allEmployees = await User.find({ role: { $in: ["HR", "MANAGER", "EMPLOYEE"] } }).lean();
        const totalEmployees = allEmployees.length;
        const activeEmployees = allEmployees.filter(e => e.isActive).length;
        const inactiveEmployees = totalEmployees - activeEmployees;

        // Role distribution
        const roleDistribution = {
            HR: allEmployees.filter(e => e.role === "HR").length,
            MANAGER: allEmployees.filter(e => e.role === "MANAGER").length,
            EMPLOYEE: allEmployees.filter(e => e.role === "EMPLOYEE").length
        };

        // Department distribution
        const deptDistribution = {};
        for (const emp of allEmployees) {
            if (emp.department) {
                deptDistribution[emp.department] = (deptDistribution[emp.department] || 0) + 1;
            }
        }

        // Attendance summary
        const attendances = await Attendance.find({}).lean();
        let present = 0, late = 0, absent = 0, halfDay = 0;
        for (const att of attendances) {
            const records = att.records?.filter(r => r.date && r.date.startsWith(datePrefix)) || [];
            for (const r of records) {
                if (r.checkInTime) {
                    present++;
                    if (r.status === 'LATE') late++;
                    else if (r.status === 'HALF_DAY') halfDay++;
                } else if (r.status === 'ABSENT') {
                    absent++;
                }
            }
        }
        const attendanceRate = totalEmployees > 0 ? ((present / totalEmployees) * 100).toFixed(1) : 0;

        // Leave summary
        const leaves = await Leave.find({
            status: "APPROVED",
            $or: [
                { fromDate: { $regex: `^${datePrefix}` } },
                { toDate: { $regex: `^${datePrefix}` } }
            ]
        }).lean();
        let totalLeaves = 0;
        for (const l of leaves) {
            totalLeaves += l.totalDays || 0;
        }

        // Pending leaves
        const pendingLeaves = await Leave.countDocuments({ status: "PENDING" });

        // Salary summary
        const salaries = await Salary.find({}).lean();
        let totalSalary = 0;
        let paidCount = 0;
        let unpaidCount = 0;
        for (const s of salaries) {
            const record = s.records?.find(r => r.month === monthYear);
            if (record) {
                totalSalary += record.netSalary || 0;
                if (record.status === "PAID") paidCount++;
                else unpaidCount++;
            } else {
                totalSalary += s.basicSalary || 0;
                unpaidCount++;
            }
        }

        // Task summary
        const tasks = await Task.find({}).lean();
        const totalTasks = tasks.length;
        const completedTasks = tasks.filter(t => t.status === "COMPLETE").length;
        const taskCompletionRate = totalTasks > 0 ? ((completedTasks / totalTasks) * 100).toFixed(1) : 0;

        res.json({
            success: true,
            data: {
                employeeStats: {
                    total: totalEmployees,
                    active: activeEmployees,
                    inactive: inactiveEmployees,
                    roleDistribution: roleDistribution,
                    departmentDistribution: deptDistribution
                },
                attendanceStats: {
                    present: present || 0,
                    late: late || 0,
                    absent: absent || 0,
                    halfDay: halfDay || 0,
                    attendanceRate: parseFloat(attendanceRate)
                },
                leaveStats: {
                    totalLeavesTaken: totalLeaves || 0,
                    pendingLeaves: pendingLeaves || 0
                },
                salaryStats: {
                    totalSalary: totalSalary || 0,
                    paidCount: paidCount || 0,
                    unpaidCount: unpaidCount || 0
                },
                taskStats: {
                    total: totalTasks || 0,
                    completed: completedTasks || 0,
                    completionRate: parseFloat(taskCompletionRate)
                }
            }
        });
    } catch (error) {
        console.error("Company summary error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;