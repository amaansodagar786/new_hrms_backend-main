const express = require("express");
const Attendance = require("../../models/Attendance/Attendance");
const User = require("../../models/User");
const Policy = require("../../models/Policy");

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
      console.log("Attendance Auth: Employee/Manager/HR - Role:", req.user.role);
      return next();
    }

    // If no employeeToken, try adminToken
    token = req.cookies.adminToken;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = {
        employeeId: decoded.adminId,
        name: "Admin",
        role: "ADMIN"
      };
      console.log("Attendance Auth: Admin logged in - Role:", req.user.role);
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

// ========== HELPER: Calculate attendance status ==========
const calculateAttendanceStatus = (checkInTime, policy) => {
  if (!checkInTime) return "ABSENT";

  const [checkInHour, checkInMinute] = checkInTime.split(":").map(Number);
  const checkInMinutes = checkInHour * 60 + checkInMinute;

  const [startHour, startMinute] = policy.attendanceRules.workingHoursStart.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;

  const graceMinutes = policy.attendanceRules.gracePeriodMinutes || 15;
  const halfDayAfterMinutes = policy.attendanceRules.halfDayAfterMinutes || 60;
  const [halfDayEndHour, halfDayEndMinute] = (policy.attendanceRules.halfDayEndTime || "12:00").split(":").map(Number);
  const halfDayEndMinutes = halfDayEndHour * 60 + halfDayEndMinute;

  const onTimeLimit = startMinutes + graceMinutes;
  const lateLimit = startMinutes + halfDayAfterMinutes;

  if (checkInMinutes <= onTimeLimit) {
    return "ON_TIME";
  } else if (checkInMinutes <= lateLimit) {
    return "LATE";
  } else if (checkInMinutes <= halfDayEndMinutes) {
    return "HALF_DAY";
  } else {
    return "ABSENT";
  }
};

// ========== HELPER: Calculate total hours ==========
const calculateTotalHours = (checkInTime, checkOutTime) => {
  if (!checkInTime || !checkOutTime) return 0;

  const [inHour, inMinute] = checkInTime.split(":").map(Number);
  const [outHour, outMinute] = checkOutTime.split(":").map(Number);

  const inMinutes = inHour * 60 + inMinute;
  const outMinutes = outHour * 60 + outMinute;

  let diffMinutes = outMinutes - inMinutes;
  if (diffMinutes < 0) diffMinutes = 0;

  return parseFloat((diffMinutes / 60).toFixed(2));
};

// ========== HELPER: Get today's date string ==========
const getTodayDate = () => {
  const today = new Date();
  return today.toISOString().split("T")[0];
};

// ========== HELPER: Determine Saturday type (for alternate_holiday_half) ==========
const getSaturdayType = (date, saturdayRule) => {
  if (saturdayRule !== "alternate_holiday_half") return null;

  const dayOfMonth = date.getDate();
  const whichSaturday = Math.ceil(dayOfMonth / 7); // 1st, 2nd, 3rd, 4th, or 5th Saturday

  // 1st and 3rd Saturday = OFF (Holiday)
  // 2nd and 4th Saturday = HALF DAY
  // 5th Saturday = FULL DAY (default)
  if (whichSaturday === 1 || whichSaturday === 3) return "OFF";
  if (whichSaturday === 2 || whichSaturday === 4) return "HALF_DAY";
  return "FULL_DAY";
};

// ========== HELPER: Check if date is weekend ==========
const isWeekend = (dateStr, policy) => {
  const date = new Date(dateStr);
  const dayOfWeek = date.getDay();

  const weeklyOffDays = policy.attendanceRules.weeklyOffDays || [0];

  if (dayOfWeek === 6) {
    const saturdayRule = policy.attendanceRules.saturdayRule || "half_day";

    // Handle alternate_holiday_half rule
    if (saturdayRule === "alternate_holiday_half") {
      const saturdayType = getSaturdayType(date, saturdayRule);
      return saturdayType === "OFF";
    }

    return saturdayRule === "off";
  }

  return weeklyOffDays.includes(dayOfWeek);
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

// ========== HELPER: Get or create employee attendance document ==========
const getOrCreateEmployeeAttendance = async (employeeId, employeeName, role) => {
  let attendance = await Attendance.findOne({ employeeId });

  if (!attendance) {
    attendance = new Attendance({
      employeeId,
      employeeName,
      role,
      records: [],
    });
    await attendance.save();
  }

  return attendance;
};

// ========== CHECK IN ==========
router.post("/checkin", async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const employeeName = req.user.name;
    const role = req.user.role;
    const todayDate = getTodayDate();
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const policy = await Policy.findOne({ isActive: true });
    if (!policy) {
      return res.status(400).json({
        success: false,
        message: "No active policy found. Please contact HR.",
      });
    }

    const isHolidayToday = isHoliday(todayDate, policy);
    const isWeekendToday = isWeekend(todayDate, policy);

    if (isHolidayToday) {
      return res.status(400).json({
        success: false,
        message: "Today is a holiday. No check-in required.",
      });
    }

    if (isWeekendToday) {
      return res.status(400).json({
        success: false,
        message: "Today is a weekend. No check-in required.",
      });
    }

    let attendance = await getOrCreateEmployeeAttendance(employeeId, employeeName, role);

    let todayRecordIndex = attendance.records.findIndex(record => record.date === todayDate);

    if (todayRecordIndex !== -1 && attendance.records[todayRecordIndex].checkInTime) {
      return res.status(400).json({
        success: false,
        message: `Already checked in today at ${attendance.records[todayRecordIndex].checkInTime}`,
      });
    }

    const status = calculateAttendanceStatus(currentTime, policy);

    if (todayRecordIndex !== -1) {
      attendance.records[todayRecordIndex].checkInTime = currentTime;
      attendance.records[todayRecordIndex].status = status;
    } else {
      attendance.records.push({
        date: todayDate,
        checkInTime: currentTime,
        status,
        isHoliday: isHolidayToday,
        isWeekend: isWeekendToday,
      });
    }

    await attendance.save();

    let statusMessage = "";
    switch (status) {
      case "ON_TIME": statusMessage = "On Time ✅"; break;
      case "LATE": statusMessage = "Late ⚠️"; break;
      case "HALF_DAY": statusMessage = "Half Day ⚠️"; break;
      default: statusMessage = status;
    }

    res.json({
      success: true,
      message: `Check-in successful at ${currentTime}. Status: ${statusMessage}`,
      attendance: {
        date: todayDate,
        checkInTime: currentTime,
        status: status,
      },
    });
  } catch (error) {
    console.error("Check-in error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== CHECK OUT ==========
router.post("/checkout", async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const todayDate = getTodayDate();
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const attendance = await Attendance.findOne({ employeeId });

    if (!attendance) {
      return res.status(400).json({
        success: false,
        message: "No attendance record found. Please check in first.",
      });
    }

    const todayRecordIndex = attendance.records.findIndex(record => record.date === todayDate);

    if (todayRecordIndex === -1 || !attendance.records[todayRecordIndex].checkInTime) {
      return res.status(400).json({
        success: false,
        message: "You haven't checked in today. Please check in first.",
      });
    }

    if (attendance.records[todayRecordIndex].checkOutTime) {
      return res.status(400).json({
        success: false,
        message: `Already checked out today at ${attendance.records[todayRecordIndex].checkOutTime}`,
      });
    }

    const totalHours = calculateTotalHours(
      attendance.records[todayRecordIndex].checkInTime,
      currentTime
    );

    attendance.records[todayRecordIndex].checkOutTime = currentTime;
    attendance.records[todayRecordIndex].totalHours = totalHours;
    await attendance.save();

    res.json({
      success: true,
      message: `Check-out successful at ${currentTime}. Total hours: ${totalHours} hours`,
      attendance: {
        date: todayDate,
        checkInTime: attendance.records[todayRecordIndex].checkInTime,
        checkOutTime: currentTime,
        totalHours: totalHours,
        status: attendance.records[todayRecordIndex].status,
      },
    });
  } catch (error) {
    console.error("Check-out error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== GET TODAY'S ATTENDANCE ==========
router.get("/today", async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const todayDate = getTodayDate();

    const attendance = await Attendance.findOne({ employeeId });

    let todayRecord = null;
    if (attendance) {
      todayRecord = attendance.records.find(record => record.date === todayDate);
    }

    const policy = await Policy.findOne({ isActive: true });
    const isHolidayToday = policy ? isHoliday(todayDate, policy) : false;
    const isWeekendToday = policy ? isWeekend(todayDate, policy) : false;

    res.json({
      success: true,
      attendance: todayRecord || null,
      isHoliday: isHolidayToday,
      isWeekend: isWeekendToday,
      message: todayRecord
        ? todayRecord.checkOutTime
          ? "Completed for today"
          : todayRecord.checkInTime
            ? "Checked in, waiting for check-out"
            : "Not checked in yet"
        : "No record for today",
    });
  } catch (error) {
    console.error("Get today error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== GET MY ATTENDANCE HISTORY ==========
router.get("/history", async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const { limit = 30, page = 1 } = req.query;

    const attendance = await Attendance.findOne({ employeeId });

    if (!attendance) {
      return res.json({
        success: true,
        attendance: [],
        pagination: {
          total: 0,
          page: 1,
          limit: parseInt(limit),
          totalPages: 0,
        },
      });
    }

    const sortedRecords = [...attendance.records].sort((a, b) => new Date(b.date) - new Date(a.date));

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedRecords = sortedRecords.slice(skip, skip + parseInt(limit));
    const total = attendance.records.length;

    res.json({
      success: true,
      attendance: paginatedRecords,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get history error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== GET ALL ATTENDANCE (HR/Admin only) ==========
router.get("/all", async (req, res) => {
  try {
    const role = req.user.role;

    if (role !== "HR" && role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only HR and Admin can view all attendance.",
      });
    }

    const { date, employeeId, role: roleFilter, limit = 50, page = 1 } = req.query;

    let filter = {};
    if (employeeId) filter.employeeId = employeeId;
    if (roleFilter) filter.role = roleFilter;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let attendanceDocs = await Attendance.find(filter)
      .sort({ employeeName: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    if (date) {
      attendanceDocs = attendanceDocs.map(doc => {
        const record = doc.records.find(r => r.date === date);
        return {
          ...doc,
          records: record ? [record] : [],
        };
      }).filter(doc => doc.records.length > 0);
    }

    const total = await Attendance.countDocuments(filter);

    res.json({
      success: true,
      attendance: attendanceDocs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get all attendance error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== UPDATE ATTENDANCE (HR/Admin only) ==========
router.put("/:employeeId/:date", async (req, res) => {
  try {
    const role = req.user.role;

    if (role !== "HR" && role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only HR and Admin can update attendance.",
      });
    }

    const { employeeId, date } = req.params;
    const { checkInTime, checkOutTime, notes } = req.body;
    const correctedBy = req.user.employeeId;

    const attendance = await Attendance.findOne({ employeeId });
    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found for this employee",
      });
    }

    const recordIndex = attendance.records.findIndex(r => r.date === date);
    if (recordIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "No attendance record found for this date",
      });
    }

    if (checkInTime) attendance.records[recordIndex].checkInTime = checkInTime;
    if (checkOutTime) attendance.records[recordIndex].checkOutTime = checkOutTime;
    if (notes) attendance.records[recordIndex].notes = notes;
    attendance.records[recordIndex].correctedBy = correctedBy;
    attendance.records[recordIndex].correctionReason = role === "ADMIN" ? "Admin Correction" : "HR Correction";

    const finalCheckIn = checkInTime || attendance.records[recordIndex].checkInTime;
    const finalCheckOut = checkOutTime || attendance.records[recordIndex].checkOutTime;
    if (finalCheckIn && finalCheckOut) {
      attendance.records[recordIndex].totalHours = calculateTotalHours(finalCheckIn, finalCheckOut);
    }

    if (checkInTime) {
      const policy = await Policy.findOne({ isActive: true });
      if (policy) {
        attendance.records[recordIndex].status = calculateAttendanceStatus(checkInTime, policy);
      }
    }

    await attendance.save();

    res.json({
      success: true,
      message: "Attendance updated successfully",
      attendance: attendance.records[recordIndex],
    });
  } catch (error) {
    console.error("Update attendance error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ========== GET EMPLOYEE ATTENDANCE SUMMARY ==========
router.get("/summary/:year/:month", async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const { year, month } = req.params;

    const paddedMonth = month.padStart(2, "0");
    const datePrefix = `${year}-${paddedMonth}`;

    const attendance = await Attendance.findOne({ employeeId });

    if (!attendance) {
      return res.json({
        success: true,
        summary: {
          totalDays: 0,
          presentDays: 0,
          onTimeDays: 0,
          lateDays: 0,
          halfDays: 0,
          absentDays: 0,
        },
      });
    }

    const monthRecords = attendance.records.filter(record => record.date.startsWith(datePrefix));

    const summary = {
      totalDays: monthRecords.length,
      presentDays: monthRecords.filter(r => r.checkInTime).length,
      onTimeDays: monthRecords.filter(r => r.status === "ON_TIME").length,
      lateDays: monthRecords.filter(r => r.status === "LATE").length,
      halfDays: monthRecords.filter(r => r.status === "HALF_DAY").length,
      absentDays: monthRecords.filter(r => r.status === "ABSENT" && !r.isHoliday && !r.isWeekend).length,
    };

    res.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error("Get summary error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;