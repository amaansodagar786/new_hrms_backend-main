const nodemailer = require("nodemailer");

// Create transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Send welcome email to new user
const sendWelcomeEmail = async (user, password) => {
  const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/login`;

  const emailTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
        .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { padding: 20px; }
        .credentials { background: #F3F4F6; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .credential-item { margin: 10px 0; }
        .label { font-weight: bold; color: #4F46E5; }
        .value { font-family: monospace; background: white; padding: 5px 10px; border-radius: 5px; display: inline-block; }
        .footer { text-align: center; padding: 15px; font-size: 12px; color: #666; border-top: 1px solid #ddd; }
        .button { display: inline-block; background: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 15px; }
        .warning { color: #DC2626; font-size: 12px; margin-top: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Welcome to HRMS</h2>
        </div>
        <div class="content">
          <h3>Dear ${user.name},</h3>
          <p>Your account has been created successfully in the HRMS system.</p>
          
          <div class="credentials">
            <h4>Your Login Credentials:</h4>
            <div class="credential-item">
              <span class="label">Email:</span>
              <span class="value">${user.email}</span>
            </div>
            <div class="credential-item">
              <span class="label">Employee ID:</span>
              <span class="value">${user.employeeId}</span>
            </div>
            <div class="credential-item">
              <span class="label">Password:</span>
              <span class="value">${password}</span>
            </div>
          </div>
          
          <p><strong>Role:</strong> ${user.role}</p>
          <p><strong>Department:</strong> ${user.department || "Not assigned"}</p>
          <p><strong>Salary:</strong> ₹${user.salary?.toLocaleString()}</p>
          
          <a href="${loginUrl}" class="button">Click here to Login</a>
          
          <p class="warning">
            ⚠️ For security reasons, please change your password after your first login.
          </p>
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
    to: user.email,
    subject: `Welcome to HRMS - Your ${user.role} Account Created`,
    html: emailTemplate,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Welcome email sent to ${user.email}`);
    return true;
  } catch (error) {
    console.error("Email sending failed:", error);
    return false;
  }
};

// ========== SEND PASSWORD RESET NOTIFICATION (without password) ==========
const sendPasswordResetNotification = async (user, updatedBy) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const currentDate = new Date().toLocaleString();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: `🔐 Password Updated - HRMS`,
      html: `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 550px; margin: 0 auto; padding: 20px; background: #F0F2FF; border-radius: 16px;">
                    <div style="background: linear-gradient(135deg, #5A67F2, #3D4ADB); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
                        <h1 style="color: #fff; margin: 0; font-size: 24px;">🔐 Password Updated</h1>
                    </div>
                    
                    <div style="background: #fff; padding: 28px; border-radius: 0 0 16px 16px;">
                        <p style="font-size: 16px; color: #0D0F1A; margin-bottom: 20px;">Dear <strong>${user.name}</strong>,</p>
                        
                        <div style="background: #F8F9FF; padding: 16px; border-radius: 12px; margin-bottom: 20px;">
                            <p style="margin: 0 0 8px 0; color: #64748B;">Your account password has been updated by:</p>
                            <p style="margin: 0; font-size: 18px; font-weight: 600; color: #5A67F2;">${updatedBy}</p>
                            <p style="margin: 8px 0 0 0; font-size: 12px; color: #94A3B8;">on ${currentDate}</p>
                        </div>
                        
                        <div style="background: #FEF2F2; padding: 14px; border-radius: 10px; margin-bottom: 24px; border-left: 4px solid #EF4444;">
                            <p style="margin: 0; font-size: 14px; color: #DC2626;">
                                ⚠️ If you did not request this change, please contact HR immediately.
                            </p>
                        </div>
                        
                        
                        
                        <hr style="border: none; border-top: 1px solid #E4E8F5; margin: 20px 0;">
                        
                        <p style="font-size: 12px; color: #94A3B8; text-align: center; margin: 0;">
                            This is an automated message from HRMS. Please do not reply to this email.
                        </p>
                    </div>
                </div>
            `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Password reset notification email sent to ${user.email}`);
    return true;
  } catch (error) {
    console.error("Error sending password reset email:", error);
    return false;
  }
};


// ========== SEND PASSWORD CHANGE NOTIFICATION ==========
const sendPasswordChangeNotification = async (user) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const currentDate = new Date().toLocaleString();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: `🔐 Password Changed - HRMS`,
      html: `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 550px; margin: 0 auto; padding: 20px; background: #F0F2FF; border-radius: 16px;">
                    <div style="background: linear-gradient(135deg, #5A67F2, #3D4ADB); padding: 24px; border-radius: 16px 16px 0 0; text-align: center;">
                        <h1 style="color: #fff; margin: 0; font-size: 24px;">🔐 Password Changed</h1>
                    </div>
                    
                    <div style="background: #fff; padding: 28px; border-radius: 0 0 16px 16px;">
                        <p style="font-size: 16px; color: #0D0F1A; margin-bottom: 20px;">Dear <strong>${user.name}</strong>,</p>
                        
                        <div style="background: #F8F9FF; padding: 16px; border-radius: 12px; margin-bottom: 20px;">
                            <p style="margin: 0 0 8px 0; color: #64748B;">Your password has been changed successfully on:</p>
                            <p style="margin: 0; font-size: 18px; font-weight: 600; color: #5A67F2;">${currentDate}</p>
                        </div>
                        
                        <div style="background: #FEF2F2; padding: 14px; border-radius: 10px; margin-bottom: 24px; border-left: 4px solid #EF4444;">
                            <p style="margin: 0; font-size: 14px; color: #DC2626;">
                                ⚠️ If you did not change your password, please contact HR immediately.
                            </p>
                        </div>
                        
                        <div style="background: #F0FDF4; padding: 14px; border-radius: 10px; margin-bottom: 24px; border-left: 4px solid #10B981;">
                            <p style="margin: 0; font-size: 14px; color: #059669;">
                                ✅ For security reasons, please keep your password confidential.
                            </p>
                        </div>
                        
                        <hr style="border: none; border-top: 1px solid #E4E8F5; margin: 20px 0;">
                        
                        <p style="font-size: 12px; color: #94A3B8; text-align: center; margin: 0;">
                            This is an automated message from HRMS. Please do not reply to this email.
                        </p>
                    </div>
                </div>
            `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Password change notification email sent to ${user.email}`);
    return true;
  } catch (error) {
    console.error("Error sending password change email:", error);
    return false;
  }
};

module.exports = { sendWelcomeEmail, sendPasswordResetNotification ,sendPasswordChangeNotification   };