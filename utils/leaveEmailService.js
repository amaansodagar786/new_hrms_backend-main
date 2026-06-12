const nodemailer = require("nodemailer");

// Create transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Send leave status notification email
const sendLeaveStatusEmail = async (leave, status, approvedBy, rejectionReason = null) => {
  const employeeEmail = leave.employeeEmail || (await getUserEmail(leave.employeeId));
  if (!employeeEmail) {
    console.log(`No email found for employee: ${leave.employeeId}`);
    return false;
  }

  const statusColor = status === "APPROVED" ? "#10B981" : "#EF4444";
  const statusText = status === "APPROVED" ? "Approved ✅" : "Rejected ❌";

  // Format leave dates
  const fromDate = new Date(leave.fromDate).toLocaleDateString();
  const toDate = new Date(leave.toDate).toLocaleDateString();

  // Format leave type summary
  const leaveSummary = leave.leaveTypeSummary
    .map(sum => `${sum.leaveType}: ${sum.daysCount} day(s)`)
    .join(", ");

  const emailTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
        .header { background: ${statusColor}; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { padding: 20px; }
        .details { background: #F3F4F6; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .detail-item { margin: 8px 0; }
        .label { font-weight: bold; color: #4F46E5; }
        .footer { text-align: center; padding: 15px; font-size: 12px; color: #666; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Leave Request ${statusText}</h2>
        </div>
        <div class="content">
          <p>Dear <strong>${leave.employeeName}</strong>,</p>
          <p>Your leave request has been <strong style="color: ${statusColor}">${status}</strong>.</p>
          
          <div class="details">
            <h3>Leave Details:</h3>
            <div class="detail-item">
              <span class="label">Leave Type:</span> ${leaveSummary}
            </div>
            <div class="detail-item">
              <span class="label">Date Range:</span> ${fromDate} to ${toDate}
            </div>
            <div class="detail-item">
              <span class="label">Total Days:</span> ${leave.totalDays} day(s)
            </div>
            <div class="detail-item">
              <span class="label">Reason:</span> ${leave.reason}
            </div>
            ${rejectionReason ? `
            <div class="detail-item">
              <span class="label">Rejection Reason:</span> ${rejectionReason}
            </div>
            ` : ''}
            <div class="detail-item">
              <span class="label">Reviewed By:</span> ${approvedBy} (${leave.approvedByRole || "Manager"})
            </div>
            <div class="detail-item">
              <span class="label">Reviewed On:</span> ${new Date().toLocaleString()}
            </div>
          </div>
          
          ${status === "APPROVED" ? `
            <p>Your leave has been approved. Please check your leave balance for updated information.</p>
          ` : `
            <p>Your leave request has been rejected. Please contact your manager for more details.</p>
          `}
        </div>
        <div class="footer">
          <p>This is an automated email. Please do not reply.</p>
          <p>&copy; ${new Date().getFullYear()} HRMS System. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"HRMS System" <${process.env.EMAIL_USER}>`,
    to: employeeEmail,
    subject: `Leave Request ${status} - ${fromDate} to ${toDate}`,
    html: emailTemplate,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Leave status email sent to ${employeeEmail}`);
    return true;
  } catch (error) {
    console.error("Email sending failed:", error);
    return false;
  }
};

// Helper to get user email
const getUserEmail = async (employeeId) => {
  try {
    const User = require("../models/User");
    const user = await User.findOne({ employeeId }).select("email");
    return user?.email || null;
  } catch (error) {
    console.error("Error getting user email:", error);
    return null;
  }
};

module.exports = { sendLeaveStatusEmail, getUserEmail };