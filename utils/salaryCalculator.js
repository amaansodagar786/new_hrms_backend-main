const Policy = require("../models/Policy");
const Attendance = require("../models/Attendance/Attendance");
const Leave = require("../models/Leave/Leave");

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

// ========== HELPER: Get working days in month (excluding holidays & weekends) ==========
const getWorkingDaysInMonth = async (year, month) => {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const policy = await Policy.findOne({ isActive: true });
  if (!policy) return 0;

  const isHoliday = (dateStr) => {
    return policy.holidays.some(holiday => {
      if (holiday.isRange) {
        const start = new Date(holiday.startDate).toISOString().split("T")[0];
        const end = new Date(holiday.endDate).toISOString().split("T")[0];
        return dateStr >= start && dateStr <= end;
      } else {
        const holidayDate = new Date(holiday.date).toISOString().split("T")[0];
        return dateStr === holidayDate;
      }
    });
  };

  const isWeekend = (dateStr) => {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const weeklyOffDays = policy.attendanceRules?.weeklyOffDays || [0];

    // Handle Sunday (0 = Sunday)
    if (dayOfWeek === 0) {
      return weeklyOffDays.includes(0);
    }

    // Handle Saturday (6 = Saturday)
    if (dayOfWeek === 6) {
      const saturdayRule = policy.attendanceRules?.saturdayRule || "half_day";

      // For alternate_holiday_half rule
      if (saturdayRule === "alternate_holiday_half") {
        const saturdayType = getSaturdayType(date, saturdayRule);
        // OFF means no working day, HALF_DAY and FULL_DAY are working (partial or full)
        return saturdayType === "OFF";
      }

      // For "off" rule - Saturday is completely off
      if (saturdayRule === "off") {
        return true;
      }

      // For "half_day" and "full_day" - Saturday is working (will be counted below)
      return false;
    }

    return false;
  };

  let workingDays = 0;
  const current = new Date(startDate);

  while (current <= endDate) {
    const dateStr = current.toISOString().split("T")[0];
    const dayOfWeek = current.getDay();

    // Skip if holiday
    if (isHoliday(dateStr)) {
      current.setDate(current.getDate() + 1);
      continue;
    }

    // Skip if weekend (Sunday or Saturday with "off" rule)
    if (isWeekend(dateStr)) {
      current.setDate(current.getDate() + 1);
      continue;
    }

    // Handle Saturday with half day rule
    if (dayOfWeek === 6) {
      const saturdayRule = policy.attendanceRules?.saturdayRule || "half_day";

      // For alternate_holiday_half - check if it's HALF_DAY
      if (saturdayRule === "alternate_holiday_half") {
        const saturdayType = getSaturdayType(current, saturdayRule);
        if (saturdayType === "HALF_DAY") {
          workingDays += 0.5;
          current.setDate(current.getDate() + 1);
          continue;
        }
        if (saturdayType === "FULL_DAY") {
          workingDays += 1;
          current.setDate(current.getDate() + 1);
          continue;
        }
      }

      // For half_day rule
      if (saturdayRule === "half_day") {
        workingDays += 0.5;
        current.setDate(current.getDate() + 1);
        continue;
      }
    }

    // Normal working day (Monday to Friday, or Saturday with full_day rule)
    workingDays++;
    current.setDate(current.getDate() + 1);
  }

  return workingDays;
};

// ========== GET ATTENDANCE SUMMARY FOR MONTH ==========
const getAttendanceSummary = async (employeeId, year, month, totalWorkingDays) => {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-31`;

  const attendance = await Attendance.findOne({ employeeId });

  if (!attendance) {
    return {
      totalWorkingDays: totalWorkingDays,
      presentDays: 0,
      onTimeDays: 0,
      lateDays: 0,
      halfDays: 0,
      absentDays: 0,
      unpaidLeaveDays: 0,
    };
  }

  const monthRecords = attendance.records.filter(r => {
    return r.date >= startDate && r.date <= endDate;
  });

  return {
    totalWorkingDays: totalWorkingDays,
    presentDays: monthRecords.filter(r => r.checkInTime).length,
    onTimeDays: monthRecords.filter(r => r.status === "ON_TIME").length,
    lateDays: monthRecords.filter(r => r.status === "LATE").length,
    halfDays: monthRecords.filter(r => r.status === "HALF_DAY").length,
    absentDays: monthRecords.filter(r => r.status === "ABSENT" && !r.isHoliday && !r.isWeekend).length,
    unpaidLeaveDays: 0,
  };
};

// ========== GET UNPAID LEAVE DAYS FOR MONTH ==========
const getUnpaidLeaveDays = async (employeeId, year, month) => {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-31`;

  const leaves = await Leave.find({
    employeeId,
    status: "APPROVED",
    fromDate: { $lte: endDate },
    toDate: { $gte: startDate },
  });

  let unpaidDays = 0;

  for (const leave of leaves) {
    // Check if leave contains LOP (Unpaid Leave)
    const hasLOP = leave.leaveTypeSummary.some(l => l.leaveType === "LOP");
    if (hasLOP) {
      const lopDays = leave.leaveTypeSummary.find(l => l.leaveType === "LOP");
      if (lopDays) {
        unpaidDays += lopDays.daysCount;
      }
    }
  }

  return unpaidDays;
};

// ========== CALCULATE SALARY WITH SELECTED COMPONENTS ==========
const calculateSalary = async (employeeId, employeeName, basicSalary, year, month, selectedComponentCodes = []) => {
  try {
    // Get policy with all components
    const policy = await Policy.findOne({ isActive: true });
    if (!policy) {
      return {
        success: false,
        message: "No active policy found",
      };
    }

    // Get all available components from policy
    const allComponents = policy.salaryComponents || [];

    // Filter only selected components and active components
    let componentsToUse = allComponents.filter(c =>
      c.isActive !== false && selectedComponentCodes.includes(c.code)
    );

    // If no components selected, use all active components
    if (selectedComponentCodes.length === 0) {
      componentsToUse = allComponents.filter(c => c.isActive !== false);
    }

    // Get working days in month (from Policy - based on holidays and weekends)
    const totalWorkingDays = await getWorkingDaysInMonth(year, month);

    if (totalWorkingDays === 0) {
      return {
        success: false,
        message: "No working days in this month",
      };
    }

    // Calculate daily salary
    const dailySalary = basicSalary / totalWorkingDays;

    // Get attendance summary (PASS totalWorkingDays as parameter)
    const attendanceSummary = await getAttendanceSummary(employeeId, year, month, totalWorkingDays);

    // Get unpaid leave days
    const unpaidLeaveDays = await getUnpaidLeaveDays(employeeId, year, month);
    attendanceSummary.unpaidLeaveDays = unpaidLeaveDays;

    // ========== CALCULATE ATTENDANCE DEDUCTIONS ==========
    // 5 lates = 1 day deduction
    const lateDaysDeduction = Math.floor(attendanceSummary.lateDays / 5) * dailySalary;
    // Half day = 50% deduction
    const halfDayDeduction = attendanceSummary.halfDays * (dailySalary * 0.5);
    // Absent = 100% deduction
    const absentDeduction = attendanceSummary.absentDays * dailySalary;
    // Unpaid leave = 100% deduction
    const leaveDeduction = unpaidLeaveDays * dailySalary;

    const attendanceDeductions = lateDaysDeduction + halfDayDeduction + absentDeduction + leaveDeduction;

    // ========== CALCULATE COMPONENT ADDITIONS AND DEDUCTIONS ==========
    let totalAdditions = 0;
    let totalComponentDeductions = 0;
    const usedComponents = [];

    for (const component of componentsToUse) {
      let amount = 0;

      if (component.calculationType === "percentage") {
        amount = (basicSalary * component.value) / 100;
      } else {
        amount = component.value;
      }

      if (component.type === "addition") {
        totalAdditions += amount;
      } else {
        totalComponentDeductions += amount;
      }

      usedComponents.push({
        code: component.code,
        name: component.name,
        type: component.type,
        calculationType: component.calculationType,
        value: component.value,
        amount: parseFloat(amount.toFixed(2)),
      });
    }

    // ========== CALCULATE FINAL SALARY ==========
    const grossSalary = basicSalary + totalAdditions;
    const totalDeductions = attendanceDeductions + totalComponentDeductions;
    const netSalary = Math.max(0, grossSalary - totalDeductions);

    return {
      success: true,
      totalWorkingDays,
      dailySalary: parseFloat(dailySalary.toFixed(2)),
      attendanceSummary,
      attendanceDeductions: {
        lateDeduction: parseFloat(lateDaysDeduction.toFixed(2)),
        halfDayDeduction: parseFloat(halfDayDeduction.toFixed(2)),
        absentDeduction: parseFloat(absentDeduction.toFixed(2)),
        leaveDeduction: parseFloat(leaveDeduction.toFixed(2)),
        total: parseFloat(attendanceDeductions.toFixed(2)),
      },
      components: {
        used: usedComponents,
        totalAdditions: parseFloat(totalAdditions.toFixed(2)),
        totalDeductions: parseFloat(totalComponentDeductions.toFixed(2)),
      },
      grossSalary: parseFloat(grossSalary.toFixed(2)),
      totalDeductions: parseFloat(totalDeductions.toFixed(2)),
      netSalary: parseFloat(netSalary.toFixed(2)),
    };

  } catch (error) {
    console.error("Calculate salary error:", error);
    return {
      success: false,
      message: error.message,
    };
  }
};

module.exports = { calculateSalary, getWorkingDaysInMonth };