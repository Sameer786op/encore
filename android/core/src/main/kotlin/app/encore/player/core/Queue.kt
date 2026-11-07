package app.encore.player.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.util.concurrent.atomic.AtomicLong

// Pure queue logic, the same rules as the desktop app's `player/queue.ts`. Every function returns
// a new state and never touches audio, so the rules are easy to test.

@Serializable
enum class RepeatMode {
    @SerialName("off") Off,
    @SerialName("all") All,
    @SerialName("one") One,
}

@Serializable
data class PlayContext(
    /** search, album, artist, playlist, liked, history, radio, home, track, mix, jam */
    val kind: String,
    val label: String,
    val id: String? = null,
)

@Serializable
data class QueueItem(
    val uid: String,
    val track: Track,
    /** in a Jam, the name of who added it */
    val by: String? = null,
)

@Serializable
data class QueueState(
    val items: List<QueueItem> = emptyList(),
    /** position of the current item, -1 when nothing is loaded */
    val index: Int = -1,
    val shuffle: Boolean = false,
    val repeat: RepeatMode = RepeatMode.Off,
    /** the order before shuffling, so turning shuffle off restores it */
    val unshuffled: List<String>? = null,
    val context: PlayContext? = null,
) {
    val current: QueueItem? get() = items.getOrNull(index)
    val upcoming: List<QueueItem> get() = if (index < 0) items else items.drop(index + 1)
}

typealias Random = () -> Double

private val uidCounter = AtomicLong()

fun makeItems(tracks: List<Track>, by: String? = null): List<QueueItem> = tracks.map { track ->
    val uid = "q" + System.currentTimeMillis().toString(36) + uidCounter.getAndIncrement().toString(36)
    QueueItem(uid, track, by)
}

private fun <T> shuffled(list: List<T>, random: Random): List<T> {
    val out = list.toMutableList()
    for (i in out.lastIndex downTo 1) {
        val j = (random() * (i + 1)).toInt().coerceIn(0, i)
        val tmp = out[i]
        out[i] = out[j]
        out[j] = tmp
    }
    return out
}

/** replace the queue with a list and start at `startIndex` */
fun loadQueue(state: QueueState, tracks: List<Track>, startIndex: Int, context: PlayContext?, random: Random = Math::random): QueueState {
    if (tracks.isEmpty()) return state.copy(items = emptyList(), index = -1, unshuffled = null, context = context)
    val start = startIndex.coerceIn(0, tracks.lastIndex)
    val items = makeItems(tracks)
    if (!state.shuffle) return state.copy(items = items, index = start, unshuffled = null, context = context)
    // shuffled: the chosen song plays first, the rest follow in random order
    val first = items[start]
    val rest = shuffled(items.filterIndexed { i, _ -> i != start }, random)
    return state.copy(items = listOf(first) + rest, index = 0, unshuffled = items.map { it.uid }, context = context)
}

/** where to go when a song ends (auto) or the user presses next; null = nothing left */
fun nextIndex(state: QueueState, auto: Boolean): Int? {
    if (state.items.isEmpty()) return null
    if (auto && state.repeat == RepeatMode.One) return state.index
    if (state.index < state.items.lastIndex) return state.index + 1
    // skipping on while repeating one song wraps around like repeat all
    if (state.repeat != RepeatMode.Off) return 0
    return null
}

fun previousIndex(state: QueueState): Int {
    if (state.index > 0) return state.index - 1
    if (state.repeat != RepeatMode.Off && state.items.isNotEmpty()) return state.items.lastIndex
    return maxOf(0, state.index)
}

fun jumpTo(state: QueueState, uid: String): QueueState {
    val index = state.items.indexOfFirst { it.uid == uid }
    return if (index < 0) state else state.copy(index = index)
}

private fun insertIntoUnshuffled(state: QueueState, afterUid: String?, uids: List<String>): List<String>? {
    val order = state.unshuffled?.toMutableList() ?: return null
    val at = if (afterUid != null) order.indexOf(afterUid) + 1 else order.size
    order.addAll(if (at <= 0) order.size else at, uids)
    return order
}

/** insert right after the current song */
fun playNext(state: QueueState, tracks: List<Track>, by: String? = null): QueueState {
    if (state.index < 0) return addToQueue(state, tracks, by)
    val added = makeItems(tracks, by)
    val items = state.items.toMutableList()
    items.addAll(state.index + 1, added)
    return state.copy(items = items, unshuffled = insertIntoUnshuffled(state, items[state.index].uid, added.map { it.uid }))
}

fun addToQueue(state: QueueState, tracks: List<Track>, by: String? = null): QueueState {
    val added = makeItems(tracks, by)
    val items = state.items + added
    return state.copy(
        items = items,
        index = if (state.index < 0 && items.isNotEmpty()) 0 else state.index,
        unshuffled = insertIntoUnshuffled(state, null, added.map { it.uid }),
    )
}

/** in a Jam, songs people add wait their turn behind the ones added before them, ahead of the rest of the queue */
fun addToJam(state: QueueState, tracks: List<Track>, by: String): QueueState {
    if (state.index < 0) return addToQueue(state, tracks, by)
    var at = state.index + 1
    while (at < state.items.size && state.items[at].by != null) at++
    val added = makeItems(tracks, by)
    val items = state.items.toMutableList()
    items.addAll(at, added)
    return state.copy(items = items, unshuffled = insertIntoUnshuffled(state, items[at - 1].uid, added.map { it.uid }))
}

data class Removal(val state: QueueState, val removedCurrent: Boolean)

/** removing the current song leaves `index` on the song that took its place */
fun removeItem(state: QueueState, uid: String): Removal {
    val at = state.items.indexOfFirst { it.uid == uid }
    if (at < 0) return Removal(state, false)
    val items = state.items.filter { it.uid != uid }
    val removedCurrent = at == state.index
    var index = state.index
    if (at < state.index) index -= 1
    if (index >= items.size) index = items.size - 1
    return Removal(state.copy(items = items, index = index, unshuffled = state.unshuffled?.filter { it != uid }), removedCurrent)
}

/**
 * put the songs after `index` that `uids` lists in that order, in the places they already take;
 * anything it doesn't list (like a song added meanwhile) stays where it is
 */
fun arrangeAfter(items: List<QueueItem>, index: Int, uids: List<String>): List<QueueItem> {
    val listed = LinkedHashSet(uids)
    val byUid = items.drop(index + 1).filter { it.uid in listed }.associateBy { it.uid }
    val order = listed.filter { it in byUid }
    var next = 0
    return items.mapIndexed { at, item -> if (at > index && item.uid in byUid) byUid.getValue(order[next++]) else item }
}

/** set a new order for songs after the current one */
fun reorderUpcoming(state: QueueState, uids: List<String>): QueueState = state.copy(items = arrangeAfter(state.items, state.index, uids))

fun clearUpcoming(state: QueueState): QueueState {
    val items = state.items.take(state.index + 1)
    val keep = items.map { it.uid }.toSet()
    return state.copy(items = items, unshuffled = state.unshuffled?.filter { it in keep })
}

fun setShuffle(state: QueueState, on: Boolean, random: Random = Math::random): QueueState {
    if (on == state.shuffle) return state
    if (on) {
        val head = state.items.take(state.index + 1)
        val tail = shuffled(state.items.drop(state.index + 1), random)
        return state.copy(shuffle = true, items = head + tail, unshuffled = state.items.map { it.uid })
    }
    val current = state.current
    val order = state.unshuffled ?: emptyList()
    val rank = order.withIndex().associate { (i, uid) -> uid to i }
    // songs added while shuffled have no rank; they go to the end in queue order
    val items = state.items
        .mapIndexed { position, item -> item to (rank[item.uid] ?: (order.size + position)) }
        .sortedBy { it.second }
        .map { it.first }
    val index = if (current != null) items.indexOfFirst { it.uid == current.uid } else -1
    return state.copy(shuffle = false, items = items, index = index, unshuffled = null)
}

fun cycleRepeat(mode: RepeatMode): RepeatMode = when (mode) {
    RepeatMode.Off -> RepeatMode.All
    RepeatMode.All -> RepeatMode.One
    RepeatMode.One -> RepeatMode.Off
}
