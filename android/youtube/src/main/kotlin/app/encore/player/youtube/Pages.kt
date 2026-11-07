package app.encore.player.youtube

import app.encore.player.core.AlbumDetails
import app.encore.player.core.AlbumRef
import app.encore.player.core.AlbumSummary
import app.encore.player.core.ArtistDetails
import app.encore.player.core.ArtistRef
import app.encore.player.core.ArtistSummary
import app.encore.player.core.RemotePlaylist
import app.encore.player.core.Track
import kotlinx.serialization.json.JsonElement

// Reading whole YouTube Music answers (search, album, artist, playlist, radio, home, player).
// Each takes the parsed JSON and returns plain data; nothing here talks to the network, so the
// tests run them against saved answers.

// ---- search ----

/** the "top result" card over general search results */
internal data class TopCard(
    val videoId: String?,
    val browseId: String?,
    val pageType: String?,
    val title: String,
    val subtitle: String,
    val subtitleRuns: List<Run>,
    val artwork: String?,
)

internal data class GeneralSearch(
    val items: List<Item>,
    val card: TopCard?,
    /** the spelling YouTube Music searched instead of what was typed */
    val showingFor: String?,
    /** a spelling YouTube Music suggests; the results are still for what was typed */
    val didYouMean: String?,
)

/** a page of rows with the token for the next page */
internal data class ShelfPage(val items: List<Item>, val continuation: String?)

private fun selectedTabContent(root: JsonElement): JsonElement? {
    val tabs = root.list("contents", "tabbedSearchResultsRenderer", "tabs")
    val tab = tabs.firstOrNull { it.at("tabRenderer", "selected").bool() == true } ?: tabs.firstOrNull()
    return tab.at("tabRenderer", "content", "sectionListRenderer") ?: root.find("sectionListRenderer")
}

private fun correction(root: JsonElement, rendererSuffix: String): String? {
    for (key in listOf("music${rendererSuffix}", rendererSuffix.replaceFirstChar { it.lowercase() })) {
        root.findAll(key).firstNotNullOfOrNull { renderer ->
            textOf(renderer.at("correctedQuery")).trim().ifEmpty { null }
                ?: renderer.at("correctedQueryEndpoint", "searchEndpoint", "query").str()?.trim()?.ifEmpty { null }
        }?.let { return it }
    }
    return null
}

internal fun parseGeneralSearch(root: JsonElement): GeneralSearch {
    val sections = selectedTabContent(root).list("contents")
    val items = mutableListOf<Item>()
    var card: TopCard? = null
    for (section in sections) {
        section.at("musicCardShelfRenderer")?.let { shelf ->
            val titleRuns = runs(shelf.at("title"))
            val first = titleRuns.firstOrNull()
            val tap = shelf.at("onTap")
            val subtitleRuns = runs(shelf.at("subtitle"))
            // where the title links to, and only when it links nowhere, where tapping the card goes
            val linked = first?.takeIf { it.videoId != null || it.browseId != null }
            card = TopCard(
                videoId = if (linked != null) linked.videoId else tap.at("watchEndpoint", "videoId").str(),
                browseId = if (linked != null) linked.browseId else tap.at("browseEndpoint", "browseId").str(),
                pageType = if (linked != null) linked.pageType
                else tap.at("browseEndpoint", "browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig", "pageType").str(),
                title = titleRuns.joined().trim(),
                subtitle = subtitleRuns.joined().trim(),
                subtitleRuns = subtitleRuns,
                artwork = bestArtwork(thumbnailsIn(shelf.at("thumbnail"))),
            )
        }
        for (row in section.list("itemSectionRenderer", "contents") + section.list("musicShelfRenderer", "contents")) {
            listItem(row.at("musicResponsiveListItemRenderer"))?.let(items::add)
        }
    }
    val showingFor = correction(root, "ShowingResultsForRenderer")
    return GeneralSearch(items, card, showingFor, if (showingFor != null) null else correction(root, "DidYouMeanRenderer"))
}

private fun shelfContinuation(shelf: JsonElement?): String? =
    shelf.at("continuations", 0, "nextContinuationData", "continuation").str()
        ?: shelf.list("contents").lastOrNull().at("continuationItemRenderer", "continuationEndpoint", "continuationCommand", "token").str()

/** a search with a filter (songs, videos, albums, playlists, artists): one shelf of rows */
internal fun parseFilteredSearch(root: JsonElement): ShelfPage {
    val shelf = selectedTabContent(root).list("contents").firstNotNullOfOrNull { it.at("musicShelfRenderer") } ?: root.find("musicShelfRenderer")
    return ShelfPage(shelf.list("contents").mapNotNull { listItem(it.at("musicResponsiveListItemRenderer")) }, shelfContinuation(shelf))
}

/** the next page of a filtered search, or of a long playlist */
internal fun parseContinuation(root: JsonElement): ShelfPage {
    val old = root.at("continuationContents")?.let { contents -> contents.obj()?.values?.firstOrNull() }
    if (old != null) {
        val rows = old.list("contents")
        return ShelfPage(rows.mapNotNull { listItem(it.at("musicResponsiveListItemRenderer")) }, shelfContinuation(old))
    }
    // the newer form: rows appended by an action, with a continuation item at the end
    val appended = root.findAll("appendContinuationItemsAction").flatMap { it.list("continuationItems") }
    val token = appended.lastOrNull().at("continuationItemRenderer", "continuationEndpoint", "continuationCommand", "token").str()
    return ShelfPage(appended.mapNotNull { listItem(it.at("musicResponsiveListItemRenderer")) }, token)
}

internal data class Suggestions(val queries: List<String>, val rows: List<Pair<Item, String>>)

/** what YouTube Music suggests while typing: searches, and rows with their "Song • Artist • plays" line */
internal fun parseSuggestions(root: JsonElement): Suggestions {
    val queries = mutableListOf<String>()
    val rows = mutableListOf<Pair<Item, String>>()
    for (section in root.list("contents")) {
        for (entry in section.list("searchSuggestionsSectionRenderer", "contents")) {
            entry.at("searchSuggestionRenderer")?.let { suggestion ->
                val text = textOf(suggestion.at("suggestion")).trim()
                    .ifEmpty { suggestion.at("navigationEndpoint", "searchEndpoint", "query").str()?.trim().orEmpty() }
                if (text.isNotEmpty()) queries += text
            }
            entry.at("musicResponsiveListItemRenderer")?.let { row ->
                val item = listItem(row) ?: return@let
                val line = textOf(row.at("flexColumns", 1, "musicResponsiveListItemFlexColumnRenderer", "text")).trim()
                rows += item to line
            }
        }
    }
    return Suggestions(queries, rows)
}

// ---- album ----

private val LIST_PARAM = Regex("[?&]list=([^&]+)")

private fun description(header: JsonElement?): String? =
    (textOf(header.at("description", "musicDescriptionShelfRenderer", "description")).ifBlank { textOf(header.at("description")) }).trim().ifEmpty { null }

internal fun parseAlbum(id: String, root: JsonElement): AlbumDetails {
    val header = root.find("musicResponsiveHeaderRenderer") ?: root.find("musicDetailHeaderRenderer")
    val title = textOf(header.at("title")).trim()
    val subtitle = textOf(header.at("subtitle"))
    val parts = subtitle.split("•").map { it.trim() }
    val artwork = bestArtwork(thumbnailsIn(header.at("thumbnail")))
    val artists = artistsFromRuns(runs(header.at("straplineTextOne"))).ifEmpty { linkedArtists(runs(header.at("subtitle"))) }
    val shelf = root.at("contents", "twoColumnBrowseResultsRenderer", "secondaryContents", "sectionListRenderer", "contents", 0, "musicShelfRenderer")
        ?: root.find("musicShelfRenderer")
    val fallback = TrackFallback(AlbumRef(id, title), artwork, artists)
    val playlistId = root.at("microformat", "microformatDataRenderer", "urlCanonical").str()?.let { LIST_PARAM.find(it)?.groupValues?.get(1) }
        ?: header.findAll("watchPlaylistEndpoint").firstNotNullOfOrNull { it.at("playlistId").str() }
    return AlbumDetails(
        id = id,
        title = title,
        artists = artists,
        year = parts.getOrNull(1)?.ifEmpty { null },
        kind = parts.getOrNull(0)?.ifEmpty { null },
        artwork = artwork,
        description = description(header),
        tracks = shelf.list("contents").mapNotNull { trackRow(it.at("musicResponsiveListItemRenderer"), fallback) },
        playlistId = playlistId,
    )
}

// ---- artist ----

private class Carousel(val title: String, val items: List<Item>)

internal fun parseArtist(id: String, root: JsonElement): ArtistDetails {
    val header = root.at("header", "musicImmersiveHeaderRenderer") ?: root.at("header", "musicVisualHeaderRenderer") ?: root.at("header")?.obj()?.values?.firstOrNull()
    val name = textOf(header.at("title")).trim()
    val sections = root.list("contents", "singleColumnBrowseResultsRenderer", "tabs", 0, "tabRenderer", "content", "sectionListRenderer", "contents")
    val carousels = sections.mapNotNull { section ->
        val shelf = section.at("musicCarouselShelfRenderer") ?: return@mapNotNull null
        Carousel(
            textOf(shelf.at("header", "musicCarouselShelfBasicHeaderRenderer", "title")).trim(),
            shelf.list("contents").mapNotNull { twoRowItem(it.at("musicTwoRowItemRenderer")) ?: listItem(it.at("musicResponsiveListItemRenderer")) },
        )
    }
    fun carousel(pattern: Regex) = carousels.firstOrNull { pattern.containsMatchIn(it.title) }?.items.orEmpty()
    val self = listOf(ArtistRef(id, name))
    fun albums(items: List<Item>) = items.filterIsInstance<Item.OfAlbum>().map { if (it.album.artists.isEmpty()) it.album.copy(artists = self) else it.album }
    val topShelf = sections.firstNotNullOfOrNull { it.at("musicShelfRenderer") }
    val about = description(header) ?: sections.firstNotNullOfOrNull { textOf(it.at("musicDescriptionShelfRenderer", "description")).trim().ifEmpty { null } }
    return ArtistDetails(
        id = id,
        name = name,
        audience = textOf(header.at("monthlyListenerCount")).trim().ifEmpty { null },
        // the header picture is a wide banner; keep it as it is
        artwork = bestArtwork(thumbnailsIn(header.at("thumbnail")), size = null),
        description = about,
        topTracks = topShelf.list("contents").mapNotNull { trackRow(it.at("musicResponsiveListItemRenderer"), TrackFallback(artists = self)) },
        albums = albums(carousel(Regex("album", RegexOption.IGNORE_CASE))),
        singles = albums(carousel(Regex("single", RegexOption.IGNORE_CASE))),
        related = carousel(Regex("fans might also like|similar|related", RegexOption.IGNORE_CASE)).filterIsInstance<Item.OfArtist>().map { it.artist },
    )
}

// ---- playlist ----

internal data class PlaylistPage(
    val title: String,
    /** e.g. "Playlist • YouTube Music • 2026" */
    val subtitle: String,
    /** e.g. "52 songs • 3 hours, 23 minutes" */
    val secondSubtitle: String,
    val description: String?,
    val artwork: String?,
    /** who made it, e.g. "YouTube Music", when the header shows their picture and name */
    val owner: String?,
    val rows: ShelfPage,
)

internal fun parsePlaylist(root: JsonElement): PlaylistPage {
    val header = root.find("musicResponsiveHeaderRenderer") ?: root.find("musicDetailHeaderRenderer") ?: root.find("musicEditablePlaylistDetailHeaderRenderer").find("musicResponsiveHeaderRenderer")
    val shelf = root.find("musicPlaylistShelfRenderer") ?: root.find("musicShelfRenderer")
    return PlaylistPage(
        title = textOf(header.at("title")).trim(),
        subtitle = textOf(header.at("subtitle")).trim(),
        secondSubtitle = textOf(header.at("secondSubtitle")).trim(),
        description = description(header),
        artwork = bestArtwork(thumbnailsIn(header.at("thumbnail"))),
        owner = (header.at("facepile", "avatarStackViewModel", "text", "content").str() ?: textOf(header.at("straplineTextOne"))).trim().ifEmpty { null },
        rows = ShelfPage(shelf.list("contents").mapNotNull { listItem(it.at("musicResponsiveListItemRenderer")) }, shelfContinuation(shelf)),
    )
}

// ---- up next and radio ----

/** the playlist id and params YouTube Music's own radio ("automix") for a song starts from */
internal fun automixEndpoint(root: JsonElement): Pair<String, String?>? {
    val endpoint = root.find("automixPreviewVideoRenderer").find("watchPlaylistEndpoint") ?: return null
    val playlistId = endpoint.at("playlistId").str() ?: return null
    return playlistId to endpoint.at("params").str()
}

internal data class Panel(val tracks: List<Track>, val continuation: String?)

/** the songs in an up-next or radio panel, in order */
internal fun parsePanel(root: JsonElement): Panel {
    val panel = root.find("playlistPanelRenderer") ?: root.at("continuationContents", "playlistPanelContinuation")
    val tracks = panel.list("contents").mapNotNull { entry ->
        panelTrack(entry.at("playlistPanelVideoRenderer") ?: entry.at("playlistPanelVideoWrapperRenderer", "primaryRenderer", "playlistPanelVideoRenderer"))
    }
    val token = panel.at("continuations", 0, "nextRadioContinuationData", "continuation").str()
        ?: panel.at("continuations", 0, "nextContinuationData", "continuation").str()
    return Panel(tracks, token)
}

// ---- home ----

/** a row of cards on YouTube Music's home or Explore pages */
internal data class Shelf(val title: String, val items: List<Item>)

internal data class HomePage(val shelves: List<Shelf>, val continuation: String?)

private fun shelves(contents: List<JsonElement>): List<Shelf> = contents.mapNotNull { section ->
    // only carousels: the taste builder, mood buttons and the like aren't music
    val shelf = section.at("musicCarouselShelfRenderer") ?: return@mapNotNull null
    Shelf(
        textOf(shelf.at("header", "musicCarouselShelfBasicHeaderRenderer", "title")).trim(),
        shelf.list("contents").mapNotNull { twoRowItem(it.at("musicTwoRowItemRenderer")) ?: listItem(it.at("musicResponsiveListItemRenderer")) },
    )
}

internal fun parseHome(root: JsonElement): HomePage {
    val list = root.at("contents", "singleColumnBrowseResultsRenderer", "tabs", 0, "tabRenderer", "content", "sectionListRenderer")
        ?: root.at("continuationContents", "sectionListContinuation")
    return HomePage(shelves(list.list("contents")), list.at("continuations", 0, "nextContinuationData", "continuation").str())
}

// ---- player ----

internal data class StreamFormat(
    val itag: Int,
    /** absent when YouTube enciphered it; those formats are skipped */
    val url: String?,
    val mimeType: String,
    val bitrate: Long,
    val averageBitrate: Long?,
    val sampleRate: Int,
    val contentLength: Long?,
    val loudnessDb: Double?,
    val isDrc: Boolean,
) {
    val isAudioOnly get() = mimeType.startsWith("audio/")
}

internal data class PlayerAnswer(
    val status: String?,
    val reason: String?,
    val formats: List<StreamFormat>,
    val expiresInSeconds: Long?,
    val loudnessDb: Double?,
    val title: String?,
    val author: String?,
    val channelId: String?,
    val lengthSeconds: Long?,
    val artwork: String?,
)

internal fun parsePlayer(root: JsonElement): PlayerAnswer {
    val streaming = root.at("streamingData")
    val formats = streaming.list("adaptiveFormats").mapNotNull { format ->
        val mime = format.at("mimeType").str() ?: return@mapNotNull null
        StreamFormat(
            itag = format.at("itag").num()?.toInt() ?: 0,
            url = format.at("url").str(),
            mimeType = mime,
            bitrate = format.at("bitrate").num()?.toLong() ?: 0,
            averageBitrate = format.at("averageBitrate").num()?.toLong(),
            sampleRate = format.at("audioSampleRate").num()?.toInt() ?: 0,
            contentLength = format.at("contentLength").num()?.toLong(),
            loudnessDb = format.at("loudnessDb").num(),
            isDrc = format.at("isDrc").bool() == true,
        )
    }
    val details = root.at("videoDetails")
    return PlayerAnswer(
        status = root.at("playabilityStatus", "status").str(),
        reason = root.at("playabilityStatus", "reason").str(),
        formats = formats,
        expiresInSeconds = streaming.at("expiresInSeconds").num()?.toLong(),
        loudnessDb = root.at("playerConfig", "audioConfig", "loudnessDb").num(),
        title = details.at("title").str(),
        author = details.at("author").str(),
        channelId = details.at("channelId").str(),
        lengthSeconds = details.at("lengthSeconds").num()?.toLong(),
        artwork = bestArtwork(thumbnailsIn(details.at("thumbnail")), size = null),
    )
}

/** the best audio on offer: the highest bitrate, then the higher sample rate (streams.ts `pickAudioFormat`) */
internal fun pickAudioFormat(formats: List<StreamFormat>): StreamFormat? =
    formats
        .filter { it.isAudioOnly && !it.isDrc && it.url != null }
        .sortedWith(compareByDescending<StreamFormat> { it.bitrate }.thenByDescending { it.sampleRate })
        .firstOrNull()

/** e.g. AlbumSummary for a top card that names an album */
internal fun TopCard.asAlbum(): AlbumSummary? =
    browseId?.let { AlbumSummary(it, title, linkedArtists(subtitleRuns), artwork = artwork, kind = albumKind(subtitleRuns)) }

internal fun TopCard.asArtist(): ArtistSummary? = browseId?.let { ArtistSummary(it, title, subtitle.ifEmpty { null }, artwork) }

internal fun TopCard.asPlaylist(): RemotePlaylist? = browseId?.let { RemotePlaylist(it.removePrefix("VL"), title, subtitle.ifEmpty { null }, artwork) }
