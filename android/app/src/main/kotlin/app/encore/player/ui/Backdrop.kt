package app.encore.player.ui

import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import android.util.LruCache
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.FloatState
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.palette.graphics.Palette
import app.encore.player.core.sizedArtwork
import app.encore.player.ui.theme.Vyse
import coil3.imageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

// The window behind everything, as on the desktop. Ember is black, lit from the bottom right by
// the accent and a peach glow, with the playing cover's colour coming in from the top left. Moss
// is a pale floor with moss-green light pooling at the bottom. Both drift very slowly and carry
// a fine grain. The glows are separate layers that only move, so the drift costs next to nothing.

/**
 * the colours of a cover: a tiny copy for washes, toned for each look, and its liveliest colour
 * for glows
 */
@Immutable
class CoverLook(val dark: ImageBitmap, val light: ImageBitmap, val tint: Color) {
    fun wash(isDark: Boolean) = if (isDark) dark else light
}

object CoverLooks {
    private val cache = LruCache<String, CoverLook>(64)

    fun peek(url: String): CoverLook? = cache.get(url)

    suspend fun load(context: Context, url: String): CoverLook? {
        cache.get(url)?.let { return it }
        return try {
            val request = ImageRequest.Builder(context).data(sizedArtwork(url, 120)).size(120).allowHardware(false).build()
            val result = context.imageLoader.execute(request) as? SuccessResult ?: return null
            val look = withContext(Dispatchers.Default) { compute(result.image.toBitmap()) }
            cache.put(url, look)
            look
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }

    private fun compute(source: Bitmap): CoverLook {
        var bitmap = if (source.config == Bitmap.Config.ARGB_8888) source else source.copy(Bitmap.Config.ARGB_8888, false)
        // halving with filtering averages each 2 x 2 block, so this ends as a true average, not a sample
        while (bitmap.width > 24 && bitmap.height > 24) bitmap = Bitmap.createScaledBitmap(bitmap, bitmap.width / 2, bitmap.height / 2, true)
        val wash = Bitmap.createScaledBitmap(bitmap, 12, 12, true)
        val palette = Palette.from(source).maximumColorCount(16).generate()
        val swatch = palette.vibrantSwatch ?: palette.lightVibrantSwatch ?: palette.dominantSwatch ?: palette.mutedSwatch
        val tint = swatch?.let { Color(it.rgb) } ?: Color(0xFFFF5A1F)
        return CoverLook(tone(wash, dark = true).asImageBitmap(), tone(wash, dark = false).asImageBitmap(), tint)
    }

    /**
     * squeezes the wash's brightness into a band that suits the look, so a pale cover doesn't turn
     * Ember's player grey and a dark one doesn't muddy Moss; colour is kept, a little richer in Ember
     */
    private fun tone(wash: Bitmap, dark: Boolean): Bitmap {
        val pixels = IntArray(wash.width * wash.height)
        wash.getPixels(pixels, 0, wash.width, 0, 0, wash.width, wash.height)
        val hsv = FloatArray(3)
        for (i in pixels.indices) {
            android.graphics.Color.colorToHSV(pixels[i], hsv)
            if (dark) {
                hsv[1] = (hsv[1] * 1.15f).coerceAtMost(1f)
                hsv[2] = 0.14f + hsv[2] * 0.5f
            } else {
                hsv[1] *= 0.75f
                hsv[2] = 0.62f + hsv[2] * 0.38f
            }
            pixels[i] = android.graphics.Color.HSVToColor(hsv)
        }
        return Bitmap.createBitmap(pixels, wash.width, wash.height, Bitmap.Config.ARGB_8888)
    }
}

/** the look of a cover, keeping the last one until the next is ready so colours change smoothly */
@Composable
fun rememberCoverLook(url: String?): CoverLook? {
    val context = LocalContext.current
    var look by remember { mutableStateOf(url?.let(CoverLooks::peek)) }
    LaunchedEffect(url) {
        look = if (url == null) null else CoverLooks.peek(url) ?: CoverLooks.load(context, url) ?: look
    }
    return look
}

/** the backdrop as a recorded layer, so a page sliding in can carry an identical copy */
val LocalBackdropLayer = staticCompositionLocalOf<GraphicsLayer?> { null }

private const val DRIFT_SECONDS = 26f

@Composable
private fun rememberDrift(): FloatState {
    val drift = remember { mutableFloatStateOf(0f) }
    val reduce = Vyse.reduceMotion
    if (!reduce) {
        LaunchedEffect(Unit) {
            val start = SystemClock.uptimeMillis() - (drift.floatValue * 1000).toLong()
            // the glows move a pixel or two a second, so fifteen steps a second is already smooth
            while (true) {
                drift.floatValue = (SystemClock.uptimeMillis() - start) / 1000f
                delay(66)
            }
        }
    }
    return drift
}

/** one soft light; it only moves its layer as it drifts */
@Composable
private fun Glow(
    color: State<Color>,
    cx: Float,
    cy: Float,
    radius: Float,
    stops: List<Pair<Float, Float>>,
    drift: FloatState,
    phase: Float,
    reach: Float = 0.045f,
) {
    Box(
        Modifier
            .fillMaxSize()
            .graphicsLayer {
                val t = drift.floatValue / DRIFT_SECONDS * 2f * PI.toFloat() + phase
                translationX = sin(t) * size.width * reach
                translationY = cos(t * 0.8f) * size.height * reach * 0.6f
            }
            .drawWithCache {
                val c = color.value
                val brush = Brush.radialGradient(
                    colorStops = stops.map { (at, alpha) -> at to c.copy(alpha = c.alpha * alpha) }.toTypedArray(),
                    center = Offset(cx * size.width, cy * size.height),
                    radius = radius * size.width,
                )
                // drawn past the edges so the drift never shows where the layer ends
                val pad = size.width * 0.2f
                onDrawBehind { drawRect(brush, topLeft = Offset(-pad, -pad), size = Size(size.width + pad * 2, size.height + pad * 2)) }
            },
    )
}

private val grainTile: ImageBitmap by lazy {
    val size = 96
    val random = Random(7)
    val pixels = IntArray(size * size) {
        val v = 96 + random.nextInt(64)
        (0xFF shl 24) or (v shl 16) or (v shl 8) or v
    }
    Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888).asImageBitmap()
}

@Composable
private fun Grain(opacity: Float) {
    Box(
        Modifier.fillMaxSize().drawWithCache {
            val paint = Paint().apply {
                shader = ImageShader(grainTile, TileMode.Repeated, TileMode.Repeated)
                alpha = opacity
                // overlay leaves black alone and roughens only what's lit, as on the desktop
                blendMode = BlendMode.Overlay
                filterQuality = FilterQuality.None
            }
            onDrawBehind {
                // two screen pixels to a grain, or it's too fine to see on a phone
                drawIntoCanvas { canvas ->
                    canvas.save()
                    canvas.scale(2f, 2f)
                    canvas.drawRect(0f, 0f, size.width / 2f, size.height / 2f, paint)
                    canvas.restore()
                }
            }
        },
    )
}

/**
 * The window behind every page. [tint] is the playing cover's colour, or null for none.
 * It records itself into [LocalBackdropLayer] when one is provided.
 */
@Composable
fun Backdrop(tint: Color?, modifier: Modifier = Modifier, layer: GraphicsLayer? = null) {
    val colors = Vyse.colors
    val drift = rememberDrift()
    val coverTint = animateColorAsState(tint ?: colors.accent, tween(1400), label = "cover")
    val recorded = if (layer != null) Modifier.drawWithContent {
        layer.record { this@drawWithContent.drawContent() }
        drawLayer(layer)
    } else Modifier
    Box(modifier.fillMaxSize().then(recorded).background(colors.bg)) {
        if (colors.dark) {
            val accent = remember(colors) { mutableStateOf(colors.accent) }
            val peach = remember { mutableStateOf(Color(255, 213, 194)) }
            Glow(coverTint, cx = 0f, cy = 0f, radius = 1.15f, stops = listOf(0f to 0.2f, 0.55f to 0.07f, 1f to 0f), drift = drift, phase = 2.1f)
            Glow(peach, cx = 1.02f, cy = 0.74f, radius = 0.62f, stops = listOf(0f to 0.3f, 0.5f to 0.08f, 1f to 0f), drift = drift, phase = 4.2f, reach = 0.03f)
            Glow(accent, cx = 0.9f, cy = 1.04f, radius = 1.05f, stops = listOf(0f to 0.5f, 0.45f to 0.16f, 1f to 0f), drift = drift, phase = 0f)
        } else {
            val white = remember { mutableStateOf(Color.White) }
            val moss = remember { mutableStateOf(Color(98, 140, 40)) }
            val deepMoss = remember { mutableStateOf(Color(70, 110, 30)) }
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFFECECEA), Color(0xFFDCDCD6)))))
            Glow(white, cx = 0.5f, cy = 0.35f, radius = 0.95f, stops = listOf(0f to 0.75f, 1f to 0f), drift = drift, phase = 1.3f, reach = 0.025f)
            Glow(coverTint, cx = 0f, cy = 0f, radius = 1.1f, stops = listOf(0f to 0.22f, 0.6f to 0.06f, 1f to 0f), drift = drift, phase = 2.1f)
            Glow(moss, cx = 0.8f, cy = 0.92f, radius = 0.9f, stops = listOf(0f to 0.5f, 0.5f to 0.14f, 1f to 0f), drift = drift, phase = 0f)
            Glow(deepMoss, cx = 0.06f, cy = 1f, radius = 0.75f, stops = listOf(0f to 0.42f, 0.55f to 0.1f, 1f to 0f), drift = drift, phase = 3.4f)
            // the floor: moss light gathering along the bottom edge
            Box(
                Modifier.fillMaxSize().drawBehind {
                    drawRect(
                        Brush.verticalGradient(0.78f to Color.Transparent, 1f to Color(98, 140, 40).copy(alpha = 0.16f)),
                    )
                },
            )
        }
        Grain(colors.grainOpacity)
    }
}

/**
 * The playing cover spread across the whole screen: the tiny copy stretched smooth, then
 * blurred on phones that can. Made once per song, never blurred live.
 */
@Composable
fun CoverWash(look: CoverLook?, modifier: Modifier = Modifier) {
    val colors = Vyse.colors
    Box(modifier.fillMaxSize().background(colors.bg)) {
        Crossfade(targetState = look, animationSpec = tween(900), label = "wash") { current ->
            if (current != null) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) renderEffect = BlurEffect(48f, 48f, TileMode.Clamp)
                            // a little bigger than the screen, so the blur's soft edge stays off it
                            scaleX = 1.15f
                            scaleY = 1.15f
                        }
                        .drawBehind {
                            val wash = current.wash(colors.dark)
                            drawImage(
                                wash,
                                srcOffset = IntOffset.Zero,
                                srcSize = IntSize(wash.width, wash.height),
                                dstOffset = IntOffset.Zero,
                                dstSize = IntSize(size.width.toInt(), size.height.toInt()),
                                filterQuality = FilterQuality.Low,
                            )
                        },
                )
            }
        }
        // keeps text readable over any cover
        Box(
            Modifier.fillMaxSize().drawBehind {
                if (colors.dark) {
                    drawRect(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.38f), Color.Black.copy(alpha = 0.52f), Color.Black.copy(alpha = 0.78f))))
                } else {
                    drawRect(Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.42f), Color.White.copy(alpha = 0.55f), Color.White.copy(alpha = 0.72f))))
                }
            },
        )
        Grain(colors.grainOpacity)
    }
}
