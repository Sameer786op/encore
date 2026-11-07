package app.encore.player.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.encore.player.AppGraph
import app.encore.player.core.PlayContext
import app.encore.player.core.Track
import app.encore.player.core.TrackSource
import app.encore.player.data.PageStore
import app.encore.player.data.SearchModel
import app.encore.player.playback.Notice
import app.encore.player.ui.nav.Navigator
import app.encore.player.ui.nav.Route
import app.encore.player.ui.nav.Tab
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.launch

// What every screen can reach: the player, the pages, the open sheet and the full player.

/** the full-screen player, opened from the mini player and closed by dragging it down */
@Stable
class PlayerSheet(private val scope: CoroutineScope) {
    /** 0 closed, 1 open; read it while drawing where you can */
    var expand by mutableFloatStateOf(0f)
        private set
    /** where it's heading, for the back button */
    var open by mutableStateOf(false)
        private set
    /** the height it travels, set by its layout */
    var travel = 1f
    private var job: Job? = null

    fun show() = settleTo(true, 0f)

    fun hide() = settleTo(false, 0f)

    /** following a finger: positive is downwards */
    fun dragBy(dy: Float) {
        job?.cancel()
        expand = (expand - dy / travel).coerceIn(0f, 1f)
    }

    /** let go: [velocity] in pixels a second, positive downwards */
    fun release(velocity: Float) {
        val opening = when {
            velocity < -900f -> true
            velocity > 900f -> false
            // a quarter of the way commits, either way, as in the players people know
            open -> expand > 0.75f
            else -> expand > 0.25f
        }
        settleTo(opening, -velocity / travel)
    }

    private fun settleTo(opening: Boolean, velocity: Float) {
        job?.cancel()
        open = opening
        val from = expand
        job = scope.launch {
            animate(from, if (opening) 1f else 0f, velocity, spring(dampingRatio = 1f, stiffness = 340f)) { value, _ -> expand = value }
        }
    }
}

sealed interface SheetSpec {
    data class Song(val track: Track, val from: PlayContext? = null) : SheetSpec
    data object Queue : SheetSpec
}

/** one sheet at a time, sliding up from the bottom */
@Stable
class Sheets(private val scope: CoroutineScope) {
    /** what's asked to show; null while hiding */
    var current by mutableStateOf<SheetSpec?>(null)
        private set
    /** what's on screen, which outlives [current] while it slides away */
    var shown by mutableStateOf<SheetSpec?>(null)
        private set
    /** 0 fully up, 1 out of sight below; read it while drawing */
    var offset by mutableFloatStateOf(1f)
        private set
    /** the height the sheet travels, set by its layout */
    var travel = 1f
    private var job: Job? = null

    fun show(spec: SheetSpec) {
        job?.cancel()
        current = spec
        shown = spec
        val from = offset
        job = scope.launch {
            animate(from, 0f, 0f, spring(dampingRatio = 0.92f, stiffness = 520f)) { value, _ -> offset = value }
        }
    }

    fun dismiss(velocity: Float = 0f) {
        if (current == null) return
        job?.cancel()
        current = null
        val from = offset
        job = scope.launch {
            animate(from, 1f, velocity / travel, spring(dampingRatio = 1f, stiffness = 600f)) { value, _ -> offset = value }
            shown = null
        }
    }

    fun dragBy(dy: Float) {
        job?.cancel()
        offset = (offset + dy / travel).coerceIn(0f, 1f)
    }

    fun release(velocity: Float) {
        if (velocity > 1100f || offset > 0.35f) dismiss(velocity)
        else {
            val from = offset
            job = scope.launch {
                animate(from, 0f, -velocity / travel, spring(dampingRatio = 0.92f, stiffness = 520f)) { value, _ -> offset = value }
            }
        }
    }
}

/** room the floating chrome takes at the bottom, for the end of every list */
@Immutable
data class Chrome(val bottom: Dp = 0.dp)

val LocalChrome = staticCompositionLocalOf { Chrome() }

/** the playing song's id, for rows to mark it */
val LocalNowPlaying = staticCompositionLocalOf<State<String?>> { mutableStateOf(null) }

/** sound is coming out, for the bars on the playing row */
val LocalIsPlaying = staticCompositionLocalOf<State<Boolean>> { mutableStateOf(false) }

@Stable
class AppUi(
    val graph: AppGraph,
    val pages: PageStore,
    val search: SearchModel,
    val nav: Navigator,
    val player: PlayerSheet,
    val sheets: Sheets,
    private val context: Context,
) {
    val playback get() = graph.playback
    val settings get() = graph.settings

    private val localNotices = MutableSharedFlow<Notice>(extraBufferCapacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val notices: kotlinx.coroutines.flow.Flow<Notice> = merge(graph.playback.notices, localNotices.asSharedFlow())

    fun toast(text: String, error: Boolean = false) {
        localNotices.tryEmit(Notice(text, error))
    }

    fun open(route: Route) {
        sheets.dismiss()
        if (player.open) player.hide()
        nav.push(route)
    }

    fun openAlbum(id: String) = open(Route.Album(id))
    fun openArtist(id: String) = open(Route.Artist(id))
    fun openPlaylist(id: String) = open(Route.Playlist(id))

    fun goTo(tab: Tab) {
        sheets.dismiss()
        if (player.open) player.hide()
        nav.select(tab)
    }

    fun songMenu(track: Track, from: PlayContext? = null) = sheets.show(SheetSpec.Song(track, from))

    fun showQueue() = sheets.show(SheetSpec.Queue)

    fun play(tracks: List<Track>, index: Int = 0, context: PlayContext? = null) = playback.play(tracks, index, context)

    fun playNext(track: Track) {
        playback.playNext(listOf(track))
        toast("Playing next")
    }

    fun addToQueue(track: Track) {
        playback.addToQueue(listOf(track))
        toast("Added to queue")
    }

    fun share(track: Track) {
        if (track.source != TrackSource.YouTube) return
        val link = "https://music.youtube.com/watch?v=${track.sourceId}"
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, track.title)
            putExtra(Intent.EXTRA_TEXT, "${track.title} by ${track.artistNames}\n$link")
        }
        try {
            context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            toast("No app to share with", error = true)
        }
    }
}

val LocalAppUi = staticCompositionLocalOf<AppUi> { error("the app's UI state isn't provided") }

