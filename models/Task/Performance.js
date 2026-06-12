const mongoose = require("mongoose");

// Single review schema (embedded)
const ReviewSchema = new mongoose.Schema({
    performanceId: {
        type: String,
        required: true,
        unique: true,
    },
    reviewMonth: {
        type: String, // Format: "2024-06"
        required: true,
    },
    reviewYear: {
        type: Number,
        required: true,
    },
    quarter: {
        type: String,
        enum: ["Q1", "Q2", "Q3", "Q4"],
        required: true,
    },
    taskCompletion: {
        type: Number,
        min: 1,
        max: 5,
        required: true,
    },
    qualityOfWork: {
        type: Number,
        min: 1,
        max: 5,
        required: true,
    },
    deadlinesMet: {
        type: Number,
        min: 1,
        max: 5,
        required: true,
    },
    behaviorTeamwork: {
        type: Number,
        min: 1,
        max: 5,
        required: true,
    },
    overallRating: {
        type: Number,
        default: 0,
    },
    comments: {
        type: String,
        default: "",
    },
    relatedTasks: [{
        type: String,
    }],
    reviewedBy: {
        type: String,
        required: true,
    },
    reviewedByName: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
}, { _id: true });

// Main Performance Schema (One document per employee)
const PerformanceSchema = new mongoose.Schema({
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
    reviews: [ReviewSchema],
}, {
    timestamps: true,
});

// Indexes
PerformanceSchema.index({ employeeId: 1 });
PerformanceSchema.index({ "reviews.performanceId": 1 });
PerformanceSchema.index({ "reviews.reviewMonth": 1 });

module.exports = mongoose.model("Performance", PerformanceSchema);