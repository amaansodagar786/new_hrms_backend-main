const cron = require("node-cron");
const Attendance = require("../models/Attendance/Attendance");
const User = require("../models/User");
const Policy = require("../models/Policy");

// ========== HELPER: Get today's date string ==========
const getTodayDate = () => {
  const today = new Date();
  return today.toISOString().split("T")[0];
};

// ========== HELPER: Check if date is weekend ==========
const isWeekend = (dateStr, policy) => {
  const date = new Date(dateStr);
  const dayOfWeek = date.getDay();

  const weeklyOffDays = policy.attendanceRules.weeklyOffDays || [0];

  if (dayOfWeek === 6) {
    const saturdayRule = policy.attendanceRules.saturdayRule || "half_day";
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

// ========== MARK ABSENT FOR EMPLOYEES WHO DIDN'T CHECK IN ==========
const markAbsentForMissingEmployees = async () => {
  const todayDate = getTodayDate();
  console.log(`[Attendance Scheduler] Running at ${new Date().toISOString()}`);
  console.log(`[Attendance Scheduler] Processing date: ${todayDate}`);

  try {
    // Get policy for holiday/weekend check
    const policy = await Policy.findOne({ isActive: true });
    if (!policy) {
      console.log("[Attendance Scheduler] No active policy found. Skipping...");
      return;
    }

    // Check if today is holiday or weekend
    const isHolidayToday = isHoliday(todayDate, policy);
    const isWeekendToday = isWeekend(todayDate, policy);

    if (isHolidayToday) {
      console.log(`[Attendance Scheduler] Today is a holiday. Skipping absent marking.`);
      return;
    }

    if (isWeekendToday) {
      console.log(`[Attendance Scheduler] Today is a weekend. Skipping absent marking.`);
      return;
    }

    // Get all active employees (HR, MANAGER, EMPLOYEE)
    const allEmployees = await User.find({ 
      isActive: true,
      role: { $in: ["HR", "MANAGER", "EMPLOYEE"] }
    }).lean();

    console.log(`[Attendance Scheduler] Total active employees: ${allEmployees.length}`);

    let absentCount = 0;
    let alreadyPresentCount = 0;

    for (const employee of allEmployees) {
      // Check if attendance record already exists for today
      let attendance = await Attendance.findOne({ employeeId: employee.employeeId });

      if (!attendance) {
        // Create new attendance document for this employee
        attendance = new Attendance({
          employeeId: employee.employeeId,
          employeeName: employee.name,
          role: employee.role,
          records: [],
        });
      }

      // Check if today's record already exists
      const todayRecordExists = attendance.records.some(record => record.date === todayDate);

      if (!todayRecordExists) {
        // Add absent record for today
        attendance.records.push({
          date: todayDate,
          status: "ABSENT",
          isHoliday: false,
          isWeekend: false,
          notes: "Auto-marked absent by system (no check-in)",
        });
        await attendance.save();
        absentCount++;
        console.log(`[Attendance Scheduler] Marked ABSENT for: ${employee.name} (${employee.employeeId})`);
      } else {
        alreadyPresentCount++;
      }
    }

    console.log(`[Attendance Scheduler] COMPLETED: ${absentCount} marked ABSENT, ${alreadyPresentCount} already had records`);
  } catch (error) {
    console.error("[Attendance Scheduler] Error:", error);
  }
};

// ========== START CRON JOB ==========
// Runs every day at 6:00 PM (18:00)
const startAttendanceScheduler = () => {
  // Schedule: 0 18 * * * = At 18:00 (6:00 PM) every day
  cron.schedule("0 18 * * *", async () => {
    console.log("=".repeat(60));
    console.log("[Attendance Scheduler] Starting scheduled job...");
    await markAbsentForMissingEmployees();
    console.log("=".repeat(60));
  });

  console.log("[Attendance Scheduler] Scheduled to run every day at 6:00 PM");
};

module.exports = { startAttendanceScheduler, markAbsentForMissingEmployees };