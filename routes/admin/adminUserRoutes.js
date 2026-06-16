const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const User = require("../../models/User");
const Attendance = require("../../models/Attendance/Attendance");
const Leave = require("../../models/Leave/Leave");
const LeaveBalance = require("../../models/Leave/LeaveBalance");
const Salary = require("../../models/Salary/Salary");
const Performance = require("../../models/Task/Performance");
const { protectAdmin } = require("../../middleware/authMiddleware");
const { sendWelcomeEmail } = require("../../utils/emailService");

const router = express.Router();

// ========== CUSTOM AUTH FOR HR/ADMIN (Accepts both tokens) ==========
const protectHRorAdmin = async (req, res, next) => {
  try {
    const jwt = require("jsonwebtoken");

    // First try employeeToken (for HR)
    let token = req.cookies.employeeToken;

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role === "HR") {
        req.user = decoded;
        req.userType = "HR";
        return next();
      }
    }

    // Then try adminToken (for Admin)
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

// ========== HELPER: Update manager's assigned employees ==========
const updateManagerAssignedEmployees = async (managerId, employeeId, employeeName, isAdding) => {
  if (!managerId) return;

  const manager = await User.findOne({ employeeId: managerId, role: "MANAGER" });
  if (!manager) return;

  if (isAdding) {
    // Check if already exists
    const alreadyExists = manager.assignedEmployees.some(
      emp => emp.employeeId === employeeId
    );
    if (!alreadyExists) {
      await User.findOneAndUpdate(
        { employeeId: managerId },
        {
          $push: {
            assignedEmployees: { employeeId, name: employeeName, assignedAt: new Date() }
          }
        }
      );
    }
  } else {
    // Remove employee from manager's list
    await User.findOneAndUpdate(
      { employeeId: managerId },
      { $pull: { assignedEmployees: { employeeId } } }
    );
  }
};

// ========== HELPER: Get attendance with filters (for complete details) ==========
const getAttendanceWithFilters = async (employeeId, year, month) => {
  const attendance = await Attendance.findOne({ employeeId }).lean();
  if (!attendance) return { records: [], total: 0 };

  let records = attendance.records || [];

  if (year) {
    records = records.filter(r => r.date && r.date.startsWith(year));
    if (month) {
      const monthStr = String(month).padStart(2, '0');
      records = records.filter(r => r.date && r.date.startsWith(`${year}-${monthStr}`));
    }
  } else {
    // Default: last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const dateLimit = sixMonthsAgo.toISOString().split('T')[0];
    records = records.filter(r => r.date && r.date >= dateLimit);
  }

  records.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return {
    records,
    total: records.length
  };
};

// ========== HELPER: Get leave history with filters ==========
const getLeaveHistory = async (employeeId, year, status, limit = 50) => {
  const filter = { employeeId };
  if (year) filter.fromDate = { $regex: `^${year}` };
  if (status) filter.status = status;

  const leaves = await Leave.find(filter)
    .sort({ appliedOn: -1 })
    .limit(limit)
    .lean();

  return leaves;
};

// ========== HELPER: Get salary records with filters ==========
const getSalaryRecords = async (employeeId, year, month) => {
  const salary = await Salary.findOne({ employeeId }).lean();
  if (!salary) return { records: [], total: 0 };

  let records = salary.records || [];

  if (year) {
    records = records.filter(r => r.year === parseInt(year));
    if (month) {
      const monthStr = String(month).padStart(2, '0');
      records = records.filter(r => r.month === `${year}-${monthStr}`);
    }
  } else {
    // Default: last 6 months
    records = records.slice(-6);
  }

  records.sort((a, b) => (b.month || '').localeCompare(a.month || ''));

  return {
    records,
    total: records.length
  };
};

// ========== HELPER: Get performance reviews ==========
const getPerformanceReviews = async (employeeId, limit = 10) => {
  const performance = await Performance.findOne({ employeeId }).lean();
  if (!performance) return { reviews: [], total: 0 };

  const reviews = (performance.reviews || [])
    .sort((a, b) => (b.reviewMonth || '').localeCompare(a.reviewMonth || ''))
    .slice(0, parseInt(limit));

  return { reviews, total: performance.reviews.length };
};

// ========== CREATE USER (HR, MANAGER, EMPLOYEE) - Admin only ==========
router.post("/users/create", protectAdmin, async (req, res) => {
  try {
    const {
      name, email, password, role, salary, managerId,
      department, designation, phone, address
    } = req.body;

    if (!name || !email || !password || !role || !salary) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: name, email, password, role, salary"
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User with this email already exists"
      });
    }

    const validRoles = ["HR", "MANAGER", "EMPLOYEE"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Must be HR, MANAGER, or EMPLOYEE"
      });
    }

    if (role === "EMPLOYEE" && !managerId) {
      return res.status(400).json({
        success: false,
        message: "managerId is required for EMPLOYEE role"
      });
    }

    if (managerId) {
      const managerExists = await User.findOne({
        employeeId: managerId,
        role: "MANAGER"
      });
      if (!managerExists) {
        return res.status(400).json({
          success: false,
          message: "Manager not found with given managerId"
        });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    let rolePrefix = "";
    switch (role) {
      case "HR": rolePrefix = "HR"; break;
      case "MANAGER": rolePrefix = "MGR"; break;
      case "EMPLOYEE": rolePrefix = "EMP"; break;
    }
    const employeeId = `${rolePrefix}_${uuidv4()}`;

    const user = new User({
      employeeId,
      name,
      email,
      password: hashedPassword,
      role,
      salary,
      managerId: managerId || null,
      department: department || "",
      designation: designation || "",
      phone: phone || "",
      address: address || "",
      panNumber: "",
      aadharNumber: "",
      bankAccountNo: "",
      bankIfsc: "",
      bankName: "",
      accountHolderName: "",
      bloodGroup: "",
      joinLetter: "",
    });

    await user.save();

    if (role === "EMPLOYEE" && managerId) {
      await updateManagerAssignedEmployees(managerId, employeeId, name, true);
    }

    try {
      await sendWelcomeEmail(user, password);
      console.log(`Welcome email sent to ${email}`);
    } catch (emailError) {
      console.error("Failed to send welcome email:", emailError);
    }

    res.status(201).json({
      success: true,
      message: `${role} created successfully. Welcome email sent to ${email}`,
      user: {
        employeeId: user.employeeId,
        name: user.name,
        email: user.email,
        role: user.role,
        salary: user.salary,
        managerId: user.managerId,
        department: user.department,
        designation: user.designation,
      },
    });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

// ========== GET ALL USERS - Admin only ==========
router.get("/users/all", protectAdmin, async (req, res) => {
  try {
    const { role, page = 1, limit = 50 } = req.query;

    let filter = {};
    if (role && ["HR", "MANAGER", "EMPLOYEE"].includes(role)) {
      filter.role = role;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const users = await User.find(filter)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await User.countDocuments(filter);

    res.json({
      success: true,
      users,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

// ========== GET SINGLE USER - Admin only ==========
router.get("/users/:employeeId", protectAdmin, async (req, res) => {
  try {
    const { employeeId } = req.params;

    const user = await User.findOne({ employeeId })
      .select("-password")
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

// ========== UPDATE USER (with manager sync) - Admin only ==========
router.put("/users/:employeeId", protectAdmin, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const {
      name, salary, managerId, department, designation,
      phone, address, isActive
    } = req.body;

    const user = await User.findOne({ employeeId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    if (user.role === "EMPLOYEE" && managerId !== undefined && managerId !== user.managerId) {
      const oldManagerId = user.managerId;
      const newManagerId = managerId;

      if (newManagerId) {
        const newManager = await User.findOne({
          employeeId: newManagerId,
          role: "MANAGER"
        });
        if (!newManager) {
          return res.status(400).json({
            success: false,
            message: "New manager not found"
          });
        }
      }

      if (oldManagerId) {
        await updateManagerAssignedEmployees(oldManagerId, employeeId, null, false);
      }

      if (newManagerId) {
        await updateManagerAssignedEmployees(newManagerId, employeeId, user.name, true);
      }
    }

    const updateFields = {};
    if (name) updateFields.name = name;
    if (salary) updateFields.salary = salary;
    if (managerId !== undefined) updateFields.managerId = managerId || null;
    if (department !== undefined) updateFields.department = department;
    if (designation !== undefined) updateFields.designation = designation;
    if (phone !== undefined) updateFields.phone = phone;
    if (address !== undefined) updateFields.address = address;
    if (isActive !== undefined) updateFields.isActive = isActive;

    const updatedUser = await User.findOneAndUpdate(
      { employeeId },
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select("-password").lean();

    res.json({
      success: true,
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

// ========== DELETE USER (with cleanup) - Admin only ==========
router.delete("/users/:employeeId", protectAdmin, async (req, res) => {
  try {
    const { employeeId } = req.params;

    const user = await User.findOne({ employeeId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    if (user.role === "EMPLOYEE" && user.managerId) {
      await updateManagerAssignedEmployees(user.managerId, employeeId, null, false);
    }

    if (user.role === "MANAGER") {
      const assignedEmployees = await User.find({ managerId: employeeId });
      for (const emp of assignedEmployees) {
        await User.findOneAndUpdate(
          { employeeId: emp.employeeId },
          { $set: { managerId: null } }
        );
      }
    }

    await User.deleteOne({ employeeId });

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

// ========== GET ALL MANAGERS (with assigned employees) - Admin/HR ==========
router.get("/managers/list", protectHRorAdmin, async (req, res) => {
  try {
    const managers = await User.find({ role: "MANAGER", isActive: true })
      .select("employeeId name email assignedEmployees")
      .sort({ name: 1 })
      .lean();

    res.json({
      success: true,
      managers,
    });
  } catch (error) {
    console.error("Get managers error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

// ========== GET MANAGER WITH ALL ASSIGNED EMPLOYEES - Admin/HR ==========
router.get("/managers/:managerId/employees", protectHRorAdmin, async (req, res) => {
  try {
    const { managerId } = req.params;

    const manager = await User.findOne({ employeeId: managerId, role: "MANAGER" })
      .select("employeeId name assignedEmployees")
      .lean();

    if (!manager) {
      return res.status(404).json({
        success: false,
        message: "Manager not found"
      });
    }

    const employeeIds = manager.assignedEmployees.map(emp => emp.employeeId);
    const employees = await User.find({
      employeeId: { $in: employeeIds },
      role: "EMPLOYEE"
    })
      .select("employeeId name designation department phone email")
      .lean();

    res.json({
      success: true,
      manager: {
        employeeId: manager.employeeId,
        name: manager.name,
      },
      employees,
      count: employees.length,
    });
  } catch (error) {
    console.error("Get manager employees error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

// ========== GET ALL EMPLOYEES WITH MANAGER NAMES (Admin/HR only) ==========
router.get("/employees/all", protectHRorAdmin, async (req, res) => {
  try {
    const { role: roleFilter, department, status, search, page = 1, limit = 20 } = req.query;

    let filter = { role: { $in: ["HR", "MANAGER", "EMPLOYEE"] } };

    if (roleFilter && ["HR", "MANAGER", "EMPLOYEE"].includes(roleFilter)) {
      filter.role = roleFilter;
    }
    if (department) {
      filter.department = department;
    }
    if (status === "inactive") {
      filter.isActive = false;
    } else {
      filter.isActive = true;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { employeeId: { $regex: search, $options: "i" } },
        { department: { $regex: search, $options: "i" } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const employees = await User.find(filter)
      .select("-password")
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const allManagers = await User.find({ role: "MANAGER", isActive: true })
      .select("employeeId name")
      .lean();

    const managerMap = new Map();
    allManagers.forEach(mgr => {
      managerMap.set(mgr.employeeId, mgr.name);
    });

    const employeesWithManager = employees.map(emp => ({
      ...emp,
      managerName: emp.managerId ? managerMap.get(emp.managerId) || null : null,
      assignedEmployeesCount: emp.role === "MANAGER" ? (emp.assignedEmployees?.length || 0) : 0
    }));

    const total = await User.countDocuments(filter);
    const departments = await User.distinct("department", { role: { $in: ["HR", "MANAGER", "EMPLOYEE"] } });

    res.json({
      success: true,
      employees: employeesWithManager,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
      filters: {
        departments: departments.filter(d => d),
        roles: ["HR", "MANAGER", "EMPLOYEE"],
      }
    });
  } catch (error) {
    console.error("Get all employees error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== GET SINGLE EMPLOYEE DETAILS (Admin/HR only) ==========
router.get("/employees/:employeeId", protectHRorAdmin, async (req, res) => {
  try {
    const { employeeId } = req.params;

    const employee = await User.findOne({ employeeId })
      .select("-password")
      .lean();

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    let managerName = null;
    if (employee.managerId) {
      const manager = await User.findOne({ employeeId: employee.managerId }).select("name").lean();
      managerName = manager?.name || null;
    }

    let assignedEmployeesList = [];
    if (employee.role === "MANAGER" && employee.assignedEmployees?.length > 0) {
      const employeeIds = employee.assignedEmployees.map(emp => emp.employeeId);
      assignedEmployeesList = await User.find({ employeeId: { $in: employeeIds } })
        .select("employeeId name designation department")
        .lean();
    }

    res.json({
      success: true,
      employee: {
        ...employee,
        managerName,
        assignedEmployees: assignedEmployeesList
      }
    });
  } catch (error) {
    console.error("Get employee details error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== UPDATE EMPLOYEE (Admin/HR only) ==========
router.put("/employees/:employeeId", protectHRorAdmin, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const {
      phone, address, department, designation,
      managerId, isActive, salary,
      panNumber, aadharNumber, bankAccountNo, bankIfsc,
      bankName, accountHolderName, bloodGroup, joinLetter
    } = req.body;

    const employee = await User.findOne({ employeeId });
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const updateFields = {};

    if (phone !== undefined) updateFields.phone = phone;
    if (address !== undefined) updateFields.address = address;
    if (department !== undefined) updateFields.department = department;
    if (designation !== undefined) updateFields.designation = designation;
    if (isActive !== undefined) updateFields.isActive = isActive;

    if (panNumber !== undefined) updateFields.panNumber = panNumber;
    if (aadharNumber !== undefined) updateFields.aadharNumber = aadharNumber;
    if (bankAccountNo !== undefined) updateFields.bankAccountNo = bankAccountNo;
    if (bankIfsc !== undefined) updateFields.bankIfsc = bankIfsc;
    if (bankName !== undefined) updateFields.bankName = bankName;
    if (accountHolderName !== undefined) updateFields.accountHolderName = accountHolderName;
    if (bloodGroup !== undefined) updateFields.bloodGroup = bloodGroup;
    if (joinLetter !== undefined) updateFields.joinLetter = joinLetter;

    if (req.userType === "ADMIN" && salary !== undefined) {
      updateFields.salary = salary;
    }

    if (managerId !== undefined && employee.role === "EMPLOYEE") {
      const oldManagerId = employee.managerId;
      const newManagerId = managerId || null;

      if (oldManagerId !== newManagerId) {
        if (oldManagerId) {
          await User.findOneAndUpdate(
            { employeeId: oldManagerId },
            { $pull: { assignedEmployees: { employeeId } } }
          );
        }

        if (newManagerId) {
          const newManager = await User.findOne({ employeeId: newManagerId, role: "MANAGER" });
          if (newManager) {
            await User.findOneAndUpdate(
              { employeeId: newManagerId },
              { $push: { assignedEmployees: { employeeId, name: employee.name, assignedAt: new Date() } } }
            );
          }
        }
      }

      updateFields.managerId = newManagerId;
    }

    const updatedEmployee = await User.findOneAndUpdate(
      { employeeId },
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select("-password").lean();

    let managerName = null;
    if (updatedEmployee.managerId) {
      const manager = await User.findOne({ employeeId: updatedEmployee.managerId }).select("name").lean();
      managerName = manager?.name || null;
    }

    res.json({
      success: true,
      message: "Employee updated successfully",
      employee: {
        ...updatedEmployee,
        managerName
      }
    });
  } catch (error) {
    console.error("Update employee error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== TOGGLE EMPLOYEE STATUS (Admin/HR only) ==========
router.patch("/employees/:employeeId/toggle-status", protectHRorAdmin, async (req, res) => {
  try {
    const { employeeId } = req.params;

    const employee = await User.findOne({ employeeId });
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const newStatus = !employee.isActive;

    await User.findOneAndUpdate(
      { employeeId },
      { $set: { isActive: newStatus } }
    );

    res.json({
      success: true,
      message: `Employee ${newStatus ? 'activated' : 'deactivated'} successfully`,
      isActive: newStatus
    });
  } catch (error) {
    console.error("Toggle status error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== RESET EMPLOYEE PASSWORD (Admin/HR only) ==========
router.put("/employees/:employeeId/reset-password", protectHRorAdmin, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { newPassword } = req.body;
    const updatedBy = req.user.name || (req.user.role === "ADMIN" ? "Admin" : "HR");

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long"
      });
    }

    const employee = await User.findOne({ employeeId });
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    employee.password = hashedPassword;
    await employee.save();

    try {
      const { sendPasswordResetNotification } = require("../../utils/emailService");
      await sendPasswordResetNotification(employee, updatedBy);
      console.log(`Password reset notification sent to ${employee.email}`);
    } catch (emailError) {
      console.error("Failed to send password reset email:", emailError);
    }

    res.json({
      success: true,
      message: `Password reset successfully for ${employee.name}. Email notification sent.`
    });

  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

// ============================================================
// ========== 🆕 NEW: GET COMPLETE EMPLOYEE DETAILS ==========
// ============================================================
router.get("/employees/:employeeId/complete-details", protectHRorAdmin, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const {
      attendanceYear, attendanceMonth,
      leaveYear, leaveStatus,
      salaryYear, salaryMonth,
      performanceLimit = 10
    } = req.query;

    // Run all queries in parallel for optimal performance
    const [
      employee,
      attendance,
      leaveBalance,
      leaveHistory,
      salaryRecords,
      performanceReviews
    ] = await Promise.all([
      // 1. Employee Basic Info
      User.findOne({ employeeId })
        .select("-password")
        .lean(),

      // 2. Attendance Records (with filters)
      getAttendanceWithFilters(employeeId, attendanceYear, attendanceMonth),

      // 3. Leave Balance (current year)
      LeaveBalance.findOne({
        employeeId,
        year: leaveYear || new Date().getFullYear()
      }).lean(),

      // 4. Leave History (with filters)
      getLeaveHistory(employeeId, leaveYear, leaveStatus),

      // 5. Salary Records (with filters)
      getSalaryRecords(employeeId, salaryYear, salaryMonth),

      // 6. Performance Reviews (with limit)
      getPerformanceReviews(employeeId, performanceLimit)
    ]);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    // Get manager name
    let managerName = null;
    if (employee.managerId) {
      const manager = await User.findOne({ employeeId: employee.managerId })
        .select("name")
        .lean();
      managerName = manager?.name || null;
    }

    // Prepare leave balance response
    let leaveBalanceData = null;
    if (leaveBalance) {
      const balances = {};
      for (const b of leaveBalance.balances || []) {
        balances[b.leaveType] = {
          total: b.total || 0,
          used: b.used || 0,
          remaining: b.remaining || 0
        };
      }
      leaveBalanceData = balances;
    }

    // Prepare response
    res.json({
      success: true,
      data: {
        // Basic Info
        employee: {
          employeeId: employee.employeeId,
          name: employee.name,
          email: employee.email,
          role: employee.role,
          department: employee.department,
          designation: employee.designation,
          managerId: employee.managerId,
          managerName: managerName,
          salary: employee.salary,
          joinDate: employee.joinDate,
          phone: employee.phone,
          address: employee.address,
          isActive: employee.isActive,
          panNumber: employee.panNumber,
          aadharNumber: employee.aadharNumber,
          bankAccountNo: employee.bankAccountNo,
          bankIfsc: employee.bankIfsc,
          bankName: employee.bankName,
          accountHolderName: employee.accountHolderName,
          bloodGroup: employee.bloodGroup,
          joinLetter: employee.joinLetter,
          profilePicture: employee.profilePicture,
          assignedEmployeesCount: employee.assignedEmployees?.length || 0,
          createdAt: employee.createdAt,
          updatedAt: employee.updatedAt
        },

        // Attendance Summary & History
        attendance: {
          records: attendance.records || [],
          total: attendance.total || 0,
          filters: {
            year: attendanceYear || null,
            month: attendanceMonth || null
          }
        },

        // Leave Management
        leave: {
          balance: leaveBalanceData,
          history: leaveHistory || [],
          filters: {
            year: leaveYear || null,
            status: leaveStatus || null
          }
        },

        // Salary Records
        salary: {
          records: salaryRecords.records || [],
          total: salaryRecords.total || 0,
          basicSalary: employee.salary,
          filters: {
            year: salaryYear || null,
            month: salaryMonth || null
          }
        },

        // Performance Reviews
        performance: {
          reviews: performanceReviews.reviews || [],
          total: performanceReviews.total || 0
        }
      }
    });

  } catch (error) {
    console.error("Get complete employee details error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

module.exports = router;