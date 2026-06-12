const mongoose = require("mongoose");

const AnnouncementSchema = new mongoose.Schema({
    announcementId: {
        type: String,
        required: true,
        unique: true,
    },
    title: {
        type: String,
        required: true,
        trim: true,
    },
    content: {
        type: String,
        required: true,
    },
    type: {
        type: String,
        enum: ["urgent", "holiday", "event", "policy", "general"],
        default: "general",
    },
    priority: {
        type: String,
        enum: ["high", "medium", "low"],
        default: "medium",
    },
    targetAudience: {
        type: [String],
        enum: ["HR", "MANAGER", "EMPLOYEE", "ADMIN"],
        default: ["HR", "MANAGER", "EMPLOYEE", "ADMIN"],
    },
    isPinned: {
        type: Boolean,
        default: false,
    },
    expiresAt: {
        type: Date,
        default: null,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    createdBy: {
        type: String,
        required: true,
    },
    createdByName: {
        type: String,
        required: true,
    },
    createdByRole: {
        type: String,
        enum: ["HR", "ADMIN"],
        required: true,
    },
}, {
    timestamps: true,
});

// Indexes for faster queries
AnnouncementSchema.index({ isActive: 1, expiresAt: 1 });
AnnouncementSchema.index({ type: 1, priority: 1 });
AnnouncementSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Announcement", AnnouncementSchema);