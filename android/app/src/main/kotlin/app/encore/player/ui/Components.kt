package app.encore.player.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.encore.player.core.sizedArtwork
import app.encore.player.ui.theme.Vyse
import coil3.compose.AsyncImage
import coil3.request.ImageRequest

// The small parts every screen is built from.

/** a Lucide outline icon */
internal fun lucide(name: String, vararg paths: String): ImageVector = buildIcon(name, paths, filled = false)

/** the same outline, filled: for the big player buttons */
internal fun lucideFilled(name: String, vararg paths: String): ImageVector = buildIcon(name, paths, filled = true)

private fun buildIcon(name: String, paths: Array<out String>, filled: Boolean): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        for (d in paths) {
            addPath(
                pathData = addPathNodes(d),
                fill = if (filled) SolidColor(Color.Black) else null,
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
    }.build()

/** filled versions of the player's buttons */
object FilledIcons {
    val Play: ImageVector by lazy { lucideFilled("play", "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z") }
    val Pause: ImageVector by lazy { lucideFilled("pause", "M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z", "M6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z") }
    val SkipForward: ImageVector by lazy { lucideFilled("skip-forward", "M21 4v16", "M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z") }
    val SkipBack: ImageVector by lazy { lucideFilled("skip-back", "M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z", "M3 20V4") }
}

@Composable
fun Icon(icon: ImageVector, contentDescription: String?, modifier: Modifier = Modifier, tint: Color = Vyse.colors.ink, size: Dp = 22.dp) {
    Image(
        painter = rememberVectorPainter(icon),
        contentDescription = contentDescription,
        modifier = modifier.size(size),
        colorFilter = ColorFilter.tint(tint),
    )
}

@Composable
fun Txt(
    text: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    color: Color = Vyse.colors.ink,
    maxLines: Int = Int.MAX_VALUE,
    align: TextAlign? = null,
) {
    BasicText(
        text = text,
        modifier = modifier,
        style = if (align != null) style.copy(color = color, textAlign = align) else style.copy(color = color),
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * Tappable with a springy press instead of a ripple: the element dips a little under the finger.
 * A long press gives a short buzz.
 */
@Composable
fun Modifier.pressable(
    onClick: () -> Unit,
    onLongClick: (() -> Unit)? = null,
    enabled: Boolean = true,
    pressedScale: Float = 0.96f,
    label: String? = null,
    role: Role = Role.Button,
): Modifier {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val reduce = Vyse.reduceMotion
    val scale by animateFloatAsState(
        targetValue = if (pressed && !reduce) pressedScale else 1f,
        animationSpec = if (pressed) tween(90) else androidx.compose.animation.core.spring(dampingRatio = 0.55f, stiffness = 700f),
        label = "press",
    )
    val haptics = LocalHapticFeedback.current
    return this
        .graphicsLayer {
            scaleX = scale
            scaleY = scale
            alpha = if (enabled) 1f else 0.4f
        }
        .combinedClickable(
            interactionSource = interaction,
            indication = null,
            enabled = enabled,
            onClickLabel = label,
            role = role,
            onLongClick = onLongClick?.let { long ->
                {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    long()
                }
            },
            onClick = onClick,
        )
}

/** a round icon button with a 48 dp target */
@Composable
fun IconButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = Vyse.colors.ink,
    size: Dp = 22.dp,
    enabled: Boolean = true,
) {
    Box(modifier.size(48.dp).pressable(onClick, enabled = enabled, pressedScale = 0.88f, label = label), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = tint, size = size)
    }
}

/** a cover, loaded at the size it's shown (YouTube's image server resizes it) */
@Composable
fun Artwork(
    url: String?,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(8.dp),
    size: Dp = 56.dp,
    contentDescription: String? = null,
) {
    val colors = Vyse.colors
    val px = with(LocalDensity.current) { size.roundToPx() }.coerceIn(64, 1200)
    val context = LocalContext.current
    val sized = remember(url, px) { sizedArtwork(url, px) }
    Box(modifier.size(size).clip(shape).background(colors.surface)) {
        if (sized == null) {
            Icon(Icons.Music, null, Modifier.align(Alignment.Center), tint = colors.ink3, size = (size * 0.36f).coerceIn(14.dp, 48.dp))
        } else {
            val request = remember(sized) { ImageRequest.Builder(context).data(sized).build() }
            AsyncImage(model = request, contentDescription = contentDescription, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
        }
    }
}

/** the small "E" next to explicit songs */
@Composable
fun ExplicitBadge(modifier: Modifier = Modifier) {
    val colors = Vyse.colors
    Box(
        modifier.size(15.dp).clip(RoundedCornerShape(3.dp)).background(colors.ink3),
        contentAlignment = Alignment.Center,
    ) {
        Txt("E", Vyse.type.eyebrow.copy(letterSpacing = androidx.compose.ui.unit.TextUnit.Unspecified), color = colors.bg)
    }
}

/** a thin spinning ring */
@Composable
fun Spinner(modifier: Modifier = Modifier, size: Dp = 22.dp, color: Color = Vyse.colors.accent, stroke: Dp = 2.dp) {
    val turn = rememberInfiniteTransition(label = "spin")
    val angle by turn.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing)), label = "angle")
    Box(
        modifier.size(size).drawBehind {
            val width = stroke.toPx()
            drawCircle(color.copy(alpha = 0.18f), style = Stroke(width))
            drawArc(color, startAngle = angle - 90f, sweepAngle = 100f, useCenter = false, style = Stroke(width, cap = StrokeCap.Round))
        },
    )
}

/** a pill switch in the lime of Ember & Moss */
@Composable
fun Switch(checked: Boolean, onChange: (Boolean) -> Unit, label: String, modifier: Modifier = Modifier) {
    val colors = Vyse.colors
    val position by animateFloatAsState(if (checked) 1f else 0f, androidx.compose.animation.core.spring(dampingRatio = 0.7f, stiffness = 600f), label = "switch")
    Box(
        modifier
            .size(width = 51.dp, height = 31.dp)
            .clip(CircleShape)
            .drawBehind {
                drawRect(lerpColor(colors.surface, colors.limeDeep, position))
            }
            .pressable({ onChange(!checked) }, pressedScale = 0.94f, label = label, role = Role.Switch),
    ) {
        Box(
            Modifier
                .padding(2.dp)
                .size(27.dp)
                .graphicsLayer { translationX = position * 20.dp.toPx() }
                .clip(CircleShape)
                .background(Color.White),
        )
    }
}

internal fun lerpColor(a: Color, b: Color, t: Float): Color = androidx.compose.ui.graphics.lerp(a, b, t.coerceIn(0f, 1f))

/** a title over a row or list, with an optional action on the right */
@Composable
fun SectionTitle(title: String, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Txt(title, Vyse.type.title2, Modifier.weight(1f), maxLines = 1)
        if (action != null && onAction != null) {
            Box(Modifier.padding(start = 8.dp).pressable(onAction, label = action).padding(horizontal = 4.dp, vertical = 8.dp)) {
                Txt(action, Vyse.type.callout, color = Vyse.colors.accentInk)
            }
        }
    }
}

/** a short line of state in the middle of a page: nothing here, offline, or failed */
@Composable
fun Message(
    icon: ImageVector,
    title: String,
    body: String? = null,
    modifier: Modifier = Modifier,
    action: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val colors = Vyse.colors
    Column(modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(64.dp).clip(CircleShape).background(Brush.linearGradient(listOf(colors.accent.copy(alpha = 0.22f), colors.accent.copy(alpha = 0.06f)))),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = colors.accentInk, size = 28.dp)
        }
        Spacer(Modifier.height(18.dp))
        Txt(title, Vyse.type.title3, align = TextAlign.Center)
        if (body != null) {
            Spacer(Modifier.height(6.dp))
            Txt(body, Vyse.type.body, color = colors.ink2, align = TextAlign.Center)
        }
        if (action != null && onAction != null) {
            Spacer(Modifier.height(20.dp))
            PillButton(action, onAction)
        }
    }
}

/** a solid accent button */
@Composable
fun PillButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, quiet: Boolean = false) {
    val colors = Vyse.colors
    val background = if (quiet) colors.surface else colors.accent
    val content = if (quiet) colors.ink else colors.onAccent
    Row(
        modifier
            .height(44.dp)
            .clip(CircleShape)
            .background(background)
            .pressable(onClick, label = text)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = content, size = 18.dp)
            Spacer(Modifier.width(8.dp))
        }
        Txt(text, Vyse.type.callout, color = content, maxLines = 1)
    }
}
