package app.encore.player.youtube

import app.encore.player.core.AlbumDetails
import app.encore.player.core.AlbumSummary
import app.encore.player.core.ArtistDetails
import app.encore.player.core.ArtistSummary
import app.encore.player.core.HomeSection
import app.encore.player.core.RemotePlaylist
import app.encore.player.core.RemotePlaylistDetails
import app.encore.player.core.SearchResults
import app.encore.player.core.SearchSuggestions
import app.encore.player.core.SuggestedItem
import app.encore.player.core.TopResult
import app.encore.player.core.Track
import app.encore.player.core.aboutTheSong
import app.encore.player.core.matchesQuery
import app.encore.player.core.normalize
import app.encore.player.core.offTarget
import app.encore.player.core.uniqueBy
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.CancellationException

// YouTube Music's catalogue: search, albums, artists, playlists, radio and home, after the
// desktop app's `youtube/catalog.ts`. The sorting of search results is the same code path, so
// a search finds the same songs in the same order on both.

/** the search filters YouTube Music offers, as its own `params` (sent as written, %3D and all) */
internal enum class SearchFilter(val params: String) {
    Songs("EgWKAQIIAQ%3D%3D"),
    Videos("EgWKAQIQAQ%3D%3D"),
    Albums("EgWKAQIYAQ%3D%3D"),
    Playlists("EgWKAQIoAQ%3D%3D"),
    Artists("EgWKAQIgAQ%3D%3D"),
}

enum class SearchKind { Artists, Albums, Playlists }

data class SearchKindResults(
    val artists: List<ArtistSummary> = emptyList(),
    val albums: List<AlbumSummary> = emptyList(),
    val playlists: List<RemotePlaylist> = emptyList(),
)

data class MoreTracks(val tracks: List<Track>, val more: String?)

/** what YouTube Music answered for one search, before it's sorted */
internal data class RawSearch(
    val general: GeneralSearch?,
    val songs: ShelfPage?,
    val videos: ShelfPage?,
    val suggestions: List<String>,
)

private fun List<Item>.tracksOf(kind: TrackKind? = null) =
    filterIsInstance<Item.OfTrack>().filter { kind == null || it.kind == kind }.map { it.track }

/** each search once, ignoring case and punctuation, leaving out any in `skip` */
internal fun distinct(list: List<String?>, skip: List<String?>): List<String> {
    val seen = skip.filterNotNull().filter { it.isNotEmpty() }.map(::normalize).toMutableSet()
    val out = mutableListOf<String>()
    for (item in list) {
        val key = item?.let(::normalize).orEmpty()
        if (key.isEmpty() || !seen.add(key)) continue
        out += item!!.trim()
    }
    return out
}

/** sorts what YouTube Music answered: songs that hold the words searched first, then videos when the songs don't have it */
internal fun searchResults(query: String, raw: RawSearch): SearchResults {
    val items = raw.general?.items.orEmpty()
    val showingFor = raw.general?.showingFor?.trim()?.ifEmpty { null }
    val didYouMean = if (showingFor != null) null else raw.general?.didYouMean?.trim()?.ifEmpty { null }
    val meant = showingFor ?: query
    // a result fits when it holds the words typed, or the spelling YouTube Music suggests for them
    fun holds(title: String, names: List<String> = emptyList()) =
        matchesQuery(meant, title, names) || (didYouMean != null && matchesQuery(didYouMean, title, names))
    fun fits(t: Track) = holds(t.title, t.artists.map { it.name } + (t.album?.title ?: ""))

    // the song filter gives richer rows (album, duration) than the mixed results, so its rows come first
    val songs = (raw.songs?.items.orEmpty().tracksOf() + items.tracksOf(TrackKind.Song)).uniqueBy { it.id }
    val songIds = songs.mapTo(HashSet()) { it.id }
    val videos = (raw.videos?.items.orEmpty().tracksOf() + items.tracksOf(TrackKind.Video)).uniqueBy { it.id }.filter { it.id !in songIds }
    val matching = songs.filter { fits(it) && !aboutTheSong(it.title, meant) }
    val clean = videos.filter { !offTarget(it.title, meant) }
    val matchingVideos = clean.filter(::fits)
    // YouTube Music's order stands while its songs fit the search; when they don't have it
    // (an upload, a regional release), the songs and videos that do fit move to the top
    val promoted = if (matching.size >= 3) emptyList() else matchingVideos.take(8)
    val tracks = if (matching.size >= 3) songs else (matching + promoted + songs).uniqueBy { it.id }

    // "Profile" rows are regular channels, not artists
    val artists = items.filterIsInstance<Item.OfArtist>().filter { !it.isProfile }.map { it.artist }.uniqueBy { it.id }
    val albums = items.filterIsInstance<Item.OfAlbum>().map { it.album }.uniqueBy { it.id }
    val promotedIds = promoted.mapTo(HashSet()) { it.id }
    val cleanIds = clean.mapTo(HashSet()) { it.id }

    var top: TopResult? = null
    raw.general?.card?.let { card ->
        when {
            card.videoId != null -> {
                // YouTube Music's top result is often the music video; it plays from here too
                val track = tracks.firstOrNull { it.sourceId == card.videoId } ?: videos.firstOrNull { it.sourceId == card.videoId }
                if (track != null) top = TopResult.OfTrack(track)
            }
            card.browseId != null && card.pageType == "MUSIC_PAGE_TYPE_ARTIST" -> top = card.asArtist()?.let { TopResult.OfArtist(it) }
            card.browseId != null && card.pageType == "MUSIC_PAGE_TYPE_ALBUM" ->
                top = (albums.firstOrNull { it.id == card.browseId } ?: card.asAlbum())?.let { TopResult.OfAlbum(it) }
        }
    }
    val topFits = when (val t = top) {
        is TopResult.OfTrack -> fits(t.track)
        is TopResult.OfArtist -> holds(t.artist.name)
        is TopResult.OfAlbum -> holds(t.album.title, t.album.artists.map { it.name })
        null -> false
    }

    return SearchResults(
        query = query,
        showingFor = showingFor,
        didYouMean = didYouMean,
        related = distinct(listOf(didYouMean) + raw.suggestions + artists.take(3).map { it.name }, listOf(query, showingFor)).take(8),
        noExactMatch = matching.isEmpty() && matchingVideos.isEmpty() && !topFits,
        top = top,
        tracks = tracks,
        albums = albums,
        artists = artists,
        // the videos people want first: the song itself, not reactions or edits
        videos = (clean + videos.filter { it.id !in cleanIds }).filter { it.id !in promotedIds },
        playlists = items.filterIsInstance<Item.OfPlaylist>().map { it.playlist }.uniqueBy { it.id },
        moreSongs = raw.songs?.continuation,
        moreVideos = raw.videos?.continuation,
    )
}

/** what's new and popular comes first */
fun homeRank(title: String): Int = when {
    Regex("quick picks", RegexOption.IGNORE_CASE).containsMatchIn(title) -> 0
    Regex("^new (releases|albums)", RegexOption.IGNORE_CASE).containsMatchIn(title) -> 1
    Regex("trending", RegexOption.IGNORE_CASE).containsMatchIn(title) -> 2
    Regex("hits|top |chart|biggest", RegexOption.IGNORE_CASE).containsMatchIn(title) -> 3
    Regex("new music videos", RegexOption.IGNORE_CASE).containsMatchIn(title) -> 4
    else -> 5
}

private fun homeSection(shelf: Shelf): HomeSection? {
    // community playlists are anyone's uploads
    if (shelf.title.isEmpty() || Regex("community", RegexOption.IGNORE_CASE).containsMatchIn(shelf.title)) return null
    val section = HomeSection(
        title = shelf.title,
        tracks = shelf.items.filterIsInstance<Item.OfTrack>().filter { it.kind != TrackKind.Other }.map { it.track }.uniqueBy { it.id },
        albums = shelf.items.filterIsInstance<Item.OfAlbum>().map { it.album }.uniqueBy { it.id },
        playlists = shelf.items.filterIsInstance<Item.OfPlaylist>().map { it.playlist }.uniqueBy { it.id },
    )
    return if (section.tracks.isEmpty() && section.albums.isEmpty() && section.playlists.isEmpty()) null else section
}

/** shelves from YouTube Music's home (both pages) and Explore, newest and most popular first */
internal fun homeSections(shelves: List<Shelf>): List<HomeSection> {
    val sections = mutableListOf<HomeSection>()
    for (shelf in shelves) {
        val section = homeSection(shelf) ?: continue
        // "New releases" and "New albums & singles" are one list
        val at = sections.indexOfFirst { it.title == section.title || (homeRank(it.title) == 1 && homeRank(section.title) == 1) }
        if (at < 0) sections += section
        else {
            val same = sections[at]
            sections[at] = same.copy(
                tracks = (same.tracks + section.tracks).uniqueBy { it.id },
                albums = (same.albums + section.albums).uniqueBy { it.id },
                playlists = (same.playlists + section.playlists).uniqueBy { it.id },
            )
        }
    }
    return sections.withIndex().sortedWith(compareBy({ homeRank(it.value.title) }, { it.index })).map { it.value }
}

/** who made a playlist, from a header like "Playlist • YouTube Music • 2026"; the page counts the songs itself */
fun playlistByline(subtitle: String): String? {
    val parts = subtitle.split("•").map { it.trim() }.filter { part ->
        part.isNotEmpty() &&
            !Regex("^(playlist|album|single|ep)$", RegexOption.IGNORE_CASE).matches(part) &&
            !Regex("^\\d{4}$").matches(part) &&
            !Regex("\\d[\\d.,]*\\s*[KMB]?\\s+(songs?|tracks?|views?)\\b", RegexOption.IGNORE_CASE).containsMatchIn(part) &&
            !Regex("\\b(hours?|minutes?|hr|min)\\b", RegexOption.IGNORE_CASE).containsMatchIn(part)
    }
    return parts.joinToString(" • ").ifEmpty { null }
}

private fun suggestedItem(item: Item, line: String): SuggestedItem? = when (item) {
    is Item.OfTrack -> if (item.kind == TrackKind.Other) null
    else SuggestedItem.OfTrack(item.track, line.ifEmpty { "Song • ${item.track.artistNames}" })
    is Item.OfArtist -> SuggestedItem.OfArtist(item.artist, if (line.isNotEmpty()) "Artist • ${line.replace(Regex("^Artist\\s*•\\s*"), "")}" else "Artist")
    is Item.OfAlbum -> SuggestedItem.OfAlbum(item.album, line.ifEmpty { "Album" })
    is Item.OfPlaylist -> SuggestedItem.OfPlaylist(item.playlist, line.ifEmpty { "Playlist" })
}

class Catalog(private val api: InnerTube) {

    private suspend fun searchPage(query: String, filter: SearchFilter? = null) =
        api.call("search", jsonOf("query" to query, "params" to filter?.params, "isAudioOnly" to true))

    private suspend fun suggestionsPage(input: String) =
        parseSuggestions(api.call("music/get_search_suggestions", jsonOf("input" to input, "isAudioOnly" to true)))

    private suspend fun fetchSearch(query: String): RawSearch = coroutineScope {
        val general = async { runCatching { parseGeneralSearch(searchPage(query)) } }
        // the song filter gives richer rows (album, duration) than the mixed results
        val songs = async { runCatching { parseFilteredSearch(searchPage(query, SearchFilter.Songs)) } }
        // songs that are only uploads, such as many regional releases, are found here
        val videos = async { runCatching { parseFilteredSearch(searchPage(query, SearchFilter.Videos)) } }
        val suggestions = async { runCatching { suggestionsPage(query).queries }.getOrDefault(emptyList()) }
        val g = general.await()
        val s = songs.await()
        val v = videos.await()
        listOf(g, s, v).firstNotNullOfOrNull { it.exceptionOrNull() as? CancellationException }?.let { throw it }
        // one kind failing still leaves the others to show
        if (g.isFailure && s.isFailure && v.isFailure) throw g.exceptionOrNull()!!
        RawSearch(g.getOrNull(), s.getOrNull(), v.getOrNull(), suggestions.await())
    }

    suspend fun search(query: String): SearchResults {
        var results = searchResults(query, fetchSearch(query))
        val words = query.trim().split(Regex("\\s+"))
        if (results.related.size < 3 && words.size > 1) {
            // a long search YouTube Music has no ideas for: ask about the start of it instead
            val shorter = words.dropLast(1).joinToString(" ")
            val more = runCatching { suggestionsPage(shorter).queries }.getOrDefault(emptyList())
            results = results.copy(related = distinct(results.related + more + shorter, listOf(query, results.showingFor)).take(8))
        }
        if (results.isEmpty) {
            // nothing at all: search what YouTube Music thinks was meant instead
            val instead = results.didYouMean ?: results.related.firstOrNull()
            if (instead != null) {
                val retry = runCatching { searchResults(instead, fetchSearch(instead)) }
                    .onFailure { if (it is CancellationException) throw it }.getOrNull()
                if (retry != null && !retry.isEmpty) {
                    val showingFor = retry.showingFor ?: instead
                    return retry.copy(
                        query = query, showingFor = showingFor, didYouMean = null,
                        related = distinct(retry.related + results.related, listOf(query, showingFor)).take(8),
                    )
                }
            }
        }
        return results
    }

    /** the next page of songs or videos, from a search's `moreSongs` or `moreVideos` */
    suspend fun searchMore(token: String): MoreTracks {
        val page = parseContinuation(api.call("search", jsonOf("continuation" to token)))
        return MoreTracks(page.items.tracksOf().uniqueBy { it.id }, page.continuation)
    }

    /** what YouTube Music suggests while typing: searches, and songs, artists, albums and playlists to open right away */
    suspend fun suggestions(query: String): SearchSuggestions {
        if (query.isBlank()) return SearchSuggestions(emptyList(), emptyList())
        val page = suggestionsPage(query)
        return SearchSuggestions(page.queries.distinct().take(6), page.rows.mapNotNull { (item, line) -> suggestedItem(item, line) }.take(5))
    }

    /** artists, albums or playlists only, for the tabs over search results */
    suspend fun searchKind(query: String, kind: SearchKind): SearchKindResults = when (kind) {
        SearchKind.Artists -> SearchKindResults(artists = searchArtists(query))
        SearchKind.Albums -> SearchKindResults(
            albums = parseFilteredSearch(searchPage(query, SearchFilter.Albums)).items.filterIsInstance<Item.OfAlbum>().map { it.album }.uniqueBy { it.id },
        )
        SearchKind.Playlists -> SearchKindResults(
            playlists = parseFilteredSearch(searchPage(query, SearchFilter.Playlists)).items.filterIsInstance<Item.OfPlaylist>().map { it.playlist }.uniqueBy { it.id },
        )
    }

    /** YouTube Music artists by name, best match first */
    suspend fun searchArtists(query: String): List<ArtistSummary> =
        parseFilteredSearch(searchPage(query, SearchFilter.Artists)).items.filterIsInstance<Item.OfArtist>().map { it.artist }.uniqueBy { it.id }

    /** songs only (no videos), for matching songs from other services */
    suspend fun searchSongs(query: String): List<Track> =
        parseFilteredSearch(searchPage(query, SearchFilter.Songs)).items.tracksOf().uniqueBy { it.id }

    /** music videos and uploads for a query, leaving out ones about a song (reactions, lessons, karaoke, compilations) */
    suspend fun searchVideos(query: String): List<Track> =
        parseFilteredSearch(searchPage(query, SearchFilter.Videos)).items.tracksOf().uniqueBy { it.id }.filter { !aboutTheSong(it.title, query) }

    suspend fun album(id: String): AlbumDetails = parseAlbum(id, api.call("browse", jsonOf("browseId" to id, "isAudioOnly" to true)))

    suspend fun artist(id: String): ArtistDetails = parseArtist(id, api.call("browse", jsonOf("browseId" to id, "isAudioOnly" to true)))

    /** a saved YouTube or YouTube Music playlist, following "load more" pages */
    private suspend fun playlistPages(id: String, maxTracks: Int): Pair<PlaylistPage, List<Item>> {
        val browseId = if (id.startsWith("VL")) id else "VL$id"
        val first = parsePlaylist(api.call("browse", jsonOf("browseId" to browseId, "isAudioOnly" to true)))
        val items = first.rows.items.toMutableList()
        var token = first.rows.continuation
        while (token != null && items.size < maxTracks) {
            val page = parseContinuation(api.call("browse", jsonOf("continuation" to token)))
            if (page.items.isEmpty()) break
            items += page.items
            token = page.continuation
        }
        return first to items.take(maxTracks)
    }

    /** a playlist's name and songs, for importing it */
    suspend fun playlist(id: String, maxTracks: Int = 5000): Pair<String, List<Track>> {
        val (page, items) = playlistPages(id, maxTracks)
        val tracks = items.tracksOf()
        // an album shared as a playlist (OLAK5uy_…) comes without a header, but every song names the album
        val albums = tracks.mapNotNull { it.album?.title }.toSet()
        return (page.title.ifEmpty { null } ?: albums.singleOrNull() ?: "YouTube playlist") to tracks
    }

    /** a YouTube Music playlist to open as a page, such as a chart */
    suspend fun remotePlaylist(id: String): RemotePlaylistDetails {
        val (page, items) = playlistPages(id, 300)
        return RemotePlaylistDetails(
            id = id.removePrefix("VL"),
            title = page.title.ifEmpty { "Playlist" },
            subtitle = playlistByline("${page.subtitle} • ${page.secondSubtitle}") ?: page.owner,
            description = page.description,
            artwork = page.artwork,
            tracks = items.tracksOf().uniqueBy { it.id },
        )
    }

    /** an endless "radio" of similar songs, seeded by a track: YouTube Music's own automix for it */
    suspend fun radio(seed: Track): List<Track> {
        val first = api.call("next", jsonOf("videoId" to seed.sourceId, "racyCheckOk" to false, "contentCheckOk" to false, "isAudioOnly" to true))
        val automix = automixEndpoint(first)
        val panel = if (automix == null) parsePanel(first)
        else parsePanel(api.call("next", jsonOf("playlistId" to automix.first, "params" to automix.second, "videoId" to seed.sourceId, "isAudioOnly" to true)))
        return panel.tracks.uniqueBy { it.id }.filter { it.id != seed.id }
    }

    /** YouTube Music's home (two pages) and Explore, as sections newest and most popular first */
    suspend fun home(): List<HomeSection> = coroutineScope {
        val feed = async { runCatching { parseHome(api.call("browse", jsonOf("browseId" to "FEmusic_home", "isAudioOnly" to true))) } }
        val explore = async { runCatching { parseHome(api.call("browse", jsonOf("browseId" to "FEmusic_explore", "isAudioOnly" to true))) } }
        val home = feed.await()
        val exploreResult = explore.await()
        listOf(home, exploreResult).firstNotNullOfOrNull { it.exceptionOrNull() as? CancellationException }?.let { throw it }
        if (home.isFailure && exploreResult.isFailure) throw home.exceptionOrNull()!!
        val more = home.getOrNull()?.continuation?.let { token ->
            runCatching { parseHome(api.call("browse", jsonOf("continuation" to token))) }
                .onFailure { if (it is CancellationException) throw it }.getOrNull()
        }
        homeSections(home.getOrNull()?.shelves.orEmpty() + more?.shelves.orEmpty() + exploreResult.getOrNull()?.shelves.orEmpty())
    }
}
