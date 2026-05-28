<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/8e85e9d0-9fe4-426d-8455-955ce6d6333d

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Split Deploy

The frontend and backend are now split for deployment:
- Frontend on Vercel
- Backend on Railway

### Files added for deployment
- `Procfile` — Railway backend start command
- `vercel.json` — Vercel static build routing for the frontend
- `.env.example` — example environment variables for local development and deployment

### Frontend deployment on Vercel

1. Create a Vercel project and connect your repo.
2. Set build command: `npm run build`
3. Set output directory: `dist`
4. Add environment variables in Vercel:
   - `VITE_API_BASE_URL` = `https://<your-railway-backend-host>`
   - `VITE_REALTIME_WS_URL` = `wss://<your-railway-backend-host>`

### Backend deployment on Railway

1. Create a Railway project and connect your repo.
2. Add the following Railway environment variables:
   - `GEMINI_API_KEY` = your Gemini API key
   - optional: `TELEGRAM_BOT_TOKEN`
   - optional: `VITE_SUPABASE_URL`
   - optional: `VITE_SUPABASE_ANON_KEY`
   - optional: `CORS_ORIGIN`
3. Use build command: `npm run build:backend`
4. Use start command: `npm run start:backend`

> Railway will run the backend as a standalone Express + WebSocket service.

### Local development

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and fill in your secrets.
3. Start the backend locally:
   - `GEMINI_API_KEY=... npm run start:backend`
4. Start the frontend locally:
   - `npm run dev`

If you want the frontend to talk to your local backend in dev, add to `.env`:
- `VITE_API_BASE_URL=http://localhost:3000`
- `VITE_REALTIME_WS_URL=ws://localhost:3000`

### Notes

- `VITE_API_BASE_URL` is used for `/api/*` HTTP requests.
- `VITE_REALTIME_WS_URL` is used for the `/live` WebSocket connection.
- Do not commit your real `.env` values; use `.env.example` as a template.
