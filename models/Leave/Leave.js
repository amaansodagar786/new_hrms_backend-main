const mongoose = require("mongoose");

// Daily leave breakdown schema
const LeaveDaySchema = new mongoose.Schema({
  date: {
    type: String,
    required: true,
  },
  leaveType: {
    type: String,
    required: true,
    uppercase: true,
  },
  isHalfDay: {
    type: Boolean,
    default: false,
  },
  halfDaySession: {
    type: String,
    enum: ["FIRST_HALF", "SECOND_HALF"],
    default: null,
  },
}, { _id: true });

// Leave type summary schema
const LeaveTypeSummarySchema = new mongoose.Schema({
  leaveType: {
    type: String,
    required: true,
    uppercase: true,
  },
  daysCount: {
    type: Number,
    required: true,
    default: 0,
  },
}, { _id: false });

// Main Leave Request Schema
const LeaveSchema = new mongoose.Schema({
  // Employee info
  employeeId: {
    type: String,
    required: true,
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

  // Date range
  fromDate: {
    type: String,
    required: true,
  },
  toDate: {
    type: String,
    required: true,
  },
  totalDays: {
    type: Number,
    required: true,
    min: 0,
  },

  // Daily breakdown with leave types
  days: [LeaveDaySchema],

  // Summary by leave type
  leaveTypeSummary: [LeaveTypeSummarySchema],

  reason: {
    type: String,
    required: true,
    trim: true,
  },

  // Status
  status: {
    type: String,
    enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"],
    default: "PENDING",
  },

  // Approval details
  approvedBy: {
    type: String,
    default: null,
  },
  approvedByName: {
    type: String,
    default: null,
  },
  approvedByRole: {
    type: String,
    enum: ["MANAGER", "HR", "ADMIN"],
    default: null,
  },
  approvedAt: {
    type: Date,
    default: null,
  },

  // Rejection details
  rejectionReason: {
    type: String,
    default: null,
  },

  // Applied on
  appliedOn: {
    type: Date,
    default: Date.now,
  },

  // Cancellation details
  cancelledBy: {
    type: String,
    default: null,
  },
  cancelledAt: {
    type: Date,
    default: null,
  },
  cancellationReason: {
    type: String,
    default: null,
  },

}, {
  timestamps: true,
});

// Indexes for faster queries
LeaveSchema.index({ employeeId: 1, status: 1 });
LeaveSchema.index({ status: 1, appliedOn: -1 });
LeaveSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model("Leave", LeaveSchema);