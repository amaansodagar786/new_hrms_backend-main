const express = require("express");
const Salary = require("../../models/Salary/Salary");
const User = require("../../models/User");
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
        role: "ADMIN",
      };
      return next();
    }

    return res.status(401).json({ success: false, message: "Not authorized" });
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
});

// ========== HELPER FUNCTIONS ==========
const getMonthName = (month) => {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return months[month - 1];
};

const canAccessPayslip = (requestedEmployeeId, currentUser) => {
  const { employeeId, role } = currentUser;
  if (role === "ADMIN") return true;
  if (role === "HR") return true;
  if (requestedEmployeeId === employeeId) return true;
  return false;
};

// ========== GET OWN PAYSLIP (for logged-in user) ==========
router.get("/self/:year/:month", async (req, res) => {
  try {
    const { year, month } = req.params;
    const employeeId = req.user.employeeId;

    if (!employeeId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const targetYear = parseInt(year);
    const targetMonth = parseInt(month);
    const formattedMonth = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;

    const [employee, salaryDoc] = await Promise.all([
      User.findOne({ employeeId }).select("-password").lean(),
      Salary.findOne({ employeeId }).lean()
    ]);

    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    if (!salaryDoc) {
      return res.status(404).json({ success: false, message: "Salary record not found" });
    }

    const salaryRecord = salaryDoc.records.find(r => r.month === formattedMonth);
    if (!salaryRecord) {
      return res.status(404).json({
        success: false,
        message: `Salary record not found for ${getMonthName(targetMonth)} ${targetYear}`
      });
    }

    if (salaryRecord.status !== "PAID") {
      return res.status(400).json({
        success: false,
        message: "Payslip is only available for paid salaries"
      });
    }

    // Prepare additions and deductions
    const additions = [];
    const deductions = [];

    if (salaryRecord.usedComponents?.length > 0) {
      for (const comp of salaryRecord.usedComponents) {
        if (comp.type === "addition") {
          additions.push({ name: comp.name, code: comp.code, amount: comp.amount, calculationType: comp.calculationType, value: comp.value });
        } else {
          deductions.push({ name: comp.name, code: comp.code, amount: comp.amount, calculationType: comp.calculationType, value: comp.value });
        }
      }
    }

    // Add attendance deductions
    const attendanceItems = [
      { name: "Late Deduction", amount: salaryRecord.lateDeduction || 0 },
      { name: "Half Day Deduction", amount: salaryRecord.halfDayDeduction || 0 },
      { name: "Absent Deduction", amount: salaryRecord.absentDeduction || 0 },
      { name: "Unpaid Leave Deduction", amount: salaryRecord.leaveDeduction || 0 }
    ];

    for (const item of attendanceItems) {
      if (item.amount > 0) {
        deductions.push({ name: item.name, code: item.name.toUpperCase().replace(/ /g, "_"), amount: item.amount, calculationType: "fixed" });
      }
    }

    const totalAdditions = additions.reduce((sum, a) => sum + a.amount, 0);
    const totalComponentDeductions = salaryRecord.totalDeductionsFromComponents ||
      deductions.filter(d => !["LATE", "HALF_DAY", "ABSENT", "LEAVE"].includes(d.code))
        .reduce((sum, d) => sum + d.amount, 0);

    const totalAttendanceDeductions = (salaryRecord.lateDeduction || 0) +
      (salaryRecord.halfDayDeduction || 0) +
      (salaryRecord.absentDeduction || 0) +
      (salaryRecord.leaveDeduction || 0);

    const grossSalary = salaryRecord.grossSalary || (salaryDoc.basicSalary + totalAdditions);

    res.json({
      success: true,
      payslip: {
        company: { name: "HRMS", address: "Your Company Address, City - 400001", email: "hr@hrms.com", phone: "+91 XXXXXXXXXX", gst: "27XXXXXX1234X1Z" },
        employee: {
          name: employee.name, employeeId: employee.employeeId, designation: employee.designation || "Not Assigned",
          department: employee.department || "Not Assigned", role: employee.role, joinDate: employee.joinDate,
          panNumber: "XXXXX1234X", bankName: "State Bank of India", bankAccount: "XXXXXXXXXX1234",
          upiId: `${employee.employeeId.toLowerCase()}@okhdfcbank`
        },
        salaryMonth: getMonthName(targetMonth), salaryYear: targetYear, salaryMonthFormatted: formattedMonth,
        basicSalary: salaryDoc.basicSalary, additions, totalAdditions, deductions,
        totalComponentDeductions, totalAttendanceDeductions,
        totalDeductions: salaryRecord.totalDeductions || (totalComponentDeductions + totalAttendanceDeductions),
        grossSalary, netSalary: salaryRecord.netSalary,
        attendanceSummary: salaryRecord.attendanceSummary || { totalWorkingDays: 0, presentDays: 0, lateDays: 0, halfDays: 0, absentDays: 0, unpaidLeaveDays: 0 },
        selectedComponents: salaryRecord.selectedComponents || [],
        paymentInfo: { status: salaryRecord.status, paidOn: salaryRecord.paidAt, paidBy: salaryRecord.paidByName || "System", generatedOn: new Date(), bankReference: `HRMS/${formattedMonth}/${employee.employeeId}` }
      }
    });

  } catch (error) {
    console.error("Get self payslip error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// ========== GET PAYSLIP BY EMPLOYEE ID (HR/Admin only) ==========
router.get("/:employeeId/:year/:month", async (req, res) => {
  try {
    const { employeeId, year, month } = req.params;
    const targetYear = parseInt(year);
    const targetMonth = parseInt(month);
    const formattedMonth = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;

    if (!canAccessPayslip(employeeId, req.user)) {
      return res.status(403).json({ success: false, message: "Access denied. You can only view your own payslip." });
    }

    const [employee, salaryDoc] = await Promise.all([
      User.findOne({ employeeId }).select("-password").lean(),
      Salary.findOne({ employeeId }).lean()
    ]);

    if (!employee) return res.status(404).json({ success: false, message: "Employee not found" });
    if (!salaryDoc) return res.status(404).json({ success: false, message: "Salary record not found" });

    const salaryRecord = salaryDoc.records.find(r => r.month === formattedMonth);
    if (!salaryRecord) return res.status(404).json({ success: false, message: `Salary record not found for ${getMonthName(targetMonth)} ${targetYear}` });
    if (salaryRecord.status !== "PAID") return res.status(400).json({ success: false, message: "Payslip is only available for paid salaries" });

    // Prepare additions and deductions (same logic as self endpoint)
    const additions = [];
    const deductions = [];

    if (salaryRecord.usedComponents?.length > 0) {
      for (const comp of salaryRecord.usedComponents) {
        if (comp.type === "addition") {
          additions.push({ name: comp.name, code: comp.code, amount: comp.amount, calculationType: comp.calculationType, value: comp.value });
        } else {
          deductions.push({ name: comp.name, code: comp.code, amount: comp.amount, calculationType: comp.calculationType, value: comp.value });
        }
      }
    }

    const attendanceItems = [
      { name: "Late Deduction", amount: salaryRecord.lateDeduction || 0 },
      { name: "Half Day Deduction", amount: salaryRecord.halfDayDeduction || 0 },
      { name: "Absent Deduction", amount: salaryRecord.absentDeduction || 0 },
      { name: "Unpaid Leave Deduction", amount: salaryRecord.leaveDeduction || 0 }
    ];

    for (const item of attendanceItems) {
      if (item.amount > 0) {
        deductions.push({ name: item.name, code: item.name.toUpperCase().replace(/ /g, "_"), amount: item.amount, calculationType: "fixed" });
      }
    }

    const totalAdditions = additions.reduce((sum, a) => sum + a.amount, 0);
    const totalComponentDeductions = salaryRecord.totalDeductionsFromComponents ||
      deductions.filter(d => !["LATE", "HALF_DAY", "ABSENT", "LEAVE"].includes(d.code))
        .reduce((sum, d) => sum + d.amount, 0);

    const totalAttendanceDeductions = (salaryRecord.lateDeduction || 0) + (salaryRecord.halfDayDeduction || 0) + (salaryRecord.absentDeduction || 0) + (salaryRecord.leaveDeduction || 0);
    const grossSalary = salaryRecord.grossSalary || (salaryDoc.basicSalary + totalAdditions);

    res.json({
      success: true,
      payslip: {
        company: { name: "HRMS", address: "Your Company Address", email: "hr@hrms.com", phone: "+91 XXXXXXXXXX" },
        employee: { name: employee.name, employeeId: employee.employeeId, designation: employee.designation || "Not Assigned", department: employee.department || "Not Assigned", role: employee.role, joinDate: employee.joinDate, panNumber: "XXXXX1234X", bankName: "State Bank of India", bankAccount: "XXXXXXXXXX1234" },
        salaryMonth: getMonthName(targetMonth), salaryYear: targetYear, salaryMonthFormatted: formattedMonth,
        basicSalary: salaryDoc.basicSalary, additions, totalAdditions, deductions,
        totalComponentDeductions, totalAttendanceDeductions,
        totalDeductions: salaryRecord.totalDeductions || (totalComponentDeductions + totalAttendanceDeductions),
        grossSalary, netSalary: salaryRecord.netSalary,
        attendanceSummary: salaryRecord.attendanceSummary || { totalWorkingDays: 0, presentDays: 0, lateDays: 0, halfDays: 0, absentDays: 0, unpaidLeaveDays: 0 },
        selectedComponents: salaryRecord.selectedComponents || [],
        paymentInfo: { status: salaryRecord.status, paidOn: salaryRecord.paidAt, paidBy: salaryRecord.paidByName || "System", generatedOn: new Date(), bankReference: `HRMS/${formattedMonth}/${employee.employeeId}` }
      }
    });

  } catch (error) {
    console.error("Get payslip error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// ========== GET PAID MONTHS ==========
router.get("/months/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    if (!canAccessPayslip(employeeId, req.user)) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const salaryDoc = await Salary.findOne({ employeeId }).lean();
    if (!salaryDoc) {
      return res.json({ success: true, paidMonths: [] });
    }

    const paidMonths = salaryDoc.records
      .filter(r => r.status === "PAID")
      .map(r => ({
        month: r.month,
        year: r.year,
        monthName: getMonthName(parseInt(r.month.split('-')[1])),
        displayName: `${getMonthName(parseInt(r.month.split('-')[1]))} ${r.year}`,
        netSalary: r.netSalary
      }))
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month.localeCompare(a.month);
      });

    res.json({ success: true, paidMonths });

  } catch (error) {
    console.error("Get paid months error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// ========== CHECK IF PAYSLIP IS AVAILABLE ==========
router.get("/check/:employeeId/:year/:month", async (req, res) => {
  try {
    const { employeeId, year, month } = req.params;
    const targetYear = parseInt(year);
    const targetMonth = parseInt(month);
    const formattedMonth = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;

    if (!canAccessPayslip(employeeId, req.user)) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const salaryDoc = await Salary.findOne({ employeeId }).lean();
    if (!salaryDoc) {
      return res.json({ success: true, available: false, message: "No salary record found" });
    }

    const salaryRecord = salaryDoc.records.find(r => r.month === formattedMonth);

    res.json({
      success: true,
      available: salaryRecord && salaryRecord.status === "PAID",
      status: salaryRecord?.status || null,
      message: salaryRecord && salaryRecord.status === "PAID" ? "Payslip available" : salaryRecord?.status === "UNPAID" ? "Salary not paid yet" : "No salary record for this month"
    });

  } catch (error) {
    console.error("Check payslip error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

module.exports = router;