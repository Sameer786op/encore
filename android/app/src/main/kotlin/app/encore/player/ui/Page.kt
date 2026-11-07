package app.encore.player.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.encore.player.data.Load
import app.encore.player.data.Problem
import app.encore.player.ui.nav.Tab
import app.encore.player.ui.theme.Vyse
import dev.chrisbanes.haze.hazeSource
import dev.chrisbanes.haze.rememberHazeState

// The frame of every page: a list that runs under the status bar, with a glass bar that fades in
// and takes over the title once the page's own big title has scrolled away.

/**
 * 0 while the page's big title is in view, rising to 1 as it slides under the bar: from its top
 * edge reaching the bar's lower edge to its bottom edge passing it
 */
@Composable
private fun rememberBarProgress(list: LazyListState, titleTop: () -> Float, titleBottom: () -> Float): State<Float> {
    val density = LocalDensity.current
    val status = WindowInsets.statusBars.getTop(density)
    return remember(list, density, status) {
        val fade = with(density) { 32.dp.toPx() }
        // the bar's lower edge, where the title disappears under it
        val barBottom = status + with(density) { 56.dp.toPx() }
        derivedStateOf {
            if (list.firstVisibleItemIndex > 0) 1f
            else {
                // a root page's title starts out inside the bar's height, so there the bar takes
                // over across the first bit of scrolling
                val start = (titleTop() - barBottom).coerceAtLeast(0f)
                val end = maxOf(titleBottom() - barBottom + fade * 0.5f, start + fade)
                ((list.firstVisibleItemScrollOffset - start) / (end - start).coerceAtLeast(1f)).coerceIn(0f, 1f)
            }
        }
    }
}

/**
 * A page. [onBack] adds the back button; [title] shows in the bar once the page's big title, between
 * [titleTop] and [titleBottom] (in pixels from the top of the list), has scrolled under it.
 */
@Composable
fun Page(
    title: String,
    modifier: Modifier = Modifier,
    list: LazyListState = rememberLazyListState(),
    onBack: (() -> Unit)? = null,
    tab: Tab? = null,
    titleBottom: () -> Float = { 0f },
    titleTop: () -> Float = titleBottom,
    actions: @Composable RowScope.() -> Unit = {},
    overlay: @Composable BoxScope.() -> Unit = {},
    content: LazyListScope.() -> Unit,
) {
    val chrome = LocalChrome.current
    val pageHaze = rememberHazeState()
    val progress = rememberBarProgress(list, titleTop, titleBottom)
    val ui = LocalAppUi.current
    if (tab != null) {
        // tapping the open tab again scrolls its first page back to the top
        val taps = ui.nav.reselected[tab] ?: 0
        LaunchedEffect(taps) { if (taps > 0) list.animateScrollToItem(0) }
    }
    Box(modifier.fillMaxSize()) {
        LazyColumn(
            state = list,
            modifier = Modifier.fillMaxSize().hazeSource(pageHaze),
            contentPadding = PaddingValues(bottom = chrome.bottom + 24.dp),
            content = content,
        )
        CompositionLocalProvider(LocalHazeState provides pageHaze) {
            TopBar(title, progress, onBack, actions)
        }
        overlay()
    }
}

@Composable
private fun TopBar(title: String, progress: State<Float>, onBack: (() -> Unit)?, actions: @Composable RowScope.() -> Unit) {
    val colors = Vyse.colors
    // the glass comes in first, frosting the big title as it slides under, and the bar's own title
    // after it, so the two titles never show sharp at once
    Box(Modifier.fillMaxWidth()) {
        Box(
            Modifier
                .matchParentSize()
                .graphicsLayer { alpha = progress.glassAlpha() }
                .glass(RectangleShape, GlassKind.Bar, shadow = false),
        )
        Box(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.statusBars).height(56.dp)) {
            Txt(
                title,
                Vyse.type.title3,
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(horizontal = 72.dp)
                    .graphicsLayer {
                        val named = progress.titleAlpha()
                        alpha = named
                        translationY = (1f - named) * 8.dp.toPx()
                    },
                maxLines = 1,
                align = TextAlign.Center,
            )
            if (onBack != null) {
                Box(Modifier.align(Alignment.CenterStart).padding(start = 8.dp)) {
                    RoundButton(Icons.ArrowLeft, "Back", onBack)
                }
            }
            Row(Modifier.align(Alignment.CenterEnd).padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
        }
        // a hairline under the bar once it's showing
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(0.5.dp)
                .graphicsLayer { alpha = progress.glassAlpha() }
                .drawBehind { drawRect(colors.line) },
        )
    }
}

/** a small round glass button, for over pictures and in bars */
@Composable
fun RoundButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier.size(48.dp).pressable(onClick, pressedScale = 0.9f, label = label), contentAlignment = Alignment.Center) {
        Box(Modifier.size(38.dp).glass(CircleShape, GlassKind.Control, shadow = false), contentAlignment = Alignment.Center) {
            Icon(icon, label, size = 20.dp)
        }
    }
}

/** room for the status bar at the top of a list */
@Composable
fun StatusBarSpace(extra: androidx.compose.ui.unit.Dp = 0.dp) {
    Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
    if (extra > 0.dp) Spacer(Modifier.height(extra))
}

/** a root page's big title */
@Composable
fun BigTitle(text: String, modifier: Modifier = Modifier, trailing: @Composable RowScope.() -> Unit = {}) {
    Row(modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Txt(text, Vyse.type.hero, Modifier.weight(1f), maxLines = 1)
        trailing()
    }
}

/** what a page shows while loading or after failing; nothing once it's ready */
fun <T> LazyListScope.loadState(load: Load<T>, onRetry: () -> Unit, placeholder: @Composable () -> Unit) {
    when (load) {
        is Load.Loading -> item(key = "loading", contentType = "loading") { placeholder() }
        is Load.Failed -> item(key = "failed", contentType = "failed") { ProblemMessage(load.problem, onRetry) }
        is Load.Ready -> Unit
    }
}

@Composable
fun ProblemMessage(problem: Problem, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Message(
        icon = if (problem.offline) Icons.WifiOff else Icons.Alert,
        title = problem.title,
        body = problem.body,
        modifier = modifier,
        action = "Try again",
        onAction = onRetry,
    )
}

@Composable
fun HorizontalSpace(width: androidx.compose.ui.unit.Dp) = Spacer(Modifier.width(width))

/** the bar's glass, in over the first half of the take-over */
private fun State<Float>.glassAlpha() = (value * 2f).coerceAtMost(1f)

/** the bar's title, in over the second half */
private fun State<Float>.titleAlpha() = (value * 2f - 1f).coerceIn(0f, 1f)
