const mongoose = require("mongoose");

const AnnouncementReadSchema = new mongoose.Schema({
  announcementId: {
    type: String,
    required: true,
    index: true,
  },
  employeeId: {
    type: String,
    required: true,
    index: true,
  },
  readAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Compound index to prevent duplicate read records
AnnouncementReadSchema.index({ announcementId: 1, employeeId: 1 }, { unique: true });

module.exports = mongoose.model("AnnouncementRead", AnnouncementReadSchema);