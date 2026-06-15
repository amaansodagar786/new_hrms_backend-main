const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// ========== CUSTOM AUTH MIDDLEWARE ==========
router.use(async (req, res, next) => {
  try {
    const jwt = require("jsonwebtoken");
    let token = req.cookies.employeeToken;

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      return next();
    }

    token = req.cookies.adminToken;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = {
        employeeId: decoded.adminId,
        name: "Admin",
        role: "ADMIN",
      };
      return next();
    }

    return res.status(401).json({ success: false, message: "Not authorized" });
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
});

// ========== CONFIGURE STORAGE ==========
// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, "../../uploads/join-letters");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename: employeeId_timestamp.pdf
    const employeeId = req.user?.employeeId || "unknown";
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${employeeId}_${timestamp}${ext}`);
  },
});

// File filter - only allow PDFs
const fileFilter = (req, file, cb) => {
  if (file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new Error("Only PDF files are allowed"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// ========== UPLOAD JOIN LETTER ==========
router.post("/join-letter", upload.single("joinLetter"), async (req, res) => {
  try {
    // Check if user is Admin or HR
    if (req.user.role !== "ADMIN" && req.user.role !== "HR") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only Admin and HR can upload documents.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    // Generate file URL
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const fileUrl = `${baseUrl}/uploads/join-letters/${req.file.filename}`;

    res.json({
      success: true,
      message: "File uploaded successfully",
      fileUrl: fileUrl,
      filename: req.file.filename,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to upload file",
    });
  }
});

// ========== SERVE STATIC FILES ==========
// This needs to be added in your main server.js/index.js
// app.use("/uploads", express.static(path.join(__dirname, "uploads")));

module.exports = router;