// ========== SHARED HELPER FUNCTION FOR ALL DASHBOARDS ==========
// Location: backend/utils/attendanceHelper.js

const Leave = require("../models/Leave/Leave");

/**
 * Calculate working days in a month for a specific employee
 * @param {number} year - Full year (e.g., 2024)
 * @param {number} month - Month (0-11, where 0=January)
 * @param {string} employeeId - Employee ID
 * @param {object} policy - Policy document
 * @returns {number} - Working days (can be decimal for half days)
 */
async function getWorkingDaysInMonth(year, month, employeeId, policy) {
    const date = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0).getDate();

    // Format first and last day of month
    const firstDayStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;

    // Get employee's approved leaves for this month
    const approvedLeaves = await Leave.find({
        employeeId: employeeId,
        status: "APPROVED",
        fromDate: { $lte: lastDayStr },
        toDate: { $gte: firstDayStr }
    });

    // Get UNPAID leave types from policy (where isUnpaid = true)
    const unpaidLeaveTypes = policy.leaveTypes
        .filter(lt => lt.isUnpaid === true)
        .map(lt => lt.code);

    let workingDays = 0;

    // Get holidays for this month
    const holidays = [];
    policy.holidays.forEach(holiday => {
        if (holiday.isRange) {
            let current = new Date(holiday.startDate);
            while (current <= new Date(holiday.endDate)) {
                holidays.push(current.toISOString().split('T')[0]);
                current.setDate(current.getDate() + 1);
            }
        } else {
            if (holiday.date) {
                holidays.push(new Date(holiday.date).toISOString().split('T')[0]);
            }
        }
    });

    // Loop through each day of the month
    for (let day = 1; day <= lastDay; day++) {
        const currentDate = new Date(year, month, day);
        const dayOfWeek = currentDate.getDay(); // 0=Sunday, 6=Saturday
        const dateStr = currentDate.toISOString().split('T')[0];

        // Check Sunday (weekly off)
        if (dayOfWeek === 0 && policy.attendanceRules.weeklyOffDays.includes(0)) {
            continue;
        }

        // Check Saturday rule
        if (dayOfWeek === 6) {
            const saturdayRule = policy.attendanceRules.saturdayRule;
            if (saturdayRule === "off") {
                continue;
            } else if (saturdayRule === "half_day" || saturdayRule === "alternate_holiday_half") {
                workingDays += 0.5;
                continue;
            }
        }

        // Check if holiday
        if (holidays.includes(dateStr)) {
            continue;
        }

        // Check if employee is on UNPAID leave (LOP)
        let isOnUnpaidLeave = false;

        for (const leave of approvedLeaves) {
            if (dateStr >= leave.fromDate && dateStr <= leave.toDate) {
                // Check if this leave contains any UNPAID leave type
                for (const summary of leave.leaveTypeSummary) {
                    if (unpaidLeaveTypes.includes(summary.leaveType)) {
                        isOnUnpaidLeave = true;
                        break;
                    }
                }
                break;
            }
        }

        // If on UNPAID leave (LOP), skip - NOT a working day
        if (isOnUnpaidLeave) {
            continue;
        }

        // If on PAID leave (CL, SL, PL), also skip - NOT a working day
        if (approvedLeaves.some(leave => dateStr >= leave.fromDate && dateStr <= leave.toDate)) {
            continue;
        }

        // This is a working day
        workingDays++;
    }

    return workingDays;
}

/**
 * Calculate attendance rate using Option B (Weighted Method)
 * @param {array} records - Attendance records for the month
 * @param {number} workingDays - Total working days for the month
 * @returns {number} - Attendance percentage
 */
function calculateAttendanceRate(records, workingDays) {
    if (workingDays === 0) return 0;

    let totalPoints = 0;

    records.forEach(record => {
        switch (record.status) {
            case 'ON_TIME':
                totalPoints += 1;
                break;
            case 'LATE':
                totalPoints += 0.8;
                break;
            case 'HALF_DAY':
                totalPoints += 0.5;
                break;
            case 'ABSENT':
                totalPoints += 0;
                break;
            default:
                totalPoints += 0;
        }
    });

    return (totalPoints / workingDays) * 100;
}

module.exports = { getWorkingDaysInMonth, calculateAttendanceRate };