# Text2AI

Text2AI is a hackathon-ready prototype for an AI-powered SMS research assistant. It receives SMS questions, researches the live web, synthesizes a source-backed answer in the user's language, and sends a concise reply back by SMS.

## Features

- Node.js backend with Express and shared research pipeline
- React + Vite dashboard
- Android gateway app skeleton for SMS handling and outbox polling
- TinyFish integration in `backend/src/services/tinyfish.js`
- LLM abstraction in `backend/src/services/llm.js`
- In-memory store fallback when Supabase is not configured
- SMS segmentation and formatting utilities for English and Hindi
- Research progress streaming via SSE

## Quick start

1. Copy `.env.example` to `.env` and set the env values you need.
2. Install backend dependencies:
   npm --prefix backend install
3. Install frontend dependencies:
   npm --prefix frontend install
4. Start the app:
   npm run dev
5. Open the dashboard at `http://localhost:5173`

## Manual setup and API keys

The app runs without a full live stack when `TINYFISH_MODE=mock` and `LLM_PROVIDER=mock` are used. To enable the live web research layer, provide:

- TinyFish CLI or API access and a valid `TINYFISH_API_KEY`
- LLM access via `LLM_PROVIDER`, `LLM_API_KEY`, and `LLM_MODEL`
- Optional Supabase credentials for persistence
- Optional Twilio credentials for SMS sending via the Twilio adapter

If any required live integration keys are missing, the project keeps running in mock mode and reports the integration as unavailable in `/api/health`.

## Privacy note

Phone numbers are masked in logs and stored as hashed values. Full SMS bodies are not logged at info level. The app never logs API keys.

## Repository layout

- `backend/` Node.js API and shared research service
- `frontend/` React dashboard
- `android-gateway/` Android SMS gateway skeleton
- `supabase/` optional schema for persistent storage
- `docs/` project brief and demo notes

## Scripts

- `npm run dev` starts backend and frontend together
- `npm test` runs backend tests
- `npm start` starts the backend only

## Android APK note

The Android project is scaffolded. Run `./gradlew assembleDebug` inside `android-gateway/` when the Android SDK is installed. If the SDK is not available, the command will fail and CI becomes the fallback validation path.
