package app.encore.player.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ArtworkTest {
    @Test fun `asks YouTube's CDN for the size a picture is shown at`() {
        assertEquals("https://lh3.googleusercontent.com/x=w180-h180-l90-rj", sizedArtwork("https://lh3.googleusercontent.com/x=w544-h544-l90-rj", 180))
        assertEquals("https://yt3.ggpht.com/y=s300", sizedArtwork("https://yt3.ggpht.com/y=s1200", 300))
    }

    @Test fun `keeps a wide banner's shape`() {
        assertEquals("https://lh3.googleusercontent.com/b=w1080-h450-p", sizedArtwork("https://lh3.googleusercontent.com/b=w2880-h1200-p", 1080))
    }

    @Test fun `leaves other links alone`() {
        assertEquals("https://i.ytimg.com/vi/abc/hqdefault.jpg", sizedArtwork("https://i.ytimg.com/vi/abc/hqdefault.jpg", 200))
        assertEquals("content://media/1", sizedArtwork("content://media/1", 200))
        assertNull(sizedArtwork(null, 200))
    }
}
