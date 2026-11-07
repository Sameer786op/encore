package app.encore.player.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import app.encore.player.core.RepeatMode
import app.encore.player.core.Track
import app.encore.player.ui.theme.Vyse
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.sign

// Sheets that slide up over everything: a song's menu and the queue. Drag one down, tap outside
// it or go back to put it away.

private fun sheetScroll(sheets: Sheets) = object : NestedScrollConnection {
    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
        // a lowered sheet rises back before its list scrolls
        if (available.y < 0f && sheets.offset > 0f && source == NestedScrollSource.UserInput) {
            sheets.dragBy(available.y)
            return Offset(0f, available.y)
        }
        return Offset.Zero
    }

    override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
        // pulling down past the top of the list lowers the sheet
        if (available.y > 0f && source == NestedScrollSource.UserInput) {
            sheets.dragBy(available.y)
            return Offset(0f, available.y)
        }
        return Offset.Zero
    }

    override suspend fun onPreFling(available: Velocity): Velocity {
        if (sheets.offset > 0f) {
            sheets.release(available.y)
            return available
        }
        return Velocity.Zero
    }
}

@Composable
fun SheetHost() {
    val ui = LocalAppUi.current
    val sheets = ui.sheets
    val spec = sheets.shown ?: return
    val colors = Vyse.colors
    BackHandler(sheets.current != null) { sheets.dismiss() }
    val connection = remember(sheets) { sheetScroll(sheets) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .drawBehind { drawRect(Color.Black, alpha = (if (colors.dark) 0.55f else 0.3f) * (1f - sheets.offset)) }
                .pointerInput(Unit) { detectTapGestures { sheets.dismiss() } },
        )
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .widthIn(max = 640.dp)
                .fillMaxWidth()
                .heightIn(max = maxHeight * 0.88f)
                .onSizeChanged { sheets.travel = it.height.toFloat().coerceAtLeast(1f) }
                .graphicsLayer { translationY = sheets.offset * size.height }
                .glass(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp), GlassKind.Menu)
                .nestedScroll(connection)
                .draggable(
                    orientation = Orientation.Vertical,
                    state = rememberDraggableState { sheets.dragBy(it) },
                    onDragStopped = { velocity -> sheets.release(velocity) },
                )
                .pointerInput(Unit) { detectTapGestures { } }
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            Box(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 6.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(width = 38.dp, height = 5.dp).clip(CircleShape).drawBehind { drawRect(colors.ink3.copy(alpha = 0.5f)) })
            }
            when (spec) {
                is SheetSpec.Song -> SongMenu(spec.track)
                SheetSpec.Queue -> QueueSheet()
            }
        }
    }
}

@Composable
private fun MenuRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(54.dp)
            .pressable(onClick, pressedScale = 0.98f, label = label)
            .padding(horizontal = 22.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, size = 22.dp, tint = Vyse.colors.ink)
        Spacer(Modifier.width(18.dp))
        Txt(label, Vyse.type.body, maxLines = 1)
    }
}

@Composable
private fun SongMenu(track: Track) {
    val ui = LocalAppUi.current
    val colors = Vyse.colors
    val sheets = ui.sheets
    fun then(action: () -> Unit): () -> Unit = {
        sheets.dismiss()
        action()
    }
    Column(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Artwork(track.artwork, size = 54.dp, shape = RoundedCornerShape(10.dp))
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Txt(track.title, Vyse.type.bodyStrong, maxLines = 2)
                Spacer(Modifier.height(3.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (track.explicit) {
                        ExplicitBadge()
                        Spacer(Modifier.width(6.dp))
                    }
                    Txt(listOfNotNull(track.artistNames.ifBlank { null }, track.album?.title).joinToString(" · "), Vyse.type.caption, color = colors.ink2, maxLines = 1)
                }
            }
        }
        Box(Modifier.fillMaxWidth().padding(vertical = 6.dp).height(0.5.dp).drawBehind { drawRect(colors.line) })
        MenuRow(Icons.PlayNext, "Play next", then { ui.playNext(track) })
        MenuRow(Icons.AddToQueue, "Add to queue", then { ui.addToQueue(track) })
        MenuRow(Icons.Radio, "Start radio", then { ui.playback.startRadio(track) })
        val albumId = track.album?.id
        if (albumId != null) MenuRow(Icons.Album, "Go to album", then { ui.openAlbum(albumId) })
        val artists = track.artists.filter { it.id != null }.take(3)
        for (artist in artists) {
            MenuRow(Icons.Artist, if (artists.size == 1) "Go to artist" else "Go to ${artist.name}", then { ui.openArtist(artist.id!!) })
        }
        MenuRow(Icons.Share, "Share", then { ui.share(track) })
    }
}

/** a row that slides away sideways to be removed */
@Composable
private fun SwipeToRemove(onRemove: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val colors = Vyse.colors
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val offset = remember { mutableFloatStateOf(0f) }
    val width = remember { mutableFloatStateOf(1f) }
    Box(
        modifier
            .fillMaxWidth()
            .onSizeChanged { width.floatValue = it.width.toFloat().coerceAtLeast(1f) }
            .draggable(
                orientation = Orientation.Horizontal,
                state = rememberDraggableState { offset.floatValue += it },
                onDragStopped = { velocity ->
                    val dx = offset.floatValue
                    val gone = abs(dx) > width.floatValue * 0.4f || (abs(velocity) > 1600f && abs(dx) > width.floatValue * 0.1f)
                    if (gone) {
                        haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                        scope.launch {
                            animate(dx, sign(dx) * width.floatValue, velocity, spring(stiffness = 900f)) { v, _ -> offset.floatValue = v }
                            onRemove()
                        }
                    } else {
                        scope.launch { animate(dx, 0f, velocity, spring(dampingRatio = 0.7f, stiffness = 600f)) { v, _ -> offset.floatValue = v } }
                    }
                },
            ),
    ) {
        Box(
            Modifier
                .matchParentSize()
                .drawBehind {
                    val reach = (abs(offset.floatValue) / (width.floatValue * 0.4f)).coerceIn(0f, 1f)
                    drawRect(colors.bad.copy(alpha = 0.22f * reach))
                },
        ) {
            Box(
                Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 24.dp)
                    .graphicsLayer { alpha = (offset.floatValue / -(width.floatValue * 0.25f)).coerceIn(0f, 1f) },
            ) { Icon(Icons.Trash, null, tint = colors.bad, size = 20.dp) }
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .padding(start = 24.dp)
                    .graphicsLayer { alpha = (offset.floatValue / (width.floatValue * 0.25f)).coerceIn(0f, 1f) },
            ) { Icon(Icons.Trash, null, tint = colors.bad, size = 20.dp) }
        }
        Box(Modifier.graphicsLayer { translationX = offset.floatValue }) { content() }
    }
}

@Composable
private fun QueueSheet() {
    val ui = LocalAppUi.current
    val colors = Vyse.colors
    val playback = ui.playback
    val queue by playback.queue.collectAsState()
    val current = queue.current
    val upcoming = queue.upcoming
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Txt("Up next", Vyse.type.title2, maxLines = 1)
                queue.context?.label?.let {
                    Spacer(Modifier.height(2.dp))
                    Txt("Playing from $it", Vyse.type.caption, color = colors.ink2, maxLines = 1)
                }
            }
            IconButton(Icons.Shuffle, if (queue.shuffle) "Shuffle is on" else "Shuffle", { playback.toggleShuffle() }, tint = if (queue.shuffle) colors.accentInk else colors.ink2)
            IconButton(
                if (queue.repeat == RepeatMode.One) Icons.RepeatOne else Icons.Repeat,
                "Repeat",
                { playback.cycleRepeat() },
                tint = if (queue.repeat != RepeatMode.Off) colors.accentInk else colors.ink2,
            )
        }
        LazyColumn(Modifier.fillMaxWidth()) {
            if (current != null) {
                item(key = "now") {
                    Column {
                        Txt("NOW PLAYING", Vyse.type.eyebrow, color = colors.ink3, modifier = Modifier.padding(start = 20.dp, top = 8.dp, bottom = 2.dp))
                        TrackRow(current.track, onClick = { ui.sheets.dismiss(); ui.player.show() })
                    }
                }
            }
            if (upcoming.isNotEmpty()) {
                item(key = "next-title") {
                    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Txt("NEXT", Vyse.type.eyebrow, color = colors.ink3, modifier = Modifier.weight(1f))
                        Box(Modifier.pressable({ playback.clearUpcoming() }, label = "Clear up next").padding(horizontal = 8.dp, vertical = 6.dp)) {
                            Txt("Clear", Vyse.type.callout, color = colors.accentInk)
                        }
                    }
                }
                items(upcoming, key = { it.uid }) { item ->
                    SwipeToRemove(onRemove = { playback.remove(item.uid) }, modifier = Modifier.animateItem()) {
                        TrackRow(item.track, onClick = { playback.jumpTo(item.uid) })
                    }
                }
            } else {
                item(key = "empty") {
                    val autoplay by ui.settings.autoplay.collectAsState()
                    Column(Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Txt("Nothing up next", Vyse.type.title3)
                        Spacer(Modifier.height(6.dp))
                        Txt(
                            if (autoplay) "When this ends, similar songs keep playing." else "Add songs with Play next or Add to queue.",
                            Vyse.type.caption,
                            color = colors.ink2,
                            align = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                }
            }
            item(key = "end") { Spacer(Modifier.height(12.dp)) }
        }
    }
}
