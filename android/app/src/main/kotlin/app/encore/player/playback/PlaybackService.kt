package app.encore.player.playback

import android.app.PendingIntent
import android.content.Intent
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import app.encore.player.MainActivity
import app.encore.player.R
import app.encore.player.VyseApp
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import kotlinx.coroutines.launch

/**
 * Plays in the background, with the notification, lock-screen, Bluetooth and headphone
 * controls. The player lives here; the queue and its rules live in [Playback].
 */
@UnstableApi
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val graph = (application as VyseApp).graph
        val exo = ExoPlayer.Builder(this)
            .setMediaSourceFactory(
                DefaultMediaSourceFactory(graph.audioSources).setLoadErrorHandlingPolicy(PlaybackErrorPolicy(graph.connectivity)),
            )
            // pauses for calls, ducks under navigation, pauses when headphones come out
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setLoadControl(
                // load well ahead: a whole song comes in a few requests and the radio can sleep in between,
                // and a drop in the connection goes unheard for minutes
                DefaultLoadControl.Builder()
                    .setBufferDurationsMs(60_000, 600_000, 1_500, 3_000)
                    .setTargetBufferBytes(16 * 1024 * 1024)
                    .setPrioritizeTimeOverSizeThresholds(true)
                    .build(),
            )
            .setUsePlatformDiagnostics(false)
            .build()

        val player = SessionPlayer(exo, graph.playback)
        session = MediaSession.Builder(this, player)
            .setSessionActivity(openPlayer())
            .setCallback(Callback())
            .build()
        setMediaNotificationProvider(DefaultMediaNotificationProvider.Builder(this).build().apply { setSmallIcon(R.drawable.ic_notification) })
        graph.playback.attach(exo)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        // swiping the app away keeps the music going; with nothing playing the service goes too
        if (!isPlaybackOngoing) pauseAllPlayersAndStopSelf()
    }

    override fun onDestroy() {
        session?.let { current ->
            (application as VyseApp).graph.playback.detach()
            current.player.release()
            current.release()
        }
        session = null
        super.onDestroy()
    }

    /** tapping the notification opens the app on the player */
    private fun openPlayer(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).setAction(MainActivity.ACTION_OPEN_PLAYER).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private inner class Callback : MediaSession.Callback {
        // pressing play on headphones or the system's media controls after the app was closed
        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            isForPlayback: Boolean,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val answer = SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
            val playback = (application as VyseApp).graph.playback
            lifecycleScope.launch {
                playback.awaitRestored()
                val items = playback.resumption()
                if (items != null) answer.set(items) else answer.setException(UnsupportedOperationException("Nothing to carry on with"))
            }
            return answer
        }
    }
}
