const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const connectDB = require("./config/mongodb");
require("dotenv").config();
const path = require("path");

process.env.TZ = 'Asia/Kolkata';



// Import scheduler
const { startAttendanceScheduler } = require("./utils/attendanceScheduler");

const app = express();

// Connect to MongoDB
connectDB();

// Start attendance scheduler (runs daily at 6 PM)
startAttendanceScheduler();

app.use(
    cors({
        origin: [
            "http://localhost:5173",
            "https://hrms-system-teal.vercel.app",

        ],
        credentials: true,
    })
);

// Middleware
app.use(express.json());
app.use(cookieParser());

// Import routes
const adminAuthRoutes = require("./routes/admin/adminAuth");
const adminUserRoutes = require("./routes/admin/adminUserRoutes");
const policyRoutes = require("./routes/policyRoutes");
const employeeAuthRoutes = require("./routes/employee/employeeAuthRoutes");
const attendanceRoutes = require("./routes/Attendance/attendanceRoutes");
const leaveRoutes = require("./routes/leave/leaveRoutes");
const taskRoutes = require("./routes/task/taskRoutes");
const performanceRoutes = require("./routes/task/performanceRoutes");
const announcementRoutes = require("./routes/announcement/announcementRoutes");
const salaryRoutes = require("./routes/salary/salaryRoutes");
const adminDashboardRoutes = require("./routes/dashbaord/adminDashboardRoutes");
const hrDashboardRoutes = require("./routes/dashbaord/hrDashboardRoutes");
const managerDashboardRoutes = require("./routes/dashbaord/managerDashboardRoutes");
const employeeDashboardRoutes = require("./routes/dashbaord/employeeDashboardRoutes");
const payslipRoutes = require("./routes/salary/payslip");
const adminReportsRoutes = require("./routes/admin/adminReports");




// Use routes
app.use("/admin", adminAuthRoutes);
app.use("/admin", adminUserRoutes);
app.use("/policies", policyRoutes);
app.use("/employee", employeeAuthRoutes);
app.use("/attendance", attendanceRoutes);
app.use("/leave", leaveRoutes);
app.use("/tasks", taskRoutes);
app.use("/performance", performanceRoutes);
app.use("/announcements", announcementRoutes);
app.use("/salary", salaryRoutes);
app.use("/salary/payslip", payslipRoutes);


app.use("/admin/dashboard", adminDashboardRoutes);
app.use("/hr/dashboard", hrDashboardRoutes);
app.use("/manager/dashboard", managerDashboardRoutes);
app.use("/employee/dashboard", employeeDashboardRoutes);
app.use("/admin/reports", adminReportsRoutes);




const uploadRoutes = require("./routes/upload/uploadRoutes");

// Serve static files from uploads directory
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Register upload routes
app.use("/upload", uploadRoutes);

// Test route
app.get("/", (req, res) => {
    res.send("HRMS Server is Running OK!");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});