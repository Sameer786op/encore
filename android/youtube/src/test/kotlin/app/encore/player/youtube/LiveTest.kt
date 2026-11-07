package app.encore.player.youtube

import app.encore.player.core.SearchResults
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assume.assumeTrue
import org.junit.Before
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Talks to YouTube Music for real. Off by default; run with `gradlew :youtube:test -Plive`.
class LiveTest {
    private val http = OkHttpClient()
    private val api = InnerTube(http)
    private val catalog = Catalog(api)

    @Before fun onlyWhenAsked() = assumeTrue("live tests are off", System.getProperty("vyse.live") == "true")

    private fun describe(r: SearchResults) =
        "top=${r.top} tracks=${r.tracks.take(5).map { it.title + " / " + it.artistNames }} videos=${r.videos.size} albums=${r.albums.size} artists=${r.artists.map { it.name }} playlists=${r.playlists.size} related=${r.related} more=${r.moreSongs != null}"

    @Test fun `search finds the song first`() = runBlocking {
        val results = catalog.search("kesariya arijit")
        println(describe(results))
        assertEquals("Kesariya", results.tracks.first().title.substringBefore(" ("))
        assertTrue(results.albums.isNotEmpty() && results.artists.isNotEmpty())
        val more = catalog.searchMore(results.moreSongs!!)
        println("more: ${more.tracks.size} tracks, next=${more.more != null}")
        assertTrue(more.tracks.isNotEmpty())
    }

    @Test fun `a misspelling is corrected`() = runBlocking {
        val results = catalog.search("blinding lites")
        println(describe(results) + " showingFor=${results.showingFor} didYouMean=${results.didYouMean}")
        assertTrue(results.tracks.any { it.title.contains("Blinding Lights") })
    }

    @Test fun `suggestions while typing`() = runBlocking {
        val suggestions = catalog.suggestions("tum hi")
        println(suggestions)
        assertTrue(suggestions.queries.isNotEmpty())
    }

    @Test fun `album, artist and a long playlist`() = runBlocking {
        val album = catalog.album("MPREb_iM8jILFK2Qm")
        println("album ${album.title}: ${album.tracks.size} songs, ${album.artists}")
        assertEquals(9, album.tracks.size)
        val artist = catalog.artist("UCDxKh1gFWeYsqePvgVzmPoQ")
        println("artist ${artist.name}: ${artist.topTracks.size} top, ${artist.albums.size} albums, ${artist.singles.size} singles, ${artist.related.size} related")
        assertTrue(artist.topTracks.isNotEmpty())
        // a playlist of hundreds of songs comes a page at a time
        val candidates = catalog.searchKind("500 best songs of all time", SearchKind.Playlists).playlists
        val (long, declared) = candidates.firstNotNullOf { candidate ->
            val first = parsePlaylist(api.call("browse", jsonOf("browseId" to "VL${candidate.id}")))
            val count = Regex("([\\d,]+) (songs?|tracks?)").find(first.secondSubtitle)?.groupValues?.get(1)?.replace(",", "")?.toIntOrNull() ?: 0
            println("  ${candidate.title}: ${first.secondSubtitle}, first page ${first.rows.items.size} rows, more=${first.rows.continuation != null}")
            if (count > 150 && first.rows.continuation != null) candidate to count else null
        }
        val page = catalog.remotePlaylist(long.id)
        println("playlist ${page.title}: declared $declared, read ${page.tracks.size} (up to 300), byline=${page.subtitle}")
        assertTrue(page.tracks.size >= minOf(declared, 300) * 9 / 10, "only ${page.tracks.size} of $declared songs")
    }

    @Test fun `radio for a song`() = runBlocking {
        val seed = catalog.search("tum hi ho").tracks.first()
        val radio = catalog.radio(seed)
        println("radio from ${seed.title}: ${radio.size} songs, e.g. ${radio.take(3).map { it.title }}")
        assertTrue(radio.size > 20)
        assertTrue(radio.none { it.id == seed.id })
    }

    @Test fun `home sections`() = runBlocking {
        val home = catalog.home()
        println(home.map { "${it.title} (${it.tracks.size}t ${it.albums.size}a ${it.playlists.size}p)" })
        assertTrue(home.size >= 3)
    }

    @Test fun `audio plays whole from the middle`() = runBlocking {
        val streams = Streams(api, http)
        val stream = streams.resolve("NJAv_7lHUIU")
        println("stream ${stream.client} ${stream.codec} ${stream.bitrate / 1000} kbps ${stream.sampleRate} Hz ${stream.contentLength} bytes, loudness ${stream.loudnessDb}")
        // a 4 MB piece from the middle, the way the player reads it
        val start = stream.contentLength / 2
        val request = Request.Builder().url(stream.url).header("range", "bytes=$start-${start + 4 * 1024 * 1024 - 1}").header("user-agent", stream.userAgent).build()
        val read = http.newCall(request).execute().use { response ->
            assertEquals(206, response.code)
            response.body.bytes().size
        }
        println("read $read bytes from the middle")
        assertTrue(read > 1_000_000)
        // a second ask comes from the cache
        assertTrue(streams.resolve("NJAv_7lHUIU") === stream)
    }
}
