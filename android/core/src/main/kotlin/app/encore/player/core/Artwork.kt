package app.encore.player.core

import kotlin.math.roundToInt

// YouTube's picture links (googleusercontent / ggpht) carry their size in the link, like
// "…=w544-h544-l90-rj" or "…=s1200", and the CDN draws them at any size asked for. Asking for
// the size a picture is shown at keeps lists light and the Now Playing cover sharp.

private val WIDTH_HEIGHT = Regex("=w(\\d+)-h(\\d+)")
private val SQUARE = Regex("=s(\\d+)")

private fun resizable(url: String) = url.contains("googleusercontent.com") || url.contains("ggpht.com")

/** the same picture at `px` wide, keeping its shape; links that can't be resized come back as they are */
fun sizedArtwork(url: String?, px: Int): String? {
    if (url == null || px <= 0 || !resizable(url)) return url
    WIDTH_HEIGHT.find(url)?.let { match ->
        val width = match.groupValues[1].toInt()
        val height = match.groupValues[2].toInt()
        if (width <= 0) return url
        val newHeight = (height.toDouble() * px / width).roundToInt().coerceAtLeast(1)
        return url.replaceRange(match.range, "=w$px-h$newHeight")
    }
    SQUARE.find(url)?.let { match -> return url.replaceRange(match.range, "=s$px") }
    return url
}
