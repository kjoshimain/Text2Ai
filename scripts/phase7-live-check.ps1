param(
    [string]$BackendUrl = 'https://<your-vercel-domain>',
    [string]$DeviceId = 'phase7-test-device'
)

$ErrorActionPreference = 'Stop'

if (-not $BackendUrl -or $BackendUrl -match '<your-vercel-domain>') {
    throw 'Provide a real backend HTTPS URL, for example: https://text2ai.vercel.app'
}

$secureSecret = Read-Host 'Gateway pairing secret' -AsSecureString
$adminKey = [System.Net.NetworkCredential]::new('', $secureSecret).Password

Write-Host 'Checking backend health...'
$health = Invoke-RestMethod -Method Get -Uri "$BackendUrl/api/health"
$health | ConvertTo-Json -Depth 10

Write-Host 'Requesting a new pairing code...'
$codeResponse = Invoke-RestMethod -Method Post -Uri "$BackendUrl/api/gateway/pairing-code" -Headers @{ 'X-Gateway-Admin-Key' = $adminKey }
$codeResponse | ConvertTo-Json -Depth 10

Write-Host ''
Write-Host 'Android app input:'
Write-Host "  Backend URL: $BackendUrl"
Write-Host "  Pairing code: $($codeResponse.code)"
Write-Host "  Device ID: $DeviceId"
Write-Host ''
Write-Host 'After pairing in the app, run this to confirm the device is registered:'
Write-Host "  Invoke-RestMethod -Method Get -Uri '$BackendUrl/api/gateway/devices' -Headers @{ 'X-Gateway-Admin-Key' = '$adminKey' }"
Write-Host ''
Write-Host 'After pairing, use this request to exchange the code for a device token:'
Write-Host "  Invoke-RestMethod -Method Post -Uri '$BackendUrl/api/gateway/pair' -ContentType 'application/json' -Body '{\"deviceId\":\"$DeviceId\",\"pairingCode\":\"$($codeResponse.code)\"}'"

Remove-Variable adminKey, secureSecret
