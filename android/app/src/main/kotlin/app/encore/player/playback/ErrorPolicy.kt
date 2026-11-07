package app.encore.player.playback

import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/**
 * When to try a song's audio again. With no connection the player keeps trying, slowly, and
 * carries on by itself once the phone is back online; a song YouTube won't play fails at once,
 * so the queue moves on.
 */
@UnstableApi
class PlaybackErrorPolicy(private val connectivity: Connectivity) : DefaultLoadErrorHandlingPolicy() {
    override fun getRetryDelayMsFor(info: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
        val error = info.exception
        val unavailable = error.causes().filterIsInstance<SongUnavailableException>().firstOrNull()
        if (unavailable != null) return if (unavailable.unplayable || info.errorCount > 2) C.TIME_UNSET else 1_000L * info.errorCount
        if (error.isConnectionProblem()) {
            // offline: wait as long as it takes; online but YouTube unreachable: give up after a few tries
            if (!connectivity.isOnline) return minOf(1_000L * info.errorCount, 5_000L)
            return if (info.errorCount > 6) C.TIME_UNSET else minOf(1_000L * info.errorCount, 5_000L)
        }
        if (info.errorCount > 3) return C.TIME_UNSET
        return super.getRetryDelayMsFor(info)
    }

    // the retry delay above decides when to give up, so the player never stops on its own count
    override fun getMinimumLoadableRetryCount(dataType: Int): Int = Int.MAX_VALUE - 1
}

internal fun Throwable.causes(): Sequence<Throwable> = generateSequence(this) { it.cause.takeIf { cause -> cause !== it } }

// the player wraps these, so the whole chain of causes is checked
internal fun Throwable.isConnectionProblem(): Boolean = causes().any { e ->
    e is UnknownHostException || e is ConnectException || e is NoRouteToHostException || e is SocketException ||
        e is SSLException || e is InterruptedIOException
}
