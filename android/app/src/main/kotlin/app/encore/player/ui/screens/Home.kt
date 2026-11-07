package app.encore.player.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyHorizontalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import app.encore.player.core.HomeSection
import app.encore.player.core.PlayContext
import app.encore.player.data.Load
import app.encore.player.ui.AlbumCard
import app.encore.player.ui.ArtistCard
import app.encore.player.ui.BigTitle
import app.encore.player.ui.Carousel
import app.encore.player.ui.CarouselPlaceholder
import app.encore.player.ui.LocalAppUi
import app.encore.player.ui.Page
import app.encore.player.ui.PlaylistCard
import app.encore.player.ui.ProblemMessage
import app.encore.player.ui.SectionTitle
import app.encore.player.ui.Spinner
import app.encore.player.ui.StatusBarSpace
import app.encore.player.ui.TrackRow
import app.encore.player.ui.nav.Tab
import app.encore.player.ui.theme.Vyse
import java.util.Calendar

private fun greeting(): String = when (Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) {
    in 5..11 -> "Good morning"
    in 12..16 -> "Good afternoon"
    in 17..21 -> "Good evening"
    else -> "Good night"
}

/** the bottom of a root page's big title, from the top of its list */
@Composable
fun rootTitleBottom(): () -> Float {
    val density = LocalDensity.current
    val status = WindowInsets.statusBars.getTop(density)
    // the status bar, BigTitle's top padding and one line of the hero style
    val line = Vyse.type.hero.lineHeight
    return remember(density, status, line) { { status + with(density) { 12.dp.toPx() + line.toPx() } } }
}

@Composable
fun HomeScreen() {
    val ui = LocalAppUi.current
    val home = ui.pages.home
    val state by home.state.collectAsState()
    val refreshing by home.refreshing.collectAsState()
    LaunchedEffect(Unit) { home.refreshIfStale() }
    val list = rememberLazyListState()
    val title = remember { greeting() }
    Page(title = title, list = list, tab = Tab.Home, titleBottom = rootTitleBottom()) {
        item(key = "top", contentType = "top") {
            Column {
                StatusBarSpace()
                BigTitle(title) {
                    if (refreshing && state is Load.Ready) Spinner(Modifier.padding(end = 8.dp), size = 18.dp)
                }
            }
        }
        when (val load = state) {
            is Load.Loading -> item(key = "loading", contentType = "loading") {
                Column {
                    Spacer(Modifier.height(12.dp))
                    CarouselPlaceholder()
                    Spacer(Modifier.height(30.dp))
                    CarouselPlaceholder()
                    Spacer(Modifier.height(30.dp))
                    CarouselPlaceholder(round = true)
                }
            }
            is Load.Failed -> item(key = "failed", contentType = "failed") { ProblemMessage(load.problem, onRetry = { home.refresh() }) }
            is Load.Ready -> {
                if (load.value.isEmpty()) {
                    item(key = "empty") {
                        app.encore.player.ui.Message(
                            app.encore.player.ui.Icons.Sparkles,
                            "Nothing here yet",
                            "YouTube Music had nothing to suggest. Try again in a moment.",
                            action = "Try again",
                            onAction = { home.refresh() },
                        )
                    }
                }
                for ((index, section) in load.value.withIndex()) {
                    item(key = "section:$index:${section.title}", contentType = "section") {
                        HomeSectionView(section, Modifier.padding(top = if (index == 0) 8.dp else 30.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeSectionView(section: HomeSection, modifier: Modifier = Modifier) {
    val ui = LocalAppUi.current
    Column(modifier.fillMaxWidth()) {
        var titled = false
        fun title(): String? = if (titled) null else section.title.also { titled = true }
        if (section.tracks.isNotEmpty()) {
            val heading = title()
            if (heading != null) {
                SectionTitle(heading)
                Spacer(Modifier.height(8.dp))
            }
            // a few rows of songs side by side, flicked through a page at a time
            val rows = section.tracks.size.coerceAtMost(4)
            val width = (LocalConfiguration.current.screenWidthDp * 0.84f).dp
            val context = PlayContext("home", section.title)
            LazyHorizontalGrid(
                rows = GridCells.Fixed(rows),
                modifier = Modifier.fillMaxWidth().height((64 * rows).dp),
                contentPadding = PaddingValues(end = 8.dp),
            ) {
                itemsIndexed(section.tracks, key = { i, t -> "$i:${t.id}" }) { i, track ->
                    Box(Modifier.width(width)) {
                        TrackRow(track, onClick = { ui.play(section.tracks, i, context) }, showAlbum = false)
                    }
                }
            }
        }
        if (section.albums.isNotEmpty()) {
            val heading = title()
            if (heading == null) Spacer(Modifier.height(18.dp))
            Carousel(heading ?: "", section.albums, key = { it.id }) { AlbumCard(it) }
        }
        if (section.playlists.isNotEmpty()) {
            val heading = title()
            if (heading == null) Spacer(Modifier.height(18.dp))
            Carousel(heading ?: "", section.playlists, key = { it.id }) { PlaylistCard(it) }
        }
        if (section.artists.isNotEmpty()) {
            val heading = title()
            if (heading == null) Spacer(Modifier.height(18.dp))
            Carousel(heading ?: "", section.artists, key = { it.id }) { ArtistCard(it) }
        }
    }
}
