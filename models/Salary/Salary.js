const mongoose = require("mongoose");

// Component used in salary calculation
const UsedComponentSchema = new mongoose.Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ["addition", "deduction"], required: true },
  calculationType: { type: String, enum: ["percentage", "fixed"], required: true },
  value: { type: Number, required: true },
  amount: { type: Number, default: 0 }, // Calculated amount for this month
}, { _id: false });

// Monthly salary record schema (embedded)
const SalaryRecordSchema = new mongoose.Schema({
  month: {
    type: String,
    required: true, // Format: "2024-06"
  },
  year: {
    type: Number,
    required: true,
  },

  // Selected components used for this calculation
  selectedComponents: {
    type: [String], // Array of component codes like ["HRA", "DA", "PF", "PT"]
    default: [],
  },

  // All components with their calculated amounts
  usedComponents: [UsedComponentSchema],

  // Additions total (sum of all addition components)
  totalAdditions: { type: Number, default: 0 },

  // Deductions total (sum of all deduction components)
  totalDeductionsFromComponents: { type: Number, default: 0 },

  // Attendance Summary for the month
  attendanceSummary: {
    totalWorkingDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    onTimeDays: { type: Number, default: 0 },
    lateDays: { type: Number, default: 0 },
    halfDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    unpaidLeaveDays: { type: Number, default: 0 },
  },

  // Attendance-based Deductions
  lateDeduction: { type: Number, default: 0 },
  halfDayDeduction: { type: Number, default: 0 },
  absentDeduction: { type: Number, default: 0 },
  leaveDeduction: { type: Number, default: 0 },
  attendanceDeductions: { type: Number, default: 0 }, // Total of all attendance deductions

  // Gross Salary (Basic + Total Additions)
  grossSalary: { type: Number, default: 0 },

  // Total Deductions (Attendance + Component Deductions)
  totalDeductions: { type: Number, default: 0 },

  // Final
  netSalary: { type: Number, default: 0 },

  // Status
  status: {
    type: String,
    enum: ["UNPAID", "PAID", "PROCESSING"],
    default: "UNPAID",
  },
  paidAt: {
    type: Date,
    default: null,
  },
  paidBy: {
    type: String,
    default: null,
  },
  paidByName: {
    type: String,
    default: null,
  },
  generatedAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: true });

// Main Salary Schema (One document per employee)
const SalarySchema = new mongoose.Schema({
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
  basicSalary: {
    type: Number,
    required: true,
  },
  records: [SalaryRecordSchema],
}, {
  timestamps: true,
});

// Indexes
SalarySchema.index({ employeeId: 1 });
SalarySchema.index({ "records.month": 1, "records.year": 1 });

module.exports = mongoose.model("Salary", SalarySchema);