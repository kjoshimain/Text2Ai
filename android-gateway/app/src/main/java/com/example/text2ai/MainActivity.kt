package com.example.text2ai

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    GatewayScreen()
                }
            }
        }
    }
}

@androidx.compose.runtime.Composable
fun GatewayScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var backendUrl by remember { mutableStateOf(GatewayConfig.backendUrl(context)) }
    var pairingCode by remember { mutableStateOf("") }
    var tokenAvailable by remember { mutableStateOf(false) }
    var serviceStatus by remember { mutableStateOf(GatewayConfig.status(context)) }
    var message by remember { mutableStateOf<String?>(null) }
    var serviceError by remember { mutableStateOf(GatewayConfig.lastError(context)) }
    var busy by remember { mutableStateOf(false) }
    val requiredPermissions = remember {
        buildList {
            add(Manifest.permission.RECEIVE_SMS)
            add(Manifest.permission.SEND_SMS)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }.toTypedArray()
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        val smsGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECEIVE_SMS,
        ) == PackageManager.PERMISSION_GRANTED && ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.SEND_SMS,
        ) == PackageManager.PERMISSION_GRANTED
        if (smsGranted && tokenAvailable) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, GatewayService::class.java),
            )
        } else if (!smsGranted) {
            message = "SMS receive and send permissions are required to run the gateway."
        }
    }

    LaunchedEffect(Unit) {
        while (true) {
            try {
                tokenAvailable = GatewayConfig.hasToken(context)
            } catch (error: Exception) {
                tokenAvailable = false
                serviceError = error.message ?: "Saved pairing is invalid. Pair the device again."
                GatewayConfig.setLastError(context, serviceError)
            }
            serviceStatus = GatewayConfig.status(context)
            serviceError = GatewayConfig.lastError(context)
            delay(1_000)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Text2AI Gateway", style = MaterialTheme.typography.headlineSmall)
        Text("Status: $serviceStatus")
        Text("Device ID: ${GatewayConfig.deviceId(context)}")
        Text("Get a one-time pairing code from the backend administrator. Do not enter the administrator key here.")
        OutlinedTextField(
            value = backendUrl,
            onValueChange = { backendUrl = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Backend HTTPS URL") },
            singleLine = true,
            enabled = !busy && !tokenAvailable,
        )
        OutlinedTextField(
            value = pairingCode,
            onValueChange = { pairingCode = it.uppercase().filter { character -> character.isLetterOrDigit() }.take(12) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("One-time pairing code") },
            singleLine = true,
            enabled = !busy && !tokenAvailable,
        )
        Button(
            onClick = {
                busy = true
                message = null
                scope.launch {
                    try {
                        GatewayConfig.setBackendUrl(context, backendUrl)
                        val paired = withContext(Dispatchers.IO) {
                            GatewayApi.pairDevice(context, backendUrl, pairingCode)
                        }
                        tokenAvailable = true
                        pairingCode = ""
                        message = "Paired successfully. Grant SMS permissions, then start the gateway."
                        backendUrl = paired
                    } catch (error: Exception) {
                        message = error.message ?: "Pairing failed. Check the backend URL and try again."
                    } finally {
                        busy = false
                    }
                }
            },
            enabled = !busy && backendUrl.isNotBlank() && pairingCode.isNotBlank() && !tokenAvailable,
        ) {
            Text(if (busy) "Pairing..." else "Pair this device")
        }
        if (tokenAvailable) {
            Button(
                onClick = {
                    val missing = requiredPermissions.filter {
                        ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
                    }
                    if (missing.isEmpty()) {
                        ContextCompat.startForegroundService(
                            context,
                            Intent(context, GatewayService::class.java),
                        )
                    } else {
                        permissionLauncher.launch(missing.toTypedArray())
                    }
                },
                enabled = serviceStatus != "active",
            ) {
                Text("Start gateway")
            }
            Button(
                onClick = {
                    context.startService(
                        Intent(context, GatewayService::class.java).setAction(GatewayService.ACTION_STOP),
                    )
                },
                enabled = serviceStatus == "active",
            ) {
                Text("Stop gateway")
            }
        }
        if (!serviceError.isNullOrBlank()) Text("Gateway error: $serviceError")
        if (!message.isNullOrBlank()) Text(message!!)
        Text(
            "Keep this device connected to the internet. SMS messages are forwarded to your configured backend.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
