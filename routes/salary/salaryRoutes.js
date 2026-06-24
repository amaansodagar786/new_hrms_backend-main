const express = require("express");
const Salary = require("../../models/Salary/Salary");
const User = require("../../models/User");
const Policy = require("../../models/Policy");
const { calculateSalary } = require("../../utils/salaryCalculator");
const { sendSalaryPaidEmail } = require("../../utils/salaryEmailService");

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
const getLastDayOfMonth = (year, month) => {
  return new Date(year, month, 0).getDate();
};

const getMonthName = (month) => {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return months[month - 1];
};

const getNextMonthYear = (year, month) => {
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear = year + 1;
  }
  return { year: nextYear, month: nextMonth };
};

// ========== CHECK IF SALARY PROCESSING IS ALLOWED ==========
const isAllowedToProcessSalary = (targetYear, targetMonth) => {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDate = today.getDate();

  const lastDayOfTargetMonth = new Date(targetYear, targetMonth, 0).getDate();

  if (currentYear === targetYear && currentMonth === targetMonth) {
    return currentDate >= 15 && currentDate <= lastDayOfTargetMonth;
  }

  let nextMonth = targetMonth + 1;
  let nextYear = targetYear;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear = targetYear + 1;
  }

  if (currentYear === nextYear && currentMonth === nextMonth) {
    return currentDate >= 1 && currentDate <= 15;
  }

  return false;
};

const getAllowedWindowMessage = (targetYear, targetMonth) => {
  const monthName = getMonthName(targetMonth);
  const nextMonthName = getMonthName(targetMonth === 12 ? 1 : targetMonth + 1);
  const lastDay = getLastDayOfMonth(targetYear, targetMonth);
  return `Salary for ${monthName} ${targetYear} can only be processed between ${monthName} 26th-${lastDay} and ${nextMonthName} 1st-5th.`;
};

// ========== GET OR CREATE EMPLOYEE SALARY DOCUMENT ==========
const getOrCreateSalaryDoc = async (employeeId, employeeName, basicSalary) => {
  let salary = await Salary.findOne({ employeeId });
  if (!salary) {
    salary = new Salary({
      employeeId,
      employeeName,
      basicSalary,
      records: [],
    });
    await salary.save();
  } else if (salary.employeeName !== employeeName) {
    salary.employeeName = employeeName;
    await salary.save();
  } else if (salary.basicSalary !== basicSalary) {
    salary.basicSalary = basicSalary;
    await salary.save();
  }
  return salary;
};

// ========== GET ALL SALARY COMPONENTS (for selection) ==========
router.get("/components", async (req, res) => {
  try {
    const policy = await Policy.findOne({ isActive: true });
    if (!policy) {
      return res.status(404).json({
        success: false,
        message: "No active policy found",
      });
    }

    const components = policy.salaryComponents?.filter(c => c.isActive !== false) || [];
    components.sort((a, b) => (a.order || 0) - (b.order || 0));

    res.json({
      success: true,
      components: components,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== GET MY CURRENT MONTH SALARY ==========
router.get("/me", async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const formattedMonth = `${year}-${String(month).padStart(2, "0")}`;

    let salary = await Salary.findOne({ employeeId });

    if (!salary) {
      return res.json({
        success: true,
        salary: null,
        message: "No salary record found for current month",
      });
    }

    const currentRecord = salary.records.find(r => r.month === formattedMonth);

    res.json({
      success: true,
      salary: currentRecord || null,
      basicSalary: salary.basicSalary,
      message: currentRecord ? "Salary record found" : "No salary calculated for this month yet",
    });
  } catch (error) {
    console.error("Get my salary error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== GET MY SALARY HISTORY ==========
router.get("/me/history", async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const { limit = 12, page = 1 } = req.query;

    const salary = await Salary.findOne({ employeeId });

    if (!salary || salary.records.length === 0) {
      return res.json({
        success: true,
        records: [],
        pagination: {
          total: 0,
          page: 1,
          limit: parseInt(limit),
          totalPages: 0,
        },
      });
    }

    let records = [...salary.records];
    records.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month.localeCompare(a.month);
    });

    const total = records.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedRecords = records.slice(skip, skip + parseInt(limit));

    res.json({
      success: true,
      records: paginatedRecords,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get salary history error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});





// ========== CALCULATE AND GENERATE SALARY FOR EMPLOYEE ==========
router.post("/calculate/:employeeId/:year/:month", async (req, res) => {
  try {
    const { employeeId, year, month } = req.params;
    const { selectedComponents = [] } = req.body; // Array of component codes to use
    const role = req.user.role;
    const targetYear = parseInt(year);
    const targetMonth = parseInt(month);

    // ========== DATE LOGIC REMOVED - CAN CALCULATE ANYTIME ==========
    // No time window validation - can calculate anytime for testing

    if (role !== "HR" && role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only HR and Admin can calculate salary",
      });
    }

    const user = await User.findOne({ employeeId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const salaryDoc = await getOrCreateSalaryDoc(employeeId, user.name, user.salary);

    const formattedMonth = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
    const existingRecord = salaryDoc.records.find(r => r.month === formattedMonth);

    if (existingRecord && existingRecord.status === "PAID") {
      return res.status(400).json({
        success: false,
        message: "Salary for this month is already paid and cannot be recalculated",
      });
    }

    // Calculate salary with selected components
    const calculation = await calculateSalary(
      employeeId, user.name, user.salary,
      targetYear, targetMonth, selectedComponents
    );

    if (!calculation.success) {
      return res.status(400).json({
        success: false,
        message: calculation.message,
      });
    }

    // Prepare the record
    const newRecord = {
      month: formattedMonth,
      year: targetYear,
      selectedComponents: selectedComponents,
      usedComponents: calculation.components.used,
      totalAdditions: calculation.components.totalAdditions,
      totalDeductionsFromComponents: calculation.components.totalDeductions,
      attendanceSummary: calculation.attendanceSummary,
      lateDeduction: calculation.attendanceDeductions.lateDeduction,
      halfDayDeduction: calculation.attendanceDeductions.halfDayDeduction,
      absentDeduction: calculation.attendanceDeductions.absentDeduction,
      leaveDeduction: calculation.attendanceDeductions.leaveDeduction,
      attendanceDeductions: calculation.attendanceDeductions.total,
      grossSalary: calculation.grossSalary,
      totalDeductions: calculation.totalDeductions,
      netSalary: calculation.netSalary,
      status: "UNPAID",
      generatedAt: new Date(),
    };

    if (existingRecord) {
      const index = salaryDoc.records.findIndex(r => r.month === formattedMonth);
      salaryDoc.records[index] = { ...salaryDoc.records[index], ...newRecord };
    } else {
      salaryDoc.records.push(newRecord);
    }

    await salaryDoc.save();

    res.json({
      success: true,
      message: `Salary calculated successfully for ${getMonthName(targetMonth)} ${targetYear}`,
      salary: newRecord,
      calculation: {
        totalWorkingDays: calculation.totalWorkingDays,
        dailySalary: calculation.dailySalary,
        attendanceDeductions: calculation.attendanceDeductions,
        components: calculation.components,
        grossSalary: calculation.grossSalary,
        totalDeductions: calculation.totalDeductions,
        netSalary: calculation.netSalary,
      },
    });
  } catch (error) {
    console.error("Calculate salary error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});


// ========== MARK SALARY AS PAID ==========
router.put("/:employeeId/:year/:month/mark-paid", async (req, res) => {
  try {
    const { employeeId, year, month } = req.params;
    const role = req.user.role;
    const userId = req.user.employeeId;
    const userName = req.user.name;
    const targetYear = parseInt(year);
    const targetMonth = parseInt(month);

    if (!isAllowedToProcessSalary(targetYear, targetMonth)) {
      const allowedMessage = getAllowedWindowMessage(targetYear, targetMonth);
      return res.status(403).json({
        success: false,
        message: allowedMessage,
        error: "SALARY_MARK_PAID_WINDOW_CLOSED",
      });
    }

    const isOwnSalary = employeeId === userId;

    if (role === "HR" && isOwnSalary) {
      return res.status(403).json({
        success: false,
        message: "HR cannot mark their own salary as paid. Please contact Admin.",
      });
    }

    if (role !== "HR" && role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only HR and Admin can mark salary as paid",
      });
    }

    const salaryDoc = await Salary.findOne({ employeeId });
    if (!salaryDoc) {
      return res.status(404).json({
        success: false,
        message: "Salary record not found for this employee",
      });
    }

    const formattedMonth = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
    const recordIndex = salaryDoc.records.findIndex(r => r.month === formattedMonth);

    if (recordIndex === -1) {
      return res.status(404).json({
        success: false,
        message: `Salary record not found for ${getMonthName(targetMonth)} ${targetYear}. Please calculate salary first.`,
      });
    }

    if (salaryDoc.records[recordIndex].status === "PAID") {
      return res.status(400).json({
        success: false,
        message: "Salary is already marked as paid",
      });
    }

    // Store employee info BEFORE updating
    const employeeName = salaryDoc.employeeName;
    const netSalary = salaryDoc.records[recordIndex].netSalary || 0;

    // Update salary record
    salaryDoc.records[recordIndex].status = "PAID";
    salaryDoc.records[recordIndex].paidAt = new Date();
    salaryDoc.records[recordIndex].paidBy = userId;
    salaryDoc.records[recordIndex].paidByName = userName;

    await salaryDoc.save();

    // ========== SEND EMAIL ==========
    try {
      await sendSalaryPaidEmail(
        employeeId,
        employeeName,
        targetMonth,
        targetYear,
        netSalary,
        userId,
        userName
      );
      console.log(`📧 Salary paid email sent to ${employeeId} for ${getMonthName(targetMonth)} ${targetYear}`);
    } catch (emailError) {
      // Don't fail the request if email fails, just log it
      console.error("❌ Failed to send salary email:", emailError);
    }

    res.json({
      success: true,
      message: `Salary for ${getMonthName(targetMonth)} ${targetYear} marked as paid successfully. Email notification sent.`,
      record: salaryDoc.records[recordIndex],
    });
  } catch (error) {
    console.error("Mark paid error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== GET ALL EMPLOYEES SALARY (HR/Admin only) ==========
router.get("/all", async (req, res) => {
  try {
    const role = req.user.role;

    if (role !== "HR" && role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only HR and Admin can view all salaries.",
      });
    }

    const { month, year, status, search, page = 1, limit = 20 } = req.query;

    const allEmployees = await User.find({
      isActive: true,
      role: { $in: ["HR", "MANAGER", "EMPLOYEE"] }
    }).select("employeeId name role salary").lean();

    const salaryDocs = await Salary.find({}).lean();

    const salaryMap = new Map();
    for (const doc of salaryDocs) {
      salaryMap.set(doc.employeeId, doc);
    }

    let allRecords = [];
    let formattedMonth = null;
    if (year && month) {
      formattedMonth = `${year}-${String(month).padStart(2, "0")}`;
    }

    for (const employee of allEmployees) {
      const salaryDoc = salaryMap.get(employee.employeeId);
      let record = null;

      if (salaryDoc && year && month && formattedMonth) {
        record = salaryDoc.records.find(r => r.month === formattedMonth);
      }

      if (status && record && record.status !== status) {
        continue;
      }

      if (search && !employee.name.toLowerCase().includes(search.toLowerCase()) &&
        !employee.employeeId.toLowerCase().includes(search.toLowerCase())) {
        continue;
      }

      allRecords.push({
        employeeId: employee.employeeId,
        employeeName: employee.name,
        role: employee.role,
        basicSalary: employee.salary,
        netSalary: record?.netSalary || 0,
        status: record?.status || "UNPAID",
        month: record?.month || formattedMonth || '—',
        year: record?.year || (year ? parseInt(year) : new Date().getFullYear()),
        hasRecord: !!record,
        selectedComponents: record?.selectedComponents || [],
        usedComponents: record?.usedComponents || [],
        grossSalary: record?.grossSalary || 0,
        totalAdditions: record?.totalAdditions || 0,
        totalDeductions: record?.totalDeductions || 0,
        ...(record || {})
      });
    }

    allRecords.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    const total = allRecords.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedRecords = allRecords.slice(skip, skip + parseInt(limit));

    const totalSalary = paginatedRecords.reduce((sum, s) => sum + (s.netSalary || 0), 0);

    res.json({
      success: true,
      salaries: paginatedRecords,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
      stats: {
        total: allRecords.length,
        totalSalary,
        paid: allRecords.filter(s => s.status === 'PAID').length,
        unpaid: allRecords.filter(s => s.status === 'UNPAID').length,
      }
    });
  } catch (error) {
    console.error("Get all salaries error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== GET EMPLOYEE SALARY DETAIL (HR/Admin only) ==========
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const role = req.user.role;

    if (role !== "HR" && role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const salary = await Salary.findOne({ employeeId });

    if (!salary) {
      return res.json({
        success: true,
        salary: null,
        records: [],
        message: "No salary records found for this employee",
      });
    }

    const records = [...salary.records];
    records.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month.localeCompare(a.month);
    });

    res.json({
      success: true,
      employeeId: salary.employeeId,
      employeeName: salary.employeeName,
      basicSalary: salary.basicSalary,
      records,
    });
  } catch (error) {
    console.error("Get employee salary error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== UPDATE BASIC SALARY (Admin only) ==========
router.put("/employee/:employeeId/basic-salary", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { basicSalary } = req.body;
    const role = req.user.role;

    if (role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only Admin can update basic salary",
      });
    }

    const salary = await Salary.findOne({ employeeId });
    if (!salary) {
      return res.status(404).json({
        success: false,
        message: "Salary record not found",
      });
    }
    salary.basicSalary = basicSalary;
    await salary.save();

    await User.findOneAndUpdate(
      { employeeId },
      { $set: { salary: basicSalary } }
    );

    res.json({
      success: true,
      message: "Basic salary updated successfully",
      basicSalary: salary.basicSalary,
    });
  } catch (error) {
    console.error("Update basic salary error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;