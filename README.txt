STERLING HOUSING SOLUTIONS

New features
- Floating WhatsApp chat button.
- Admin login at /admin.
- Admin can change the enquiry email and WhatsApp number/message.
- Website enquiries are automatically emailed through SMTP.

SETUP
1. Install Node.js 18+.
2. Run: npm install
3. Set the environment variables shown in .env.example on your host.
4. Run: npm start
5. Open /admin and sign in with ADMIN_PASSWORD.
6. Enter the enquiry email and WhatsApp number, then save.

IMPORTANT
- Do not put SMTP passwords or the admin password in index.html.
- Use HTTPS in production.
- The current form emails text field values. Photo attachment storage/upload should be connected to secure file storage before accepting sensitive uploads in production.
