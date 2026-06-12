const mongoose = require("mongoose");

// Balance for each leave type
const BalanceSchema = new mongoose.Schema({
  leaveType: {
    type: String,
    required: true,
    uppercase: true,
  },
  total: {
    type: Number,
    default: 0,
  },
  used: {
    type: Number,
    default: 0,
  },
  remaining: {
    type: Number,
    default: 0,
  },
}, { _id: false });

// Main Leave Balance Schema
const LeaveBalanceSchema = new mongoose.Schema({
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
  year: {
    type: Number,
    required: true,
    default: () => new Date().getFullYear(),
  },
  balances: [BalanceSchema],
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Compound index for employeeId + year
LeaveBalanceSchema.index({ employeeId: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("LeaveBalance", LeaveBalanceSchema);