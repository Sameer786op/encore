package app.encore.player.youtube

import app.encore.player.core.ArtistRef
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The parsers against real YouTube Music answers, saved in November 2026 (search "kesariya arijit",
// album Brahmastra, artist Arijit Singh, playlist The Hit List, the radio for Kesariya, home).
// Tracking tokens, the visitor id and stream links were taken out before saving.

internal fun fixture(name: String): JsonElement =
    lenientJson.parseToJsonElement(FixtureTest::class.java.getResource("/fixtures/$name.json")!!.readText())

class FixtureTest {
    private val arijit = ArtistRef("UCDxKh1gFWeYsqePvgVzmPoQ", "Arijit Singh")

    @Test fun `song search rows carry artists, album and length`() {
        val page = parseFilteredSearch(fixture("search-songs"))
        assertEquals(20, page.items.size)
        assertNotNull(page.continuation)
        val first = (page.items[0] as Item.OfTrack)
        assertEquals(TrackKind.Song, first.kind)
        with(first.track) {
            assertEquals("youtube:NJAv_7lHUIU", id)
            assertEquals("Kesariya (From \"Brahmastra\") (Tu Fuljhadiyo Wale Tyohaaro Jesi - Happy Diwali)", title)
            assertEquals(listOf(arijit), artists)
            assertEquals("Kesariya (From \"Brahmastra\")", album?.title)
            assertTrue(album?.id!!.startsWith("MPREb_"))
            assertEquals(269_000, durationMs)
            assertTrue(artwork!!.contains("=w544-h544"), artwork)
        }
        val danceMix = (page.items[1] as Item.OfTrack).track
        assertEquals(listOf("Pritam", "Shashwat Singh", "Antara Mitra", "Arijit Singh"), danceMix.artists.map { it.name })
        assertEquals(198_000, danceMix.durationMs)
    }

    @Test fun `the next page of songs reads the same way`() {
        val page = parseContinuation(fixture("search-songs-more"))
        assertEquals(20, page.items.size)
        assertTrue(page.items.all { it is Item.OfTrack && it.track.durationMs > 0 })
        assertNotNull(page.continuation)
    }

    @Test fun `video rows name the channel and the length`() {
        val page = parseFilteredSearch(fixture("search-videos"))
        val upload = (page.items[0] as Item.OfTrack)
        assertEquals(TrackKind.Video, upload.kind)
        assertEquals("r-T_Wb3VFFc", upload.track.sourceId)
        assertEquals("সা", upload.track.artists.single().name)
        assertEquals(42_000, upload.track.durationMs)
        val official = (page.items[1] as Item.OfTrack).track
        assertEquals(listOf(arijit), official.artists)
        assertEquals(266_000, official.durationMs)
    }

    @Test fun `general search has songs, videos, albums, artists, playlists and the top card`() {
        val search = parseGeneralSearch(fixture("search-general"))
        val tracks = search.items.filterIsInstance<Item.OfTrack>()
        assertEquals(5, tracks.count { it.kind == TrackKind.Song })
        assertEquals(3, tracks.count { it.kind == TrackKind.Video })
        // podcast episodes aren't songs or videos, and podcast shows aren't kept at all
        assertEquals(3, tracks.count { it.kind == TrackKind.Other })
        val albums = search.items.filterIsInstance<Item.OfAlbum>()
        assertEquals(3, albums.size)
        assertTrue(albums.all { it.album.kind == "Single" })
        val artists = search.items.filterIsInstance<Item.OfArtist>()
        assertEquals(3, artists.count { !it.isProfile })
        assertEquals(3, artists.count { it.isProfile })
        assertEquals(6, search.items.count { it is Item.OfPlaylist })
        val song = tracks.first { it.kind == TrackKind.Song }.track
        assertEquals("NJAv_7lHUIU", song.sourceId)
        assertEquals(listOf(arijit), song.artists)
        // this search's top card is a podcast episode, which isn't offered as the top result
        assertEquals("MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE", search.card?.pageType)
        assertNull(search.showingFor)
    }

    @Test fun `filtered album, playlist and artist searches`() {
        val albums = parseFilteredSearch(fixture("search-albums")).items.map { (it as Item.OfAlbum).album }
        assertEquals(19, albums.size)
        with(albums[0]) {
            assertEquals("MPREb_iM8jILFK2Qm", id)
            assertEquals("Brahmastra (Original Motion Picture Soundtrack)", title)
            assertEquals("Album", kind)
            assertEquals("2022", year)
            assertEquals("Pritam", artists.single().name)
        }
        assertEquals("EP", albums[1].kind)

        val playlists = parseFilteredSearch(fixture("search-playlists")).items.map { (it as Item.OfPlaylist).playlist }
        assertEquals(20, playlists.size)
        assertEquals("PLCU2AKdwPmvpuHDVrlI5ObzhOElwuMWOV", playlists[0].id)
        assertEquals("Libby Parker • 4M views", playlists[0].subtitle)

        val artists = parseFilteredSearch(fixture("search-artists")).items.map { (it as Item.OfArtist).artist }
        assertEquals(12, artists.size)
        assertEquals("Arijit Singh", artists[0].name)
        assertEquals("Artist • 657M monthly audience", artists[0].subtitle)
    }

    @Test fun `suggestions give searches and rows, keeping artists YouTube didn't link`() {
        val suggestions = parseSuggestions(fixture("suggestions"))
        assertEquals(listOf("kesariya", "kesari", "kesariyo rang tane lagyo", "kesari ke lal", "kesariya balam", "kesariya dance mix"), suggestions.queries)
        assertEquals(5, suggestions.rows.size)
        val (teriMitti, line) = suggestions.rows[1]
        assertEquals("Song • Arko, B Praak & Manoj Muntashir • 1B plays", line)
        assertEquals(listOf("Arko", "B Praak", "Manoj Muntashir"), (teriMitti as Item.OfTrack).track.artists.map { it.name })
        assertNull(teriMitti.track.artists.last().id)
        assertEquals("Teri Mitti (Kesari)", teriMitti.track.album?.title)
    }

    @Test fun `an album page fills its songs in from the header`() {
        val album = parseAlbum("MPREb_iM8jILFK2Qm", fixture("album"))
        assertEquals("Brahmastra (Original Motion Picture Soundtrack)", album.title)
        assertEquals("Album", album.kind)
        assertEquals("2022", album.year)
        assertEquals("Pritam", album.artists.single().name)
        assertEquals("OLAK5uy_lKJ13-VhPkGWJddilHROXhSILvFd6WxcY", album.playlistId)
        assertTrue(album.description!!.startsWith("Brahmāstra: Part One"))
        assertTrue(album.artwork!!.contains("=w544-h544"), album.artwork)
        assertEquals(9, album.tracks.size)
        with(album.tracks[0]) {
            assertEquals("BddP6PYo2gs", sourceId)
            assertEquals(listOf("Pritam", "Arijit Singh"), artists.map { it.name })
            assertEquals("MPREb_iM8jILFK2Qm", this.album?.id)
            assertEquals(album.title, this.album?.title)
            assertEquals(album.artwork, artwork)
            assertEquals(269_000, durationMs)
        }
    }

    @Test fun `an artist page has top songs with their albums, releases and related artists`() {
        val artist = parseArtist("UCDxKh1gFWeYsqePvgVzmPoQ", fixture("artist"))
        assertEquals("Arijit Singh", artist.name)
        assertEquals("657M monthly audience", artist.audience)
        assertTrue(artist.description!!.startsWith("Arijit Singh is an Indian singer"))
        // the wide banner, at the size YouTube Music gives it
        assertTrue(artist.artwork!!.contains("googleusercontent.com"))
        assertEquals(5, artist.topTracks.size)
        with(artist.topTracks[0]) {
            assertEquals("Gehra Hua (From \"Dhurandhar\")", title)
            assertEquals(4, artists.size)
            assertEquals("Gehra Hua (From \"Dhurandhar\")", album?.title)
        }
        assertEquals(10, artist.albums.size)
        assertTrue(artist.albums.all { it.year == "2026" || it.year?.length == 4 })
        // album cards on an artist's page don't name the artist; it's theirs
        assertEquals(listOf(arijit), artist.albums[0].artists)
        assertEquals(10, artist.singles.size)
        assertEquals("Single", artist.singles[0].kind)
        assertEquals(10, artist.related.size)
    }

    @Test fun `a playlist page reads its header and every row`() {
        val page = parsePlaylist(fixture("playlist"))
        assertEquals("The Hit List", page.title)
        assertEquals("Playlist • 2026", page.subtitle)
        assertEquals("52 songs • 3 hours, 23 minutes", page.secondSubtitle)
        assertEquals("The home of today's biggest and hottest hits.", page.description)
        assertEquals("YouTube Music", page.owner)
        assertEquals(52, page.rows.items.size)
        assertNull(page.rows.continuation)
        val first = (page.rows.items[0] as Item.OfTrack).track
        assertEquals("drop dead", first.title)
        assertEquals("Olivia Rodrigo", first.artists.single().name)
        assertEquals(251_000, first.durationMs)
        assertNull(playlistByline("${page.subtitle} • ${page.secondSubtitle}"))
    }

    @Test fun `radio starts from the song's automix and lists fifty songs`() {
        val (playlistId, params) = automixEndpoint(fixture("next"))!!
        assertEquals("RDAMVMNJAv_7lHUIU", playlistId)
        assertNotNull(params)
        val panel = parsePanel(fixture("radio"))
        assertEquals(50, panel.tracks.size)
        assertEquals("NJAv_7lHUIU", panel.tracks[0].sourceId)
        assertNotNull(panel.continuation)
        with(panel.tracks[1]) {
            assertEquals("Apna Bana Le (From \"Bhediya\")", title)
            assertEquals(listOf("Arijit Singh", "Sachin-Jigar"), artists.map { it.name })
            assertTrue(durationMs > 0)
            assertNotNull(album)
        }
        assertTrue(panel.tracks.all { it.artists.isNotEmpty() })
    }

    @Test fun `home has quick picks and playlists, and a next page`() {
        val home = parseHome(fixture("home"))
        assertEquals(listOf("Quick picks", "Easy Evenings"), home.shelves.map { it.title })
        assertEquals(20, home.shelves[0].items.count { it is Item.OfTrack })
        assertEquals(10, home.shelves[1].items.count { it is Item.OfPlaylist })
        assertNotNull(home.continuation)
        val sections = homeSections(home.shelves)
        assertEquals(20, sections[0].tracks.size)
        assertEquals(10, sections[1].playlists.size)
    }

    @Test fun `the Vision Pro client offers Opus 251 as the best audio`() {
        val answer = parsePlayer(fixture("player-visionos"))
        assertEquals("OK", answer.status)
        assertEquals(21540, answer.expiresInSeconds)
        val best = pickAudioFormat(answer.formats)!!
        assertEquals(251, best.itag)
        assertEquals(4_695_894, best.contentLength)
        assertEquals(48_000, best.sampleRate)
        assertEquals(5.58, best.loudnessDb)
    }

    @Test fun `the iPhone client offers AAC 140`() {
        val answer = parsePlayer(fixture("player-ios"))
        assertEquals(140, pickAudioFormat(answer.formats)!!.itag)
    }
}
