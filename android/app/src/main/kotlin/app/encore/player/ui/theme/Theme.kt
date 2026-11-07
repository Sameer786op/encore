package app.encore.player.ui.theme

import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.encore.player.R

// Sora for headings and Manrope for everything else, as on the desktop; both are variable fonts
// bundled with the app.

private fun variable(res: Int, weight: Int) = Font(res, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))

val Sora = FontFamily((3..8).map { variable(R.font.sora, it * 100) })
val Manrope = FontFamily((3..8).map { variable(R.font.manrope, it * 100) })

private val tight = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)

@Immutable
data class VyseType(
    /** the big title at the top of a page */
    val hero: TextStyle = TextStyle(fontFamily = Sora, fontWeight = FontWeight.Bold, fontSize = 32.sp, lineHeight = 37.sp, letterSpacing = (-0.025).em, lineHeightStyle = tight),
    val title1: TextStyle = TextStyle(fontFamily = Sora, fontWeight = FontWeight.Bold, fontSize = 25.sp, lineHeight = 30.sp, letterSpacing = (-0.02).em, lineHeightStyle = tight),
    val title2: TextStyle = TextStyle(fontFamily = Sora, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 25.sp, letterSpacing = (-0.015).em, lineHeightStyle = tight),
    val title3: TextStyle = TextStyle(fontFamily = Sora, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 22.sp, letterSpacing = (-0.01).em, lineHeightStyle = tight),
    val body: TextStyle = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 21.sp, letterSpacing = (-0.004).em, lineHeightStyle = tight),
    val bodyStrong: TextStyle = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 15.sp, lineHeight = 20.sp, letterSpacing = (-0.006).em, lineHeightStyle = tight),
    val callout: TextStyle = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 19.sp, letterSpacing = (-0.004).em, lineHeightStyle = tight),
    val caption: TextStyle = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 17.sp, lineHeightStyle = tight),
    /** small capitals over a section */
    val eyebrow: TextStyle = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.ExtraBold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.1.em, lineHeightStyle = tight),
    val tab: TextStyle = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, lineHeight = 12.sp, letterSpacing = 0.01.em, lineHeightStyle = tight),
)

/** the desktop's curves */
object Motion {
    /** cubic-bezier(.32,.72,0,1): settles softly, like iOS */
    val EaseApple = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)
    /** cubic-bezier(.16,1,.3,1): quick out of the gate */
    val EaseOutExpo = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)

    fun <T> gentle(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.9f, stiffness = 380f)
    fun <T> snappy(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.82f, stiffness = 760f)
    fun <T> bouncy(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessMediumLow)
}

val LocalVyseColors = staticCompositionLocalOf { vyseColors(true, ACCENTS.first()) }
val LocalVyseType = staticCompositionLocalOf { VyseType() }
/** the phone's "Remove animations" is on: decorative motion stops, everything else is instant or short */
val LocalReduceMotion = staticCompositionLocalOf { false }

object Vyse {
    val colors: VyseColors
        @Composable @ReadOnlyComposable get() = LocalVyseColors.current
    val type: VyseType
        @Composable @ReadOnlyComposable get() = LocalVyseType.current
    val reduceMotion: Boolean
        @Composable @ReadOnlyComposable get() = LocalReduceMotion.current
}

@Composable
fun VyseTheme(dark: Boolean, accentId: String, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val colors = remember(dark, accentId) { vyseColors(dark, accentPreset(accentId)) }
    val reduceMotion = remember { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
    val selection = remember(colors) { TextSelectionColors(handleColor = colors.accent, backgroundColor = colors.accent.copy(alpha = 0.35f)) }
    CompositionLocalProvider(
        LocalVyseColors provides colors,
        LocalVyseType provides remember { VyseType() },
        LocalReduceMotion provides reduceMotion,
        LocalTextSelectionColors provides selection,
        content = content,
    )
}
