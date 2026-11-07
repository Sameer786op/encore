package app.encore.player.core

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PlaylistSyncTest {
    private fun ids(text: String) = if (text.isEmpty()) emptyList() else text.split(",")

    private fun check(old: List<String>, new: List<String>, keep: String?): List<PlaylistStep> {
        val steps = planPlaylistSync(old, new, keep)
        assertEquals(new, applyPlaylistSteps(old, steps), "steps $steps")
        // the playing song stays in the player's list through every step
        if (keep != null && keep in old && keep in new) {
            var list = old
            for (step in steps) {
                list = applyPlaylistSteps(list, listOf(step))
                assertTrue(keep in list, "the playing song was taken out by $step")
            }
        }
        return steps
    }

    @Test
    fun `nothing changes when the lists match`() {
        assertEquals(emptyList(), check(ids("a,b,c"), ids("a,b,c"), "a"))
    }

    @Test
    fun `adding to the queue is one insert at the end`() {
        assertEquals(listOf(PlaylistStep.Insert(3, ids("d,e"))), check(ids("a,b,c"), ids("a,b,c,d,e"), "a"))
    }

    @Test
    fun `play next is one insert after the playing song`() {
        assertEquals(listOf(PlaylistStep.Insert(1, ids("x,y"))), check(ids("a,b,c"), ids("a,x,y,b,c"), "a"))
    }

    @Test
    fun `removing songs takes each run out in one step`() {
        assertEquals(listOf(PlaylistStep.Remove(4, 5), PlaylistStep.Remove(1, 3)), check(ids("a,b,c,d,e,f"), ids("a,d,f"), "a"))
    }

    @Test
    fun `dragging a song down or up is a single move`() {
        assertEquals(listOf(PlaylistStep.Move(1, 3)), check(ids("a,b,c,d,e"), ids("a,c,d,b,e"), "a"))
        assertEquals(listOf(PlaylistStep.Move(3, 1)), check(ids("a,b,c,d,e"), ids("a,d,b,c,e"), "a"))
        assertEquals(listOf(PlaylistStep.Move(1, 4)), check(ids("a,b,c,d,e"), ids("a,c,d,e,b"), "a"))
    }

    @Test
    fun `a new queue replaces the old one`() {
        check(ids("a,b,c"), ids("x,y"), "a")
        check(emptyList(), ids("x,y"), null)
        check(ids("a,b"), emptyList(), "a")
    }

    @Test
    fun `shuffling a long queue rebuilds it around the playing song`() {
        val old = (0 until 200).map { "s$it" }
        val head = old.take(31)
        val new = head + old.drop(31).shuffled(Random(7))
        val steps = check(old, new, "s30")
        assertTrue(steps.size <= 4, "too many steps: ${steps.size}")
        // and turning shuffle off puts the playing song back in its old place
        val back = check(new.filter { it != "s30" }.take(10) + "s30" + new.filter { it != "s30" }.drop(10), old, "s30")
        assertTrue(back.size <= 4)
    }

    @Test
    fun `any change keeps the playing song and ends with the new list`() {
        val random = Random(42)
        var next = 0
        repeat(3000) {
            val old = List(random.nextInt(0, 40)) { "u${next++}" }
            var new = old.filter { random.nextInt(5) != 0 }.toMutableList()
            if (random.nextBoolean()) new.shuffle(random)
            repeat(random.nextInt(0, 4)) {
                val at = random.nextInt(0, new.size + 1)
                new.addAll(at, List(random.nextInt(1, 4)) { "u${next++}" })
            }
            if (new.size > 2 && random.nextBoolean()) {
                val from = random.nextInt(new.size)
                new.add(random.nextInt(new.size), new.removeAt(from))
            }
            val keep = (old.filter { it in new }.takeIf { it.isNotEmpty() } ?: old).randomOrNull(random)
            check(old, new, keep)
        }
    }
}
