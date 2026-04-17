# HeyGen Google Meet Test App

This is a deliberately small test app for verifying a Recall bot can open a webpage, render a HeyGen LiveAvatar, join a Google Meet, and do one tiny branched conversation.

## What it does

- Creates a HeyGen LiveAvatar session from your backend
- Starts the avatar in the browser
- Lets you paste a Google Meet URL and launch a Recall bot from a button
- Uses browser speech recognition plus simple keyword matching for the back-and-forth

## Environment variables

Copy `.env.example` to `.env` and fill in:

- `HEYGEN_AVATAR_API_KEY`
- `HEYGEN_AVATAR_ID`
- `HEYGEN_AVATAR_VOICE_ID`
- `HEYGEN_AVATAR_CONTEXT_ID`
- `RECALL_API_KEY`
- `RECALL_REGION`
- `PUBLIC_APP_URL`

`PUBLIC_APP_URL` should be the full public HTTPS URL Recall can open, usually your ngrok URL.

## HeyGen setup

You said you have credentials but not the avatar configured yet. The minimum setup is:

1. Open [LiveAvatar](https://app.liveavatar.com/home).
2. Pick a public LiveAvatar or create a custom one.
3. Open the avatar settings and note the `avatar_id`.
4. Pick a voice and note the `voice_id`.
5. Create a context for the avatar.
   Put in a short prompt like: "You are a concise demo avatar. Keep every reply under two sentences."
6. Note the `context_id`.
7. Put those three values plus your API key into `.env`.

If you want, once the app is built and typechecked I can give you a tighter step-by-step for locating those IDs in the LiveAvatar UI.

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm run dev
```

3. Expose the frontend with ngrok:

```bash
ngrok http 5173
```

4. Copy the public HTTPS URL into `PUBLIC_APP_URL` in `.env`.

5. Open the local app in your browser:

- Frontend: `http://localhost:5173`

6. Paste a Google Meet URL and click `Join Meet`.

## Notes

- The Recall bot is launched with `google_meet: "web_4_core"`.
- The browser running inside the Recall bot should render this page as the bot camera feed.
- Speech recognition depends on browser support. Chrome-based browsers are the safest choice for the operator page.
