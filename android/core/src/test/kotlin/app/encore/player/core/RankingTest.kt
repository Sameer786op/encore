package app.encore.player.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// The desktop app's ranking tests (youtube/ranking.test.ts), case for case.
class RankingTest {
    @Test fun `normalize drops accents, case and punctuation`() {
        assertEquals("arjit singh live", normalize("Àrjit  Singh - (Live)"))
        assertEquals("asap rocky", normalize("A\$AP Rocky"))
    }

    @Test fun `normalize keeps the vowel signs of Hindi and other scripts`() {
        assertEquals("बेखयाली", normalize("बेखयाली!"))
    }

    @Test fun `queryWords leaves out words that don't pick a song`() {
        assertEquals(listOf("tum", "hi", "ho"), queryWords("Tum Hi Ho official video song"))
        assertEquals(emptyList(), queryWords("the lyrics"))
    }

    @Test fun `needs both words of a two-word search, in the title or the artists`() {
        assertTrue(matchesQuery("arijit singh", "Tera Fitoor", listOf("Arijit Singh")))
        assertTrue(matchesQuery("o maahi", "O Maahi", listOf("Arijit Singh")))
        assertFalse(matchesQuery("o maahi", "Maahi Ve", listOf("Neha Kakkar")))
    }

    @Test fun `matches words at their start, so half-typed words count`() {
        assertTrue(matchesQuery("kesar", "Kesariya", listOf("Arijit Singh")))
        assertTrue(matchesQuery("tum hi ho", "Tum Hi Ho", listOf("Arijit Singh")))
        assertFalse(matchesQuery("tum hi ho", "Tum Hi Who", emptyList()))
    }

    @Test fun `lets a long search miss a word`() {
        assertTrue(matchesQuery("ek tarfa darshan raval live", "Ek Tarfa", listOf("Darshan Raval")))
        assertFalse(matchesQuery("ek tarfa darshan raval live", "Ek Din", listOf("Someone")))
    }

    @Test fun `takes anything when only filler words were typed`() {
        assertTrue(matchesQuery("official video", "Anything", emptyList()))
    }

    @Test fun `skips videos about a song`() {
        assertTrue(offTarget("Blinding Lights | REACTION", "blinding lights"))
        assertTrue(offTarget("Tum Hi Ho - Karaoke - Aashiqui 2", "tum hi ho"))
        assertFalse(offTarget("Blinding Lights (Official Video)", "blinding lights"))
    }

    @Test fun `skips edits unless they were asked for`() {
        assertTrue(offTarget("worry (ultra slowed)", "worry"))
        assertFalse(offTarget("worry (ultra slowed)", "worry slowed"))
        assertFalse(offTarget("Kesariya - Lofi Flip", "kesariya lofi"))
    }

    @Test fun `skips countdowns and shorts`() {
        assertTrue(offTarget("TOP 8 BEST PHONK SONGS OF 2026 #short", "brazilian phonk"))
        assertFalse(offTarget("Top 8 phonk", "top 8 phonk"))
    }

    @Test fun `lets songs be edits, since the popular version of a song can be one`() {
        assertFalse(aboutTheSong("worry (ultra slowed)", "worry"))
        assertTrue(aboutTheSong("Blinding Lights | REACTION", "blinding lights"))
    }

    @Test fun `matches whole words, so a title that only contains one isn't skipped`() {
        assertFalse(offTarget("Statusphere", "statusphere"))
        assertFalse(offTarget("Reactions in Time", "time"))
    }
}
