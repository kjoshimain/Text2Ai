package com.example.text2ai

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.telephony.SmsManager
import android.util.Log
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class GatewayService : Service() {
    companion object {
        const val ACTION_STOP = "com.example.text2ai.action.STOP_GATEWAY"
        private const val CHANNEL_ID = "text2ai_gateway"
        private const val NOTIFICATION_ID = 4102
        private const val TAG = "Text2AI-Gateway"
    }

    @Volatile
    private var active = false
    private var worker: ExecutorService? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopGateway()
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification("Connecting to backend"))
        if (active) return START_STICKY

        val token = try {
            GatewayConfig.token(this)
        } catch (error: Exception) {
            GatewayConfig.setLastError(this, error.message ?: "Could not read the saved device token.")
            null
        }
        if (token.isNullOrBlank()) {
            GatewayConfig.setStatus(this, "not paired")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
            return START_NOT_STICKY
        }

        active = true
        GatewayConfig.setStatus(this, "active")
        GatewayConfig.setLastError(this, null)
        worker = Executors.newSingleThreadExecutor().also { executor ->
            executor.execute { pollLoop() }
        }
        return START_STICKY
    }

    private fun pollLoop() {
        while (active && !Thread.currentThread().isInterrupted) {
            try {
                GatewayConfig.setLastError(this, null)
                for (sms in GatewayConfig.pendingInbound(this)) {
                    if (!active) break
                    try {
                        GatewayApi.sendInbound(this, sms.from, sms.body, sms.smsId)
                        GatewayConfig.removeInbound(this, sms.smsId)
                    } catch (error: BackendRequestException) {
                        if (error.statusCode != 413) throw error
                        GatewayConfig.removeInbound(this, sms.smsId)
                        GatewayConfig.setLastError(
                            this,
                            "Backend rejected an incoming SMS because it exceeds the configured character limit.",
                        )
                    }
                }
                val messages = GatewayApi.pollOutbox(this)
                GatewayConfig.clearPendingAcksNotIn(this, messages.map { it.id }.toSet())
                for (message in messages) {
                    if (!active) break
                    deliverOrAcknowledge(message)
                }
            } catch (error: Exception) {
                if (!active) break
                val detail = error.message ?: "Could not reach the backend."
                GatewayConfig.setLastError(this, detail)
                Log.e(TAG, "Gateway polling failed: $detail", error)
                try {
                    Thread.sleep(5_000)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                }
            }
        }
    }

    private fun deliverOrAcknowledge(message: OutboxMessage) {
        val pendingStatus = GatewayConfig.pendingAck(this, message.id)
        val status = pendingStatus ?: try {
            val smsManager = getSystemService(SmsManager::class.java)
            smsManager.sendMultipartTextMessage(
                message.to,
                null,
                ArrayList(message.segments),
                null,
                null,
            )
            GatewayConfig.savePendingAck(this, message.id, "sent")
            "sent"
        } catch (error: Exception) {
            val detail = error.message ?: "Android could not send an SMS."
            GatewayConfig.setLastError(this, detail)
            Log.e(TAG, "SMS send failed for outbox item ${message.id}: $detail", error)
            GatewayConfig.savePendingAck(this, message.id, "failed")
            "failed"
        }

        GatewayApi.acknowledge(this, message.id, status)
        GatewayConfig.clearPendingAck(this, message.id)
        if (status == "sent") {
            updateNotification("Message sent")
        } else {
            updateNotification("A message could not be sent")
        }
    }

    private fun stopGateway() {
        active = false
        worker?.shutdownNow()
        worker = null
        GatewayConfig.setStatus(this, "stopped")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        active = false
        worker?.shutdownNow()
        worker = null
        if (GatewayConfig.status(this) == "active") {
            GatewayConfig.setStatus(this, "stopped")
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Text2AI SMS gateway",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Shows when the SMS gateway is connected."
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(status: String): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Text2AI gateway")
                .setContentText(status)
                .setContentIntent(openApp)
                .setOngoing(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Text2AI gateway")
                .setContentText(status)
                .setContentIntent(openApp)
                .setOngoing(true)
                .build()
        }
    }

    private fun updateNotification(status: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(status))
    }
}
