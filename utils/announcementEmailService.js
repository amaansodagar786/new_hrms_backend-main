const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Send email when new announcement is created
const sendAnnouncementEmail = async (announcement, employee, creatorName) => {
  // Get type color and icon
  const typeConfig = {
    urgent: { color: "#EF4444", icon: "⚠️" },
    holiday: { color: "#10B981", icon: "🎉" },
    event: { color: "#8B5CF6", icon: "📅" },
    policy: { color: "#3B82F6", icon: "📋" },
    general: { color: "#6B7280", icon: "📢" },
  };
  
  const config = typeConfig[announcement.type] || typeConfig.general;
  
  // Get priority badge
  const priorityConfig = {
    high: { text: "HIGH PRIORITY", color: "#EF4444" },
    medium: { text: "MEDIUM PRIORITY", color: "#F59E0B" },
    low: { text: "LOW PRIORITY", color: "#10B981" },
  };
  
  const priority = priorityConfig[announcement.priority] || priorityConfig.medium;

  const emailTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
        .header { background: ${config.color}; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h2 { margin: 0; }
        .priority-badge { display: inline-block; background: ${priority.color}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.7rem; font-weight: bold; margin-bottom: 10px; }
        .content { padding: 20px; }
        .announcement-title { font-size: 1.3rem; font-weight: bold; color: #333; margin-bottom: 10px; }
        .announcement-content { background: #F3F4F6; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .announcement-meta { font-size: 0.75rem; color: #666; margin-top: 10px; }
        .footer { text-align: center; padding: 15px; font-size: 12px; color: #666; border-top: 1px solid #ddd; }
        .button { display: inline-block; background: #5A67F2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 15px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>${config.icon} New Announcement</h2>
        </div>
        <div class="content">
          <div class="priority-badge">${priority.text}</div>
          <div class="announcement-title">${announcement.title}</div>
          <div class="announcement-content">
            ${announcement.content.replace(/\n/g, '<br>')}
          </div>
          <div class="announcement-meta">
            <p><strong>Type:</strong> ${announcement.type.toUpperCase()}</p>
            <p><strong>Posted by:</strong> ${creatorName} (${announcement.createdByRole})</p>
            <p><strong>Posted on:</strong> ${new Date(announcement.createdAt).toLocaleString()}</p>
            ${announcement.expiresAt ? `<p><strong>Expires on:</strong> ${new Date(announcement.expiresAt).toLocaleDateString()}</p>` : ''}
          </div>
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/announcements" class="button">View All Announcements</a>
        </div>
        <div class="footer">
          <p>This is an automated email. Please do not reply.</p>
          <p>&copy; ${new Date().getFullYear()} HRMS System</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"HRMS System" <${process.env.EMAIL_USER}>`,
    to: employee.email,
    subject: `[${announcement.type.toUpperCase()}] ${announcement.title}`,
    html: emailTemplate,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Announcement email sent to ${employee.name} (${employee.email})`);
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

module.exports = { sendAnnouncementEmail, getUserEmail };