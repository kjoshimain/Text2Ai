package com.example.text2ai

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import java.security.MessageDigest
import java.util.concurrent.Executors

class SmsReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "Text2AI-SMS"
        private val executor = Executors.newSingleThreadExecutor()
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val token = try {
            GatewayConfig.token(context)
        } catch (error: Exception) {
            GatewayConfig.setLastError(context, error.message ?: "Could not read the saved device token.")
            return
        } ?: return
        if (token.isBlank()) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isEmpty()) return
        val from = messages.firstNotNullOfOrNull { it.originatingAddress }?.trim().orEmpty()
        val body = messages.joinToString(separator = "") { it.messageBody.orEmpty() }.trim()
        if (from.isBlank() || body.isBlank()) return
        if (body.length > 1_000) {
            GatewayConfig.setLastError(context, "Incoming SMS exceeds the backend's 1000-character limit.")
            return
        }
        val timestamp = messages.minOf { it.timestampMillis }
        val smsId = stableSmsId("$from|$timestamp|$body")
        try {
            GatewayConfig.enqueueInbound(
                context,
                GatewayConfig.PendingInboundSms(smsId, from, body),
            )
        } catch (error: Exception) {
            val detail = error.message ?: "Could not save the incoming SMS for forwarding."
            GatewayConfig.setLastError(context, detail)
            Log.e(TAG, "Inbound SMS could not be queued: $detail", error)
            return
        }
        val pendingResult = goAsync()
        val appContext = context.applicationContext

        executor.execute {
            try {
                GatewayApi.sendInbound(appContext, from, body, smsId)
                GatewayConfig.removeInbound(appContext, smsId)
                GatewayConfig.setLastError(appContext, null)
            } catch (error: Exception) {
                val detail = error.message ?: "Could not forward an incoming SMS."
                if (error is BackendRequestException && error.statusCode == 413) {
                    GatewayConfig.removeInbound(appContext, smsId)
                }
                GatewayConfig.setLastError(appContext, detail)
                Log.e(TAG, "Inbound SMS forwarding failed: $detail", error)
            } finally {
                pendingResult.finish()
            }
        }
    }

    private fun stableSmsId(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
        return "sms-" + digest.joinToString("") { byte -> "%02x".format(byte) }
    }
}
