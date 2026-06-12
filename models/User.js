const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["HR", "MANAGER", "EMPLOYEE"],
      required: true,
    },
    salary: {
      type: Number,
      required: true,
    },
    managerId: {
      type: String,
      default: null,
    },
    // NEW: For MANAGER role - array of assigned employees
    assignedEmployees: [
      {
        employeeId: { type: String, required: true },
        name: { type: String, required: true },
        assignedAt: { type: Date, default: Date.now },
      },
    ],
    department: {
      type: String,
      default: "",
    },
    designation: {
      type: String,
      default: "",
    },
    joinDate: {
      type: Date,
      default: Date.now,
    },
    phone: {
      type: String,
      default: "",
    },
    address: {
      type: String,
      default: "",
    },
    profilePicture: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", UserSchema);