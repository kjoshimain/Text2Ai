package com.example.text2ai

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

data class OutboxMessage(
    val id: String,
    val to: String,
    val body: String,
    val segments: List<String>,
)

class BackendRequestException(
    val statusCode: Int,
    message: String,
) : IllegalStateException(message)

object GatewayApi {
    private const val CONNECT_TIMEOUT_MS = 8_000
    private const val READ_TIMEOUT_MS = 32_000

    fun pairDevice(context: Context, rawBaseUrl: String, pairingCode: String): String {
        val baseUrl = normalizeBaseUrl(rawBaseUrl)
        val deviceId = GatewayConfig.deviceId(context)
        require(pairingCode.isNotBlank()) { "Enter the one-time pairing code from the backend administrator." }

        val response = requestJson(
            "$baseUrl/api/gateway/pair",
            "POST",
            JSONObject()
                .put("deviceId", deviceId)
                .put("pairingCode", pairingCode.trim().uppercase()),
        )
        val token = response.optString("token")
        require(token.isNotBlank()) { "The backend did not return a device token." }
        GatewayConfig.setBackendUrl(context, baseUrl)
        GatewayConfig.saveToken(context, token)
        GatewayConfig.setLastError(context, null)
        return baseUrl
    }

    fun sendInbound(context: Context, from: String, body: String, smsId: String) {
        val baseUrl = normalizeBaseUrl(GatewayConfig.backendUrl(context))
        val token = requireNotNull(GatewayConfig.token(context)) { "Pair this device before forwarding SMS." }
        val payload = JSONObject()
            .put("deviceId", GatewayConfig.deviceId(context))
            .put("from", from)
            .put("body", body)
            .put("smsId", smsId)
            .toString()
        authenticatedRequest(
            "$baseUrl/api/gateway/inbound",
            "POST",
            payload,
            token,
            timeoutMs = 15_000,
        )
    }

    fun pollOutbox(context: Context): List<OutboxMessage> {
        val baseUrl = normalizeBaseUrl(GatewayConfig.backendUrl(context))
        val token = requireNotNull(GatewayConfig.token(context)) { "Pair this device before polling." }
        val connection = URL("$baseUrl/api/gateway/outbox").openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "GET"
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("X-Device-Signature", hmacSha256(token, ""))
            val response = readResponse(connection)
            val items = response.optJSONArray("items") ?: JSONArray()
            return (0 until items.length()).mapNotNull { index ->
                val item = items.optJSONObject(index) ?: return@mapNotNull null
                val id = item.optString("id")
                val to = item.optString("to")
                val body = item.optString("body")
                if (id.isBlank() || to.isBlank() || body.isBlank()) return@mapNotNull null
                val jsonSegments = item.optJSONArray("segments")
                val segments = if (jsonSegments == null) {
                    listOf(body)
                } else {
                    (0 until jsonSegments.length()).mapNotNull { segmentIndex ->
                        jsonSegments.optString(segmentIndex).takeIf(String::isNotBlank)
                    }
                }
                OutboxMessage(id, to, body, segments.ifEmpty { listOf(body) })
            }
        } finally {
            connection.disconnect()
        }
    }

    fun acknowledge(context: Context, messageId: String, status: String) {
        require(status in setOf("sent", "delivered", "failed")) { "Invalid message status." }
        val baseUrl = normalizeBaseUrl(GatewayConfig.backendUrl(context))
        val token = requireNotNull(GatewayConfig.token(context)) { "Pair this device before acknowledging." }
        val payload = JSONObject()
            .put("messageId", messageId)
            .put("status", status)
            .toString()
        authenticatedRequest("$baseUrl/api/gateway/ack", "POST", payload, token)
    }

    private fun authenticatedRequest(
        endpoint: String,
        method: String,
        body: String,
        token: String,
        timeoutMs: Int = CONNECT_TIMEOUT_MS,
    ): JSONObject {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = method
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("X-Device-Signature", hmacSha256(token, body))
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            return readResponse(connection)
        } finally {
            connection.disconnect()
        }
    }

    private fun requestJson(endpoint: String, method: String, payload: JSONObject): JSONObject {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = method
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = CONNECT_TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            return readResponse(connection)
        } finally {
            connection.disconnect()
        }
    }

    private fun readResponse(connection: HttpURLConnection): JSONObject {
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        if (status !in 200..299) {
            val details = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw BackendRequestException(
                status,
                details?.takeIf(String::isNotBlank) ?: "Backend request failed with HTTP $status.",
            )
        }
        return try {
            JSONObject(body)
        } catch (error: Exception) {
            throw IllegalStateException("Backend returned an invalid JSON response.", error)
        }
    }

    private fun normalizeBaseUrl(value: String): String {
        val uri = java.net.URI(value.trim().trimEnd('/'))
        require(uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank()) {
            "Enter a valid HTTPS backend URL."
        }
        require(uri.userInfo == null && uri.query == null && uri.fragment == null) {
            "Backend URL must not contain credentials, a query, or a fragment."
        }
        return uri.toString()
    }

    private fun hmacSha256(token: String, payload: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(token.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(payload.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte) }
    }
}
