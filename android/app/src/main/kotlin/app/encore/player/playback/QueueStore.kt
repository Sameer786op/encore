package app.encore.player.playback

import app.encore.player.core.QueueState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/** the queue and where the song was, so the app opens where you left off */
@Serializable
data class SavedQueue(val queue: QueueState, val positionMs: Long = 0)

/** keeps the queue in a file; written in the background, the newest copy always last */
class QueueStore(private val file: File) {
    private val json = Json { ignoreUnknownKeys = true }
    private val writing = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    suspend fun load(): SavedQueue? = withContext(Dispatchers.IO) {
        try {
            if (!file.exists()) return@withContext null
            val saved = json.decodeFromString<SavedQueue>(file.readText())
            val queue = saved.queue
            if (queue.items.isEmpty()) return@withContext null
            saved.copy(queue = queue.copy(index = queue.index.coerceIn(0, queue.items.lastIndex)), positionMs = saved.positionMs.coerceAtLeast(0))
        } catch (e: Exception) {
            // a damaged file just means starting with an empty queue
            null
        }
    }

    fun save(queue: QueueState, positionMs: Long) {
        val snapshot = SavedQueue(window(queue), positionMs)
        scope.launch {
            writing.withLock {
                runCatching {
                    val temp = File(file.parentFile, file.name + ".tmp")
                    temp.writeText(json.encodeToString(SavedQueue.serializer(), snapshot))
                    if (!temp.renameTo(file)) {
                        file.delete()
                        temp.renameTo(file)
                    }
                }
            }
        }
    }

    /** a long queue keeps the songs around the current one, as on the desktop */
    private fun window(queue: QueueState): QueueState {
        if (queue.items.size <= MAX_SAVED_ITEMS) return queue
        val start = maxOf(0, minOf(queue.index - 100, queue.items.size - MAX_SAVED_ITEMS))
        val items = queue.items.subList(start, start + MAX_SAVED_ITEMS).toList()
        val keep = items.mapTo(HashSet()) { it.uid }
        return queue.copy(items = items, index = queue.index - start, unshuffled = queue.unshuffled?.filter { it in keep })
    }

    private companion object {
        const val MAX_SAVED_ITEMS = 1000
    }
}
