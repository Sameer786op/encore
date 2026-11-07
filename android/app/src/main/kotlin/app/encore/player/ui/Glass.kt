package app.encore.player.ui

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.draw.innerShadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import app.encore.player.ui.theme.Vyse
import app.encore.player.ui.theme.VyseColors
import dev.chrisbanes.haze.HazeInput
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.blur.HazeBlurStyle
import dev.chrisbanes.haze.blur.HazeColorEffect
import dev.chrisbanes.haze.blur.hazeBlur

// Liquid glass, as on the desktop: a tinted, blurred, saturated pane with light caught along its
// edges (a bright line on top, a fainter one at the bottom, a hairline rim) and a soft shadow.
// Android 12 and newer blur what's behind for real; older phones get a frosted tint instead.

/** what the glass sees through: the backdrop and the page, not the bars on top */
val LocalHazeState = staticCompositionLocalOf<HazeState?> { null }

enum class GlassKind {
    /** bars and the mini player */
    Bar,
    /** small buttons and chips */
    Control,
    /** sheets, menus and toasts: always tinted enough to read over anything */
    Menu,
    /** over artwork: clear glass that lets the picture through */
    Clear,
}

val canBlur: Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

private fun saturation(amount: Float) = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(amount) })

private fun VyseColors.tint(kind: GlassKind): Color = when (kind) {
    GlassKind.Bar -> glass.copy(alpha = glassAlpha)
    GlassKind.Control -> glassControl.copy(alpha = glassAlpha * 0.85f)
    GlassKind.Menu -> menu
    GlassKind.Clear -> Color.White.copy(alpha = 0.06f)
}

/** without blur the pane has to hide what's behind it on its own */
private fun VyseColors.frosted(kind: GlassKind): Color = when (kind) {
    GlassKind.Clear -> Color.Black.copy(alpha = 0.35f)
    GlassKind.Menu -> if (dark) Color(26, 26, 29).copy(alpha = 0.97f) else Color(250, 250, 248).copy(alpha = 0.98f)
    else -> if (dark) Color(20, 20, 23).copy(alpha = 0.9f) else Color(246, 246, 243).copy(alpha = 0.92f)
}

@Composable
private fun rememberGlassStyle(kind: GlassKind): HazeBlurStyle {
    val colors = Vyse.colors
    return remember(colors, kind) {
        val radius = when (kind) {
            GlassKind.Bar, GlassKind.Menu -> 22.dp
            GlassKind.Control -> 16.dp
            GlassKind.Clear -> 12.dp
        }
        HazeBlurStyle {
            blurEnabled(canBlur)
            blurRadius(radius)
            backgroundColor(colors.bg)
            colorEffects(listOf(HazeColorEffect.colorFilter(saturation(if (kind == GlassKind.Clear) 2f else 1.9f)), HazeColorEffect.tint(colors.tint(kind))))
            fallbackColorEffect(HazeColorEffect.tint(colors.frosted(kind)))
            noiseFactor(0.06f)
        }
    }
}

/**
 * Glass under this element's content. `shadow` adds the soft drop shadow floating panes get;
 * leave it off for glass that sits flush with an edge.
 */
@Composable
fun Modifier.glass(shape: Shape, kind: GlassKind = GlassKind.Bar, shadow: Boolean = true): Modifier {
    val colors = Vyse.colors
    val haze = LocalHazeState.current
    val style = rememberGlassStyle(kind)
    var modifier = this
    if (shadow) {
        modifier = modifier
            .dropShadow(shape, Shadow(radius = 36.dp, color = Color.Black, spread = (-14).dp, offset = DpOffset(0.dp, 14.dp), alpha = 0.6f * colors.shadowK))
            .dropShadow(shape, Shadow(radius = 8.dp, color = Color.Black, spread = (-2).dp, offset = DpOffset(0.dp, 2.dp), alpha = 0.25f * colors.shadowK))
    }
    modifier = modifier.clip(shape)
    modifier = if (haze != null) modifier.hazeBlur(HazeInput.Sources(haze), style) else modifier.background(colors.frosted(kind))
    val sheen = when (kind) {
        GlassKind.Clear -> listOf(Color.White.copy(alpha = 0.14f), Color.White.copy(alpha = 0.03f))
        GlassKind.Control -> listOf(Color.White.copy(alpha = 0.1f), Color.White.copy(alpha = 0.02f))
        else -> listOf(Color.White.copy(alpha = 0.075f), Color.White.copy(alpha = 0.015f), Color.White.copy(alpha = 0.035f))
    }
    val top = if (kind == GlassKind.Clear) 0.45f else 0.3f
    return modifier
        .drawWithCache {
            val brush = Brush.verticalGradient(sheen)
            onDrawWithContent {
                drawRect(brush)
                drawContent()
            }
        }
        .innerShadow(shape, Shadow(radius = 0.5.dp, color = Color.White, offset = DpOffset(0.dp, 1.dp), alpha = top))
        .innerShadow(shape, Shadow(radius = 0.5.dp, color = Color.White, offset = DpOffset(0.dp, (-1).dp), alpha = 0.07f))
        .border(0.5.dp, if (kind == GlassKind.Clear) Color.White.copy(alpha = 0.18f) else colors.glassRim, shape)
}
