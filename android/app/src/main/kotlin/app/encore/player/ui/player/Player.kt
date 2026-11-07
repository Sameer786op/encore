package app.encore.player.ui.player

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import app.encore.player.core.QueueItem
import app.encore.player.core.RepeatMode
import app.encore.player.playback.PlayerStatus
import app.encore.player.ui.Artwork
import app.encore.player.ui.CoverWash
import app.encore.player.ui.FilledIcons
import app.encore.player.ui.GlassKind
import app.encore.player.ui.Icon
import app.encore.player.ui.IconButton
import app.encore.player.ui.Icons
import app.encore.player.ui.LocalAppUi
import app.encore.player.ui.Spinner
import app.encore.player.ui.Txt
import app.encore.player.ui.formatTime
import app.encore.player.ui.glass
import app.encore.player.ui.pressable
import app.encore.player.ui.rememberCoverLook
import app.encore.player.ui.theme.Vyse
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sign

// The mini player floating over the tabs, and the full player it opens into.

/**
 * The playing position, refreshed just often enough for a bar [widthPx] wide to move a pixel at
 * a time: every frame for a long bar and a short song, a few times a second otherwise.
 */
@Composable
fun rememberPosition(widthPx: Float, active: Boolean): State<Long> {
    val ui = LocalAppUi.current
    val status by ui.playback.status.collectAsState()
    val position = remember { mutableLongStateOf(ui.playback.positionMs()) }
    LaunchedEffect(active, status.playing, status.durationMs, widthPx) {
        position.longValue = ui.playback.positionMs()
        if (!active) return@LaunchedEffect
        while (true) {
            if (status.playing) {
                val step = (status.durationMs / widthPx.coerceAtLeast(1f)).toLong().coerceIn(16, 500)
                if (step <= 24) withFrameMillis { } else delay(step)
            } else {
                // still catches a seek made from the notification or headphones
                delay(400)
            }
            position.longValue = ui.playback.positionMs()
        }
    }
    return position
}

/** play or pause, showing pause as soon as play is pressed and a ring while it loads */
@Composable
private fun PlayPause(status: PlayerStatus, size: Dp, iconSize: Dp, solid: Boolean, onClick: () -> Unit) {
    val colors = Vyse.colors
    val loading = status.wantsToPlay && status.buffering
    Box(
        Modifier.size(size).pressable(onClick, pressedScale = 0.9f, label = if (status.wantsToPlay) "Pause" else "Play"),
        contentAlignment = Alignment.Center,
    ) {
        if (solid) Box(Modifier.size(size).clip(CircleShape).drawBehind { drawRect(colors.accent) })
        Icon(
            if (status.wantsToPlay) FilledIcons.Pause else FilledIcons.Play,
            null,
            tint = if (solid) colors.onAccent else colors.ink,
            size = iconSize,
            modifier = Modifier.graphicsLayer { if (!status.wantsToPlay) translationX = iconSize.toPx() * 0.06f },
        )
        if (loading) Spinner(size = size - 4.dp, color = if (solid) colors.onAccent.copy(alpha = 0.9f) else colors.accent, stroke = 2.dp)
    }
}

/**
 * The floating mini player. Tap or swipe up to open the full player; swipe sideways to skip.
 */
@Composable
fun MiniPlayer(item: QueueItem, status: PlayerStatus, modifier: Modifier = Modifier) {
    val ui = LocalAppUi.current
    val colors = Vyse.colors
    val sheet = ui.player
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    var width by remember { mutableFloatStateOf(1f) }
    val swipe = remember { mutableFloatStateOf(0f) }
    val shape = RoundedCornerShape(22.dp)
    val position = rememberPosition(width, active = true)
    val duration by rememberUpdatedState(status.durationMs)

    Box(
        modifier
            .fillMaxWidth()
            .height(62.dp)
            .onSizeChanged { width = it.width.toFloat() }
            .glass(shape, GlassKind.Bar)
            .pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    val tracker = VelocityTracker()
                    tracker.addPosition(down.uptimeMillis, down.position)
                    var axis: Orientation? = null
                    var total = Offset.Zero
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (!change.pressed) break
                        val delta = change.positionChange()
                        total += delta
                        tracker.addPosition(change.uptimeMillis, change.position)
                        if (axis == null && total.getDistance() > viewConfiguration.touchSlop) {
                            axis = if (abs(total.x) > abs(total.y)) Orientation.Horizontal else Orientation.Vertical
                        }
                        when (axis) {
                            Orientation.Horizontal -> {
                                change.consume()
                                swipe.floatValue += delta.x
                            }
                            Orientation.Vertical -> {
                                change.consume()
                                sheet.dragBy(delta.y)
                            }
                            null -> Unit
                        }
                    }
                    val velocity = tracker.calculateVelocity()
                    when (axis) {
                        Orientation.Horizontal -> {
                            val dx = swipe.floatValue
                            val skip = abs(dx) > width * 0.28f || (abs(velocity.x) > 1400f && abs(dx) > width * 0.06f)
                            scope.launch {
                                if (skip) {
                                    haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                                    val direction = sign(dx)
                                    animate(dx, direction * width, velocity.x, spring(stiffness = 900f)) { v, _ -> swipe.floatValue = v }
                                    if (direction < 0) ui.playback.next() else ui.playback.previous()
                                    animate(-direction * width * 0.4f, 0f, 0f, spring(dampingRatio = 0.8f, stiffness = 500f)) { v, _ -> swipe.floatValue = v }
                                } else {
                                    animate(dx, 0f, velocity.x, spring(dampingRatio = 0.7f, stiffness = 600f)) { v, _ -> swipe.floatValue = v }
                                }
                            }
                        }
                        Orientation.Vertical -> sheet.release(velocity.y)
                        null -> Unit
                    }
                }
            }
            .pressable({ sheet.show() }, pressedScale = 0.985f, label = "Open the player")
            .drawBehind {
                // the song's progress, along the bottom edge
                val d = duration
                if (d > 0) {
                    val fraction = (position.value.toFloat() / d).coerceIn(0f, 1f)
                    val h = 2.5.dp.toPx()
                    drawRect(colors.ink.copy(alpha = 0.1f), topLeft = Offset(0f, size.height - h), size = Size(size.width, h))
                    drawRect(
                        Brush.horizontalGradient(colors.ramp, startX = 0f, endX = size.width),
                        topLeft = Offset(0f, size.height - h),
                        size = Size(size.width * fraction, h),
                    )
                }
            },
    ) {
        Row(
            Modifier
                .fillMaxSize()
                .padding(start = 9.dp, end = 4.dp)
                .graphicsLayer {
                    translationX = swipe.floatValue
                    alpha = 1f - (abs(swipe.floatValue) / width).coerceIn(0f, 1f) * 0.8f
                },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Artwork(item.track.artwork, size = 44.dp, shape = RoundedCornerShape(11.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Txt(item.track.title, Vyse.type.bodyStrong, maxLines = 1)
                val line = if (status.waitingForNetwork) "Waiting for a connection…" else item.track.artistNames
                Txt(line, Vyse.type.caption, color = if (status.waitingForNetwork) colors.warn else colors.ink2, maxLines = 1)
            }
            PlayPause(status, size = 46.dp, iconSize = 24.dp, solid = false) { ui.playback.togglePlay() }
            IconButton(FilledIcons.SkipForward, "Next", { ui.playback.next() }, size = 22.dp)
        }
    }
}

/** the bar that shows and moves the position, with the times under it */
@Composable
private fun SeekBar(durationMs: Long, modifier: Modifier = Modifier) {
    val ui = LocalAppUi.current
    val colors = Vyse.colors
    val haptics = LocalHapticFeedback.current
    var width by remember { mutableFloatStateOf(1f) }
    val position = rememberPosition(width, active = true)
    var scrub by remember { mutableStateOf<Float?>(null) }
    val duration by rememberUpdatedState(durationMs)
    val thickness by animateDpAsState(if (scrub != null) 9.dp else 5.dp, spring(dampingRatio = 0.7f, stiffness = 700f), label = "thickness")
    val shownSeconds by remember {
        derivedStateOf { ((scrub?.let { it * duration }?.toLong() ?: position.value) / 1000) }
    }

    fun seek(fraction: Float) {
        if (duration <= 0) return
        ui.playback.seekTo((fraction.coerceIn(0f, 1f) * duration).toLong())
    }

    Column(modifier.fillMaxWidth()) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(32.dp)
                .onSizeChanged { width = it.width.toFloat() }
                .pointerInput(Unit) {
                    detectTapGestures { offset ->
                        haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                        seek(offset.x / size.width)
                    }
                }
                .pointerInput(Unit) {
                    detectHorizontalDragGestures(
                        onDragStart = { offset ->
                            haptics.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
                            scrub = (offset.x / size.width).coerceIn(0f, 1f)
                        },
                        onDragEnd = {
                            scrub?.let(::seek)
                            haptics.performHapticFeedback(HapticFeedbackType.GestureEnd)
                            scrub = null
                        },
                        onDragCancel = { scrub = null },
                    ) { change, dx ->
                        change.consume()
                        scrub = ((scrub ?: 0f) + dx / size.width).coerceIn(0f, 1f)
                    }
                }
                .drawBehind {
                    val h = thickness.toPx()
                    val top = (size.height - h) / 2f
                    val radius = CornerRadius(h / 2f)
                    val d = duration
                    val fraction = scrub ?: if (d > 0) (position.value.toFloat() / d).coerceIn(0f, 1f) else 0f
                    val buffered = if (d > 0) (ui.playback.bufferedPositionMs().toFloat() / d).coerceIn(0f, 1f) else 0f
                    drawRoundRect(colors.ink.copy(alpha = 0.14f), topLeft = Offset(0f, top), size = Size(size.width, h), cornerRadius = radius)
                    if (buffered > fraction) {
                        drawRoundRect(colors.ink.copy(alpha = 0.14f), topLeft = Offset(0f, top), size = Size(size.width * buffered, h), cornerRadius = radius)
                    }
                    if (fraction > 0f) {
                        drawRoundRect(
                            Brush.horizontalGradient(colors.ramp, startX = 0f, endX = size.width),
                            topLeft = Offset(0f, top),
                            size = Size((size.width * fraction).coerceAtLeast(h), h),
                            cornerRadius = radius,
                        )
                    }
                    if (scrub != null) {
                        drawCircle(colors.ink, radius = 8.dp.toPx(), center = Offset(size.width * fraction, size.height / 2f))
                    }
                },
        )
        Row(Modifier.fillMaxWidth()) {
            val known = durationMs > 0
            Txt(if (known) formatTime(shownSeconds * 1000) else "--:--", Vyse.type.caption, color = colors.ink2)
            Spacer(Modifier.weight(1f))
            Txt(if (known) "-" + formatTime(durationMs - shownSeconds * 1000) else "--:--", Vyse.type.caption, color = colors.ink2)
        }
    }
}

/** the round toggles either side of the main controls */
@Composable
private fun Toggle(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, on: Boolean, onClick: () -> Unit) {
    val colors = Vyse.colors
    Box(Modifier.size(52.dp).pressable(onClick, pressedScale = 0.88f, label = label, role = Role.Switch), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = if (on) colors.accentInk else colors.ink2, size = 22.dp)
        if (on) {
            Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 5.dp).size(4.dp).clip(CircleShape).drawBehind { drawRect(colors.accentInk) })
        }
    }
}

@Composable
private fun Controls(status: PlayerStatus, shuffle: Boolean, repeat: RepeatMode, modifier: Modifier = Modifier) {
    val ui = LocalAppUi.current
    val playback = ui.playback
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Toggle(Icons.Shuffle, if (shuffle) "Shuffle is on" else "Shuffle", shuffle) { playback.toggleShuffle() }
        IconButton(FilledIcons.SkipBack, "Previous", { playback.previous() }, size = 30.dp, modifier = Modifier.size(60.dp))
        PlayPause(status, size = 76.dp, iconSize = 32.dp, solid = true) { playback.togglePlay() }
        IconButton(FilledIcons.SkipForward, "Next", { playback.next() }, size = 30.dp, modifier = Modifier.size(60.dp))
        Toggle(
            if (repeat == RepeatMode.One) Icons.RepeatOne else Icons.Repeat,
            when (repeat) {
                RepeatMode.Off -> "Repeat"
                RepeatMode.All -> "Repeat all"
                RepeatMode.One -> "Repeat one"
            },
            repeat != RepeatMode.Off,
        ) { playback.cycleRepeat() }
    }
}

/** the big cover: it shrinks back a little while paused, and swipes sideways to skip */
@Composable
private fun Cover(item: QueueItem, playing: Boolean, size: Dp, tint: Color, modifier: Modifier = Modifier) {
    val ui = LocalAppUi.current
    val reduce = Vyse.reduceMotion
    val haptics = LocalHapticFeedback.current
    val scale by animateFloatAsState(
        if (playing) 1f else 0.86f,
        if (reduce) spring(stiffness = 2000f) else spring(dampingRatio = 0.62f, stiffness = 260f),
        label = "cover",
    )
    val swipe = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    var width by remember { mutableFloatStateOf(1f) }
    val shape = RoundedCornerShape(18.dp)
    Box(
        modifier
            .size(size)
            .onSizeChanged { width = it.width.toFloat() }
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                translationX = swipe.value
                rotationZ = swipe.value / width * 4f
                alpha = 1f - (abs(swipe.value) / width).coerceIn(0f, 1f) * 0.7f
            }
            .draggable(
                orientation = Orientation.Horizontal,
                state = rememberDraggableState { delta -> scope.launch { swipe.snapTo(swipe.value + delta) } },
                onDragStopped = { velocity ->
                    val dx = swipe.value
                    if (abs(dx) > width * 0.3f || (abs(velocity) > 1500f && abs(dx) > width * 0.08f)) {
                        haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                        val direction = sign(dx)
                        swipe.animateTo(direction * width * 1.1f, spring(stiffness = 900f), velocity)
                        if (direction < 0) ui.playback.next() else ui.playback.previous()
                        swipe.snapTo(-direction * width * 0.5f)
                        swipe.animateTo(0f, spring(dampingRatio = 0.78f, stiffness = 420f))
                    } else {
                        swipe.animateTo(0f, spring(dampingRatio = 0.6f, stiffness = 500f), velocity)
                    }
                },
            )
            .dropShadow(shape, Shadow(radius = 48.dp, color = tint, spread = (-10).dp, offset = DpOffset(0.dp, 22.dp), alpha = if (Vyse.colors.dark) 0.5f else 0.35f)),
    ) {
        Artwork(item.track.artwork, size = size, shape = shape, contentDescription = "Cover of ${item.track.album?.title ?: item.track.title}")
    }
}

/** the song's name and artists, the name scrolling when it's too long */
@Composable
private fun Titles(item: QueueItem, status: PlayerStatus, modifier: Modifier = Modifier, center: Boolean = false) {
    val ui = LocalAppUi.current
    val colors = Vyse.colors
    val reduce = Vyse.reduceMotion
    val track = item.track
    Column(modifier.fillMaxWidth(), horizontalAlignment = if (center) Alignment.CenterHorizontally else Alignment.Start) {
        Txt(
            track.title,
            Vyse.type.title1,
            modifier = if (reduce) Modifier else Modifier.basicMarquee(iterations = Int.MAX_VALUE, initialDelayMillis = 1800, repeatDelayMillis = 2400),
            maxLines = 1,
        )
        Spacer(Modifier.height(4.dp))
        val artist = track.artists.firstOrNull { it.id != null }
        Txt(
            track.artistNames,
            Vyse.type.body.copy(fontSize = Vyse.type.title3.fontSize),
            color = colors.ink2,
            maxLines = 1,
            modifier = if (artist != null) Modifier.pressable({ ui.openArtist(artist.id!!) }, pressedScale = 0.98f, label = "Open ${artist.name}") else Modifier,
        )
        if (status.waitingForNetwork) {
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.WifiOff, null, tint = colors.warn, size = 15.dp)
                Spacer(Modifier.width(6.dp))
                Txt("Waiting for a connection…", Vyse.type.caption, color = colors.warn)
            }
        }
    }
}

@Composable
private fun TopRow(contextLabel: String?, onClose: () -> Unit, onMore: () -> Unit, onContext: (() -> Unit)?) {
    val colors = Vyse.colors
    Row(Modifier.fillMaxWidth().height(56.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(Icons.ChevronDown, "Close the player", onClose, size = 26.dp)
        Column(
            Modifier
                .weight(1f)
                .then(if (onContext != null) Modifier.pressable(onContext, pressedScale = 0.97f, label = "Open $contextLabel") else Modifier),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Txt(if (contextLabel != null) "PLAYING FROM" else "NOW PLAYING", Vyse.type.eyebrow, color = colors.ink3, maxLines = 1)
            if (contextLabel != null) {
                Spacer(Modifier.height(2.dp))
                Txt(contextLabel, Vyse.type.callout, maxLines = 1, align = TextAlign.Center)
            }
        }
        IconButton(Icons.More, "More", onMore, size = 24.dp)
    }
}

/** the glass pill that opens the queue */
@Composable
private fun QueueChip(next: QueueItem?) {
    val ui = LocalAppUi.current
    val colors = Vyse.colors
    Row(
        Modifier
            .heightIn(min = 44.dp)
            .glass(CircleShape, GlassKind.Control, shadow = false)
            .pressable({ ui.showQueue() }, label = "Up next")
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Queue, null, size = 18.dp)
        Spacer(Modifier.width(8.dp))
        Txt("Up next", Vyse.type.callout, maxLines = 1)
        if (next != null) {
            Txt("  ·  ${next.track.title}", Vyse.type.caption, color = colors.ink2, maxLines = 1, modifier = Modifier.widthIn(max = 170.dp))
        }
    }
}

/** the full player, sliding up over everything */
@Composable
fun NowPlaying() {
    val ui = LocalAppUi.current
    val sheet = ui.player
    val queue by ui.playback.queue.collectAsState()
    val status by ui.playback.status.collectAsState()
    val item = queue.current
    LaunchedEffect(item == null) { if (item == null) sheet.hide() }
    val visible by remember { derivedStateOf { sheet.expand > 0f } }
    if (!visible || item == null) return

    BackHandler(sheet.open) { sheet.hide() }
    val look = rememberCoverLook(item.track.artwork)
    val context = queue.context
    val openContext: (() -> Unit)? = context?.id?.let { id ->
        when (context.kind) {
            "album" -> { { ui.openAlbum(id) } }
            "playlist" -> { { ui.openPlaylist(id) } }
            "artist" -> { { ui.openArtist(id) } }
            else -> null
        }
    }
    val tint = look?.tint ?: Vyse.colors.accent
    val next = queue.items.getOrNull(queue.index + 1)

    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .graphicsLayer {
                translationY = (1f - sheet.expand) * size.height
                // the corners round off as it leaves, like a card being put away
                val away = 1f - sheet.expand
                shape = RoundedCornerShape((away * 40).coerceAtMost(32f).dp)
                clip = away > 0f
            }
            .draggable(
                orientation = Orientation.Vertical,
                state = rememberDraggableState { sheet.dragBy(it) },
                onDragStopped = { velocity -> sheet.release(velocity) },
            )
            .pointerInput(Unit) { detectTapGestures { } },
    ) {
        CoverWash(look)
        val w = maxWidth
        val h = maxHeight
        val wide = w > h
        if (!wide) {
            Column(
                Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(horizontal = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                TopRow(context?.label, { sheet.hide() }, { ui.songMenu(item.track, context) }, openContext)
                Spacer(Modifier.weight(1f))
                val coverSize = min((w - 48.dp).value, (h - 430.dp).value).coerceAtLeast(160f).dp
                Cover(item, status.wantsToPlay, coverSize, tint)
                Spacer(Modifier.weight(1f))
                Titles(item, status)
                Spacer(Modifier.height(18.dp))
                SeekBar(status.durationMs)
                Spacer(Modifier.height(10.dp))
                Controls(status, queue.shuffle, queue.repeat)
                Spacer(Modifier.weight(0.7f))
                QueueChip(next)
                Spacer(Modifier.height(14.dp))
            }
        } else {
            Row(
                Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(horizontal = 24.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val coverSize = min((h - 64.dp).value, (w / 2 - 48.dp).value).coerceAtLeast(140f).dp
                Cover(item, status.wantsToPlay, coverSize, tint)
                Spacer(Modifier.width(32.dp))
                Column(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
                    TopRow(context?.label, { sheet.hide() }, { ui.songMenu(item.track, context) }, openContext)
                    Spacer(Modifier.weight(1f))
                    Titles(item, status)
                    Spacer(Modifier.height(12.dp))
                    SeekBar(status.durationMs)
                    Spacer(Modifier.height(4.dp))
                    Controls(status, queue.shuffle, queue.repeat)
                    Spacer(Modifier.weight(1f))
                    QueueChip(next)
                }
            }
        }
    }
}
