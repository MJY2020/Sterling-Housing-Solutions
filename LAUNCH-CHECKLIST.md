# Sterling Housing Solutions Launch Checklist

## Required Replit Secrets

Set these in Replit Secrets:

- `NODE_ENV=production`
- `ADMIN_PASSWORD`: strong admin password for `/admin`
- `SESSION_SECRET`: long random value that stays the same across restarts
- `ENQUIRY_EMAIL`: where enquiries should be sent
- `WHATSAPP_NUMBER`: full international number without `+`
- `WHATSAPP_MESSAGE`: opening WhatsApp message
- `EMAIL_DELIVERY=resend`
- `RESEND_API_KEY`: Resend API key
- `RESEND_FROM`: verified sending address, for example `Sterling Housing Solutions <enquiries@sterlinghousingsolutions.com>`
- `ENQUIRIES_PATH=enquiries.json`

## Before Going Live

- Confirm Resend domain DNS remains verified.
- Run `npm install`.
- Run `npm run check`.
- Run `npm audit --omit=dev` and resolve production vulnerabilities.
- Import the GitHub repo into Replit.
- Confirm Replit runs `npm start`.
- Confirm the site is served over HTTPS.
- Open `/admin`, sign in, and send a test email.
- Submit a public enquiry and confirm it appears in the admin dashboard.
- Confirm the WhatsApp button opens the correct chat on desktop and mobile.
- Confirm privacy and terms pages are visible.

## Data And Storage

- Enquiries save to `ENQUIRIES_PATH` when set, otherwise to local `enquiries.json`.
- For a larger live site, connect a production database such as Supabase, Neon/Postgres, or Replit Database instead of relying only on a JSON file.
- Back up enquiries regularly.
- Photo uploads are disabled until secure file storage is connected.

## Security

- Keep `config.json` out of Git and avoid storing passwords/API keys in it.
- In production, passwords and API keys must be environment variables.
- The public enquiry form has required-field validation, a honeypot field, and basic IP rate limiting.
- Admin login has basic IP rate limiting.
- Review the generated Privacy Policy and Terms with a qualified professional before relying on them.
