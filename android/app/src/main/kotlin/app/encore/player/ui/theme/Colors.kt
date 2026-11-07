package app.encore.player.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

// Ember & Moss, the desktop app's look (styles.css and ui/colors.ts), for the phone. Ember is a
// black window lit by ember glows under near-black glass; Moss is milky frosted glass over a pale
// moss floor with navy ink. Any accent is nudged until it reads on either.

@Immutable
data class AccentPreset(
    val id: String,
    val name: String,
    val color: Color,
    /** a two-colour swatch of its own instead of a flat one */
    val logo: Pair<Color, Color>? = null,
    /** its own signature gradient, start to end */
    val ramp: List<Color>? = null,
)

val ACCENTS = listOf(
    AccentPreset("ember", "Ember", Color(0xFFFF5A1F), Color(0xFFFFB35C) to Color(0xFFFF4D14), listOf(Color(0xFFFF5A1F), Color(0xFFFFC23D), Color(0xFF93D920))),
    AccentPreset("encore", "Ruby", Color(0xFFFA2D48)),
    AccentPreset("sunset", "Sunset", Color(0xFFFF7A1A)),
    AccentPreset("amber", "Amber", Color(0xFFFFB800)),
    AccentPreset("forest", "Forest", Color(0xFF34C759)),
    AccentPreset("mint", "Mint", Color(0xFF00C7BE)),
    AccentPreset("ocean", "Ocean", Color(0xFF0A84FF)),
    AccentPreset("indigo", "Indigo", Color(0xFF5E5CE6)),
    AccentPreset("violet", "Violet", Color(0xFFAF52DE)),
    AccentPreset("berry", "Berry", Color(0xFFFF2D87)),
    AccentPreset("aurora", "Aurora", Color(0xFF40C8F4), Color(0xFF2EE6C5) to Color(0xFF7A5CFF)),
    AccentPreset("graphite", "Graphite", Color(0xFF8E8E93), Color(0xFF9A9AA1) to Color(0xFF3A3A40)),
)

fun accentPreset(id: String): AccentPreset = ACCENTS.firstOrNull { it.id == id } ?: ACCENTS.first()

@Immutable
data class VyseColors(
    val dark: Boolean,
    val bg: Color,
    val ink: Color,
    val ink2: Color,
    val ink3: Color,
    /** quiet fills: chips, tracks, placeholders */
    val surface: Color,
    /** nearly solid panels */
    val surface2: Color,
    val surface3: Color,
    val line: Color,
    /** buttons, highlights and links */
    val accent: Color,
    /** the accent as text, at 4.5:1 or better */
    val accentInk: Color,
    val accentLight: Color,
    val accentDeep: Color,
    val onAccent: Color,
    /** the signature gradient for meters, the seek bar and gradient text, start to end */
    val ramp: List<Color>,
    /** the logo's gradient, top to bottom */
    val logo: List<Color>,
    val ember: Color,
    val peach: Color,
    val lime: Color,
    val limeDeep: Color,
    val good: Color,
    val warn: Color,
    val bad: Color,
    /** the glass tint, before its transparency */
    val glass: Color,
    val glassAlpha: Float,
    val glassControl: Color,
    val glassRim: Color,
    /** menus, sheets and toasts: always tinted enough to read */
    val menu: Color,
    val well: Color,
    val ring: Color,
    val rowOn: Color,
    val shadowK: Float,
    val backdropEdge: Color,
    val grainOpacity: Float,
)

private class Rgb(val r: Double, val g: Double, val b: Double)

private val WHITE = Rgb(255.0, 255.0, 255.0)
private val BLACK = Rgb(0.0, 0.0, 0.0)

private fun Color.rgb() = Rgb(red * 255.0, green * 255.0, blue * 255.0)

private fun Rgb.color(alpha: Float = 1f): Color {
    fun channel(v: Double) = v.roundToInt().coerceIn(0, 255)
    return Color(channel(r), channel(g), channel(b), (alpha * 255).roundToInt())
}

private fun mix(a: Rgb, b: Rgb, t: Double) = Rgb(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t)

private fun luminance(c: Rgb): Double {
    fun lin(v: Double): Double {
        val x = v / 255
        return if (x <= 0.03928) x / 12.92 else ((x + 0.055) / 1.055).pow(2.4)
    }
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

private fun contrast(a: Rgb, b: Rgb): Double {
    val la = luminance(a)
    val lb = luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
}

/** nudge a colour toward black or white until it stands out from the background */
private fun readable(color: Rgb, background: Rgb, minimum: Double): Rgb {
    val toward = if (luminance(background) > 0.5) BLACK else WHITE
    var out = color
    var step = 1
    while (step <= 10 && contrast(out, background) < minimum) {
        out = mix(color, toward, step * 0.06)
        step++
    }
    return out
}

/** how bright a colour looks, 0 to 1 */
fun Color.lightness(): Float = luminance(rgb()).toFloat()

fun vyseColors(dark: Boolean, preset: AccentPreset): VyseColors {
    val base = preset.color.rgb()
    // roughly what sits behind the accent in each theme
    val surface = if (dark) Rgb(24.0, 24.0, 28.0) else Rgb(242.0, 242.0, 247.0)
    val accent = readable(base, surface, 2.6)
    val onAccent = if (contrast(WHITE, accent) >= 3) Color.White else Color(0xFF16161A)
    val light = mix(accent, WHITE, 0.32)
    // the gradient's bright end would vanish on Moss, so each stop is deepened until it shows
    val stops = preset.ramp?.map { it.rgb() } ?: listOf(accent, mix(accent, light, 0.5), light)
    val ink = readable(base, surface, if (dark) 4.5 else 5.2)
    val logo = preset.logo?.let { (a, b) -> listOf(a, mix(a.rgb(), b.rgb(), 0.5).color(), b) }
        ?: listOf(mix(base, WHITE, 0.3).color(), base.color(), mix(base, BLACK, 0.22).color())
    val ramp = stops.map { readable(it, surface, 2.0).color() }

    return if (dark) {
        val inkColor = Color(0xFFF7F3EF)
        VyseColors(
            dark = true,
            bg = Color(0xFF030303),
            ink = inkColor,
            ink2 = inkColor.copy(alpha = 0.68f),
            ink3 = inkColor.copy(alpha = 0.5f),
            surface = Color(118, 118, 128).copy(alpha = 0.2f),
            surface2 = Color(30, 30, 34).copy(alpha = 0.96f),
            surface3 = Color.White.copy(alpha = 0.08f),
            line = Color.White.copy(alpha = 0.09f),
            accent = accent.color(),
            accentInk = ink.color(),
            accentLight = light.color(),
            accentDeep = mix(accent, BLACK, 0.35).color(),
            onAccent = onAccent,
            ramp = ramp,
            logo = logo,
            ember = Color(0xFFFF5A1F),
            peach = Color(0xFFFFD5C2),
            lime = Color(0xFFCDF35A),
            limeDeep = Color(0xFF93D920),
            good = Color(0xFF63E6A0),
            warn = Color(0xFFFFC46B),
            bad = Color(0xFFFF8A9B),
            glass = Color(14, 14, 16),
            glassAlpha = 0.3f,
            glassControl = Color(34, 34, 37),
            glassRim = Color.White.copy(alpha = 0.12f),
            menu = Color(22, 22, 24).copy(alpha = 0.8f),
            well = Color.Black.copy(alpha = 0.28f),
            ring = Color.White.copy(alpha = 0.1f),
            rowOn = Color.White.copy(alpha = 0.1f),
            shadowK = 1f,
            backdropEdge = Color.Black,
            grainOpacity = 0.2f,
        )
    } else {
        val inkColor = Color(0xFF17153B)
        VyseColors(
            dark = false,
            bg = Color(0xFFE6E6E1),
            ink = inkColor,
            ink2 = inkColor.copy(alpha = 0.78f),
            ink3 = inkColor.copy(alpha = 0.62f),
            surface = Color(118, 118, 128).copy(alpha = 0.12f),
            surface2 = Color(250, 250, 248).copy(alpha = 0.97f),
            surface3 = inkColor.copy(alpha = 0.05f),
            line = inkColor.copy(alpha = 0.1f),
            accent = accent.color(),
            accentInk = ink.color(),
            accentLight = light.color(),
            accentDeep = mix(accent, BLACK, 0.35).color(),
            onAccent = onAccent,
            ramp = ramp,
            logo = logo,
            ember = Color(0xFFFF6A2B),
            peach = Color(0xFFFFE0CF),
            lime = Color(0xFF9FD323),
            limeDeep = Color(0xFF6DB31A),
            good = Color(0xFF2F7D12),
            warn = Color(0xFFA35F00),
            bad = Color(0xFFD1123A),
            glass = Color.White,
            glassAlpha = 0.3f,
            glassControl = Color.White,
            glassRim = Color.White.copy(alpha = 0.85f),
            menu = Color(250, 250, 248).copy(alpha = 0.86f),
            well = inkColor.copy(alpha = 0.045f),
            ring = Color.White.copy(alpha = 0.8f),
            rowOn = Color.White.copy(alpha = 0.78f),
            shadowK = 0.3f,
            backdropEdge = Color.White,
            grainOpacity = 0.08f,
        )
    }
}
