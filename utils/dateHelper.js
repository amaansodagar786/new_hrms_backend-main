// ========== COMMON DATE HELPER FOR ALL DASHBOARDS ==========
// Location: backend/utils/dateHelper.js

/**
 * Check if a given date is holiday or weekend
 * @param {Date} date - Date to check
 * @param {object} policy - Policy document with holidays and attendance rules
 * @returns {object} - { isOff: boolean, type: string, isHalfDay: boolean }
 */
function checkHolidayOrWeekend(date, policy) {
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay(); // 0=Sunday, 6=Saturday
    
    // Check Sunday (weekly off)
    if (dayOfWeek === 0 && policy.attendanceRules.weeklyOffDays.includes(0)) {
        return { isOff: true, type: "WEEKEND", isHalfDay: false };
    }
    
    // Check Saturday
    if (dayOfWeek === 6) {
        const saturdayRule = policy.attendanceRules.saturdayRule;
        if (saturdayRule === "off") {
            return { isOff: true, type: "WEEKEND", isHalfDay: false };
        }
        if (saturdayRule === "half_day" || saturdayRule === "alternate_holiday_half") {
            return { isOff: false, type: "HALF_DAY", isHalfDay: true };
        }
        // If saturdayRule === "full_day", Saturday is normal working day
    }
    
    // Check Holiday
    const isHoliday = policy.holidays.some(holiday => {
        if (holiday.isRange && holiday.startDate && holiday.endDate) {
            const startStr = new Date(holiday.startDate).toISOString().split('T')[0];
            const endStr = new Date(holiday.endDate).toISOString().split('T')[0];
            return dateStr >= startStr && dateStr <= endStr;
        } else if (holiday.date) {
            const holidayStr = new Date(holiday.date).toISOString().split('T')[0];
            return dateStr === holidayStr;
        }
        return false;
    });
    
    if (isHoliday) {
        return { isOff: true, type: "HOLIDAY", isHalfDay: false };
    }
    
    return { isOff: false, type: "WORKING_DAY", isHalfDay: false };
}

/**
 * Check if an employee is on approved leave for a given date
 * @param {string} employeeId - Employee ID
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @param {object} LeaveModel - Leave model
 * @returns {Promise<boolean>}
 */
async function isOnApprovedLeave(employeeId, dateStr, LeaveModel) {
    const leave = await LeaveModel.findOne({
        employeeId: employeeId,
        status: "APPROVED",
        fromDate: { $lte: dateStr },
        toDate: { $gte: dateStr }
    });
    return !!leave;
}

/**
 * Get attendance status for a day considering holiday/weekend/leave
 * @param {object} attendanceRecord - Daily attendance record
 * @param {object} holidayCheck - Result from checkHolidayOrWeekend
 * @param {boolean} isOnLeave - Whether employee is on approved leave
 * @returns {object} - { status, checkInTime, checkOutTime, totalHours }
 */
function getAttendanceStatus(attendanceRecord, holidayCheck, isOnLeave) {
    // If holiday
    if (holidayCheck.isOff && holidayCheck.type === "HOLIDAY") {
        return {
            status: "HOLIDAY",
            checkInTime: null,
            checkOutTime: null,
            totalHours: 0,
            message: "Company Holiday"
        };
    }
    
    // If weekend
    if (holidayCheck.isOff && holidayCheck.type === "WEEKEND") {
        return {
            status: "WEEKEND",
            checkInTime: null,
            checkOutTime: null,
            totalHours: 0,
            message: "Weekly Off"
        };
    }
    
    // If half day weekend (Saturday half day)
    if (holidayCheck.isHalfDay) {
        if (attendanceRecord && attendanceRecord.checkInTime) {
            return {
                status: attendanceRecord.status || "HALF_DAY",
                checkInTime: attendanceRecord.checkInTime,
                checkOutTime: attendanceRecord.checkOutTime,
                totalHours: attendanceRecord.totalHours || 0
            };
        }
        return {
            status: "HALF_DAY_WEEKEND",
            checkInTime: null,
            checkOutTime: null,
            totalHours: 0,
            message: "Half Working Day"
        };
    }
    
    // If on approved leave
    if (isOnLeave) {
        return {
            status: "ON_LEAVE",
            checkInTime: null,
            checkOutTime: null,
            totalHours: 0,
            message: "On Approved Leave"
        };
    }
    
    // Normal working day
    if (attendanceRecord && attendanceRecord.checkInTime) {
        return {
            status: attendanceRecord.status || "PRESENT",
            checkInTime: attendanceRecord.checkInTime,
            checkOutTime: attendanceRecord.checkOutTime,
            totalHours: attendanceRecord.totalHours || 0
        };
    }
    
    return {
        status: "ABSENT",
        checkInTime: null,
        checkOutTime: null,
        totalHours: 0,
        message: "Not Checked In"
    };
}

module.exports = { checkHolidayOrWeekend, isOnApprovedLeave, getAttendanceStatus };