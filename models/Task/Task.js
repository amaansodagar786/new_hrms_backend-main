const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema({
  taskId: {
    type: String,
    required: true,
    unique: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: "",
  },
  deadline: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: ["COMPLETE", "INCOMPLETE"],
    default: "INCOMPLETE",
  },
  createdBy: {
    type: String,
    required: true,
  },
  createdByName: {
    type: String,
    required: true,
  },
  assignedTo: [{
    employeeId: { type: String, required: true },
    employeeName: { type: String, required: true },
    assignedAt: { type: Date, default: Date.now },
  }],
  completedAt: {
    type: Date,
    default: null,
  },
  completedBy: {
    type: String,
    default: null,
  },
  notes: {
    type: String,
    default: "",
  },
}, {
  timestamps: true,
});

// Indexes for faster queries
TaskSchema.index({ createdBy: 1 });
TaskSchema.index({ "assignedTo.employeeId": 1 });
TaskSchema.index({ status: 1 });

module.exports = mongoose.model("Task", TaskSchema);