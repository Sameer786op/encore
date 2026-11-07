package app.encore.player.data

import android.os.SystemClock
import android.util.Log
import app.encore.player.core.AlbumDetails
import app.encore.player.core.ArtistDetails
import app.encore.player.core.HomeSection
import app.encore.player.core.RemotePlaylistDetails
import app.encore.player.playback.Connectivity
import app.encore.player.playback.isConnectionProblem
import app.encore.player.youtube.Catalog
import app.encore.player.youtube.YouTubeException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.File

// Pages from YouTube Music, kept in memory so going back, or opening a page again, is instant.
// A page that has grown old is shown at once and quietly refreshed. Everything here is used from
// the main thread; the fetching and parsing happen in the background.

sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ready<T>(val value: T) : Load<T>
    data class Failed(val problem: Problem) : Load<Nothing>
}

val <T> Load<T>.valueOrNull: T? get() = (this as? Load.Ready)?.value

/** what went wrong, in words for the screen */
data class Problem(val offline: Boolean, val title: String, val body: String)

fun problemOf(error: Throwable, online: Boolean): Problem = when {
    !online || error.isConnectionProblem() -> Problem(true, "You’re offline", "This page will load when you’re back online.")
    error is YouTubeException && error.status == 404 -> Problem(false, "Not on YouTube Music", "It may have been taken down.")
    error is YouTubeException -> Problem(false, "YouTube Music didn’t answer", "Try again in a moment.")
    else -> Problem(false, "Couldn’t load this", "Try again in a moment.")
}

private const val TAG = "VysePages"

/** one kind of page, by id */
class Resource<T : Any>(
    private val connectivity: Connectivity,
    private val capacity: Int,
    private val staleMs: Long,
    private val fetch: suspend (String) -> T,
) {
    private val scope = MainScope()

    private class Slot<T> {
        val state = MutableStateFlow<Load<T>>(Load.Loading)
        var loadedAt = 0L
        var job: Job? = null
    }

    private val slots = object : LinkedHashMap<String, Slot<T>>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Slot<T>>): Boolean = size > capacity
    }

    init {
        // pages that failed while offline load by themselves once the phone is back online
        scope.launch {
            connectivity.online.drop(1).filter { it }.collect {
                for ((key, slot) in slots.entries.toList()) if (slot.state.value is Load.Failed) load(key, slot, quiet = false)
            }
        }
    }

    fun get(key: String): StateFlow<Load<T>> {
        val slot = slots.getOrPut(key) { Slot() }
        if (slot.job?.isActive != true) {
            val state = slot.state.value
            val stale = state is Load.Ready && SystemClock.elapsedRealtime() - slot.loadedAt > staleMs
            if (state !is Load.Ready || stale) load(key, slot, quiet = state is Load.Ready)
        }
        return slot.state.asStateFlow()
    }

    /** what's already loaded, without asking for anything */
    fun peek(key: String): T? = slots[key]?.state?.value?.valueOrNull

    fun retry(key: String) {
        val slot = slots[key] ?: return
        if (slot.job?.isActive == true) return
        slot.state.value = Load.Loading
        load(key, slot, quiet = false)
    }

    private fun load(key: String, slot: Slot<T>, quiet: Boolean) {
        if (!quiet && slot.state.value is Load.Failed) slot.state.value = Load.Loading
        slot.job = scope.launch {
            try {
                val value = withContext(Dispatchers.Default) { fetch(key) }
                slot.state.value = Load.Ready(value)
                slot.loadedAt = SystemClock.elapsedRealtime()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "couldn't load $key: ${e.javaClass.simpleName}: ${e.message}")
                // a page already on screen stays there when a quiet refresh fails
                if (!quiet) slot.state.value = Load.Failed(problemOf(e, connectivity.isOnline))
            }
        }
    }
}

/** YouTube Music's home, saved to disk so the app opens on it straight away */
class HomeFeed(private val catalog: Catalog, private val connectivity: Connectivity, private val file: File) {
    private val scope = MainScope()
    private val _state = MutableStateFlow<Load<List<HomeSection>>>(Load.Loading)
    val state: StateFlow<Load<List<HomeSection>>> = _state.asStateFlow()
    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()
    private var loadedAt = 0L
    private var job: Job? = null
    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = ListSerializer(HomeSection.serializer())

    init {
        scope.launch {
            val saved = withContext(Dispatchers.IO) {
                runCatching { if (file.exists()) json.decodeFromString(serializer, file.readText()) else null }.getOrNull()
            }
            if (!saved.isNullOrEmpty() && _state.value !is Load.Ready) _state.value = Load.Ready(saved)
            refresh()
        }
        scope.launch {
            connectivity.online.drop(1).filter { it }.collect { if (_state.value !is Load.Ready) refresh() }
        }
    }

    /** when the home was last fetched long enough ago */
    fun refreshIfStale() {
        if (SystemClock.elapsedRealtime() - loadedAt > STALE_MS) refresh()
    }

    fun refresh() {
        if (job?.isActive == true) return
        _refreshing.value = true
        if (_state.value is Load.Failed) _state.value = Load.Loading
        job = scope.launch {
            try {
                val sections = withContext(Dispatchers.Default) { catalog.home() }.filter { !it.isEmpty }
                if (sections.isNotEmpty() || _state.value !is Load.Ready) _state.value = Load.Ready(sections)
                loadedAt = SystemClock.elapsedRealtime()
                withContext(Dispatchers.IO) {
                    runCatching {
                        val tmp = File(file.path + ".tmp")
                        tmp.writeText(json.encodeToString(serializer, sections))
                        if (!tmp.renameTo(file)) {
                            file.delete()
                            tmp.renameTo(file)
                        }
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "couldn't load home: ${e.javaClass.simpleName}: ${e.message}")
                if (_state.value !is Load.Ready) _state.value = Load.Failed(problemOf(e, connectivity.isOnline))
            } finally {
                _refreshing.value = false
            }
        }
    }

    private companion object {
        const val STALE_MS = 10 * 60_000L
    }
}

/** every page the screens open */
class PageStore(catalog: Catalog, connectivity: Connectivity, cacheDir: File) {
    val albums = Resource<AlbumDetails>(connectivity, capacity = 24, staleMs = 30 * 60_000L) { catalog.album(it) }
    val artists = Resource<ArtistDetails>(connectivity, capacity = 16, staleMs = 30 * 60_000L) { catalog.artist(it) }
    val playlists = Resource<RemotePlaylistDetails>(connectivity, capacity = 16, staleMs = 15 * 60_000L) { catalog.remotePlaylist(it) }
    val home = HomeFeed(catalog, connectivity, File(cacheDir, "home.json"))
}
