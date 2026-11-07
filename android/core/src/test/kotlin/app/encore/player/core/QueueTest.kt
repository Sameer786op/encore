package app.encore.player.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The desktop app's queue tests (player/queue.test.ts), case for case.
class QueueTest {
    private fun t(n: Int) = Track(id = "youtube:$n", source = TrackSource.YouTube, sourceId = "$n", title = "T$n")
    private fun titles(s: QueueState) = s.items.map { it.track.title }
    // deterministic "random": always picks the first remaining slot
    private val firstPick: Random = { 0.0 }
    private val empty = QueueState()

    @Test fun `loads a list and starts at the chosen song`() {
        val s = loadQueue(empty, listOf(t(1), t(2), t(3)), 1, null)
        assertEquals("T2", s.current?.track?.title)
        assertEquals(listOf("T3"), s.upcoming.map { it.track.title })
    }

    @Test fun `loading with shuffle on plays the chosen song first`() {
        val s = loadQueue(empty.copy(shuffle = true), listOf(t(1), t(2), t(3), t(4)), 2, null, firstPick)
        assertEquals(0, s.index)
        assertEquals("T3", titles(s)[0])
        assertEquals(listOf("T1", "T2", "T3", "T4"), titles(s).sorted())
    }

    @Test fun `stops at the end unless repeat is on`() {
        var s = loadQueue(empty, listOf(t(1), t(2)), 1, null)
        assertNull(nextIndex(s, true))
        s = s.copy(repeat = RepeatMode.All)
        assertEquals(0, nextIndex(s, true))
        s = s.copy(repeat = RepeatMode.One)
        assertEquals(1, nextIndex(s, true))
        // pressing next while repeating one still moves on
        assertEquals(0, nextIndex(s, false))
    }

    @Test fun `previous wraps only with repeat all`() {
        val s = loadQueue(empty, listOf(t(1), t(2)), 0, null)
        assertEquals(0, previousIndex(s))
        assertEquals(1, previousIndex(s.copy(repeat = RepeatMode.All)))
    }

    @Test fun `play next inserts after the current song, add to queue appends`() {
        var s = loadQueue(empty, listOf(t(1), t(2), t(3)), 0, null)
        s = playNext(s, listOf(t(9)))
        s = addToQueue(s, listOf(t(8)))
        assertEquals(listOf("T1", "T9", "T2", "T3", "T8"), titles(s))
        assertEquals(0, s.index)
    }

    @Test fun `adding to an empty queue makes the first song current`() {
        assertEquals(0, addToQueue(empty, listOf(t(1))).index)
        assertEquals(0, playNext(empty, listOf(t(1))).index)
    }

    @Test fun `removing songs keeps the current one in place`() {
        val s = loadQueue(empty, listOf(t(1), t(2), t(3), t(4)), 2, null)
        val before = removeItem(s, s.items[0].uid)
        assertFalse(before.removedCurrent)
        assertEquals("T3", before.state.current?.track?.title)

        val current = removeItem(s, s.items[2].uid)
        assertTrue(current.removedCurrent)
        assertEquals("T4", current.state.current?.track?.title)

        val last = loadQueue(empty, listOf(t(1), t(2)), 1, null)
        assertEquals(0, removeItem(last, last.items[1].uid).state.index)
    }

    @Test fun `reorders upcoming songs without touching history or the current song`() {
        val s = loadQueue(empty, listOf(t(1), t(2), t(3), t(4)), 1, null)
        val c = s.items[2]
        val d = s.items[3]
        val r = reorderUpcoming(s, listOf(d.uid, c.uid))
        assertEquals(listOf("T1", "T2", "T4", "T3"), titles(r))
        assertEquals("T2", r.current?.track?.title)
    }

    @Test fun `reordering leaves songs it wasn't told about where they are`() {
        // someone added T9 to play next while T3 and T4 were being dragged
        var s = loadQueue(empty, listOf(t(1), t(2), t(3), t(4)), 0, null)
        val b = s.items[1]
        val c = s.items[2]
        val d = s.items[3]
        s = playNext(s, listOf(t(9)))
        assertEquals(listOf("T1", "T9", "T4", "T2", "T3"), titles(reorderUpcoming(s, listOf(d.uid, b.uid, c.uid))))
        // the current song and history never move, and unknown or repeated uids are ignored
        assertEquals(titles(s), titles(reorderUpcoming(s, listOf(s.items[0].uid, "nope", d.uid, d.uid))))
    }

    @Test fun `in a Jam, added songs take turns ahead of the rest of the queue`() {
        var s = loadQueue(empty, listOf(t(1), t(2), t(3)), 0, null)
        s = addToJam(s, listOf(t(7)), "Alex")
        s = addToJam(s, listOf(t(8)), "Sam")
        s = addToJam(s, listOf(t(9)), "Alex")
        assertEquals(listOf("T1", "T7", "T8", "T9", "T2", "T3"), titles(s))
        assertEquals(listOf("Alex", "Sam", "Alex"), s.items.subList(1, 4).map { it.by })
        // once one plays, the next one added still waits behind the others
        s = addToJam(jumpTo(s, s.items[1].uid), listOf(t(6)), "Sam")
        assertEquals(listOf("T1", "T7", "T8", "T9", "T6", "T2", "T3"), titles(s))
        assertEquals(0, addToJam(empty, listOf(t(1)), "Sam").index)
    }

    @Test fun `in a shuffled Jam, added songs come back in turn when shuffle is turned off`() {
        var s = setShuffle(loadQueue(empty, listOf(t(1), t(2), t(3)), 0, null), true, firstPick)
        s = addToJam(addToJam(s, listOf(t(7)), "Alex"), listOf(t(8)), "Sam")
        assertEquals(listOf("T1", "T7", "T8", "T2", "T3"), titles(setShuffle(s, false)))
    }

    @Test fun `clears only what is still to come`() {
        val s = clearUpcoming(loadQueue(empty, listOf(t(1), t(2), t(3)), 1, null))
        assertEquals(listOf("T1", "T2"), titles(s))
    }

    @Test fun `shuffle keeps played songs, and turning it off restores the order`() {
        var s = loadQueue(empty, listOf(t(1), t(2), t(3), t(4), t(5)), 1, null)
        s = setShuffle(s, true, firstPick)
        assertEquals(listOf("T1", "T2"), titles(s).take(2))
        assertNotEquals(listOf("T3", "T4", "T5"), titles(s).drop(2))
        s = addToQueue(s, listOf(t(6)))
        s = jumpTo(s, s.items[3].uid)
        val playing = s.current?.track?.title
        s = setShuffle(s, false)
        assertEquals(listOf("T1", "T2", "T3", "T4", "T5", "T6"), titles(s))
        assertEquals(playing, s.current?.track?.title)
    }

    @Test fun `songs added while shuffled keep their relative order when unshuffling`() {
        var s = setShuffle(loadQueue(empty, listOf(t(1), t(2)), 0, null), true, firstPick)
        s = s.copy(unshuffled = null)
        s = addToQueue(addToQueue(s, listOf(t(3))), listOf(t(4)))
        s = setShuffle(s, false)
        assertEquals(listOf("T3", "T4"), titles(s).takeLast(2))
    }

    @Test fun `repeat cycles off, all, one`() {
        assertEquals(
            listOf(RepeatMode.All, RepeatMode.One, RepeatMode.Off),
            listOf(cycleRepeat(RepeatMode.Off), cycleRepeat(RepeatMode.All), cycleRepeat(RepeatMode.One)),
        )
    }
}
