# CLIRC — Cross-Layer Incident Root-Cause Correlator

## What this is

CLIRC is a stateless demo web app that takes a synthetic cloud incident scenario and runs four parallel AI subagent analyses — one per evidence layer (Infrastructure as Code, IAM/Permissions, App + Git History, and Runtime Logs) — using the Groq API with the `llama-3.3-70b-versatile` model. The four findings are then synthesized into a causal timeline, a root-cause verdict with confidence score, a red-herring callout, and a proposed fix — all rendered live in the browser. No database, no authentication, and no external services beyond a free Groq API key are required.

## Local development

Prerequisites: Node.js 18+ and a free Groq API key (https://console.groq.com — no credit card required).

```bash
cd web
npm install
cp .env.example .env.local
# Edit .env.local and set GROQ_API_KEY=your_actual_key
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

1. Push this repo to GitHub (or import directly to Vercel)
2. Go to https://vercel.com/new → Import Git Repository
3. Set **Root Directory** to `web`
4. Click Deploy — Vercel auto-detects Next.js, no other config needed
5. After deploy, go to **Settings → Environment Variables**
6. Add `GROQ_API_KEY` = your Groq API key
7. Redeploy (or trigger a new deployment) for the variable to take effect

## Deploy to Netlify

1. Push this repo to GitHub
2. Go to https://app.netlify.com/start → Import from Git
3. Set **Base directory** to `web`
4. Set **Build command** to `npm run build`
5. Set **Publish directory** to `.next`
6. Click Deploy
7. After deploy, go to **Site configuration → Environment variables**
8. Add `GROQ_API_KEY` = your Groq API key
9. Trigger a new deploy for the variable to take effect

Note: Netlify support requires `@netlify/plugin-nextjs` (already included in `package.json` devDependencies and `netlify.toml`).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | ✅ Yes | Your Groq API key from https://console.groq.com |

No other secrets, accounts, or services are required to run this demo.
