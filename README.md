# Text2AI

Text2AI is a prototype for an SMS-first research assistant. A gateway phone receives a question, forwards it to the backend, and sends the eventual reply back to the sender. A web dashboard will share the backend research pipeline.

## Current checkpoint

**Phase 4 — Android SMS gateway implemented and debug APK built; live handset verification pending.** The Android app pairs over HTTPS, stores its gateway token encrypted with Android Keystore, forwards incoming SMS with HMAC authentication, and runs a user-started foreground service that sends queued replies and acknowledges them. The debug APK builds with the Gradle wrapper; pairing and SMS delivery still need verification on a phone with a SIM and a reachable HTTPS backend.

**Phase 5 — complete.** The backend is deployed on Vercel using durable Supabase storage, and the production health check confirms both are configured. See [docs/VERCEL_DEPLOYMENT.md](./docs/VERCEL_DEPLOYMENT.md).

**Phase 6 — live backend deployment verified; end-to-end handset verification remains.** TinyFish, Supabase, and the gateway administrator configuration are active in production. Anthropic/LLM credentials and Twilio are not configured, and SMS pairing and delivery still need verification on a phone with a SIM; see [docs/VERCEL_DEPLOYMENT.md](./docs/VERCEL_DEPLOYMENT.md).

**Phase 3 — research core implemented; live credentials still required.** Research now runs through TinyFish Search/Fetch and Anthropic JSON synthesis, ranks official domains, retains verified citations, reports staged progress over SSE, and returns an explicit fallback rather than invented evidence when a provider fails. The dashboard consumes the progress stream. Add live provider credentials before expecting completed live answers.

**Phase 2 — backend foundation.** The API, in-memory/Supabase store adapters, SMS adapter interfaces, gateway pairing/auth/outbox/ack flow, input validation, rate limiting, privacy-aware request logs, and backend utility tests are implemented.

## Quick start

Requirements: Node.js LTS and npm.

```powershell
Copy-Item .env.example .env
npm install
npm --prefix backend install
npm --prefix frontend install
npm run dev
```

The backend listens on `http://localhost:3001`; the Vite dashboard is at `http://localhost:5173`. The backend foundation and mock SMS adapter run without external credentials. Optional Supabase persistence is enabled only when both `SUPABASE_URL` and `SUPABASE_KEY` are configured; otherwise the process uses memory storage.

## Backend API foundation

- `GET /api/health` — reports the active store and integration configuration booleans.
- `POST /api/gateway/pairing-code` — generate a short-lived one-time code; requires `X-Gateway-Admin-Key`.
- `POST /api/gateway/pair` — exchange a code for a per-device token.
- `POST /api/gateway/inbound` — receive a signed gateway SMS request and acknowledge it before async processing.
- `GET /api/gateway/outbox` — authenticated long-poll for queued messages.
- `POST /api/gateway/ack` — report sent, delivered, or failed.
- `GET /api/gateway/devices` and `POST /api/gateway/devices/:deviceId/revoke` — inspect/revoke device status; both require `X-Gateway-Admin-Key`.
- `POST /api/simulate-sms` — dashboard simulator endpoint.
- `POST /api/research` — starts a research run and returns `202` with a `runId`.
- `GET /api/research/:runId/stream` — Server-Sent Events for stage progress and the final source-backed result.
- `GET /api/conversations` and `GET /api/conversations/:id` — conversation records.

Gateway inbound, outbox, and ack calls use `Authorization: Bearer <device-token>` and `X-Device-Signature: <hex HMAC-SHA256 of exact request body>`. For outbox GET, the signature is the HMAC of an empty string. The token is stored hashed in the backend store.

## Environment variables

See [.env.example](./.env.example) for defaults and descriptions. To enable live research, configure `TINYFISH_API_KEY`, `LLM_PROVIDER=anthropic`, and `LLM_API_KEY` in the backend process environment or backend `.env`; `LLM_MODEL` is optional. Real integration keys belong only in the backend `.env`; never place them in the frontend or Android app. With the example `mock` LLM provider or missing credentials, the service returns an explicit fallback and does not claim to have completed research.

## Privacy and security

- Phone numbers are normalized for storage lookup, hashed in conversation records, and masked in logs.
- Request logs contain request IDs, route, status, duration, and client IP only; they do not log request bodies, SMS content, authorization headers, or keys.
- Device tokens are returned only at pairing time, stored as hashes by the backend, and encrypted with Android Keystore on the gateway phone. Gateway endpoints verify both the token and HMAC signature.
- Pairing-code issuance and device administration require a backend-only `GATEWAY_PAIRING_SECRET` (minimum 32 bytes); do not enter or embed it in the Android app.
- Inbound SMS IDs are deduplicated through the configured retention window. Without an SMS ID, a hash of normalized phone and message text is deduplicated for two minutes.
- Gateway replies expire from the outbox after the configured interval; conversation/message retention cleanup runs at startup and daily.
- SMS itself is not end-to-end encrypted. Configure HTTPS for a deployed backend.
- Protect the pairing-code and device-administration endpoints with a random backend-only `GATEWAY_PAIRING_SECRET`; the Android app must never receive that secret. See [android-gateway/README.md](./android-gateway/README.md) for the pairing procedure.

## Repository

- `backend/` Express API, stores, SMS adapters, utilities, and tests
- `frontend/` React + Vite dashboard scaffold
- `android-gateway/` Android SMS gateway app
- `supabase/schema.sql` optional Supabase tables and cleanup function
- `docs/` product and demo notes

## Scripts

- `npm run dev` — start backend and frontend
- `npm test` — run backend unit/integration tests
- `npm start` — start backend

## Android APK

The debug APK is generated at `android-gateway\app\build\outputs\apk\debug\app-debug.apk` after building with the instructions in [android-gateway/README.md](./android-gateway/README.md). The APK is a debug build; install it on a compatible phone to verify pairing and SMS delivery.
