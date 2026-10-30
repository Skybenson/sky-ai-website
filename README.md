# Sky AI Website

A responsive Sky AI landing page and chat app, with an Express backend that calls the OpenAI Responses API. The browser never receives your API key.

## Requirements

- Node.js 18.18+ (Node 20+ recommended)
- An OpenAI API key with API billing enabled

## Run locally

1. Install Node.js if you don't already have it: https://nodejs.org/
2. Extract this project folder.
3. Open a terminal in this folder and run:

   ```bash
   npm install
   ```

4. Copy `.env.example` to a new file named `.env`.
5. Open `.env` and replace `your_api_key_here` with your API key. Keep this file private; never upload it or paste it into the website code.
6. Start Sky:

   ```bash
   npm start
   ```

7. Open http://localhost:3000

## Connect an API key

Create/manage an API key in the OpenAI developer platform: https://platform.openai.com/api-keys

API usage is billed separately from a ChatGPT subscription. Check current model availability and pricing before launch:
https://platform.openai.com/pricing/

The default model is `gpt-6-luna`. If that model is not enabled for your API account, change `OPENAI_MODEL` in `.env` to a model available to your account.

## Deploy online

Deploy this Node.js app to a host that supports persistent Node.js web services (for example Render, Railway, or a VPS).

- Build/install command: `npm install`
- Start command: `npm start`
- Add `OPENAI_API_KEY` as a secret environment variable in the hosting dashboard.
- Optionally set `OPENAI_MODEL` and `PORT` if your host requires them.
- Do not commit `.env` to GitHub.
- Use HTTPS and configure appropriate rate limits, abuse protection, and usage budgets before sharing publicly.

## Current scope

- Responsive landing page and chat interface
- Sky personality instructions on the server
- Conversation context during the current browser session
- Basic input validation and server-side API-key protection

Not yet included: accounts, permanent saved memory, voice, file uploads, admin dashboard, payment system, or production-grade rate limiting. Conversation history currently lives in the browser tab and is sent to the server for each turn.
