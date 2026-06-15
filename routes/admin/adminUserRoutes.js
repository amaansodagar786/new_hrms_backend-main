const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const User = require("../../models/User");
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

// ========== CREATE USER (HR, MANAGER, EMPLOYEE) - Admin only ==========
router.post("/users/create", protectAdmin, async (req, res) => {
  try {
    const {
      name, email, password, role, salary, managerId,
      department, designation, phone, address
    } = req.body;

    // Validation
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
      // New fields - initially empty
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

    // If employee is created, add to manager's assignedEmployees array
    if (role === "EMPLOYEE" && managerId) {
      await updateManagerAssignedEmployees(managerId, employeeId, name, true);
    }

    // ========== SEND WELCOME EMAIL ==========
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

    // If updating manager for EMPLOYEE
    if (user.role === "EMPLOYEE" && managerId !== undefined && managerId !== user.managerId) {
      const oldManagerId = user.managerId;
      const newManagerId = managerId;

      // Validate new manager exists if provided
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

      // Remove from old manager's assignedEmployees
      if (oldManagerId) {
        await updateManagerAssignedEmployees(oldManagerId, employeeId, null, false);
      }

      // Add to new manager's assignedEmployees
      if (newManagerId) {
        await updateManagerAssignedEmployees(newManagerId, employeeId, user.name, true);
      }
    }

    // Update fields
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

    // If user is EMPLOYEE, remove from manager's assignedEmployees
    if (user.role === "EMPLOYEE" && user.managerId) {
      await updateManagerAssignedEmployees(user.managerId, employeeId, null, false);
    }

    // If user is MANAGER, remove all assigned employees' managerId references
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

    // Get full employee details for assigned employees
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

    // Build filter - get all employees (HR, MANAGER, EMPLOYEE)
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

    // For search
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { employeeId: { $regex: search, $options: "i" } },
        { department: { $regex: search, $options: "i" } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get all employees
    const employees = await User.find(filter)
      .select("-password")
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get all managers for reference
    const allManagers = await User.find({ role: "MANAGER", isActive: true })
      .select("employeeId name")
      .lean();

    const managerMap = new Map();
    allManagers.forEach(mgr => {
      managerMap.set(mgr.employeeId, mgr.name);
    });

    // Add managerName to each employee
    const employeesWithManager = employees.map(emp => ({
      ...emp,
      managerName: emp.managerId ? managerMap.get(emp.managerId) || null : null,
      assignedEmployeesCount: emp.role === "MANAGER" ? (emp.assignedEmployees?.length || 0) : 0
    }));

    const total = await User.countDocuments(filter);

    // Get unique departments for filter dropdown
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

    // Get manager name if exists
    let managerName = null;
    if (employee.managerId) {
      const manager = await User.findOne({ employeeId: employee.managerId }).select("name").lean();
      managerName = manager?.name || null;
    }

    // If employee is manager, get assigned employees list
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

// ========== UPDATE EMPLOYEE (Admin/HR only) - WITH NEW FIELDS ==========
router.put("/employees/:employeeId", protectHRorAdmin, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const {
      phone, address, department, designation,
      managerId, isActive, salary,
      // NEW FIELDS
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

    // Build update object
    const updateFields = {};

    // Existing fields
    if (phone !== undefined) updateFields.phone = phone;
    if (address !== undefined) updateFields.address = address;
    if (department !== undefined) updateFields.department = department;
    if (designation !== undefined) updateFields.designation = designation;
    if (isActive !== undefined) updateFields.isActive = isActive;

    // NEW FIELDS
    if (panNumber !== undefined) updateFields.panNumber = panNumber;
    if (aadharNumber !== undefined) updateFields.aadharNumber = aadharNumber;
    if (bankAccountNo !== undefined) updateFields.bankAccountNo = bankAccountNo;
    if (bankIfsc !== undefined) updateFields.bankIfsc = bankIfsc;
    if (bankName !== undefined) updateFields.bankName = bankName;
    if (accountHolderName !== undefined) updateFields.accountHolderName = accountHolderName;
    if (bloodGroup !== undefined) updateFields.bloodGroup = bloodGroup;
    if (joinLetter !== undefined) updateFields.joinLetter = joinLetter;

    // Only Admin can update salary
    if (req.userType === "ADMIN" && salary !== undefined) {
      updateFields.salary = salary;
    }

    // If updating manager for EMPLOYEE
    if (managerId !== undefined && employee.role === "EMPLOYEE") {
      const oldManagerId = employee.managerId;
      const newManagerId = managerId || null;

      // If manager changed, update both sides
      if (oldManagerId !== newManagerId) {
        // Remove from old manager's assignedEmployees
        if (oldManagerId) {
          await User.findOneAndUpdate(
            { employeeId: oldManagerId },
            { $pull: { assignedEmployees: { employeeId } } }
          );
        }

        // Add to new manager's assignedEmployees
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

    // Get manager name for response
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

module.exports = router;