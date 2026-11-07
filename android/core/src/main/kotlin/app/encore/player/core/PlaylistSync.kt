package app.encore.player.core

// The queue decides what plays; the phone's player keeps its own copy of the list so it can
// buffer ahead and show the queue to headphones, the lock screen and cars. After every change
// to the queue, these steps bring the player's copy in line without disturbing the song that
// is playing: it is moved, never taken out and put back, so it never stops or rebuffers.

sealed interface PlaylistStep {
    /** take out the songs at [from, to) */
    data class Remove(val from: Int, val to: Int) : PlaylistStep

    /** put these songs in so the first lands at `at` */
    data class Insert(val at: Int, val uids: List<String>) : PlaylistStep

    /** take the song at `from` and put it back so it ends up at `to` */
    data class Move(val from: Int, val to: Int) : PlaylistStep
}

/** past this many single moves (shuffle, unshuffle), the list is rebuilt around the playing song instead */
const val MAX_SYNC_MOVES = 24

/**
 * the steps that turn `old` into `new`. Every uid is distinct within a list. `keep` is the
 * playing song: when it is in both lists it is never removed, so playback carries on through
 * any change.
 */
fun planPlaylistSync(old: List<String>, new: List<String>, keep: String?, maxMoves: Int = MAX_SYNC_MOVES): List<PlaylistStep> {
    if (old == new) return emptyList()
    val steps = mutableListOf<PlaylistStep>()
    val wanted = new.toHashSet()
    val list = old.toMutableList()

    // songs that left the queue go first, from the end so earlier positions stay put; a run of them is one step
    var i = list.lastIndex
    while (i >= 0) {
        if (list[i] in wanted) {
            i--
            continue
        }
        var start = i
        while (start > 0 && list[start - 1] !in wanted) start--
        steps += PlaylistStep.Remove(start, i + 1)
        list.subList(start, i + 1).clear()
        i = start - 1
    }
    val afterRemovals = list.toList()

    // then each position in turn gets the song it should have
    val targetIndex = HashMap<String, Int>(new.size * 2)
    new.forEachIndexed { index, uid -> targetIndex[uid] = index }
    val present = list.toHashSet()
    val placing = mutableListOf<PlaylistStep>()
    var moves = 0
    var at = 0
    while (at < new.size) {
        val want = new[at]
        if (at < list.size && list[at] == want) {
            at++
            continue
        }
        if (want !in present) {
            // new songs in a row go in together
            var end = at
            while (end < new.size && new[end] !in present) end++
            val run = new.subList(at, end).toList()
            placing += PlaylistStep.Insert(at, run)
            list.addAll(at, run)
            present.addAll(run)
            at = end
            continue
        }
        moves++
        if (moves > maxMoves) return steps + rebuildAround(afterRemovals, new, keep)
        val here = list[at]
        if (at + 1 < list.size && list[at + 1] == want) {
            // the song here was dragged up out of order: send it down to where it belongs, which fixes the whole run in one step
            val to = minOf(targetIndex.getValue(here), list.lastIndex)
            placing += PlaylistStep.Move(at, to)
            list.add(to, list.removeAt(at))
        } else {
            val from = list.indexOf(want)
            placing += PlaylistStep.Move(from, at)
            list.add(at, list.removeAt(from))
            at++
        }
    }
    return steps + placing
}

/** take out everything but the playing song, then put the rest back around it */
private fun rebuildAround(list: List<String>, new: List<String>, keep: String?): List<PlaylistStep> {
    val steps = mutableListOf<PlaylistStep>()
    val keepAt = if (keep != null) list.indexOf(keep) else -1
    val keepTo = if (keep != null) new.indexOf(keep) else -1
    if (keepAt < 0 || keepTo < 0) {
        if (list.isNotEmpty()) steps += PlaylistStep.Remove(0, list.size)
        if (new.isNotEmpty()) steps += PlaylistStep.Insert(0, new)
        return steps
    }
    if (keepAt + 1 < list.size) steps += PlaylistStep.Remove(keepAt + 1, list.size)
    if (keepAt > 0) steps += PlaylistStep.Remove(0, keepAt)
    if (keepTo > 0) steps += PlaylistStep.Insert(0, new.subList(0, keepTo).toList())
    if (keepTo + 1 < new.size) steps += PlaylistStep.Insert(keepTo + 1, new.subList(keepTo + 1, new.size).toList())
    return steps
}

/** what the steps do to a list; the player does the same with its copy */
fun applyPlaylistSteps(list: List<String>, steps: List<PlaylistStep>): List<String> {
    val out = list.toMutableList()
    for (step in steps) {
        when (step) {
            is PlaylistStep.Remove -> out.subList(step.from, step.to).clear()
            is PlaylistStep.Insert -> out.addAll(step.at, step.uids)
            is PlaylistStep.Move -> out.add(step.to, out.removeAt(step.from))
        }
    }
    return out
}
