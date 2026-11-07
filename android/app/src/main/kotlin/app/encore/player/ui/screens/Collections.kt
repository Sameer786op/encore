package app.encore.player.ui.screens

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import app.encore.player.core.ArtistRef
import app.encore.player.core.PlayContext
import app.encore.player.core.Track
import app.encore.player.core.sizedArtwork
import app.encore.player.data.Load
import app.encore.player.data.valueOrNull
import app.encore.player.ui.AlbumCard
import app.encore.player.ui.ArtistCard
import app.encore.player.ui.Artwork
import app.encore.player.ui.Carousel
import app.encore.player.ui.FilledIcons
import app.encore.player.ui.Icons
import app.encore.player.ui.LocalAppUi
import app.encore.player.ui.Message
import app.encore.player.ui.Page
import app.encore.player.ui.PillButton
import app.encore.player.ui.RowPlaceholders
import app.encore.player.ui.SectionTitle
import app.encore.player.ui.StatusBarSpace
import app.encore.player.ui.TrackRow
import app.encore.player.ui.Txt
import app.encore.player.ui.formatLength
import app.encore.player.ui.loadState
import app.encore.player.ui.placeholder
import app.encore.player.ui.pressable
import app.encore.player.ui.songCount
import app.encore.player.ui.theme.Vyse
import coil3.compose.AsyncImage
import coil3.request.ImageRequest

// Album, playlist and artist pages. Each opens at once from what's already loaded, and its title
// moves up into the bar as the page scrolls.

/** text that opens out to its full length when tapped */
@Composable
private fun MoreText(text: String, modifier: Modifier = Modifier, lines: Int = 3) {
    var open by remember { mutableStateOf(false) }
    Txt(
        text,
        Vyse.type.caption.copy(lineHeight = Vyse.type.body.lineHeight),
        color = Vyse.colors.ink2,
        maxLines = if (open) Int.MAX_VALUE else lines,
        modifier = modifier
            .animateContentSize()
            .pressable({ open = !open }, pressedScale = 0.99f, label = if (open) "Show less" else "Show more"),
    )
}

/** names, each one opening its artist when it has a page */
@Composable
private fun Byline(artists: List<ArtistRef>, fallback: String?) {
    val ui = LocalAppUi.current
    val colors = Vyse.colors
    val first = artists.firstOrNull { it.id != null }
    val text = artists.joinToString(", ") { it.name }.ifBlank { fallback.orEmpty() }
    if (text.isBlank()) return
    Txt(
        text,
        Vyse.type.title3.copy(fontFamily = Vyse.type.body.fontFamily),
        color = colors.accentInk,
        maxLines = 2,
        align = TextAlign.Center,
        modifier = if (first != null) Modifier.pressable({ ui.openArtist(first.id!!) }, pressedScale = 0.97f, label = "Open ${first.name}") else Modifier,
    )
}

/** the top of an album or playlist: cover, title, who made it, and the play buttons */
@Composable
private fun CollectionHeader(
    artwork: String?,
    title: String?,
    loading: Boolean,
    onTitle: (top: Float, bottom: Float) -> Unit,
    byline: @Composable () -> Unit,
    meta: String?,
    description: String?,
    onPlay: (() -> Unit)?,
    onShuffle: (() -> Unit)?,
) {
    val colors = Vyse.colors
    val config = LocalConfiguration.current
    // on a turned phone the cover stays short enough to leave room for the title under it
    val cover = minOf(config.screenWidthDp.dp * 0.64f, config.screenHeightDp.dp * 0.5f, 300.dp)
    val shape = RoundedCornerShape(16.dp)
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        StatusBarSpace(extra = 52.dp)
        if (loading) {
            Box(Modifier.size(cover).placeholder(shape))
        } else {
            Box(Modifier.dropShadow(shape, Shadow(radius = 40.dp, color = Color.Black, spread = (-12).dp, offset = DpOffset(0.dp, 20.dp), alpha = 0.55f * colors.shadowK + 0.1f))) {
                Artwork(artwork, size = cover, shape = shape)
            }
        }
        Spacer(Modifier.height(22.dp))
        if (loading || title == null) {
            Box(Modifier.width(220.dp).height(24.dp).placeholder(RoundedCornerShape(6.dp)))
            Spacer(Modifier.height(10.dp))
            Box(Modifier.width(140.dp).height(16.dp).placeholder(RoundedCornerShape(5.dp)))
        } else {
            Txt(
                title,
                Vyse.type.title1,
                maxLines = 3,
                align = TextAlign.Center,
                modifier = Modifier.onGloballyPositioned { val y = it.positionInParent().y; onTitle(y, y + it.size.height) },
            )
            Spacer(Modifier.height(6.dp))
            byline()
            if (!meta.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Txt(meta, Vyse.type.caption, color = colors.ink2, maxLines = 1, align = TextAlign.Center)
            }
        }
        Spacer(Modifier.height(20.dp))
        Row(Modifier.widthIn(max = 420.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PillButton("Play", { onPlay?.invoke() }, Modifier.weight(1f), icon = FilledIcons.Play)
            PillButton("Shuffle", { onShuffle?.invoke() }, Modifier.weight(1f), icon = Icons.Shuffle, quiet = true)
        }
        if (!description.isNullOrBlank()) {
            Spacer(Modifier.height(16.dp))
            MoreText(description, Modifier.fillMaxWidth())
        }
        Spacer(Modifier.height(14.dp))
    }
}

@Composable
private fun Footer(tracks: List<Track>, extra: String? = null) {
    val total = tracks.sumOf { it.durationMs }
    val line = listOfNotNull(songCount(tracks.size), if (total > 0) formatLength(total) else null, extra).joinToString(" · ")
    Txt(line, Vyse.type.caption, color = Vyse.colors.ink3, modifier = Modifier.padding(horizontal = 20.dp, vertical = 18.dp))
}

@Composable
fun AlbumScreen(id: String) {
    val ui = LocalAppUi.current
    val state by remember(id) { ui.pages.albums.get(id) }.collectAsState()
    val album = state.valueOrNull
    var titleTop by remember { mutableFloatStateOf(Float.MAX_VALUE) }
    var titleBottom by remember { mutableFloatStateOf(Float.MAX_VALUE) }
    Page(title = album?.title.orEmpty(), onBack = { ui.nav.pop() }, titleTop = { titleTop }, titleBottom = { titleBottom }) {
        if (state !is Load.Failed) {
            item(key = "header", contentType = "header") {
                val context = album?.let { PlayContext("album", it.title, it.id) }
                CollectionHeader(
                    artwork = album?.artwork,
                    title = album?.title,
                    loading = album == null,
                    onTitle = { top, bottom -> titleTop = top; titleBottom = bottom },
                    byline = { Byline(album?.artists.orEmpty(), null) },
                    meta = album?.let { a -> listOfNotNull(a.kind ?: "Album", a.year).joinToString(" · ") },
                    description = null,
                    onPlay = album?.let { a -> { ui.play(a.tracks, 0, context) } },
                    onShuffle = album?.let { a -> { ui.playback.shufflePlay(a.tracks, context) } },
                )
            }
        } else {
            item(key = "space") { StatusBarSpace(extra = 56.dp) }
        }
        loadState(state, onRetry = { ui.pages.albums.retry(id) }) { RowPlaceholders(8) }
        if (album != null) {
            val context = PlayContext("album", album.title, album.id)
            val albumArtists = album.artists.joinToString(", ") { it.name }
            if (album.tracks.isEmpty()) item(key = "none") { Message(Icons.Album, "No songs here", "YouTube Music lists nothing playable on this album.") }
            itemsIndexed(album.tracks, key = { i, t -> "$i:${t.id}" }, contentType = { _, _ -> "track" }) { i, track ->
                TrackRow(
                    track,
                    onClick = { ui.play(album.tracks, i, context) },
                    number = i + 1,
                    showAlbum = false,
                    showDuration = true,
                    hideArtists = track.artists.isEmpty() || track.artistNames == albumArtists,
                )
            }
            if (album.tracks.isNotEmpty()) item(key = "footer") { Footer(album.tracks, album.year) }
            if (!album.description.isNullOrBlank()) {
                item(key = "about") { MoreText(album.description!!, Modifier.padding(horizontal = 20.dp), lines = 4) }
            }
        }
    }
}

@Composable
fun PlaylistScreen(id: String) {
    val ui = LocalAppUi.current
    val state by remember(id) { ui.pages.playlists.get(id) }.collectAsState()
    val playlist = state.valueOrNull
    var titleTop by remember { mutableFloatStateOf(Float.MAX_VALUE) }
    var titleBottom by remember { mutableFloatStateOf(Float.MAX_VALUE) }
    Page(title = playlist?.title.orEmpty(), onBack = { ui.nav.pop() }, titleTop = { titleTop }, titleBottom = { titleBottom }) {
        if (state !is Load.Failed) {
            item(key = "header", contentType = "header") {
                val context = playlist?.let { PlayContext("playlist", it.title, it.id) }
                val colors = Vyse.colors
                CollectionHeader(
                    artwork = playlist?.artwork,
                    title = playlist?.title,
                    loading = playlist == null,
                    onTitle = { top, bottom -> titleTop = top; titleBottom = bottom },
                    byline = {
                        playlist?.subtitle?.let { Txt(it, Vyse.type.callout, color = colors.ink2, maxLines = 2, align = TextAlign.Center) }
                    },
                    meta = null,
                    description = playlist?.description,
                    onPlay = playlist?.let { p -> { ui.play(p.tracks, 0, context) } },
                    onShuffle = playlist?.let { p -> { ui.playback.shufflePlay(p.tracks, context) } },
                )
            }
        } else {
            item(key = "space") { StatusBarSpace(extra = 56.dp) }
        }
        loadState(state, onRetry = { ui.pages.playlists.retry(id) }) { RowPlaceholders(8) }
        if (playlist != null) {
            val context = PlayContext("playlist", playlist.title, playlist.id)
            if (playlist.tracks.isEmpty()) item(key = "none") { Message(Icons.Playlist, "This playlist is empty", null) }
            itemsIndexed(playlist.tracks, key = { i, t -> "$i:${t.id}" }, contentType = { _, _ -> "track" }) { i, track ->
                TrackRow(track, onClick = { ui.play(playlist.tracks, i, context) })
            }
            if (playlist.tracks.isNotEmpty()) item(key = "footer") { Footer(playlist.tracks) }
        }
    }
}

private val grayscale = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0f) })

/** the artist's portrait in black and white, lit from the side in ember or lime */
@Composable
private fun ArtistHeader(name: String?, audience: String?, artwork: String?, loading: Boolean, height: Dp, onTitle: (top: Float, bottom: Float) -> Unit) {
    val colors = Vyse.colors
    val context = LocalContext.current
    val density = LocalDensity.current
    val widthPx = with(density) { LocalConfiguration.current.screenWidthDp.dp.roundToPx() }
    val rim = if (colors.dark) colors.ember else colors.lime
    Box(Modifier.fillMaxWidth().height(height)) {
        if (artwork != null) {
            val request = remember(artwork, widthPx) { ImageRequest.Builder(context).data(sizedArtwork(artwork, widthPx)).build() }
            AsyncImage(
                model = request,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                colorFilter = grayscale,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
                    .drawWithContent {
                        drawContent()
                        // the rim lights, added like coloured light
                        drawRect(
                            Brush.radialGradient(
                                listOf(rim.copy(alpha = 0.62f), rim.copy(alpha = 0.18f), Color.Transparent),
                                center = Offset(size.width * 1.04f, size.height * 0.38f),
                                radius = size.width * 0.72f,
                            ),
                            blendMode = BlendMode.Screen,
                        )
                        drawRect(
                            Brush.radialGradient(
                                listOf(rim.copy(alpha = 0.3f), Color.Transparent),
                                center = Offset(-size.width * 0.06f, size.height * 0.82f),
                                radius = size.width * 0.6f,
                            ),
                            blendMode = BlendMode.Screen,
                        )
                        // and the picture melts into the page at the bottom
                        drawRect(
                            Brush.verticalGradient(0f to Color.Black, 0.5f to Color.Black, 1f to Color.Transparent),
                            blendMode = BlendMode.DstIn,
                        )
                    },
            )
        } else if (loading) {
            Box(Modifier.fillMaxSize().placeholder(androidx.compose.ui.graphics.RectangleShape))
        }
        Column(Modifier.align(Alignment.BottomStart).padding(start = 20.dp, end = 20.dp, bottom = 10.dp)) {
            if (name != null) {
                Txt(
                    name,
                    Vyse.type.hero.copy(fontSize = Vyse.type.hero.fontSize * 1.15f),
                    maxLines = 2,
                    // where the name sits in the header: the column's place plus its own
                    modifier = Modifier.onGloballyPositioned {
                        val y = (it.parentLayoutCoordinates?.positionInParent()?.y ?: 0f) + it.positionInParent().y
                        onTitle(y, y + it.size.height)
                    },
                )
            } else if (loading) Box(Modifier.width(200.dp).height(30.dp).placeholder(RoundedCornerShape(6.dp)))
            if (!audience.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Txt(audience, Vyse.type.caption, color = colors.ink2, maxLines = 1)
            }
        }
    }
}

@Composable
fun ArtistScreen(id: String) {
    val ui = LocalAppUi.current
    val state by remember(id) { ui.pages.artists.get(id) }.collectAsState()
    val artist = state.valueOrNull
    val config = LocalConfiguration.current
    // as tall as the screen is wide, but never the whole screen of a turned phone
    val height = minOf(config.screenWidthDp.dp, config.screenHeightDp.dp * 0.7f, 460.dp)
    var titleTop by remember { mutableFloatStateOf(Float.MAX_VALUE) }
    var titleBottom by remember { mutableFloatStateOf(Float.MAX_VALUE) }
    Page(title = artist?.name.orEmpty(), onBack = { ui.nav.pop() }, titleTop = { titleTop }, titleBottom = { titleBottom }) {
        if (state !is Load.Failed) {
            item(key = "header", contentType = "header") {
                ArtistHeader(artist?.name, artist?.audience, artist?.artwork, artist == null, height, onTitle = { top, bottom -> titleTop = top; titleBottom = bottom })
            }
        } else {
            item(key = "space") { StatusBarSpace(extra = 56.dp) }
        }
        loadState(state, onRetry = { ui.pages.artists.retry(id) }) { RowPlaceholders(5) }
        if (artist != null) {
            val context = PlayContext("artist", artist.name, artist.id)
            val top = artist.topTracks
            if (top.isNotEmpty()) {
                item(key = "actions") {
                    Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp).widthIn(max = 420.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        PillButton("Play", { ui.play(top, 0, context) }, Modifier.weight(1f), icon = FilledIcons.Play)
                        PillButton("Radio", { ui.playback.startRadio(top.first()) }, Modifier.weight(1f), icon = Icons.Radio, quiet = true)
                    }
                }
                item(key = "top-title") { SectionTitle("Top songs", Modifier.padding(top = 12.dp, bottom = 4.dp)) }
                itemsIndexed(top, key = { i, t -> "top:$i:${t.id}" }, contentType = { _, _ -> "track" }) { i, track ->
                    TrackRow(track, onClick = { ui.play(top, i, context) })
                }
            }
            if (artist.albums.isNotEmpty()) {
                item(key = "albums") {
                    Carousel("Albums", artist.albums, key = { it.id }, Modifier.padding(top = 26.dp)) {
                        AlbumCard(it, subtitle = listOfNotNull(it.year, it.kind).joinToString(" · "))
                    }
                }
            }
            if (artist.singles.isNotEmpty()) {
                item(key = "singles") {
                    Carousel("Singles & EPs", artist.singles, key = { it.id }, Modifier.padding(top = 26.dp)) {
                        AlbumCard(it, subtitle = listOfNotNull(it.year, it.kind).joinToString(" · "))
                    }
                }
            }
            if (artist.related.isNotEmpty()) {
                item(key = "related") {
                    Carousel("Fans also like", artist.related, key = { it.id }, Modifier.padding(top = 26.dp)) { ArtistCard(it) }
                }
            }
            if (!artist.description.isNullOrBlank()) {
                item(key = "about") {
                    Column(Modifier.padding(top = 26.dp)) {
                        SectionTitle("About")
                        Spacer(Modifier.height(10.dp))
                        MoreText(artist.description!!, Modifier.padding(horizontal = 20.dp), lines = 4)
                    }
                }
            }
            if (top.isEmpty() && artist.albums.isEmpty() && artist.singles.isEmpty()) {
                item(key = "none") { Message(Icons.Artist, "Nothing to play yet", "YouTube Music has no songs listed for ${artist.name}.") }
            }
        }
    }
}
