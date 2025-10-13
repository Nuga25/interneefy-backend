const nodemailer = require("nodemailer");

// Create reusable transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Function to send welcome email with credentials
async function sendWelcomeEmail({
  fullName,
  email,
  password,
  role,
  companyName,
}) {
  const roleTitle = role === "INTERN" ? "Intern" : "Supervisor";
  const loginUrl = process.env.FRONTEND_URL || "http://localhost:3000/login";

  const mailOptions = {
    from: `"${companyName}" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Welcome to ${companyName} - Your Account Details`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f9f9f9;
            }
            .header {
              background-color: #4F46E5;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 8px 8px 0 0;
            }
            .content {
              background-color: white;
              padding: 30px;
              border-radius: 0 0 8px 8px;
            }
            .credentials {
              background-color: #f3f4f6;
              padding: 20px;
              border-left: 4px solid #4F46E5;
              margin: 20px 0;
            }
            .button {
              display: inline-block;
              padding: 12px 24px;
              background-color: #4F46E5;
              color: white;
              text-decoration: none;
              border-radius: 6px;
              margin-top: 20px;
            }
            .footer {
              text-align: center;
              margin-top: 20px;
              color: #666;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to ${companyName}!</h1>
            </div>
            <div class="content">
              <p>Hello ${fullName},</p>
              
              <p>We're excited to have you join us as a ${roleTitle}! Your account has been created and you can now access the internship management platform.</p>
              
              <div class="credentials">
                <h3>Your Login Credentials:</h3>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Temporary Password:</strong> ${password}</p>
              </div>
              
              <p><strong>⚠️ Important:</strong> Please change your password after your first login for security purposes.</p>
              
              <a href="${loginUrl}" class="button">Login to Your Account</a>
              
              <p style="margin-top: 30px;">If you have any questions or need assistance, please don't hesitate to reach out to your administrator.</p>
              
              <p>Best regards,<br>${companyName} Team</p>
            </div>
            <div class="footer">
              <p>This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
Welcome to ${companyName}!

Hello ${fullName},

We're excited to have you join us as a ${roleTitle}!

Your Login Credentials:
Email: ${email}
Temporary Password: ${password}

Login here: ${loginUrl}

Best regards,
${companyName} Team
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Welcome email sent successfully:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Error sending welcome email:", error);
    return { success: false, error: error.message };
  }
}

module.exports = { sendWelcomeEmail };
