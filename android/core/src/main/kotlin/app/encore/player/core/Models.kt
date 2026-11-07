package app.encore.player.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// The app's data shapes. They match the desktop app's `src/shared/types.ts`, field for field,
// so a library saved on the PC reads the same here.

@Serializable
enum class TrackSource {
    @SerialName("youtube") YouTube,
    @SerialName("local") Local,
}

@Serializable
data class ArtistRef(val id: String? = null, val name: String)

@Serializable
data class AlbumRef(val id: String? = null, val title: String)

@Serializable
data class Track(
    /** globally unique: `source:sourceId` */
    val id: String,
    val source: TrackSource,
    val sourceId: String,
    val title: String,
    val artists: List<ArtistRef> = emptyList(),
    val album: AlbumRef? = null,
    val durationMs: Long = 0,
    val artwork: String? = null,
    val explicit: Boolean = false,
    /** ReplayGain from a local file's tags, in dB */
    val gainDb: Double? = null,
) {
    val artistNames: String get() = artists.joinToString(", ") { it.name }
}

fun trackId(source: TrackSource, sourceId: String): String =
    "${if (source == TrackSource.YouTube) "youtube" else "local"}:$sourceId"

fun youtubeTrack(
    videoId: String,
    title: String,
    artists: List<ArtistRef> = emptyList(),
    album: AlbumRef? = null,
    durationMs: Long = 0,
    artwork: String? = null,
    explicit: Boolean = false,
) = Track(trackId(TrackSource.YouTube, videoId), TrackSource.YouTube, videoId, title, artists, album, durationMs, artwork, explicit)

@Serializable
data class AlbumSummary(
    val id: String,
    val title: String,
    val artists: List<ArtistRef> = emptyList(),
    val year: String? = null,
    /** "Album", "Single", "EP" */
    val kind: String? = null,
    val artwork: String? = null,
)

@Serializable
data class ArtistSummary(
    val id: String,
    val name: String,
    val subtitle: String? = null,
    val artwork: String? = null,
)

/** a playlist on YouTube Music, such as a chart */
@Serializable
data class RemotePlaylist(
    val id: String,
    val title: String,
    val subtitle: String? = null,
    val artwork: String? = null,
)

data class AlbumDetails(
    val id: String,
    val title: String,
    val artists: List<ArtistRef>,
    val year: String?,
    val kind: String?,
    val artwork: String?,
    val description: String?,
    val tracks: List<Track>,
    /** the album as a playlist (OLAK5uy_…), for sharing */
    val playlistId: String?,
) {
    val summary get() = AlbumSummary(id, title, artists, year, kind, artwork)
}

data class ArtistDetails(
    val id: String,
    val name: String,
    /** e.g. "657M monthly audience" */
    val audience: String?,
    /** the header picture: wide on YouTube Music */
    val artwork: String?,
    val description: String?,
    val topTracks: List<Track>,
    val albums: List<AlbumSummary>,
    val singles: List<AlbumSummary>,
    /** "Fans might also like" */
    val related: List<ArtistSummary>,
) {
    val summary get() = ArtistSummary(id, name, audience, artwork)
}

data class RemotePlaylistDetails(
    val id: String,
    val title: String,
    val subtitle: String?,
    val description: String?,
    val artwork: String?,
    val tracks: List<Track>,
)

sealed interface TopResult {
    data class OfTrack(val track: Track) : TopResult
    data class OfAlbum(val album: AlbumSummary) : TopResult
    data class OfArtist(val artist: ArtistSummary) : TopResult
}

data class SearchResults(
    /** what was typed */
    val query: String,
    /** the spelling the results are for, when YouTube Music corrected what was typed */
    val showingFor: String? = null,
    /** a spelling YouTube Music thinks was meant; the results are still for what was typed */
    val didYouMean: String? = null,
    /** other searches to try, likeliest first */
    val related: List<String> = emptyList(),
    /** no song or video holds the words searched, so the song may not be there */
    val noExactMatch: Boolean = false,
    val top: TopResult? = null,
    val tracks: List<Track> = emptyList(),
    val albums: List<AlbumSummary> = emptyList(),
    val artists: List<ArtistSummary> = emptyList(),
    val videos: List<Track> = emptyList(),
    val playlists: List<RemotePlaylist> = emptyList(),
    /** pass to searchMore for the next page of songs */
    val moreSongs: String? = null,
    /** pass to searchMore for the next page of videos */
    val moreVideos: String? = null,
) {
    val isEmpty get() = tracks.isEmpty() && albums.isEmpty() && artists.isEmpty() && videos.isEmpty() && playlists.isEmpty()
}

/** what YouTube Music suggests while typing: searches, and things to open right away */
data class SearchSuggestions(val queries: List<String>, val items: List<SuggestedItem>)

sealed interface SuggestedItem {
    val subtitle: String

    data class OfTrack(val track: Track, override val subtitle: String) : SuggestedItem
    data class OfArtist(val artist: ArtistSummary, override val subtitle: String) : SuggestedItem
    data class OfAlbum(val album: AlbumSummary, override val subtitle: String) : SuggestedItem
    data class OfPlaylist(val playlist: RemotePlaylist, override val subtitle: String) : SuggestedItem
}

@Serializable
data class HomeSection(
    val title: String,
    val tracks: List<Track> = emptyList(),
    val albums: List<AlbumSummary> = emptyList(),
    val playlists: List<RemotePlaylist> = emptyList(),
    val artists: List<ArtistSummary> = emptyList(),
) {
    val isEmpty get() = tracks.isEmpty() && albums.isEmpty() && playlists.isEmpty() && artists.isEmpty()
}

/** the format a song streams in */
data class StreamQuality(
    /** "opus" or "mp4a.40.2" */
    val codec: String,
    val kbps: Int,
    val sampleRate: Int,
)

/** the id each kind of item is known by, for lists that skip repeats */
interface HasId { val id: String }

fun <T> List<T>.uniqueBy(key: (T) -> String): List<T> {
    val seen = HashSet<String>()
    return filter { seen.add(key(it)) }
}
