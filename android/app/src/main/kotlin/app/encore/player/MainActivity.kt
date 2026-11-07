package app.encore.player

import android.content.ComponentName
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableIntStateOf
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.encore.player.playback.PlaybackService
import app.encore.player.ui.VyseRoot
import com.google.common.util.concurrent.ListenableFuture

@UnstableApi
class MainActivity : ComponentActivity() {
    private var controller: ListenableFuture<MediaController>? = null
    /** counts requests to open the full player */
    private val openPlayer = mutableIntStateOf(0)
    private var dark: Boolean? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        applyBars(graph().settings.theme.value != ThemeMode.Moss)
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null && intent?.action == ACTION_OPEN_PLAYER) openPlayer.intValue++
        setContent {
            VyseRoot(graph(), openPlayer) { applyBars(it) }
        }
    }

    private fun graph() = (application as VyseApp).graph

    /** the bars' icons follow the look: light on Ember, dark on Moss */
    private fun applyBars(isDark: Boolean, force: Boolean = false) {
        if (!force && dark == isDark) return
        dark = isDark
        val style = if (isDark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
        window.setBackgroundDrawable(ColorDrawable(if (isDark) 0xFF030303.toInt() else 0xFFE6E6E1.toInt()))
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // turning the phone puts the bars' icons back to the theme's colours, so set them again
        // once the turn has settled
        window.decorView.post { dark?.let { applyBars(it, force = true) } }
    }

    override fun onStart() {
        super.onStart()
        // connecting starts the player service, so a tap on play has a player to go to
        controller = MediaController.Builder(this, SessionToken(this, ComponentName(this, PlaybackService::class.java))).buildAsync()
    }

    override fun onStop() {
        controller?.let { MediaController.releaseFuture(it) }
        controller = null
        super.onStop()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_OPEN_PLAYER) openPlayer.intValue++
    }

    companion object {
        const val ACTION_OPEN_PLAYER = "app.encore.player.OPEN_PLAYER"
    }
}
