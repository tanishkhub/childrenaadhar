# Children Aadhar Foundation

A mobile-first donation collection tool for volunteers. It records cash or UPI donations, the selected volunteer, and the collection date/time. UPI receipt photos are resized on the phone before being stored as a Base64 string in MongoDB.

## Run locally

1. Copy `.env.example` to `.env` and fill in `MONGODB_URI`, `ADMIN_PASSWORD`, and `JWT_SECRET`.
2. Run `npm install` and `npm run dev`.
3. Open the local URL shown in the terminal. The admin page is `/admin`.

## Deploy to Vercel

Import this GitHub repository into Vercel. In **Project Settings → Environment Variables**, add:

- `MONGODB_URI` — include a database name such as `/children_aadhar` in the connection URL.
- `ADMIN_PASSWORD` — the password for `/admin`.
- `JWT_SECRET` — a long, unique random string.

Deploy. The included `vercel.json` sends `/api/*` requests to the Express serverless function and serves the React app elsewhere.

### Background push notifications

To enable reliable reminders when the browser is closed, generate VAPID keys once with `npx web-push generate-vapid-keys`. Add the resulting `publicKey` and `privateKey` in Vercel as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Also add `VAPID_SUBJECT` (for example, `mailto:your-email@example.com`) and a long random `CRON_SECRET`.

Vercel then runs the included morning, afternoon, and evening reminder jobs. Volunteers must open the app once and tap **Enable reminders** to subscribe.

### MongoDB Atlas setting

In Atlas, allow Vercel access under **Network Access**. For a quick first deployment use `0.0.0.0/0`; then restrict it if you have Vercel's outbound IP details available. Never put the database URL or admin password in frontend code or commit it to GitHub.
