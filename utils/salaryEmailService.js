// utils/salaryEmailService.js
const nodemailer = require("nodemailer");

// Create transporter
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

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

// Send salary paid notification email
const sendSalaryPaidEmail = async (employeeId, employeeName, month, year, netSalary, paidBy, paidByName) => {
    const employeeEmail = await getUserEmail(employeeId);
    if (!employeeEmail) {
        console.log(`No email found for employee: ${employeeId}`);
        return false;
    }

    // Format month/year
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[month - 1];

    const emailTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
        .header { background: #10B981; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { padding: 20px; }
        .amount-box { background: #F3F4F6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
        .amount { font-size: 32px; font-weight: bold; color: #10B981; }
        .details { background: #F9FAFB; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .detail-item { margin: 8px 0; }
        .label { font-weight: bold; color: #4F46E5; }
        .footer { text-align: center; padding: 15px; font-size: 12px; color: #666; border-top: 1px solid #ddd; }
        .success-icon { font-size: 48px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>✅ Salary Paid Confirmation</h2>
        </div>
        <div class="content">
          <p>Dear <strong>${employeeName}</strong>,</p>
          <p>We are pleased to inform you that your salary for <strong>${monthName} ${year}</strong> has been processed and paid.</p>
          
          <div class="amount-box">
            <div style="font-size: 14px; color: #666; margin-bottom: 5px;">Net Salary Amount</div>
            <div class="amount">₹${netSalary.toLocaleString('en-IN')}</div>
          </div>
          
          <div class="details">
            <h3>Salary Details:</h3>
            <div class="detail-item">
              <span class="label">Month:</span> ${monthName} ${year}
            </div>
            <div class="detail-item">
              <span class="label">Net Salary:</span> ₹${netSalary.toLocaleString('en-IN')}
            </div>
            <div class="detail-item">
              <span class="label">Processed By:</span> ${paidByName || "HR Team"}
            </div>
            <div class="detail-item">
              <span class="label">Payment Date:</span> ${new Date().toLocaleString()}
            </div>
          </div>
          
          <p style="margin-top: 20px;">The salary has been credited to your account. Please check with your bank for the transaction details.</p>
          
          <p>Thank you for your continued dedication and hard work.</p>
          <p>Best Regards,<br><strong>HR Team</strong></p>
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
        subject: `Salary Paid - ${monthName} ${year}`,
        html: emailTemplate,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Salary paid email sent to ${employeeEmail}`);
        return true;
    } catch (error) {
        console.error("Email sending failed:", error);
        return false;
    }
};

module.exports = { sendSalaryPaidEmail, getUserEmail };