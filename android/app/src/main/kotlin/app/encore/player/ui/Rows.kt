package app.encore.player.ui

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.encore.player.core.AlbumSummary
import app.encore.player.core.ArtistSummary
import app.encore.player.core.RemotePlaylist
import app.encore.player.core.Track
import app.encore.player.ui.theme.Vyse

// Songs as rows, and albums, playlists and artists as cards: the pieces every list is made of.

fun formatTime(ms: Long): String {
    val total = (ms.coerceAtLeast(0) / 1000).toInt()
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val seconds = total % 60
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds) else "%d:%02d".format(minutes, seconds)
}

/** "1 hr 12 min" or "38 min", for the end of a list */
fun formatLength(ms: Long): String {
    val minutes = (ms / 60_000).toInt()
    return if (minutes >= 60) "${minutes / 60} hr ${minutes % 60} min" else "$minutes min"
}

fun songCount(n: Int) = if (n == 1) "1 song" else "$n songs"

/** three bars bouncing to show what's playing; still when paused or animations are off */
@Composable
fun PlayingBars(playing: Boolean, modifier: Modifier = Modifier, color: Color = Vyse.colors.accentInk, size: Dp = 16.dp) {
    val reduce = Vyse.reduceMotion
    val moving = playing && !reduce
    val transition = rememberInfiniteTransition(label = "bars")
    val a by transition.animateFloat(0.3f, 1f, infiniteRepeatable(tween(420, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "a")
    val b by transition.animateFloat(1f, 0.35f, infiniteRepeatable(tween(520, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "b")
    val c by transition.animateFloat(0.45f, 0.95f, infiniteRepeatable(tween(360, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "c")
    Box(
        modifier.size(size).drawBehind {
            val bar = this.size.width / 5f
            val heights = if (moving) floatArrayOf(a, b, c) else floatArrayOf(0.45f, 0.8f, 0.6f)
            for (i in 0..2) {
                val h = this.size.height * heights[i]
                drawRoundRect(
                    color,
                    topLeft = Offset(bar * (i * 2), this.size.height - h),
                    size = Size(bar, h),
                    cornerRadius = CornerRadius(bar / 2, bar / 2),
                )
            }
        },
    )
}

private fun Track.line(withAlbum: Boolean): String {
    val names = artistNames
    val album = album?.title
    return if (withAlbum && !album.isNullOrBlank() && album != title) listOf(names, album).filter { it.isNotBlank() }.joinToString(" · ") else names
}

/**
 * A song. Tap plays it, a long press or the dots open its menu. Album pages pass [number] to show
 * the track number in place of the cover.
 */
@Composable
fun TrackRow(
    track: Track,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    number: Int? = null,
    showAlbum: Boolean = true,
    showDuration: Boolean = false,
    /** artists to leave out of the line under the title, such as the album's own */
    hideArtists: Boolean = false,
    onMore: (() -> Unit)? = null,
) {
    val ui = LocalAppUi.current
    val colors = Vyse.colors
    val current = LocalNowPlaying.current.value == track.id
    val playing = current && LocalIsPlaying.current.value
    val more = onMore ?: { ui.songMenu(track) }
    Row(
        modifier
            .fillMaxWidth()
            .pressable(onClick, onLongClick = more, pressedScale = 0.985f, label = "Play ${track.title}")
            .padding(start = 20.dp, end = 6.dp)
            .height(if (number != null) 56.dp else 64.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (number != null) {
            Box(Modifier.width(28.dp), contentAlignment = Alignment.CenterStart) {
                if (current) PlayingBars(playing)
                else Txt(number.toString(), Vyse.type.callout, color = colors.ink3, maxLines = 1)
            }
            Spacer(Modifier.width(8.dp))
        } else {
            Box {
                Artwork(track.artwork, size = 48.dp, shape = RoundedCornerShape(8.dp))
                if (current) {
                    Box(
                        Modifier
                            .size(48.dp)
                            .drawBehind { drawRoundRect(Color.Black.copy(alpha = 0.45f), cornerRadius = CornerRadius(8.dp.toPx())) },
                        contentAlignment = Alignment.Center,
                    ) {
                        PlayingBars(playing, color = Color.White)
                    }
                }
            }
            Spacer(Modifier.width(14.dp))
        }
        Column(Modifier.weight(1f)) {
            Txt(track.title, Vyse.type.bodyStrong, color = if (current) colors.accentInk else colors.ink, maxLines = 1)
            val line = if (hideArtists) "" else track.line(showAlbum)
            if (line.isNotEmpty() || track.explicit) {
                Spacer(Modifier.height(3.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (track.explicit) {
                        ExplicitBadge()
                        if (line.isNotEmpty()) Spacer(Modifier.width(6.dp))
                    }
                    if (line.isNotEmpty()) Txt(line, Vyse.type.caption, color = colors.ink2, maxLines = 1)
                }
            }
        }
        if (showDuration && track.durationMs > 0) {
            Txt(formatTime(track.durationMs), Vyse.type.caption, color = colors.ink3, maxLines = 1, modifier = Modifier.padding(start = 10.dp))
        }
        IconButton(Icons.MoreVertical, "More for ${track.title}", more, tint = colors.ink2, size = 20.dp)
    }
}

/** a square cover with two lines under it */
@Composable
private fun Card(
    artwork: String?,
    title: String,
    subtitle: String?,
    onClick: () -> Unit,
    width: Dp,
    shape: Shape,
    modifier: Modifier = Modifier,
    center: Boolean = false,
) {
    val colors = Vyse.colors
    Column(
        modifier.width(width).pressable(onClick, label = title),
        horizontalAlignment = if (center) Alignment.CenterHorizontally else Alignment.Start,
    ) {
        Artwork(artwork, size = width, shape = shape, contentDescription = null)
        Spacer(Modifier.height(10.dp))
        Txt(title, Vyse.type.callout, maxLines = if (center) 1 else 2, align = if (center) TextAlign.Center else null)
        if (!subtitle.isNullOrBlank()) {
            Spacer(Modifier.height(2.dp))
            Txt(subtitle, Vyse.type.caption, color = colors.ink2, maxLines = 1, align = if (center) TextAlign.Center else null)
        }
    }
}

fun AlbumSummary.byline(): String = listOfNotNull(kind?.takeIf { it.isNotBlank() }, artists.joinToString(", ") { it.name }.takeIf { it.isNotBlank() } ?: year)
    .joinToString(" · ")

@Composable
fun AlbumCard(album: AlbumSummary, modifier: Modifier = Modifier, width: Dp = 152.dp, subtitle: String = album.byline()) {
    val ui = LocalAppUi.current
    Card(album.artwork, album.title, subtitle, { ui.openAlbum(album.id) }, width, RoundedCornerShape(12.dp), modifier)
}

@Composable
fun PlaylistCard(playlist: RemotePlaylist, modifier: Modifier = Modifier, width: Dp = 152.dp) {
    val ui = LocalAppUi.current
    Card(playlist.artwork, playlist.title, playlist.subtitle, { ui.openPlaylist(playlist.id) }, width, RoundedCornerShape(12.dp), modifier)
}

@Composable
fun ArtistCard(artist: ArtistSummary, modifier: Modifier = Modifier, width: Dp = 128.dp) {
    val ui = LocalAppUi.current
    Card(artist.artwork, artist.name, artist.subtitle, { ui.openArtist(artist.id) }, width, CircleShape, modifier, center = true)
}

/** a sideways row of cards under a title */
@Composable
fun <T> Carousel(
    title: String,
    items: List<T>,
    key: (T) -> String,
    modifier: Modifier = Modifier,
    content: @Composable (T) -> Unit,
) {
    Column(modifier.fillMaxWidth()) {
        SectionTitle(title)
        Spacer(Modifier.height(12.dp))
        LazyRow(
            contentPadding = PaddingValues(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            items(items, key = key) { content(it) }
        }
    }
}

/** a soft pulsing block where something is still loading */
@Composable
fun Modifier.placeholder(shape: Shape = RoundedCornerShape(8.dp)): Modifier {
    val colors = Vyse.colors
    val reduce = Vyse.reduceMotion
    val transition = rememberInfiniteTransition(label = "placeholder")
    val pulse = transition.animateFloat(0.55f, 1f, infiniteRepeatable(tween(850), RepeatMode.Reverse), label = "pulse")
    return drawBehind {
        val alpha = if (reduce) 0.8f else pulse.value
        val outline = shape.createOutline(size, layoutDirection, this)
        drawOutline(outline, colors.surface, alpha = alpha)
    }
}

/** grey stand-ins for a list of songs */
@Composable
fun RowPlaceholders(count: Int, modifier: Modifier = Modifier) {
    Column(modifier) {
        repeat(count) {
            Row(Modifier.padding(horizontal = 20.dp).height(64.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).placeholder())
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Box(Modifier.fillMaxWidth(0.62f).height(13.dp).placeholder(RoundedCornerShape(4.dp)))
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.fillMaxWidth(0.38f).height(11.dp).placeholder(RoundedCornerShape(4.dp)))
                }
            }
        }
    }
}

/** grey stand-ins for a row of cards */
@Composable
fun CarouselPlaceholder(modifier: Modifier = Modifier, round: Boolean = false) {
    Column(modifier) {
        Box(Modifier.padding(horizontal = 20.dp).width(160.dp).height(20.dp).placeholder(RoundedCornerShape(5.dp)))
        Spacer(Modifier.height(14.dp))
        Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            repeat(3) {
                Column {
                    Box(Modifier.size(if (round) 128.dp else 152.dp).placeholder(if (round) CircleShape else RoundedCornerShape(12.dp)))
                    Spacer(Modifier.height(10.dp))
                    Box(Modifier.width(110.dp).height(12.dp).placeholder(RoundedCornerShape(4.dp)))
                }
            }
        }
    }
}
