package app.encore.player.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import app.encore.player.AppGraph
import app.encore.player.ThemeMode
import app.encore.player.core.QueueItem
import app.encore.player.ui.nav.Entry
import app.encore.player.ui.nav.NavHost
import app.encore.player.ui.nav.Navigator
import app.encore.player.ui.nav.Route
import app.encore.player.ui.nav.Tab
import app.encore.player.ui.player.MiniPlayer
import app.encore.player.ui.player.NowPlaying
import app.encore.player.ui.screens.AlbumScreen
import app.encore.player.ui.screens.ArtistScreen
import app.encore.player.ui.screens.HomeScreen
import app.encore.player.ui.screens.LibraryScreen
import app.encore.player.ui.screens.PlaylistScreen
import app.encore.player.ui.screens.SearchScreen
import app.encore.player.ui.screens.YouScreen
import app.encore.player.ui.theme.VyseTheme
import dev.chrisbanes.haze.hazeSource
import dev.chrisbanes.haze.rememberHazeState

// The whole app on one screen: the backdrop and pages, the glass tabs with the mini player over
// them, and the full player and sheets over everything.

/** [openPlayer] counts requests to open the full player, such as a tap on the notification */
@Composable
fun VyseRoot(graph: AppGraph, openPlayer: State<Int>, onDark: (Boolean) -> Unit) {
    val theme by graph.settings.theme.collectAsState()
    val accent by graph.settings.accent.collectAsState()
    val dark = when (theme) {
        ThemeMode.System -> isSystemInDarkTheme()
        ThemeMode.Ember -> true
        ThemeMode.Moss -> false
    }
    SideEffect { onDark(dark) }
    VyseTheme(dark, accent) { Shell(graph, openPlayer) }
}

@Composable
private fun Screen(entry: Entry) {
    when (val route = entry.route) {
        Route.Home -> HomeScreen()
        Route.Search -> SearchScreen()
        Route.Library -> LibraryScreen()
        Route.You -> YouScreen()
        is Route.Album -> AlbumScreen(route.id)
        is Route.Artist -> ArtistScreen(route.id)
        is Route.Playlist -> PlaylistScreen(route.id)
    }
}

@Composable
private fun Shell(graph: AppGraph, openPlayer: State<Int>) {
    val scope = rememberCoroutineScope()
    val nav = rememberSaveable(saver = Navigator.saver(scope)) { Navigator(scope) }
    val player = remember { PlayerSheet(scope) }
    val sheets = remember { Sheets(scope) }
    val context = LocalContext.current.applicationContext
    val ui = remember { AppUi(graph, graph.pages, graph.search, nav, player, sheets, context) }
    val queue by graph.playback.queue.collectAsState()
    val status by graph.playback.status.collectAsState()
    val current = queue.current
    val nowPlaying = rememberUpdatedState(current?.track?.id)
    val isPlaying = rememberUpdatedState(status.playing)
    val look = rememberCoverLook(current?.track?.artwork)
    val haze = rememberHazeState()
    val backdrop = rememberGraphicsLayer()
    val density = LocalDensity.current

    // the mini player stays on screen with the last song while it slides away
    val lastItem = remember { mutableStateOf<QueueItem?>(null) }
    if (current != null) SideEffect { lastItem.value = current }
    val miniItem = current ?: lastItem.value

    val navBottom = with(density) { WindowInsets.navigationBars.getBottom(density).toDp() }
    val chromeBottom = navBottom + TAB_BAR_HEIGHT.dp + if (current != null) 72.dp else 0.dp

    LaunchedEffect(openPlayer.value) {
        if (openPlayer.value > 0) {
            graph.playback.awaitRestored()
            if (graph.playback.queue.value.current != null) player.show()
        }
    }

    // back: a page slides away with the gesture; on a tab's first page, back goes Home first
    PredictiveBackHandler(enabled = nav.canGoBack) { events -> nav.back(events) }
    BackHandler(enabled = !nav.canGoBack && nav.tab != Tab.Home) { nav.select(Tab.Home) }

    CompositionLocalProvider(
        LocalAppUi provides ui,
        LocalNowPlaying provides nowPlaying,
        LocalIsPlaying provides isPlaying,
        LocalChrome provides Chrome(chromeBottom),
        LocalHazeState provides haze,
        LocalBackdropLayer provides backdrop,
    ) {
        Box(Modifier.fillMaxSize().onSizeChanged { player.travel = it.height.toFloat().coerceAtLeast(1f) }) {
            Box(Modifier.fillMaxSize().hazeSource(haze)) {
                Backdrop(look?.tint, layer = backdrop)
                NavHost(nav) { entry -> Screen(entry) }
            }
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .graphicsLayer {
                        translationY = player.expand * size.height
                        alpha = (1f - player.expand * 1.4f).coerceIn(0f, 1f)
                    },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                AnimatedVisibility(
                    visible = current != null,
                    enter = slideInVertically(spring(dampingRatio = 0.8f, stiffness = 420f)) { it } + fadeIn(),
                    exit = slideOutVertically { it } + fadeOut(),
                ) {
                    if (miniItem != null) {
                        MiniPlayer(miniItem, status, Modifier.widthIn(max = 640.dp).padding(horizontal = 10.dp).padding(bottom = 10.dp))
                    }
                }
                BottomBar()
            }
            ToastHost(bottom = chromeBottom, Modifier.align(Alignment.BottomCenter))
            NowPlaying()
            SheetHost()
        }
    }
}
