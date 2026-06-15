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

    // ========== NEW FIELDS (Added) ==========
    panNumber: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },
    aadharNumber: {
      type: String,
      default: "",
      trim: true,
    },
    bankAccountNo: {
      type: String,
      default: "",
      trim: true,
    },
    bankIfsc: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },
    bankName: {
      type: String,
      default: "",
      trim: true,
    },
    accountHolderName: {
      type: String,
      default: "",
      trim: true,
    },
    bloodGroup: {
      type: String,
      enum: ["", "A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"],
      default: "",
    },
    joinLetter: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", UserSchema);