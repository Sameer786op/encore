package app.encore.player.youtube

import kotlin.test.Test
import kotlin.test.assertEquals

// The desktop app's stream tests (youtube/streams.test.ts).
class StreamsTest {
    private fun format(itag: Int, mime: String, kbps: Int, rate: Int, url: String? = "https://example/$itag", isDrc: Boolean = false) =
        StreamFormat(itag, url, mime, kbps * 1000L, null, rate, null, null, isDrc)

    @Test fun `takes the best audio on offer - Opus 251 over AAC 140 and the low formats`() {
        // what YouTube offered for "Tum Hi Ho" in October 2026
        val formats = listOf(
            format(139, "audio/mp4; codecs=\"mp4a.40.5\"", 50, 22050),
            format(140, "audio/mp4; codecs=\"mp4a.40.2\"", 131, 44100),
            format(249, "audio/webm; codecs=\"opus\"", 69, 48000),
            format(250, "audio/webm; codecs=\"opus\"", 88, 48000),
            format(251, "audio/webm; codecs=\"opus\"", 164, 48000),
        )
        assertEquals(251, pickAudioFormat(formats)?.itag)
    }

    @Test fun `skips video, dynamic-range-compressed copies and formats it can't fetch`() {
        val formats = listOf(
            format(18, "video/mp4; codecs=\"avc1, mp4a\"", 500, 44100),
            format(251, "audio/webm; codecs=\"opus\"", 170, 48000, isDrc = true),
            // an enciphered link needs YouTube's player script, which the phone doesn't run
            format(250, "audio/webm; codecs=\"opus\"", 160, 48000, url = null),
            format(140, "audio/mp4; codecs=\"mp4a.40.2\"", 131, 44100),
        )
        assertEquals(140, pickAudioFormat(formats)?.itag)
    }
}
