package app.encore.player.core

import java.text.Normalizer

// How well a search result fits what was typed (the desktop app's `youtube/ranking.ts`).
// YouTube Music's song search is good, but a song that's only an upload (a regional release,
// a fan edit) is found among the videos instead, next to reactions and tutorials about it.

private val COMBINING = Regex("[\\u0300-\\u036f]")
private val NOT_A_WORD = Regex("[^\\p{L}\\p{N}\\p{M}]+")

/** lowercase, Latin accents and punctuation gone, single spaces; other scripts keep their vowel signs */
fun normalize(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFKD)
        .replace(COMBINING, "")
        .lowercase()
        .replace("$", "s")
        .replace(NOT_A_WORD, " ")
        .trim()

// words that say nothing about which song is meant
private val FILLER = setOf(
    "the", "a", "an", "of", "and", "or", "in", "on", "to", "by", "feat", "ft", "featuring", "official", "video", "audio",
    "lyric", "lyrics", "lyrical", "song", "songs", "music", "full", "hd", "hq", "4k", "new", "latest",
)

fun queryWords(query: String): List<String> =
    normalize(query).split(" ").filter { it.isNotEmpty() && it !in FILLER }.distinct()

/** whether a song's title and artists hold the words searched: all of one or two, three in four of more */
fun matchesQuery(query: String, title: String, artists: List<String> = emptyList()): Boolean {
    val words = queryWords(query)
    if (words.isEmpty()) return true
    // words match at their start, so a half-typed "kesar" finds "Kesariya" but "ho" doesn't find "Who"
    val haystack = " " + normalize((listOf(title) + artists).joinToString(" "))
    val found = words.count { haystack.contains(" $it") }
    val needed = if (words.size <= 2) words.size else Math.ceil(words.size * 0.75).toInt()
    return found >= needed
}

// videos about a song rather than the song itself
private val ABOUT = listOf(
    "reaction", "reacts", "reacting", "first time hearing", "tutorial", "lesson", "how to play", "chords", "karaoke",
    "guitar cover", "piano cover", "drum cover", "bass cover", "flute cover", "violin cover", "fingerstyle",
    "choreography", "dance cover", "dance video", "dance practice", "review", "interview", "podcast", "unboxing",
    "behind the scenes", "making of", "shorts", "status", "ringtone", "1 hour", "10 hours", "hour loop",
    "jukebox", "nonstop", "non stop", "mashup", "top 10", "top 20", "top 50", "playlist", "full album", "best of", "all songs",
)

// edits of a song, which people search for by name when they want one
private val EDITS = listOf("slowed", "reverb", "reverbed", "sped up", "speed up", "nightcore", "8d", "bass boosted", "lofi", "lo fi")

private val COUNTDOWN_OR_SHORT = Regex("\\btop \\d+\\b|\\bshorts?\\b")

private fun unasked(title: String, query: String, phrases: List<String>): Boolean {
    val t = " ${normalize(title)} "
    val q = " ${normalize(query)} "
    return phrases.any { t.contains(" $it ") && !q.contains(" $it ") }
}

/** a reaction, a lesson, a compilation: something about the song rather than the song */
fun aboutTheSong(title: String, query: String): Boolean {
    val t = normalize(title)
    return unasked(title, query, ABOUT) || (COUNTDOWN_OR_SHORT.containsMatchIn(t) && !COUNTDOWN_OR_SHORT.containsMatchIn(normalize(query)))
}

/** a video that's about the song, or an edit of it nobody asked for */
fun offTarget(title: String, query: String): Boolean = aboutTheSong(title, query) || unasked(title, query, EDITS)
