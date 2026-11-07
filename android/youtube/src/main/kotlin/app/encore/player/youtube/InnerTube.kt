package app.encore.player.youtube

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.URLEncoder
import java.util.Base64
import java.util.Locale
import java.util.TimeZone
import kotlin.coroutines.resumeWithException

// YouTube's own API ("InnerTube"), spoken the way youtubei.js speaks it for the desktop app:
// the same clients, versions and headers, so the phone gets the same answers. Requests carry a
// visitor id from YouTube (like a first visit in a browser) and no account.

/** one of the YouTube apps the requests present themselves as */
class ClientProfile internal constructor(
    val name: String,
    val version: String,
    /** the number YouTube knows the client by, sent as x-youtube-client-name */
    val id: Int,
    /** the user agent in the request headers, and for fetching the audio this client's links point to */
    val userAgent: String,
    internal val fields: Map<String, String>,
    /** the user agent inside the request body; youtubei.js sends its browser one for every client */
    internal val contextUserAgent: String = userAgent,
) {
    companion object {
        private const val CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

        /** YouTube Music on the web: search, pages, radio */
        val WebRemix = ClientProfile(
            name = "WEB_REMIX", version = "1.20250219.01.00", id = 67, userAgent = CHROME,
            fields = mapOf(
                "osName" to "Macintosh", "osVersion" to "10_15_7", "platform" to "DESKTOP", "deviceMake" to "Apple", "deviceModel" to "",
                "browserName" to "Chrome", "browserVersion" to "131.0.0.0",
            ),
        )

        /** YouTube on Apple Vision Pro: plain audio links that play whole, no player script needed */
        val VisionOs = ClientProfile(
            name = "VISIONOS", version = "1.02", id = 101,
            userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
            fields = mapOf("osName" to "visionOS", "osVersion" to "26.5.23O471", "platform" to "MOBILE", "deviceMake" to "Apple", "deviceModel" to "RealityDevice17,1"),
        )

        /** YouTube on iPhone: AAC links, the fallback when Vision Pro's don't work */
        val Ios = ClientProfile(
            name = "iOS", version = "20.11.6", id = 5,
            userAgent = "com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)",
            fields = mapOf("osName" to "iOS", "osVersion" to "16.7.7.20H330", "platform" to "MOBILE", "deviceMake" to "Apple", "deviceModel" to "iPhone10,4"),
            contextUserAgent = CHROME,
        )
    }
}

class YouTubeException(message: String, val status: Int? = null, cause: Throwable? = null) : IOException(message, cause)

internal val lenientJson = Json { ignoreUnknownKeys = true; isLenient = true }

private val JSON_TYPE = "application/json".toMediaType()

/** runs an OkHttp call without blocking a thread, cancelling it when the coroutine is cancelled */
suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { runCatching { cancel() } }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (!continuation.isCancelled) continuation.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            continuation.resume(response) { _, _, _ -> response.close() }
        }
    })
}

class InnerTube(
    private val http: OkHttpClient,
    /** the phone's country, used until YouTube says which one the connection is in */
    private val fallbackCountry: () -> String = { Locale.getDefault().country.ifEmpty { "US" } },
    private val clock: () -> Long = System::currentTimeMillis,
) {
    internal data class Session(val visitorData: String, val country: String, val createdAt: Long)

    private val sessionLock = Mutex()
    @Volatile private var session: Session? = null

    /** a fresh visitor id on the next request, e.g. after YouTube stopped answering this one */
    fun resetSession() {
        session = null
    }

    internal suspend fun session(): Session {
        session?.takeIf { clock() - it.createdAt < SESSION_MAX_AGE_MS }?.let { return it }
        return sessionLock.withLock {
            session?.takeIf { clock() - it.createdAt < SESSION_MAX_AGE_MS }
                ?: createSession().also { session = it }
        }
    }

    private suspend fun createSession(): Session {
        val fetched = runCatching {
            val request = Request.Builder().url("https://www.youtube.com/sw.js_data")
                .header("user-agent", ClientProfile.WebRemix.userAgent)
                .header("accept-language", "*")
                .build()
            val text = http.newCall(request).await().use { response ->
                if (!response.isSuccessful) throw YouTubeException("sw.js_data answered ${response.code}", response.code)
                withContext(Dispatchers.IO) { response.body.string() }
            }
            // the answer starts with )]}' to stop it being run as a script
            val data = lenientJson.parseToJsonElement(text.substringAfter("\n", text).removePrefix(")]}'").trim())
            val device = data.at(0, 2, 0, 0)
            val visitor = device.at(13).str()
            if (visitor.isNullOrEmpty()) null else Session(visitor, device.at(1).str()?.ifEmpty { null } ?: fallbackCountry(), clock())
        }.getOrNull()
        // youtubei.js makes up a visitor id when YouTube won't give one; requests still work with it
        return fetched ?: Session(localVisitorData(), fallbackCountry(), clock())
    }

    /**
     * POSTs to youtubei/v1/[endpoint] with the client's context added to [body].
     * Answers with the parsed JSON, or throws [YouTubeException].
     */
    suspend fun call(endpoint: String, body: JsonObject, client: ClientProfile = ClientProfile.WebRemix): JsonElement {
        val session = session()
        val payload = buildJsonObject {
            put("context", context(client, session))
            for ((key, value) in body) put(key, value)
        }
        val request = Request.Builder()
            .url("https://www.youtube.com/youtubei/v1/$endpoint?prettyPrint=false&alt=json")
            .header("accept", "*/*")
            .header("accept-language", "*")
            .header("origin", "https://www.youtube.com")
            .header("user-agent", client.userAgent)
            .header("x-goog-visitor-id", session.visitorData)
            .header("x-youtube-client-name", client.id.toString())
            .header("x-youtube-client-version", client.version)
            .post(payload.toString().toRequestBody(JSON_TYPE))
            .build()
        val text = http.newCall(request).await().use { response ->
            if (!response.isSuccessful) throw YouTubeException("YouTube answered ${response.code} to $endpoint", response.code)
            withContext(Dispatchers.IO) { response.body.string() }
        }
        return withContext(Dispatchers.Default) {
            runCatching { lenientJson.parseToJsonElement(text) }.getOrElse { throw YouTubeException("YouTube's answer to $endpoint wasn't JSON", cause = it) }
        }
    }

    private fun context(client: ClientProfile, session: Session): JsonObject {
        val zone = TimeZone.getDefault()
        return buildJsonObject {
            put("client", buildJsonObject {
                // English, so the words the parsers look for ("Song", "Albums", "Profile") are the ones they know
                put("hl", "en")
                put("gl", session.country)
                put("screenDensityFloat", 1)
                put("screenHeightPoints", 1440)
                put("screenPixelDensity", 1)
                put("screenWidthPoints", 2560)
                put("visitorData", session.visitorData)
                put("clientName", client.name)
                put("clientVersion", client.version)
                put("userAgent", client.contextUserAgent)
                put("clientFormFactor", "UNKNOWN_FORM_FACTOR")
                put("userInterfaceTheme", "USER_INTERFACE_THEME_LIGHT")
                put("timeZone", zone.id)
                put("originalUrl", "https://www.youtube.com")
                put("utcOffsetMinutes", zone.getOffset(clock()) / 60_000)
                put("memoryTotalKbytes", "8000000")
                for ((key, value) in client.fields) put(key, value)
            })
            put("user", buildJsonObject {
                put("enableSafetyMode", false)
                put("lockedSafetyMode", false)
            })
            put("request", buildJsonObject {
                put("useSsl", true)
                put("internalExperimentFlags", buildJsonArray {})
            })
        }
    }

    companion object {
        private const val SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000L

        /** a visitor id made the way youtubei.js makes one: a protobuf of a random id and the time */
        internal fun localVisitorData(random: java.util.Random = java.security.SecureRandom(), nowSeconds: Long = System.currentTimeMillis() / 1000): String {
            val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
            val id = String(CharArray(11) { alphabet[random.nextInt(alphabet.length)] })
            val bytes = java.io.ByteArrayOutputStream()
            bytes.write(0x0A)
            bytes.write(id.length)
            bytes.write(id.toByteArray())
            bytes.write(0x28)
            var value = nowSeconds
            while (value >= 0x80) {
                bytes.write(((value and 0x7F) or 0x80).toInt())
                value = value ushr 7
            }
            bytes.write(value.toInt())
            val base64 = Base64.getEncoder().encodeToString(bytes.toByteArray()).replace('+', '-').replace('/', '_')
            return URLEncoder.encode(base64, "UTF-8")
        }
    }
}

/** a request body from pairs, leaving out the null ones */
internal fun jsonOf(vararg pairs: Pair<String, Any?>): JsonObject = buildJsonObject {
    for ((key, value) in pairs) when (value) {
        null -> Unit
        is String -> put(key, value)
        is Boolean -> put(key, value)
        is Number -> put(key, value)
        is JsonElement -> put(key, value)
        else -> put(key, JsonPrimitive(value.toString()))
    }
}
