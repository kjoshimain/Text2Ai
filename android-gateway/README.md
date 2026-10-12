# Android SMS gateway

The Android app receives SMS, authenticates and forwards inbound messages to the Text2AI backend, long-polls its device outbox, and sends queued replies using the phone's SIM.

## Requirements

- Android Studio or Android SDK 34
- JDK 17+
- A spare Android phone with a SIM for SMS delivery
- A publicly reachable backend configured with HTTPS

## Pair and run

1. Configure `GATEWAY_PAIRING_SECRET` on the backend with a random secret of at least 32 bytes and restart the backend. Generate one in PowerShell with:

   ```powershell
   $bytes = New-Object byte[] 32
   [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
   [Convert]::ToBase64String($bytes)
   ```
2. On the trusted backend administrator machine, request a short-lived, one-time code. For a local PowerShell session from the repository root:

   ```powershell
   $line = Get-Content .env | Where-Object { $_ -match '^GATEWAY_PAIRING_SECRET=' } | Select-Object -First 1
   $adminKey = $line.Substring('GATEWAY_PAIRING_SECRET='.Length)
   Invoke-RestMethod -Method Post -Uri 'http://localhost:3001/api/gateway/pairing-code' -Headers @{ 'X-Gateway-Admin-Key' = $adminKey }
   ```

   Do not run the HTTP example against a remote host. For a remote backend, use its HTTPS URL and keep the admin key only on a trusted administrator machine.
3. Open the gateway app and enter the backend HTTPS base URL and one-time pairing code. Tap **Pair this device**. The app exchanges the code for a device token and encrypts that token with an Android Keystore key. The backend administrator key is never entered into the phone.
4. Grant SMS receive/send permissions and notification permission when prompted.
5. Tap **Start gateway** and keep the phone online. The ongoing notification indicates that outbox polling is active.
6. Tap **Stop gateway** before taking the phone offline or disabling the relay.

The receiver forwards complete SMS bodies with an idempotent message ID and HMAC-SHA256 signature. If forwarding is interrupted, up to 500 pending inbound messages remain encrypted on-device and are retried when the gateway is running. The service sends the exact SMS segments queued by the backend and acknowledges each item as `sent` or `failed`. Failed acknowledgements remain locally recorded so a subsequent poll can retry the acknowledgement without re-sending the SMS.

## Build

The scaffold does not include a functioning Gradle wrapper. Install JDK 17, Android SDK 34, and Gradle 8.7+, then run `gradle :app:assembleDebug` from this directory. The debug APK is normally written to `app\build\outputs\apk\debug\app-debug.apk`.

## Security and operating limits

- Backend URLs must use HTTPS. The app refuses cleartext HTTP and does not follow redirects for authenticated requests.
- The device token is encrypted at rest with AES-GCM using a non-exportable Android Keystore key. The app does not contain TinyFish or LLM credentials.
- Pending inbound SMS bodies are encrypted at rest with the same Android Keystore key. The retry queue is bounded to 500 messages.
- SMS receiver and sender permissions are sensitive. Install only on a phone dedicated to the relay and grant permissions only if you intend to forward its incoming SMS.
- The foreground data-sync service must be started by the user and is subject to Android background execution limits. Keep the app updated and monitor its status.
- This prototype acknowledges `sent` when Android accepts the send request; it does not request carrier delivery reports.
- SMS forwarding requires an accessible backend and may incur carrier charges.
