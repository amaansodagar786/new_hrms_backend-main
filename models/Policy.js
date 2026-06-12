const mongoose = require("mongoose");

// ========== HOLIDAY SCHEMA ==========
const HolidaySchema = new mongoose.Schema({
    name: { type: String, required: true },
    date: { type: Date },
    startDate: { type: Date },
    endDate: { type: Date },
    type: {
        type: String,
        enum: ["public", "festival", "company_event", "optional"],
        default: "public"
    },
    isRange: { type: Boolean, default: false },
    description: { type: String, default: "" },
    createdBy: { type: String },
    createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

// ========== ATTENDANCE RULE SCHEMA ==========
const AttendanceRuleSchema = new mongoose.Schema({
    workingHoursStart: { type: String, default: "09:00" },
    workingHoursEnd: { type: String, default: "18:00" },
    gracePeriodMinutes: { type: Number, default: 15 },
    halfDayAfterMinutes: { type: Number, default: 60 },
    halfDayEndTime: { type: String, default: "12:00" },
    breakStart: { type: String, default: "13:00" },
    breakEnd: { type: String, default: "14:00" },
    weeklyOffDays: { type: [Number], default: [0] },
    saturdayRule: {
        type: String,
        enum: ["full_day", "half_day", "alternate_half_day", "alternate_holiday_half", "off"],
        default: "half_day"
    },
    updatedBy: { type: String },
    updatedAt: { type: Date, default: Date.now },
});

// ========== LEAVE TYPE SCHEMA ==========
const LeaveTypeSchema = new mongoose.Schema({
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    description: { type: String, default: "" },
    yearlyLimit: { type: Number, default: null },
    minDaysToApply: { type: Number, default: 1 },
    maxDaysAtOnce: { type: Number, default: null },
    isUnpaid: { type: Boolean, default: false },
    requiresApproval: { type: Boolean, default: true },
    applicableRoles: {
        type: [String],
        enum: ["HR", "MANAGER", "EMPLOYEE"],
        default: ["HR", "MANAGER", "EMPLOYEE"]
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedBy: { type: String },
    updatedAt: { type: Date },
});

// ========== SALARY COMPONENT SCHEMA (NEW - FOR POLICY ONLY) ==========
const SalaryComponentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    code: {
        type: String,
        required: true,
        unique: true
    },
    type: {
        type: String,
        enum: ["addition", "deduction"],
        required: true
    },
    calculationType: {
        type: String,
        enum: ["percentage", "fixed"],
        default: "percentage"
    },
    value: {
        type: Number,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    description: {
        type: String,
        default: ""
    },
    order: {
        type: Number,
        default: 0
    },
    createdBy: {
        type: String
    },
    updatedBy: {
        type: String
    }
}, { timestamps: true });

// ========== MAIN POLICY SCHEMA ==========
const PolicySchema = new mongoose.Schema({
    // Active policy (only one active set)
    isActive: { type: Boolean, default: true },

    // Attendance Rules
    attendanceRules: { type: AttendanceRuleSchema, default: () => ({}) },

    // Holidays list
    holidays: [HolidaySchema],

    // Leave Types
    leaveTypes: [LeaveTypeSchema],

    // Salary Components (NEW)
    salaryComponents: [SalaryComponentSchema],

    // Metadata
    updatedBy: { type: String },
    version: { type: Number, default: 1 },
}, { timestamps: true });

module.exports = mongoose.model("Policy", PolicySchema);