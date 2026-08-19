Sterling Housing Solutions Website

Run locally:

1. npm install
2. Set ADMIN_PASSWORD and SESSION_SECRET.
3. npm start
4. Open http://localhost:3000
5. Open /admin to manage settings and enquiries.

Replit deployment:

This is a Node/Express app, not a static-only site. Import the GitHub repo into Replit and run it with npm start.

Required environment variables:

- NODE_ENV=production
- ADMIN_PASSWORD
- SESSION_SECRET
- ENQUIRY_EMAIL
- WHATSAPP_NUMBER
- WHATSAPP_MESSAGE
- EMAIL_DELIVERY=resend
- RESEND_API_KEY
- RESEND_FROM
- ENQUIRIES_PATH=enquiries.json

Email:

Resend is the recommended production email option. Verify the sending domain in Resend, add the required DNS records in Namecheap, create an API key, then set RESEND_API_KEY and RESEND_FROM on the host.

Admin:

The admin dashboard can manage enquiries and non-secret settings. In production, passwords and API keys should be stored as environment variables on the host, not in config.json.

Enquiries:

Enquiries are saved to ENQUIRIES_PATH when set, otherwise to enquiries.json in the project folder. For a larger live site, connect Supabase, Neon/Postgres, or Replit Database.

Security:

The form includes required-field validation, a honeypot field, and basic rate limiting. Admin login also has basic rate limiting. Review the Privacy Policy and Terms before launch.

Photos:

Photo uploads are disabled until secure storage is connected.
