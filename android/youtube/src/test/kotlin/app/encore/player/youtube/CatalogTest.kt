package app.encore.player.youtube

import app.encore.player.core.AlbumSummary
import app.encore.player.core.ArtistRef
import app.encore.player.core.RemotePlaylist
import app.encore.player.core.TopResult
import app.encore.player.core.youtubeTrack
import kotlinx.serialization.json.JsonArray
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The desktop app's catalog tests (youtube/catalog.test.ts), case for case, plus the phone's own.

class CatalogTest {
    private fun song(id: String) = Item.OfTrack(youtubeTrack(id, "Song $id", listOf(ArtistRef(null, "Someone"))), TrackKind.Song)
    private fun album(id: String) = Item.OfAlbum(AlbumSummary(id, "Album $id"))
    private fun playlist(id: String) = Item.OfPlaylist(RemotePlaylist(id.removePrefix("VL"), "Playlist $id", "YouTube Music"))

    @Test fun `homeRank puts what's new and popular first`() {
        assertEquals(0, homeRank("Quick picks"))
        assertEquals(1, homeRank("New releases"))
        assertEquals(1, homeRank("New albums & singles"))
        assertEquals(2, homeRank("Trending"))
        assertEquals(3, homeRank("Today's biggest hits"))
        assertEquals(4, homeRank("New music videos"))
        assertEquals(5, homeRank("Mixed for you"))
    }

    @Test fun `homeSections orders shelves newest and most popular first, keeping the rest in place`() {
        val sections = homeSections(
            listOf(
                Shelf("Mixed for you", listOf(song("a"))),
                Shelf("Trending", listOf(song("b"))),
                Shelf("Long drive", listOf(song("c"))),
                Shelf("Quick picks", listOf(song("d"))),
            ),
        )
        assertEquals(listOf("Quick picks", "Trending", "Mixed for you", "Long drive"), sections.map { it.title })
    }

    @Test fun `homeSections joins the two lists of new releases and shelves that repeat on page two`() {
        val sections = homeSections(
            listOf(
                Shelf("New releases", listOf(album("x"), song("a"))),
                Shelf("Quick picks", listOf(song("b"))),
                Shelf("Quick picks", listOf(song("b"), song("c"))),
                Shelf("New albums & singles", listOf(album("x"), album("y"))),
            ),
        )
        assertEquals(listOf("Quick picks", "New releases"), sections.map { it.title })
        assertEquals(listOf("b", "c"), sections[0].tracks.map { it.sourceId })
        assertEquals(listOf("x", "y"), sections[1].albums.map { it.id })
        assertEquals(1, sections[1].tracks.size)
    }

    @Test fun `homeSections keeps charts as playlists, without the VL prefix`() {
        val charts = homeSections(listOf(Shelf("Top charts", listOf(playlist("VLPL123"), playlist("PL456"))))).single()
        assertEquals(
            listOf(RemotePlaylist("PL123", "Playlist VLPL123", "YouTube Music"), RemotePlaylist("PL456", "Playlist PL456", "YouTube Music")),
            charts.playlists,
        )
    }

    @Test fun `homeSections leaves out community playlists, empty shelves and untitled ones`() {
        val sections = homeSections(
            listOf(Shelf("From the community", listOf(playlist("PL1"))), Shelf("Nothing here", emptyList()), Shelf("", listOf(song("b")))),
        )
        assertEquals(emptyList(), sections)
    }

    @Test fun `home keeps only carousels`() {
        val page = parseHome(
            lenientJson.parseToJsonElement(
                """{"contents":{"singleColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[
                {"musicTastebuilderShelfRenderer":{"header":{"musicCarouselShelfBasicHeaderRenderer":{"title":{"runs":[{"text":"Moods"}]}}}}},
                {"musicCarouselShelfRenderer":{"header":{"musicCarouselShelfBasicHeaderRenderer":{"title":{"runs":[{"text":"Hits"}]}}},"contents":[]}}
                ]}}}}]}}}""",
            ),
        )
        assertEquals(listOf("Hits"), page.shelves.map { it.title })
    }

    @Test fun `playlistByline keeps who made it and drops what the page already shows`() {
        assertNull(playlistByline("Playlist • 2026 • 100 songs • 5 hours, 27 minutes"))
        assertEquals("YouTube Music", playlistByline("Playlist • YouTube Music • 2026 • 50 songs • 2 hr 10 min"))
        assertEquals("Chart", playlistByline("Chart • 1.2M views"))
    }

    // ---- rows (mappers.ts) ----

    private fun run(text: String, browseId: String? = null) =
        if (browseId == null) """{"text":"$text"}""" else """{"text":"$text","navigationEndpoint":{"browseEndpoint":{"browseId":"$browseId"}}}"""

    private fun column(vararg runs: String) = """{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[${runs.joinToString(",")}]}}}"""

    private fun row(columns: List<String>, fixed: String? = null, videoId: String = "abc") = listItem(
        lenientJson.parseToJsonElement(
            """{"playlistItemData":{"videoId":"$videoId"},"flexColumns":[${columns.joinToString(",")}]""" +
                (if (fixed != null) ""","fixedColumns":[{"musicResponsiveListItemFixedColumnRenderer":{"text":{"runs":[{"text":"$fixed"}]}}}]""" else "") + "}",
        ),
    )

    @Test fun `finds the artist in the second column of uploads that aren't marked as music`() {
        val track = (row(listOf(column(run("Guzaara")), column(run("Josh Brar", "UCjosh")), column(run("Aug 18, 2025")))) as Item.OfTrack).track
        assertEquals(listOf(ArtistRef("UCjosh", "Josh Brar")), track.artists)
    }

    @Test fun `reads the length from the last column when it isn't given otherwise`() {
        fun length(text: String) = (row(listOf(column(run("Song"))), fixed = text) as Item.OfTrack).track.durationMs
        assertEquals(196_000, length("3:16"))
        assertEquals(3_765_000, length("1:02:45"))
        assertEquals(0, length("Live"))
        // a length in the details wins over the last column
        val both = row(listOf(column(run("Song")), column(run("Someone", "UC1"), run(" • "), run("3:20"))), fixed = "3:16") as Item.OfTrack
        assertEquals(200_000, both.track.durationMs)
    }

    @Test fun `doesn't take a play count for an artist, and prefers the artists it was given`() {
        assertEquals(emptyList(), (row(listOf(column(run("Song")), column(run("1.2M plays")))) as Item.OfTrack).track.artists)
        val given = listItem(
            lenientJson.parseToJsonElement("""{"playlistItemData":{"videoId":"abc"},"flexColumns":[${column(run("Song"))},${column(run("Someone else"))}]}"""),
            TrackFallback(artists = listOf(ArtistRef(null, "The band"))),
        ) as Item.OfTrack
        assertEquals(listOf(ArtistRef(null, "The band")), given.track.artists)
    }

    @Test fun `names an upload's artist even when nothing links to them`() {
        val track = (row(listOf(column(run("Song")), column(run("Song"), run(" • "), run("Lata Mangeshkar & Kishore Kumar"), run(" • "), run("3M plays")))) as Item.OfTrack).track
        assertEquals(listOf("Lata Mangeshkar", "Kishore Kumar"), track.artists.map { it.name })
    }

    @Test fun `keeps a name that ran on into the album and length to just the name`() {
        val track = (row(listOf(column(run("Song")), column(run("Harpreet Bachher • Kesariya Balam • 6:42", "UC1")))) as Item.OfTrack).track
        assertEquals(listOf(ArtistRef("UC1", "Harpreet Bachher")), track.artists)
    }

    @Test fun `bestArtwork takes the largest picture, resized when the CDN allows it`() {
        val thumbs = lenientJson.parseToJsonElement(
            """[{"url":"https://lh3.googleusercontent.com/a=w60-h60","width":60},{"url":"https://lh3.googleusercontent.com/b=w226-h226","width":226}]""",
        ) as JsonArray
        assertEquals("https://lh3.googleusercontent.com/b=w544-h544", bestArtwork(thumbs))
    }

    @Test fun `bestArtwork leaves out YouTube Music's stand-in for an artist with no photo`() {
        val thumbs = lenientJson.parseToJsonElement("""[{"url":"https://www.gstatic.com/youtube/media/ytm/images/artist_avatar@1200.png","width":1200}]""") as JsonArray
        assertNull(bestArtwork(thumbs))
    }

    // ---- search results ----

    private fun track(kind: TrackKind, id: String, title: String, artist: String = "Someone") =
        Item.OfTrack(youtubeTrack(id, title, listOf(ArtistRef(null, artist))), kind)

    private fun raw(
        songs: List<Item>,
        videos: List<Item>,
        general: GeneralSearch = GeneralSearch(emptyList(), null, null, null),
        suggestions: List<String> = emptyList(),
    ) = RawSearch(general, ShelfPage(songs, null), ShelfPage(videos, null), suggestions)

    @Test fun `keeps YouTube Music's order while its songs hold the words searched`() {
        val songs = listOf(
            track(TrackKind.Song, "a", "Other Tune"), track(TrackKind.Song, "b", "Husn"),
            track(TrackKind.Song, "c", "Husn (Live)"), track(TrackKind.Song, "d", "Husn Hai"),
        )
        val r = searchResults("husn", raw(songs, listOf(track(TrackKind.Video, "v", "Husn (Official Video)"))))
        assertEquals(listOf("a", "b", "c", "d"), r.tracks.map { it.sourceId })
        assertEquals(listOf("v"), r.videos.map { it.sourceId })
        assertFalse(r.noExactMatch)
    }

    @Test fun `brings up videos of the song when the songs don't have it, skipping reactions`() {
        val songs = listOf(track(TrackKind.Song, "a", "Something Else"), track(TrackKind.Song, "b", "Another One"))
        val videos = listOf(
            track(TrackKind.Video, "r", "Ek Tarfa REACTION"), track(TrackKind.Video, "v", "Ek Tarfa", "Darshan Raval"),
            track(TrackKind.Video, "x", "Unrelated"),
        )
        val r = searchResults("ek tarfa", raw(songs, videos))
        assertEquals(listOf("v", "a", "b"), r.tracks.map { it.sourceId })
        assertEquals(listOf("x", "r"), r.videos.map { it.sourceId })
    }

    @Test fun `offers YouTube Music's spelling and suggestions as related searches, once each`() {
        val r = searchResults(
            "kesriya",
            raw(listOf(track(TrackKind.Song, "a", "Kesariya", "Arijit Singh")), emptyList(), GeneralSearch(emptyList(), null, null, "kesariya"), listOf("Kesriya", "kesariya", "kesriya song")),
        )
        assertEquals("kesariya", r.didYouMean)
        assertEquals(listOf("kesariya", "kesriya song"), r.related)
        // the corrected spelling counts as a match
        assertFalse(r.noExactMatch)
    }

    @Test fun `says what was searched instead when YouTube Music corrected the spelling itself`() {
        val r = searchResults(
            "blinding lites",
            raw(listOf(track(TrackKind.Song, "a", "Blinding Lights", "The Weeknd")), emptyList(), GeneralSearch(emptyList(), null, "blinding lights", null)),
        )
        assertEquals("blinding lights", r.showingFor)
        assertNull(r.didYouMean)
        assertFalse(r.noExactMatch)
    }

    @Test fun `marks a search nothing matches, so other searches can be offered first`() {
        val r = searchResults("zxqv wrrbl", raw(listOf(track(TrackKind.Song, "a", "No Brainer")), emptyList(), suggestions = listOf("zxqv")))
        assertTrue(r.noExactMatch)
        assertEquals(listOf("zxqv"), r.related)
    }

    @Test fun `the top card's music video plays as the top result`() {
        val card = TopCard("v", null, null, "Ek Tarfa", "Video • Darshan Raval", emptyList(), null)
        val r = searchResults(
            "ek tarfa",
            raw(listOf(track(TrackKind.Song, "a", "Ek Tarfa (Remix)")), listOf(track(TrackKind.Video, "v", "Ek Tarfa", "Darshan Raval")), GeneralSearch(emptyList(), card, null, null)),
        )
        assertEquals("v", assertIs<TopResult.OfTrack>(r.top).track.sourceId)
    }

    @Test fun `an artist card is the top result, and profiles aren't artists`() {
        val card = TopCard(null, "UCx", "MUSIC_PAGE_TYPE_ARTIST", "Arijit Singh", "Artist • 657M monthly audience", emptyList(), null)
        val general = GeneralSearch(
            listOf(
                Item.OfArtist(app.encore.player.core.ArtistSummary("UCx", "Arijit Singh", "Artist"), isProfile = false),
                Item.OfArtist(app.encore.player.core.ArtistSummary("UCp", "Arijit fan", "Profile • 2K subscribers"), isProfile = true),
            ),
            card, null, null,
        )
        val r = searchResults("arijit singh", raw(emptyList(), emptyList(), general))
        assertEquals("Arijit Singh", assertIs<TopResult.OfArtist>(r.top).artist.name)
        assertEquals(listOf("UCx"), r.artists.map { it.id })
        assertFalse(r.noExactMatch)
    }

    @Test fun `distinct keeps each search once and skips the ones given`() {
        assertEquals(listOf("Kesariya", "tum hi ho"), distinct(listOf("Kesariya", "kesariya!", null, "", "tum hi ho", "Arijit"), listOf("arijit")))
    }

    @Test fun `a visitor id made on the phone looks like one from YouTube`() {
        val id = InnerTube.localVisitorData(java.util.Random(7), 1_762_500_000)
        // 0x0A, then the id's length (11): "Cgt…", like the ids YouTube hands out
        assertTrue(id.startsWith("Cgt"), id)
        assertTrue(id.endsWith("%3D") || !id.contains("="), id)
    }
}
