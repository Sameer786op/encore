package app.encore.player.data

import android.util.Log
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.encore.player.Settings
import app.encore.player.core.SearchResults
import app.encore.player.core.SearchSuggestions
import app.encore.player.core.Track
import app.encore.player.core.uniqueBy
import app.encore.player.playback.Connectivity
import app.encore.player.youtube.Catalog
import app.encore.player.youtube.SearchKind
import app.encore.player.youtube.SearchKindResults
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class SearchTab(val label: String, val kind: SearchKind? = null) {
    All("All"),
    Songs("Songs"),
    Videos("Videos"),
    Albums("Albums", SearchKind.Albums),
    Artists("Artists", SearchKind.Artists),
    Playlists("Playlists", SearchKind.Playlists),
}

/** a list that grows a page at a time */
data class Paged(val tracks: List<Track>, val more: String?, val loading: Boolean = false, val failed: Boolean = false)

/**
 * The Search tab: what's typed, what YouTube Music suggests for it, and the results of the last
 * search. It outlives the screen, so switching tabs and coming back finds everything as it was.
 */
@Stable
class SearchModel(private val catalog: Catalog, private val connectivity: Connectivity, private val settings: Settings) {
    private val scope = MainScope()

    val field = TextFieldState()

    /** the search the results are for */
    var submitted by mutableStateOf<String?>(null)
        private set
    var results by mutableStateOf<Load<SearchResults>?>(null)
        private set
    var tab by mutableStateOf(SearchTab.All)
        private set
    var suggestions by mutableStateOf<SearchSuggestions?>(null)
        private set
    /** the text the suggestions are for */
    var suggestionsFor by mutableStateOf("")
        private set
    var songs by mutableStateOf(Paged(emptyList(), null))
        private set
    var videos by mutableStateOf(Paged(emptyList(), null))
        private set
    val kinds = mutableStateMapOf<SearchKind, Load<SearchKindResults>>()

    private var searchJob: Job? = null
    private var suggestJob: Job? = null
    private val kindJobs = HashMap<SearchKind, Job>()
    /** counts searches, so a page of an older search can't land in a newer one's results */
    private var generation = 0

    init {
        // what failed for want of a connection loads by itself once the phone is back online,
        // as the message on screen says it will
        scope.launch {
            connectivity.online.drop(1).filter { it }.collect { retryOffline() }
        }
    }

    private fun retryOffline() {
        val typed = field.text.toString().trim()
        if (typed.isNotEmpty() && typed != suggestionsFor && typed != submitted) suggest(typed)
        val query = submitted ?: return
        if ((results as? Load.Failed)?.problem?.offline == true) {
            search(query)
            return
        }
        for ((kind, load) in kinds.toMap()) if ((load as? Load.Failed)?.problem?.offline == true) retryKind(kind)
        if (songs.failed) loadMoreSongs()
        if (videos.failed) loadMoreVideos()
    }

    /** called as the text changes; waits for a pause in typing */
    fun suggest(text: String) {
        suggestJob?.cancel()
        val query = text.trim()
        if (query.isEmpty()) {
            suggestions = null
            suggestionsFor = ""
            return
        }
        suggestJob = scope.launch {
            delay(140)
            try {
                val found = withContext(Dispatchers.Default) { catalog.suggestions(query) }
                suggestions = found
                suggestionsFor = query
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // suggestions are a nicety: what was shown stays
            }
        }
    }

    fun submit(text: String) {
        val query = text.trim().replace('\n', ' ')
        if (query.isEmpty()) return
        if (field.text.toString() != query) field.setTextAndPlaceCursorAtEnd(query)
        settings.rememberSearch(query)
        suggestJob?.cancel()
        tab = SearchTab.All
        search(query)
    }

    /** runs [query], keeping the open tab */
    private fun search(query: String) {
        generation++
        searchJob?.cancel()
        for (job in kindJobs.values) job.cancel()
        kindJobs.clear()
        kinds.clear()
        submitted = query
        results = Load.Loading
        songs = Paged(emptyList(), null)
        videos = Paged(emptyList(), null)
        searchJob = scope.launch {
            try {
                val found = withContext(Dispatchers.Default) { catalog.search(query) }
                results = Load.Ready(found)
                songs = Paged(found.tracks, found.moreSongs)
                videos = Paged(found.videos, found.moreVideos)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("VyseSearch", "search failed: ${e.javaClass.simpleName}: ${e.message}")
                results = Load.Failed(problemOf(e, connectivity.isOnline))
            }
        }
        // an open albums, artists or playlists tab loads along with it
        tab.kind?.let(::loadKind)
    }

    fun retry() {
        submitted?.let(::search)
    }

    fun select(tab: SearchTab) {
        this.tab = tab
        tab.kind?.let(::loadKind)
    }

    /** one kind of result for the current search, unless it's loaded or on its way */
    private fun loadKind(kind: SearchKind) {
        val query = submitted ?: return
        if (kinds[kind] is Load.Ready || kindJobs[kind]?.isActive == true) return
        kinds[kind] = Load.Loading
        kindJobs[kind] = scope.launch {
            try {
                kinds[kind] = Load.Ready(withContext(Dispatchers.Default) { catalog.searchKind(query, kind) })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                kinds[kind] = Load.Failed(problemOf(e, connectivity.isOnline))
            }
        }
    }

    fun retryKind(kind: SearchKind) {
        kindJobs.remove(kind)?.cancel()
        kinds.remove(kind)
        loadKind(kind)
    }

    fun loadMoreSongs() {
        songs = loadMore(songs) { songs = it }
    }

    fun loadMoreVideos() {
        videos = loadMore(videos) { videos = it }
    }

    private fun loadMore(list: Paged, update: (Paged) -> Unit): Paged {
        val token = list.more ?: return list
        if (list.loading) return list
        val forSearch = generation
        scope.launch {
            try {
                val page = withContext(Dispatchers.Default) { catalog.searchMore(token) }
                if (generation != forSearch) return@launch
                update(Paged((list.tracks + page.tracks).uniqueBy { it.id }, page.more.takeIf { page.tracks.isNotEmpty() }))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (generation == forSearch) update(list.copy(loading = false, failed = true))
            }
        }
        return list.copy(loading = true, failed = false)
    }

    /** back to the start: recent searches */
    fun clear() {
        generation++
        searchJob?.cancel()
        suggestJob?.cancel()
        for (job in kindJobs.values) job.cancel()
        kindJobs.clear()
        field.setTextAndPlaceCursorAtEnd("")
        submitted = null
        results = null
        suggestions = null
        suggestionsFor = ""
        kinds.clear()
        songs = Paged(emptyList(), null)
        videos = Paged(emptyList(), null)
        tab = SearchTab.All
    }
}
