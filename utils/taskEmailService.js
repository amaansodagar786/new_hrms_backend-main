const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Send email when task is assigned
const sendTaskAssignedEmail = async (task, employee, managerName) => {
  const emailTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
        .header { background: #5A67F2; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { padding: 20px; }
        .task-details { background: #F3F4F6; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .footer { text-align: center; padding: 15px; font-size: 12px; color: #666; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>New Task Assigned</h2>
        </div>
        <div class="content">
          <p>Dear <strong>${employee.employeeName}</strong>,</p>
          <p>You have been assigned a new task by <strong>${managerName}</strong>.</p>
          
          <div class="task-details">
            <h3>Task Details:</h3>
            <p><strong>Title:</strong> ${task.title}</p>
            <p><strong>Description:</strong> ${task.description || "No description"}</p>
            ${task.deadline ? `<p><strong>Deadline:</strong> ${new Date(task.deadline).toLocaleDateString()}</p>` : ''}
          </div>
          
          <p>Please log in to the HRMS portal to view and complete this task.</p>
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
    to: employee.employeeEmail || await getUserEmail(employee.employeeId),
    subject: `New Task Assigned: ${task.title}`,
    html: emailTemplate,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Task assigned email sent to ${employee.employeeName}`);
    return true;
  } catch (error) {
    console.error("Email sending failed:", error);
    return false;
  }
};

// Send email when performance review is added
const sendPerformanceEmail = async (employee, performance, managerName) => {
  const emailTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
        .header { background: #10B981; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { padding: 20px; }
        .ratings { background: #F3F4F6; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .rating-item { margin: 8px 0; }
        .footer { text-align: center; padding: 15px; font-size: 12px; color: #666; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Performance Review Added</h2>
        </div>
        <div class="content">
          <p>Dear <strong>${employee.employeeName}</strong>,</p>
          <p>Your manager <strong>${managerName}</strong> has added a performance review for <strong>${performance.reviewMonth}</strong>.</p>
          
          <div class="ratings">
            <h3>Ratings (1-5 Scale):</h3>
            <div class="rating-item"><strong>Task Completion:</strong> ${performance.taskCompletion}/5</div>
            <div class="rating-item"><strong>Quality of Work:</strong> ${performance.qualityOfWork}/5</div>
            <div class="rating-item"><strong>Deadlines Met:</strong> ${performance.deadlinesMet}/5</div>
            <div class="rating-item"><strong>Behavior & Teamwork:</strong> ${performance.behaviorTeamwork}/5</div>
            <hr />
            <div class="rating-item"><strong>Overall Rating:</strong> ${performance.overallRating}/5</div>
          </div>
          
          ${performance.comments ? `<p><strong>Comments:</strong> ${performance.comments}</p>` : ''}
          
          <p>Please log in to the HRMS portal to view your complete performance history.</p>
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
    to: employee.employeeEmail || await getUserEmail(employee.employeeId),
    subject: `Performance Review for ${performance.reviewMonth}`,
    html: emailTemplate,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Performance email sent to ${employee.employeeName}`);
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

module.exports = { sendTaskAssignedEmail, sendPerformanceEmail, getUserEmail };