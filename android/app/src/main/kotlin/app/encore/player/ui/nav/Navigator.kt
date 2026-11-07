package app.encore.player.ui.nav

import androidx.activity.BackEventCompat
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.unit.dp
import app.encore.player.ui.LocalBackdropLayer
import app.encore.player.ui.theme.Motion
import app.encore.player.ui.theme.Vyse
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

// Four tabs, each with its own stack of pages, as phone music apps do. A new page slides in over
// the last one like a card; going back slides it away, following the finger on the back gesture.

sealed interface Route {
    data object Home : Route
    data object Search : Route
    data object Library : Route
    data object You : Route
    data class Album(val id: String) : Route
    data class Artist(val id: String) : Route
    data class Playlist(val id: String) : Route

    fun encode(): String = when (this) {
        Home -> "home"
        Search -> "search"
        Library -> "library"
        You -> "you"
        is Album -> "album:$id"
        is Artist -> "artist:$id"
        is Playlist -> "playlist:$id"
    }

    companion object {
        fun decode(text: String): Route? {
            val kind = text.substringBefore(':')
            val id = text.substringAfter(':', "")
            return when (kind) {
                "home" -> Home
                "search" -> Search
                "library" -> Library
                "you" -> You
                "album" -> Album(id).takeIf { id.isNotEmpty() }
                "artist" -> Artist(id).takeIf { id.isNotEmpty() }
                "playlist" -> Playlist(id).takeIf { id.isNotEmpty() }
                else -> null
            }
        }
    }
}

enum class Tab(val label: String, val root: Route) {
    Home("Home", Route.Home),
    Search("Search", Route.Search),
    Library("Library", Route.Library),
    You("You", Route.You),
}

/** a page in a stack; the key keeps its scroll position and other remembered state */
@Immutable
data class Entry(val key: String, val route: Route)

private var keyCounter = 0L
private val keyPrefix = System.currentTimeMillis().toString(36)

private fun newKey() = "p$keyPrefix-${keyCounter++}"

@Stable
class Navigator(private val scope: CoroutineScope, saved: List<String>? = null) {
    var tab by mutableStateOf(Tab.Home)
        private set
    private val stacks: Map<Tab, SnapshotStateList<Entry>> = Tab.entries.associateWith { mutableStateListOf<Entry>() }

    /** the open tab's pages, bottom first */
    val stack: List<Entry> get() = stacks.getValue(tab)

    /** how far the top page has slid in, 0 to 1; read it only while drawing */
    var slide by mutableFloatStateOf(1f)
        private set
    /** a page is sliding in or out, so the one under it shows */
    var sliding by mutableStateOf(false)
        private set
    /** counts taps on the tab that's already open, so its first page can scroll to the top */
    val reselected = mutableStateMapOf<Tab, Int>()

    internal var onRemoved: (String) -> Unit = {}
    private var job: Job? = null
    private var finishing: (() -> Unit)? = null

    init {
        if (saved != null && saved.isNotEmpty()) {
            tab = Tab.entries.firstOrNull { it.name == saved.first() } ?: Tab.Home
            for (line in saved.drop(1)) {
                val parts = line.split('|', limit = 3)
                if (parts.size != 3) continue
                val stackTab = Tab.entries.firstOrNull { it.name == parts[0] } ?: continue
                val route = Route.decode(parts[2]) ?: continue
                stacks.getValue(stackTab).add(Entry(parts[1], route))
            }
        }
        for ((stackTab, list) in stacks) {
            if (list.isEmpty() || list.first().route != stackTab.root) list.add(0, Entry(newKey(), stackTab.root))
        }
    }

    val canGoBack: Boolean get() = stack.size > 1

    fun push(route: Route) {
        settle()
        val list = stacks.getValue(tab)
        if (list.last().route == route) return
        list.add(Entry(newKey(), route))
        sliding = true
        slide = 0f
        job = scope.launch {
            animate(0f, 1f, animationSpec = Motion.gentle()) { value, _ -> slide = value }
            sliding = false
            job = null
        }
    }

    fun pop(): Boolean {
        settle()
        val list = stacks.getValue(tab)
        if (list.size <= 1) return false
        slideAway(list.last(), velocity = 0f)
        return true
    }

    /** the back gesture: the page follows the finger, then goes or comes back */
    suspend fun back(events: Flow<BackEventCompat>) {
        settle()
        val list = stacks.getValue(tab)
        if (list.size <= 1) return
        val top = list.last()
        sliding = true
        try {
            events.collect { event -> slide = 1f - event.progress * 0.92f }
            slideAway(top, velocity = 0f)
        } catch (e: CancellationException) {
            val from = slide
            job = scope.launch {
                animate(from, 1f, animationSpec = Motion.snappy()) { value, _ -> slide = value }
                sliding = false
                job = null
            }
            throw e
        }
    }

    private fun slideAway(entry: Entry, velocity: Float) {
        sliding = true
        val from = slide
        finishing = { remove(entry) }
        job = scope.launch {
            animate(from, 0f, velocity, animationSpec = spring(dampingRatio = 1f, stiffness = 520f)) { value, _ -> slide = value }
            finishing = null
            remove(entry)
            slide = 1f
            sliding = false
            job = null
        }
    }

    private fun remove(entry: Entry) {
        for (list in stacks.values) {
            if (list.remove(entry)) {
                onRemoved(entry.key)
                return
            }
        }
    }

    /** finishes whatever is moving at once, so the next move starts from a still screen */
    private fun settle() {
        job?.cancel()
        job = null
        finishing?.let {
            finishing = null
            it()
        }
        slide = 1f
        sliding = false
    }

    fun select(next: Tab) {
        settle()
        if (next == tab) {
            val list = stacks.getValue(next)
            if (list.size > 1) {
                val gone = list.subList(1, list.size).toList()
                list.removeRange(1, list.size)
                gone.forEach { onRemoved(it.key) }
            } else {
                reselected[next] = (reselected[next] ?: 0) + 1
            }
            return
        }
        tab = next
    }

    fun save(): List<String> = listOf(tab.name) + Tab.entries.flatMap { t ->
        stacks.getValue(t).map { "${t.name}|${it.key}|${it.route.encode()}" }
    }

    companion object {
        fun saver(scope: CoroutineScope) = Saver<Navigator, List<String>>(
            save = { it.save() },
            restore = { Navigator(scope, it) },
        )
    }
}

/**
 * Shows the open tab's top page, and the one under it while a page slides. Each page keeps its
 * remembered state (scroll position included) for as long as it's in a stack.
 */
@Composable
fun NavHost(nav: Navigator, modifier: Modifier = Modifier, content: @Composable (Entry) -> Unit) {
    val holder = rememberSaveableStateHolder()
    DisposableEffect(nav, holder) {
        nav.onRemoved = { holder.removeState(it) }
        onDispose { nav.onRemoved = {} }
    }
    val colors = Vyse.colors
    val backdrop = LocalBackdropLayer.current
    val reduce = Vyse.reduceMotion
    val stack = nav.stack
    val top = stack.last()
    val under = if (nav.sliding) stack.getOrNull(stack.lastIndex - 1) else null
    val visible = if (under != null) listOf(under, top) else listOf(top)

    // a quick fade when changing tabs
    val tabFade = remember { Animatable(1f) }
    var shownTab by remember { mutableStateOf(nav.tab) }
    LaunchedEffect(nav.tab) {
        if (shownTab != nav.tab) {
            shownTab = nav.tab
            if (!reduce) {
                tabFade.snapTo(0f)
                tabFade.animateTo(1f, tween(240, easing = Motion.EaseOutExpo))
            }
        }
    }

    Box(modifier.fillMaxSize().graphicsLayer {
        alpha = tabFade.value
        translationY = (1f - tabFade.value) * 10.dp.toPx()
    }) {
        for (entry in visible) {
            key(entry.key) {
                val isTop = entry == top && under != null
                val isUnder = entry == under
                Box(
                    Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            if (isTop) translationX = (1f - nav.slide) * size.width
                            else if (isUnder) translationX = -0.3f * nav.slide * size.width
                        }
                        .then(
                            if (isTop) Modifier.drawBehind {
                                val dx = (1f - nav.slide) * size.width
                                // the edge of the incoming page throws a soft shadow on the one under it
                                val shadow = 28.dp.toPx()
                                drawRect(
                                    Brush.horizontalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = if (colors.dark) 0.5f else 0.14f)), startX = -shadow, endX = 0f),
                                    topLeft = Offset(-shadow, 0f),
                                    size = Size(shadow, size.height),
                                )
                                // and carries its own copy of the window behind, held still, cut to
                                // its own bounds so the page under it stays in view
                                clipRect(0f, 0f, size.width, size.height) {
                                    if (backdrop != null) translate(left = -dx) { drawLayer(backdrop) } else drawRect(colors.bg)
                                }
                            } else if (isUnder) Modifier.drawWithContent {
                                drawContent()
                                drawRect(Color.Black, alpha = nav.slide * if (colors.dark) 0.45f else 0.12f)
                            } else Modifier,
                        ),
                ) {
                    holder.SaveableStateProvider(entry.key) { content(entry) }
                }
            }
        }
    }
}
