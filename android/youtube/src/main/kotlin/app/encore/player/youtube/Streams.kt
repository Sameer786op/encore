package app.encore.player.youtube

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

// Finding a song's audio, after the desktop app's `youtube/streams.ts`. YouTube's Vision Pro
// app gets plain links to whole Opus files that need no player script; the iPhone app's AAC
// links are the fallback. A link is only used once a range from the middle of the file has
// answered, because some links serve the start of a song and then stop.

data class AudioStream(
    /** a plain file link, fetched a range at a time */
    val url: String,
    val mimeType: String,
    val contentLength: Long,
    /** when YouTube stops honouring the link, in epoch milliseconds */
    val expiresAt: Long,
    /** how loud YouTube measured the song, for volume levelling */
    val loudnessDb: Double?,
    /** which YouTube app the link was made for; fetch it with that app's user agent */
    val client: String,
    val userAgent: String,
    /** "opus" or "mp4a.40.2" */
    val codec: String,
    /** average bits per second */
    val bitrate: Long,
    val sampleRate: Int,
)

class StreamUnavailableException(message: String, /** YouTube said the video itself can't play */ val unplayable: Boolean) : Exception(message)

private class UnplayableException(message: String) : Exception(message)

private val CODECS = Regex("codecs=\"([^\"]+)\"")

class Streams(
    private val api: InnerTube,
    private val http: OkHttpClient,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    // Clients tried in order. VISIONOS serves whole files without a proof-of-origin token; the
    // iPhone client is the fallback, used only when its link passes the whole-file check.
    private val clients = listOf(ClientProfile.VisionOs, ClientProfile.Ios)

    private val cache = ConcurrentHashMap<String, AudioStream>()
    private val inFlight = ConcurrentHashMap<String, Deferred<AudioStream>>()

    // lookups outlive whoever asked first: skipping a song doesn't cancel the prefetch waiting on the same lookup
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** a song's audio, from the cache while its link has more than ten minutes left */
    suspend fun resolve(videoId: String, fresh: Boolean = false): AudioStream {
        if (fresh) cache.remove(videoId)
        cache[videoId]?.let { cached -> if (cached.expiresAt - clock() > EXPIRY_MARGIN_MS) return cached }
        val lookup = inFlight.computeIfAbsent(videoId) { id ->
            // started only once it's in the map, so finishing can't race ahead of being stored
            scope.async(start = CoroutineStart.LAZY) { resolveFresh(id).also { cache[id] = it } }
                .also { deferred -> deferred.invokeOnCompletion { inFlight.remove(id, deferred) } }
        }
        lookup.start()
        return lookup.await()
    }

    /** the cached link, if it is still good; for knowing a song is ready without asking YouTube */
    fun cached(videoId: String): AudioStream? = cache[videoId]?.takeIf { it.expiresAt - clock() > EXPIRY_MARGIN_MS }

    fun forget(videoId: String) {
        cache.remove(videoId)
    }

    private suspend fun resolveFresh(videoId: String): AudioStream {
        val failures = mutableListOf<String>()
        var videoIsUnplayable = false
        // a failure to reach YouTube at all says nothing about the song: the player waits for the connection instead of skipping
        var unreachable: IOException? = null
        var reachedYouTube = false
        for (client in clients) {
            try {
                resolveWithClient(videoId, client)?.let { return it }
                reachedYouTube = true
                failures += "${client.name}: no usable audio"
            } catch (e: CancellationException) {
                throw e
            } catch (e: UnplayableException) {
                reachedYouTube = true
                videoIsUnplayable = true
                failures += "${client.name}: ${e.message}"
            } catch (e: YouTubeException) {
                reachedYouTube = true
                failures += "${client.name}: ${e.message?.lineSequence()?.firstOrNull()}"
            } catch (e: IOException) {
                unreachable = e
                failures += "${client.name}: ${e.message?.lineSequence()?.firstOrNull()}"
            } catch (e: Exception) {
                reachedYouTube = true
                failures += "${client.name}: ${e.message?.lineSequence()?.firstOrNull()}"
            }
        }
        unreachable?.let { if (!reachedYouTube) throw it }
        // when YouTube didn't even say the video is gone, the session itself may be stale
        if (!videoIsUnplayable) api.resetSession()
        throw StreamUnavailableException("No playable audio for $videoId (${failures.joinToString("; ")})", videoIsUnplayable)
    }

    private suspend fun resolveWithClient(videoId: String, client: ClientProfile): AudioStream? {
        val answer = parsePlayer(
            api.call(
                "player",
                jsonOf(
                    "videoId" to videoId,
                    "racyCheckOk" to true,
                    "contentCheckOk" to true,
                    "playbackContext" to jsonOf("contentPlaybackContext" to jsonOf("vis" to 0, "splay" to false, "lactMilliseconds" to "-1")),
                ),
                client,
            ),
        )
        if (answer.status != null && answer.status != "OK") throw UnplayableException("${answer.status}: ${answer.reason ?: "unavailable"}")
        val format = pickAudioFormat(answer.formats) ?: return null
        val url = format.url ?: return null
        val total = servesWholeFile(url, format.contentLength, client.userAgent) ?: return null
        return AudioStream(
            url = url,
            mimeType = format.mimeType.substringBefore(";").trim(),
            contentLength = total,
            expiresAt = clock() + (answer.expiresInSeconds ?: (5 * 60 * 60L)) * 1000,
            loudnessDb = format.loudnessDb ?: answer.loudnessDb,
            client = client.name,
            userAgent = client.userAgent,
            codec = CODECS.find(format.mimeType)?.groupValues?.get(1) ?: format.mimeType.substringBefore(";").trim(),
            bitrate = format.averageBitrate ?: format.bitrate,
            sampleRate = format.sampleRate,
        )
    }

    /** a link that only answers the first chunk is useless, so a range from the middle is checked too */
    private suspend fun servesWholeFile(url: String, knownLength: Long?, userAgent: String): Long? {
        var total = knownLength ?: 0L
        if (total <= 0) {
            total = rangeRequest(url, 0, 1, userAgent)?.let { contentRange -> contentRange.substringAfter("/").toLongOrNull() } ?: return null
            if (total <= 0) return null
        }
        val middle = total / 2
        return if (rangeRequest(url, middle, middle + 1, userAgent) != null) total else null
    }

    /** the Content-Range of a 206 answer, or null when the range wasn't served */
    private suspend fun rangeRequest(url: String, start: Long, end: Long, userAgent: String): String? {
        val request = Request.Builder().url(url).header("range", "bytes=$start-$end").header("user-agent", userAgent).build()
        return http.newCall(request).await().use { response -> if (response.code == 206) response.header("content-range") ?: "" else null }
    }

    companion object {
        /** refresh a cached link this long before YouTube says it expires */
        const val EXPIRY_MARGIN_MS = 10 * 60_000L
    }
}
