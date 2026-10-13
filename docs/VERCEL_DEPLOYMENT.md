# Phase 5: deploy the backend on Vercel

This guide deploys the Express backend so the Android gateway can pair with it over HTTPS. The gateway requires durable storage: Vercel instances are ephemeral, so production startup fails if Supabase is not configured. The backend registers its asynchronous research work with Vercel so that work continues after the inbound request has returned.

Phase 5 is complete: the backend is deployed on Vercel with durable Supabase storage. The production health check confirms Supabase and gateway admin configuration, and TinyFish is enabled. Phase 6's live backend deployment is verified. Phase 7 starts with end-to-end handset pairing and SMS delivery on a SIM-equipped Android phone. Anthropic/LLM synthesis and Twilio remain optional until live answer delivery is required.

The schema enables row-level security and restricts Data API table and RPC access to the backend's `service_role`; the service-role key must stay in Vercel's server-side environment variables.

The gateway uses short outbox polls so an idle phone does not keep a serverless function open long enough to time out. Keep `OUTBOX_LONG_POLL_MS` at or below `4000` milliseconds (the default is `3000`). The deployment also allows up to 60 seconds for serverless work, so inbound research registered with Vercel can finish and enqueue a reply.

## 1. Create the Supabase project

1. Create a Supabase project and open its SQL Editor.
2. Run the contents of [`../supabase/schema.sql`](../supabase/schema.sql).
3. From the Supabase project settings, copy the project URL and the **service role** key. Keep the service role key private; never use it in the Android app or frontend.

## 2. Deploy the backend

1. Import the `kjoshimain/Text2Ai` GitHub repository into Vercel.
2. Set the Vercel project **Root Directory** to `backend`. Vercel detects the Express server in `src/server.js`; keep the detected framework/build settings.
3. Add the backend environment variables below to the **Production** environment. Keep secrets out of source control and do not add them to preview deployments unless those deployments use separate credentials and storage.

Required for durable pairing and gateway operation:

- `NODE_ENV=production`
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_KEY` — Supabase service role key
- `GATEWAY_PAIRING_SECRET` — random secret of at least 32 bytes

Required for live, source-backed research answers:

- `TINYFISH_API_KEY`
- `LLM_PROVIDER=anthropic`
- `LLM_API_KEY`

`LLM_MODEL` is optional. Without the live research credentials, the service can return its explicit research-unavailable fallback. Configure `CLIENT_ORIGIN` to the exact dashboard origin if a browser dashboard will call the API.

Generate a pairing admin secret locally in PowerShell; enter its output directly into Vercel's environment settings and do not send it in chat:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Deploy the project, then verify that `https://<your-vercel-domain>/api/health` returns `ok: true`, `store: "supabase"`, and `integrations.gatewayAdmin: true`.

## 3. Pair the Android gateway

On a trusted administrator computer, request a one-time pairing code. The command prompts for the admin secret without echoing it:

```powershell
$backendUrl = 'https://<your-vercel-domain>'
$secureSecret = Read-Host 'Gateway pairing secret' -AsSecureString
$adminKey = [System.Net.NetworkCredential]::new('', $secureSecret).Password
Invoke-RestMethod -Method Post -Uri "$backendUrl/api/gateway/pairing-code" -Headers @{ 'X-Gateway-Admin-Key' = $adminKey }
Remove-Variable adminKey, secureSecret
```

Enter the HTTPS base URL and the returned one-time code in the Android app. The admin secret is never entered into the app. Install the app on a phone with a SIM, grant its requested permissions, and verify an incoming question and reply end to end.

## Remaining live checks

Verify pairing and SMS delivery end to end on a physical Android phone with a SIM. Configure `LLM_PROVIDER=anthropic` and `LLM_API_KEY` if synthesized, source-backed answers are needed; configure Twilio only if using that SMS provider. Keep `Text2AI.apk` as the debug build for this phase; it is not a Play Store release.
