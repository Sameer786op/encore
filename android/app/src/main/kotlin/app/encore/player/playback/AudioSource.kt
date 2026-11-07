package app.encore.player.playback

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.okhttp.OkHttpDataSource
import app.encore.player.core.Track
import app.encore.player.core.TrackSource
import app.encore.player.youtube.AudioStream
import app.encore.player.youtube.StreamUnavailableException
import app.encore.player.youtube.Streams
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import java.io.IOException
import java.io.InterruptedIOException

// How the player gets a song's sound. A queue item's address is vyse://yt/<videoId>; the link
// to the actual file is looked up only when the player opens it, so links are always fresh, and
// the file is fetched a few megabytes at a time, each range a request of its own, as YouTube's
// own apps do.

const val YOUTUBE_SCHEME = "vyse"
private const val YOUTUBE_HOST = "yt"

/** the address the player is given for a song */
fun Track.playUri(): Uri = when (source) {
    TrackSource.YouTube -> Uri.Builder().scheme(YOUTUBE_SCHEME).authority(YOUTUBE_HOST).appendPath(sourceId).build()
    TrackSource.Local -> Uri.parse(sourceId)
}

/** YouTube had no audio for the song; `unplayable` when it said the video itself can't be played */
class SongUnavailableException(message: String?, val unplayable: Boolean) : IOException(message)

@UnstableApi
class AudioDataSourceFactory(context: Context, private val streams: Streams, http: OkHttpClient) : DataSource.Factory {
    private val app = context.applicationContext
    private val upstream = OkHttpDataSource.Factory(http)

    override fun createDataSource(): DataSource = RoutingDataSource(YouTubeDataSource(streams, upstream), DefaultDataSource.Factory(app, upstream).createDataSource())
}

/** YouTube songs through the resolver, anything else (files on the phone, later) the usual way */
@UnstableApi
private class RoutingDataSource(private val youtube: DataSource, private val other: DataSource) : DataSource {
    private var active: DataSource? = null

    override fun addTransferListener(transferListener: TransferListener) {
        youtube.addTransferListener(transferListener)
        other.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        val source = if (dataSpec.uri.scheme == YOUTUBE_SCHEME) youtube else other
        active = source
        return source.open(dataSpec)
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = active!!.read(buffer, offset, length)

    override fun getUri(): Uri? = active?.uri

    override fun getResponseHeaders(): Map<String, List<String>> = active?.responseHeaders ?: emptyMap()

    override fun close() {
        try {
            active?.close()
        } finally {
            active = null
        }
    }
}

@UnstableApi
private class YouTubeDataSource(
    private val streams: Streams,
    private val upstreamFactory: OkHttpDataSource.Factory,
) : BaseDataSource(/* isNetwork = */ true) {
    private var spec: DataSpec? = null
    private var videoId = ""
    private var stream: AudioStream? = null
    private var upstream: DataSource? = null
    /** the next byte to hand over, in the whole file */
    private var position = 0L
    /** where this read ends, exclusive */
    private var end = 0L
    /** where the open range ends, exclusive */
    private var chunkEnd = 0L
    private var opened = false

    override fun open(dataSpec: DataSpec): Long {
        spec = dataSpec
        videoId = dataSpec.uri.lastPathSegment ?: throw DataSourceException(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS)
        transferInitializing(dataSpec)
        val found = resolve(fresh = false)
        if (dataSpec.position > found.contentLength) throw DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
        stream = found
        position = dataSpec.position
        end = if (dataSpec.length != C.LENGTH_UNSET.toLong()) minOf(found.contentLength, position + dataSpec.length) else found.contentLength
        if (position < end) openRange(mayRefresh = true)
        opened = true
        transferStarted(dataSpec)
        return end - position
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        while (true) {
            if (position >= end) return C.RESULT_END_OF_INPUT
            if (upstream == null || position >= chunkEnd) {
                closeUpstream()
                openRange(mayRefresh = true)
            }
            val source = upstream!!
            val read = source.read(buffer, offset, minOf(length.toLong(), chunkEnd - position).toInt())
            if (read == C.RESULT_END_OF_INPUT) {
                // the range closed before all of it came: the player retries from here
                if (position < chunkEnd) throw IOException("The connection to YouTube ended early")
                continue
            }
            position += read
            bytesTransferred(read)
            return read
        }
    }

    override fun getUri(): Uri? = spec?.uri

    override fun getResponseHeaders(): Map<String, List<String>> = upstream?.responseHeaders ?: emptyMap()

    override fun close() {
        try {
            closeUpstream()
        } finally {
            spec = null
            if (opened) {
                opened = false
                transferEnded()
            }
        }
    }

    private fun closeUpstream() {
        val source = upstream ?: return
        upstream = null
        source.close()
    }

    private fun openRange(mayRefresh: Boolean) {
        val current = stream!!
        val length = minOf(RANGE_BYTES, end - position)
        val range = DataSpec.Builder()
            .setUri(current.url)
            .setPosition(position)
            .setLength(length)
            .setHttpRequestHeaders(mapOf("User-Agent" to current.userAgent))
            .build()
        val source = upstreamFactory.createDataSource()
        try {
            source.open(range)
        } catch (e: HttpDataSource.InvalidResponseCodeException) {
            runCatching { source.close() }
            // a link YouTube stopped honouring: ask for a new one once
            if (mayRefresh && (e.responseCode == 403 || e.responseCode == 410)) {
                val fresh = resolve(fresh = true)
                if (fresh.contentLength != current.contentLength || fresh.mimeType != current.mimeType) {
                    // a different file than the one being played; starting over is the only way
                    if (position > 0) throw SongUnavailableException("The song's audio changed while it played", unplayable = false)
                    end = fresh.contentLength
                }
                stream = fresh
                openRange(mayRefresh = false)
                return
            }
            throw e
        } catch (e: IOException) {
            runCatching { source.close() }
            throw e
        }
        upstream = source
        chunkEnd = position + length
    }

    private fun resolve(fresh: Boolean): AudioStream = try {
        runBlocking { streams.resolve(videoId, fresh) }
    } catch (e: StreamUnavailableException) {
        throw SongUnavailableException(e.message, e.unplayable)
    } catch (e: InterruptedException) {
        throw InterruptedIOException("Stopped looking up the song")
    }

    private companion object {
        /** each request asks for at most this much */
        const val RANGE_BYTES = 4L * 1024 * 1024
    }
}
