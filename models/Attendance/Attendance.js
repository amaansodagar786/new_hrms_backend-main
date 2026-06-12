const mongoose = require("mongoose");

// Daily attendance record sub-schema
const DailyRecordSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true,
  },
  checkInTime: {
    type: String,
    default: null,
  },
  checkOutTime: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: ["ON_TIME", "LATE", "HALF_DAY", "ABSENT", "HOLIDAY", "WEEKEND"],
    default: "ABSENT",
  },
  totalHours: {
    type: Number,
    default: 0,
  },
  isHoliday: {
    type: Boolean,
    default: false,
  },
  isWeekend: {
    type: Boolean,
    default: false,
  },
  correctedBy: {
    type: String,
    default: null,
  },
  correctionReason: {
    type: String,
    default: null,
  },
  notes: {
    type: String,
    default: "",
  },
}, { _id: true });

// Main Employee Attendance Schema
const EmployeeAttendanceSchema = new mongoose.Schema({
  employeeId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  employeeName: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ["HR", "MANAGER", "EMPLOYEE"],
    required: true,
  },
  records: [DailyRecordSchema],
}, {
  timestamps: true,
});

// Index for faster date queries on records
EmployeeAttendanceSchema.index({ "records.date": 1 });

module.exports = mongoose.model("Attendance", EmployeeAttendanceSchema);