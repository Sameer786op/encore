package app.encore.player.youtube

import app.encore.player.core.AlbumRef
import app.encore.player.core.AlbumSummary
import app.encore.player.core.ArtistRef
import app.encore.player.core.ArtistSummary
import app.encore.player.core.RemotePlaylist
import app.encore.player.core.Track
import app.encore.player.core.youtubeTrack
import kotlinx.serialization.json.JsonElement

// Reading YouTube Music's list rows into the app's shapes, after the desktop app's
// `youtube/mappers.ts` and the youtubei.js parsers it relies on. Where youtubei.js drops
// something the phone can use (an artist without a link, the album of an artist's top song),
// these keep it.

private const val PAGE_ALBUM = "MUSIC_PAGE_TYPE_ALBUM"
private const val PAGE_PLAYLIST = "MUSIC_PAGE_TYPE_PLAYLIST"
private const val PAGE_ARTIST = "MUSIC_PAGE_TYPE_ARTIST"
private const val PAGE_CHANNEL = "MUSIC_PAGE_TYPE_USER_CHANNEL"
private const val PAGE_NON_MUSIC = "MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE"
private const val PAGE_PODCAST = "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE"

/** what a row in a list is */
internal enum class TrackKind {
    /** a song from an album (YouTube Music's "ATV") */
    Song,

    /** a music video or an upload */
    Video,

    /** anything else that plays: podcast episodes, rows YouTube didn't label */
    Other,
}

internal sealed interface Item {
    data class OfTrack(val track: Track, val kind: TrackKind) : Item
    data class OfAlbum(val album: AlbumSummary) : Item
    data class OfArtist(val artist: ArtistSummary, val isProfile: Boolean) : Item
    data class OfPlaylist(val playlist: RemotePlaylist) : Item
}

/** what a page knows about its songs that the rows leave out */
internal data class TrackFallback(
    val album: AlbumRef? = null,
    val artwork: String? = null,
    val artists: List<ArtistRef> = emptyList(),
)

// ---- pictures ----

private val PLACEHOLDER = Regex("^https://www\\.gstatic\\.com/youtube/media/ytm/images/")
private val WIDTH_HEIGHT = Regex("=w\\d+-h\\d+")
private val SQUARE = Regex("=s\\d+")

/** the thumbnails list inside a thumbnail node, wherever YouTube nested it */
internal fun thumbnailsIn(node: JsonElement?): List<JsonElement> = node.find("thumbnails").let { (it as? kotlinx.serialization.json.JsonArray) ?: emptyList() }

/** the largest thumbnail, re-requested square at `size` px when the CDN allows resizing; null size keeps it as it is */
internal fun bestArtwork(thumbnails: List<JsonElement>, size: Int? = 544): String? {
    val largest = thumbnails.filter { it.at("url").str() != null }.maxByOrNull { it.at("width").num() ?: 0.0 } ?: return null
    val raw = largest.at("url").str()!!
    val url = if (raw.startsWith("//")) "https:$raw" else raw
    // YouTube Music's stand-in for an artist with no photo isn't their artwork; the app draws its own
    if (PLACEHOLDER.containsMatchIn(url)) return null
    if (size != null && url.contains("googleusercontent.com")) {
        if (WIDTH_HEIGHT.containsMatchIn(url)) return url.replaceFirst(WIDTH_HEIGHT, "=w$size-h$size")
        if (SQUARE.containsMatchIn(url)) return url.replaceFirst(SQUARE, "=s$size")
    }
    return url
}

// ---- text runs ----

private val DURATION = Regex("^\\d+(?::[0-5]\\d)+$")
private val YEAR = Regex("^[12]\\d{3}$")
private val STAT = Regex("\\b(views?|plays?|subscribers?|monthly audience|songs?|episodes?|likes?)\\b", RegexOption.IGNORE_CASE)
private val NAME_SPLIT = Regex(",\\s*|\\s+&\\s+")
private val JOINERS = setOf(",", "&")

/** the words YouTube Music puts first in a row to say what it is */
private val TYPE_LABELS = setOf("song", "video", "episode", "album", "single", "ep", "playlist", "artist", "profile", "podcast")

/** "4:29" or "1:02:45" in seconds */
internal fun durationSeconds(text: String): Long? {
    val t = text.trim()
    if (!DURATION.matches(t)) return null
    return t.split(":").fold(0L) { total, part -> total * 60 + part.toLong() }
}

/** a row's details split at its " • " separators */
internal fun segments(runs: List<Run>): List<List<Run>> {
    val out = mutableListOf<MutableList<Run>>(mutableListOf())
    for (run in runs) {
        if (run.text.trim() == "•") out += mutableListOf<Run>() else out.last() += run
    }
    return out.filter { segment -> segment.any { it.text.isNotBlank() } }
}

private fun isStat(text: String): Boolean {
    val t = text.trim()
    return DURATION.matches(t) || YEAR.matches(t) || STAT.containsMatchIn(t)
}

/** "Harpreet Bachher • Kesariya Balam • 6:42" in a name means the row ran on into it */
private fun cleanName(text: String) = text.split(" • ")[0].trim()

/** the artists a row links to, in the part of its details that holds them, with unlinked names next to them */
internal fun linkedArtists(runs: List<Run>): List<ArtistRef> {
    val segment = segments(runs).firstOrNull { part -> part.any { it.isArtistLink } } ?: return emptyList()
    return segment
        .filter { it.text.trim() !in JOINERS && it.text.isNotBlank() }
        .flatMap { run ->
            if (run.isArtistLink) listOf(ArtistRef(run.browseId, cleanName(run.text)))
            else cleanName(run.text).split(NAME_SPLIT).map { ArtistRef(null, it.trim()) }
        }
        .filter { it.name.isNotEmpty() }
}

/** names in a row that links to no artist, such as some uploads: the first part that isn't a label or a count */
internal fun unlinkedArtists(runs: List<Run>): List<ArtistRef> {
    val parts = segments(runs).dropWhile { part -> part.joined().trim().lowercase() in TYPE_LABELS }
    val names = parts.firstOrNull { part -> part.none { it.isAlbumLink || it.browseId != null } }?.joined()?.trim() ?: return emptyList()
    if (isStat(names)) return emptyList()
    return names.split(NAME_SPLIT).map { ArtistRef(null, cleanName(it)) }.filter { it.name.isNotEmpty() }
}

/** artist links inside a header's text, e.g. an album's "The Weeknd, Playboi Carti & Doechii" */
internal fun artistsFromRuns(runs: List<Run>): List<ArtistRef> {
    val linked = runs.filter { it.isArtistLink && it.text.isNotBlank() }.map { ArtistRef(it.browseId, it.text.trim()) }
    if (linked.isNotEmpty()) return linked
    val plain = runs.joined().trim()
    return if (plain.isEmpty()) emptyList() else plain.split(NAME_SPLIT).map { ArtistRef(null, it.trim()) }.filter { it.name.isNotEmpty() }
}

private val ALBUM_KINDS = setOf("album", "single", "ep", "compilation", "mixtape", "soundtrack", "live album", "audiobook", "dj mix")

/** "Album", "Single" or "EP" from details like "Single • 2026" */
internal fun albumKind(details: List<Run>): String? {
    val label = segments(details).firstOrNull()?.joined()?.trim() ?: return null
    return label.takeIf { it.lowercase() in ALBUM_KINDS }
}

private fun isExplicit(badges: List<JsonElement>) =
    badges.any { it.at("musicInlineBadgeRenderer", "icon", "iconType").str() == "MUSIC_EXPLICIT_BADGE" }

private fun kindOf(musicVideoType: String?): TrackKind = when (musicVideoType) {
    "MUSIC_VIDEO_TYPE_ATV" -> TrackKind.Song
    "MUSIC_VIDEO_TYPE_OMV", "MUSIC_VIDEO_TYPE_UGC", "MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC" -> TrackKind.Video
    else -> TrackKind.Other
}

// ---- musicResponsiveListItemRenderer: rows in search, albums, playlists, artist pages ----

/** one row of a list; null when it isn't something the app can show */
internal fun listItem(row: JsonElement?, fallback: TrackFallback = TrackFallback()): Item? {
    val r = row.obj() ?: return null
    val endpoint = r["navigationEndpoint"]
    val columns = r.list("flexColumns").map { runs(it.at("musicResponsiveListItemFlexColumnRenderer", "text")) }
    val fixed = r.list("fixedColumns").map { runs(it.at("musicResponsiveListItemFixedColumnRenderer", "text")) }
    val title = columns.firstOrNull()?.joined()?.trim().orEmpty()
    if (title.isEmpty()) return null
    val details = columns.getOrNull(1).orEmpty()
    val artwork = bestArtwork(thumbnailsIn(r["thumbnail"]))
    val browseId = endpoint.at("browseEndpoint", "browseId").str()
    var pageType = endpoint.at("browseEndpoint", "browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig", "pageType").str()
    if (pageType == null && columns.any { column -> column.any { it.pageType == PAGE_NON_MUSIC } }) pageType = PAGE_NON_MUSIC

    when (pageType) {
        PAGE_ALBUM -> {
            if (browseId == null) return null
            return Item.OfAlbum(
                AlbumSummary(
                    id = browseId,
                    title = title,
                    artists = linkedArtists(details),
                    year = details.lastOrNull { YEAR.matches(it.text.trim()) }?.text?.trim(),
                    kind = albumKind(details),
                    artwork = artwork,
                ),
            )
        }
        PAGE_PLAYLIST -> {
            if (browseId == null) return null
            return Item.OfPlaylist(RemotePlaylist(browseId.removePrefix("VL"), title, details.joined().trim().ifEmpty { null }, artwork))
        }
        PAGE_ARTIST, PAGE_CHANNEL -> {
            if (browseId == null) return null
            val subtitle = details.joined().trim()
            // "Profile" rows are regular channels, not artists
            return Item.OfArtist(ArtistSummary(browseId, title, subtitle.ifEmpty { null }, artwork), isProfile = subtitle.startsWith("Profile"))
        }
        PAGE_PODCAST -> return null
    }

    val first = columns.firstOrNull()?.firstOrNull()
    val videoId = r.at("playlistItemData", "videoId").str() ?: endpoint.at("watchEndpoint", "videoId").str() ?: first?.videoId ?: return null
    val kind = if (pageType == PAGE_NON_MUSIC) TrackKind.Other else kindOf(first?.musicVideoType)
    val album = columns.drop(1).flatten().firstOrNull { it.isAlbumLink }?.let { AlbumRef(it.browseId, it.text.trim()) } ?: fallback.album
    val seconds = details.lastOrNull { DURATION.matches(it.text.trim()) }?.let { durationSeconds(it.text) }
        ?: fixed.firstOrNull()?.let { column -> column.lastOrNull { DURATION.matches(it.text.trim()) }?.let { durationSeconds(it.text) } ?: durationSeconds(column.joined()) }
        ?: 0
    val artists = linkedArtists(details).ifEmpty { fallback.artists }.ifEmpty { unlinkedArtists(details) }
    return Item.OfTrack(
        youtubeTrack(
            videoId = videoId,
            title = title,
            artists = artists,
            album = album,
            durationMs = seconds * 1000,
            artwork = artwork ?: fallback.artwork,
            explicit = isExplicit(r.list("badges")),
        ),
        kind,
    )
}

internal fun trackRow(row: JsonElement?, fallback: TrackFallback = TrackFallback()): Track? =
    (listItem(row, fallback) as? Item.OfTrack)?.track

// ---- musicTwoRowItemRenderer: cards in carousels on Home and artist pages ----

internal fun twoRowItem(item: JsonElement?): Item? {
    val r = item.obj() ?: return null
    val endpoint = r["navigationEndpoint"]
    val title = textOf(r["title"]).trim()
    if (title.isEmpty()) return null
    val subtitle = runs(r["subtitle"])
    val subtitleText = subtitle.joined().trim()
    val artwork = bestArtwork(thumbnailsIn(r["thumbnailRenderer"]))
    val browseId = endpoint.at("browseEndpoint", "browseId").str()
    val pageType = endpoint.at("browseEndpoint", "browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig", "pageType").str()
    when (pageType) {
        PAGE_ARTIST -> return browseId?.let { Item.OfArtist(ArtistSummary(it, title, subtitleText.ifEmpty { null }, artwork), isProfile = false) }
        PAGE_PLAYLIST -> return browseId?.let { Item.OfPlaylist(RemotePlaylist(it.removePrefix("VL"), title, subtitleText.ifEmpty { null }, artwork)) }
        PAGE_ALBUM -> {
            if (browseId == null) return null
            return Item.OfAlbum(
                AlbumSummary(
                    id = browseId,
                    title = title,
                    artists = linkedArtists(subtitle),
                    year = subtitle.lastOrNull()?.text?.trim()?.takeIf { YEAR.matches(it) },
                    kind = albumKind(subtitle),
                    artwork = artwork,
                ),
            )
        }
    }
    // a mix (watchPlaylistEndpoint) is a list, not one song
    val watch = endpoint.at("watchEndpoint") ?: return null
    val videoId = watch.at("videoId").str() ?: return null
    val musicVideoType = watch.at("watchEndpointMusicSupportedConfigs", "watchEndpointMusicConfig", "musicVideoType").str()
    val kind = if (musicVideoType == "MUSIC_VIDEO_TYPE_ATV" || subtitle.firstOrNull()?.text?.trim() == "Song") TrackKind.Song else TrackKind.Video
    return Item.OfTrack(
        youtubeTrack(
            videoId = videoId,
            title = title,
            artists = linkedArtists(subtitle),
            album = subtitle.firstOrNull { it.isAlbumLink }?.let { AlbumRef(it.browseId, it.text.trim()) },
            artwork = artwork,
            explicit = isExplicit(r.list("subtitleBadges")),
        ),
        kind,
    )
}

// ---- playlistPanelVideoRenderer: songs in a radio or "up next" ----

internal fun panelTrack(item: JsonElement?): Track? {
    val r = item.obj() ?: return null
    val videoId = r["videoId"].str() ?: r.at("navigationEndpoint", "watchEndpoint", "videoId").str() ?: return null
    val title = textOf(r["title"]).trim()
    if (title.isEmpty()) return null
    val byline = runs(r["longBylineText"])
    // youtubei.js only keeps linked artists; an upload's channel name is better than nothing
    val artists = linkedArtists(byline).ifEmpty {
        textOf(r["shortBylineText"]).trim().takeIf { it.isNotEmpty() }?.let { listOf(ArtistRef(null, cleanName(it))) } ?: emptyList()
    }
    return youtubeTrack(
        videoId = videoId,
        title = title,
        artists = artists,
        album = byline.firstOrNull { it.isAlbumLink }?.let { AlbumRef(it.browseId, it.text.trim()) },
        durationMs = (durationSeconds(textOf(r["lengthText"])) ?: 0) * 1000,
        artwork = bestArtwork(thumbnailsIn(r["thumbnail"])),
        explicit = isExplicit(r.list("badges")),
    )
}
