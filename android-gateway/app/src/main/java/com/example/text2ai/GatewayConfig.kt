package com.example.text2ai

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object GatewayConfig {
    private const val PREFERENCES = "text2ai_gateway"
    private const val KEY_ALIAS = "text2ai_gateway_token_key"
    private const val TOKEN_KEY = "device_token"
    private const val URL_KEY = "backend_url"
    private const val DEVICE_ID_KEY = "device_id"
    private const val LAST_ERROR_KEY = "last_error"
    private const val STATUS_KEY = "service_status"
    private const val PENDING_ACKS_KEY = "pending_acks"
    private const val PENDING_INBOUND_KEY = "pending_inbound"
    private const val MAX_PENDING_INBOUND = 500
    private val queueLock = Any()

    data class PendingInboundSms(
        val smsId: String,
        val from: String,
        val body: String,
    )

    private fun preferences(context: Context) =
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun backendUrl(context: Context): String =
        preferences(context).getString(URL_KEY, "") ?: ""

    fun setBackendUrl(context: Context, value: String) {
        preferences(context).edit().putString(URL_KEY, value.trim().trimEnd('/')).apply()
    }

    fun deviceId(context: Context): String {
        val prefs = preferences(context)
        val existing = prefs.getString(DEVICE_ID_KEY, null)
        if (existing != null) return existing
        val created = UUID.randomUUID().toString()
        prefs.edit().putString(DEVICE_ID_KEY, created).apply()
        return created
    }

    fun saveToken(context: Context, token: String) {
        require(token.isNotBlank()) { "The backend returned an empty device token." }
        preferences(context).edit().putString(TOKEN_KEY, encrypt(token)).apply()
    }

    fun token(context: Context): String? {
        val stored = preferences(context).getString(TOKEN_KEY, null) ?: return null
        return decrypt(stored)
    }

    fun enqueueInbound(context: Context, sms: PendingInboundSms) {
        require(sms.smsId.isNotBlank() && sms.from.isNotBlank() && sms.body.isNotBlank()) {
            "Incoming SMS queue item is incomplete."
        }
        synchronized(queueLock) {
            val prefs = preferences(context)
            val entries = prefs.getStringSet(PENDING_INBOUND_KEY, emptySet()).orEmpty().toMutableSet()
            if (entries.any { it.startsWith("${sms.smsId}=") }) return
            check(entries.size < MAX_PENDING_INBOUND) {
                "The pending SMS queue is full. Start the gateway and retry later."
            }
            val payload = JSONObject()
                .put("smsId", sms.smsId)
                .put("from", sms.from)
                .put("body", sms.body)
                .toString()
            entries.add("${sms.smsId}=${encrypt(payload)}")
            prefs.edit().putStringSet(PENDING_INBOUND_KEY, entries).apply()
        }
    }

    fun pendingInbound(context: Context): List<PendingInboundSms> = synchronized(queueLock) {
        preferences(context).getStringSet(PENDING_INBOUND_KEY, emptySet())
            .orEmpty()
            .map { entry ->
                val smsId = entry.substringBefore('=')
                val payload = JSONObject(decrypt(entry.substringAfter('=')))
                PendingInboundSms(
                    smsId = smsId,
                    from = payload.optString("from"),
                    body = payload.optString("body"),
                )
            }
    }

    fun removeInbound(context: Context, smsId: String) {
        synchronized(queueLock) {
            val entries = preferences(context).getStringSet(PENDING_INBOUND_KEY, emptySet())
                .orEmpty()
                .filterNot { it.startsWith("$smsId=") }
                .toSet()
            preferences(context).edit().putStringSet(PENDING_INBOUND_KEY, entries).apply()
        }
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return "${Base64.encodeToString(cipher.iv, Base64.NO_WRAP)}:" +
            Base64.encodeToString(encrypted, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String {
        val parts = stored.split(':', limit = 2)
        require(parts.size == 2) { "Encrypted gateway data is corrupted." }
        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val encrypted = Base64.decode(parts[1], Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(encrypted).toString(Charsets.UTF_8)
    }

    fun hasToken(context: Context): Boolean = token(context) != null

    fun setLastError(context: Context, error: String?) {
        preferences(context).edit().putString(LAST_ERROR_KEY, error).apply()
    }

    fun lastError(context: Context): String? =
        preferences(context).getString(LAST_ERROR_KEY, null)

    fun setStatus(context: Context, status: String) {
        preferences(context).edit().putString(STATUS_KEY, status).apply()
    }

    fun status(context: Context): String =
        preferences(context).getString(STATUS_KEY, "stopped") ?: "stopped"

    fun pendingAck(context: Context, messageId: String): String? =
        preferences(context).getStringSet(PENDING_ACKS_KEY, emptySet())
            ?.firstOrNull { it.startsWith("$messageId=") }
            ?.substringAfter('=')

    fun savePendingAck(context: Context, messageId: String, status: String) {
        val entries = preferences(context).getStringSet(PENDING_ACKS_KEY, emptySet())
            .orEmpty()
            .filterNot { it.startsWith("$messageId=") }
            .toMutableSet()
        entries.add("$messageId=$status")
        preferences(context).edit().putStringSet(PENDING_ACKS_KEY, entries).apply()
    }

    fun clearPendingAck(context: Context, messageId: String) {
        val entries = preferences(context).getStringSet(PENDING_ACKS_KEY, emptySet())
            .orEmpty()
            .filterNot { it.startsWith("$messageId=") }
            .toSet()
        preferences(context).edit().putStringSet(PENDING_ACKS_KEY, entries).apply()
    }

    fun clearPendingAcksNotIn(context: Context, activeMessageIds: Set<String>) {
        val entries = preferences(context).getStringSet(PENDING_ACKS_KEY, emptySet())
            .orEmpty()
            .filter { entry -> entry.substringBefore('=') in activeMessageIds }
            .toSet()
        preferences(context).edit().putStringSet(PENDING_ACKS_KEY, entries).apply()
    }

    private fun encryptionKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }
}
