package app.encore.player.playback

import androidx.core.net.toUri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ShuffleOrder
import androidx.media3.session.MediaSession
import app.encore.player.Settings
import app.encore.player.core.PlayContext
import app.encore.player.core.PlaylistStep
import app.encore.player.core.QueueItem
import app.encore.player.core.QueueState
import app.encore.player.core.RepeatMode
import app.encore.player.core.Track
import app.encore.player.core.addToQueue
import app.encore.player.core.clearUpcoming
import app.encore.player.core.cycleRepeat
import app.encore.player.core.loadQueue
import app.encore.player.core.nextIndex
import app.encore.player.core.planPlaylistSync
import app.encore.player.core.playNext
import app.encore.player.core.previousIndex
import app.encore.player.core.removeItem
import app.encore.player.core.reorderUpcoming
import app.encore.player.core.setShuffle
import app.encore.player.core.sizedArtwork
import app.encore.player.core.uniqueBy
import app.encore.player.youtube.Catalog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** a short message for the bottom of the screen */
data class Notice(val text: String, val isError: Boolean = false)

/** what the player is doing, for the screens; the song's position is read separately, every frame it's on screen */
data class PlayerStatus(
    /** play was pressed: the button shows pause, even while the song is still loading */
    val wantsToPlay: Boolean = false,
    /** sound is coming out */
    val playing: Boolean = false,
    val buffering: Boolean = false,
    /** buffering with no connection: it carries on by itself once the phone is back online */
    val waitingForNetwork: Boolean = false,
    val durationMs: Long = 0,
    /** looking for similar songs to keep going */
    val radioLoading: Boolean = false,
)

/**
 * The queue and the rules for moving through it, the same as the desktop app's player store.
 * Screens, the notification, the lock screen and headphones all go through here. The queue is
 * what counts; the phone's player holds a copy of it, brought in line after every change.
 * Everything here runs on the main thread.
 */
@UnstableApi
class Playback(
    private val store: QueueStore,
    private val catalog: Catalog,
    private val settings: Settings,
    private val connectivity: Connectivity,
) {
    private val scope = MainScope()

    private val _queue = MutableStateFlow(QueueState())
    val queue: StateFlow<QueueState> = _queue.asStateFlow()

    private val _status = MutableStateFlow(PlayerStatus())
    val status: StateFlow<PlayerStatus> = _status.asStateFlow()

    private val _notices = MutableSharedFlow<Notice>(extraBufferCapacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val notices: SharedFlow<Notice> = _notices.asSharedFlow()

    private var player: ExoPlayer? = null
    /** while the queue is being copied into the player, its own reports of what changed are ours and are ignored */
    private var applying = false
    /** where the song is while there's no player to ask */
    private var restingPositionMs = 0L
    /** play was pressed before the player was ready */
    private var playWhenAttached = false
    /** the queue was changed before the saved one was read, so the saved one is dropped */
    private var touched = false
    private val restored = CompletableDeferred<Unit>()

    private var failuresInARow = 0
    /** bumped whenever a new queue replaces the old one, so a late radio answer doesn't land in it */
    private var generation = 0
    private var radio: Deferred<Int>? = null
    private var radioGeneration = -1
    private var radioAskedFor: String? = null
    private var ticker: Job? = null
    private var saveJob: Job? = null
    private var lastSave = 0L

    init {
        scope.launch {
            val saved = store.load()
            if (saved != null && !touched) {
                _queue.value = saved.queue
                restingPositionMs = saved.positionMs
                syncPlayer(saved.positionMs)
                refreshStatus()
            }
            restored.complete(Unit)
        }
        scope.launch { connectivity.online.drop(1).collect { refreshStatus() } }
    }

    // ---- the player service hands its player over while it runs

    fun attach(exo: ExoPlayer) {
        player = exo
        exo.setShuffleOrder(ShuffleOrder.UnshuffledShuffleOrder(exo.mediaItemCount))
        exo.addListener(listener)
        syncPlayer(restingPositionMs)
        if (playWhenAttached) {
            playWhenAttached = false
            start()
        }
        refreshStatus()
    }

    fun detach() {
        val exo = player ?: return
        if (exo.mediaItemCount > 0) restingPositionMs = exo.currentPosition
        exo.removeListener(listener)
        player = null
        stopTicking()
        saveNow()
        refreshStatus()
    }

    suspend fun awaitRestored() = restored.await()

    /** the queue as the system wants it to carry on after the app was closed */
    fun resumption(): MediaSession.MediaItemsWithStartPosition? {
        val state = _queue.value
        if (state.current == null) return null
        return MediaSession.MediaItemsWithStartPosition(state.items.map { it.toMediaItem() }, state.index, positionMs())
    }

    // ---- what the screens ask for

    fun play(tracks: List<Track>, startIndex: Int = 0, context: PlayContext? = null) {
        if (tracks.isEmpty()) return
        newQueue { loadQueue(it, tracks, startIndex, context) }
        start()
    }

    /** a list in random order, shuffle staying on for what's added later */
    fun shufflePlay(tracks: List<Track>, context: PlayContext? = null) {
        if (tracks.isEmpty()) return
        newQueue { loadQueue(it.copy(shuffle = true), tracks, (Math.random() * tracks.size).toInt(), context) }
        start()
    }

    fun togglePlay() {
        if (_queue.value.current == null) return
        val exo = player
        if (exo == null) {
            playWhenAttached = !playWhenAttached
            refreshStatus()
            return
        }
        val active = exo.playWhenReady && exo.playbackState != Player.STATE_IDLE && exo.playbackState != Player.STATE_ENDED
        if (active) exo.pause() else start()
    }

    fun resume() = start()

    fun pause() {
        playWhenAttached = false
        player?.pause()
        refreshStatus()
    }

    fun next() {
        val state = _queue.value
        if (state.items.isEmpty()) return
        val target = nextIndex(state, auto = false)
        if (target != null) return goTo(target, play = true)
        continueWithRadioOrStop(auto = false)
    }

    fun previous() {
        val state = _queue.value
        if (state.index < 0) return
        // a few seconds in, previous starts the song again, as on the desktop
        if (positionMs() > RESTART_AFTER_MS || (state.index <= 0 && state.repeat == RepeatMode.Off)) return seekTo(0)
        goTo(previousIndex(state), play = true)
    }

    fun seekTo(positionMs: Long) {
        val target = positionMs.coerceAtLeast(0)
        val exo = player
        if (exo == null || exo.mediaItemCount == 0) {
            restingPositionMs = target
            scheduleSave()
            return
        }
        exo.seekTo(target)
    }

    fun positionMs(): Long {
        val exo = player ?: return restingPositionMs
        return if (exo.mediaItemCount > 0) exo.currentPosition else restingPositionMs
    }

    fun bufferedPositionMs(): Long = player?.takeIf { it.mediaItemCount > 0 }?.bufferedPosition ?: 0

    fun jumpTo(uid: String) {
        val index = _queue.value.items.indexOfFirst { it.uid == uid }
        if (index >= 0) goTo(index, play = true)
    }

    fun playNext(tracks: List<Track>) {
        if (tracks.isEmpty()) return
        val wasEmpty = _queue.value.current == null
        change { playNext(it, tracks) }
        if (wasEmpty) start()
    }

    fun addToQueue(tracks: List<Track>) {
        if (tracks.isEmpty()) return
        val wasEmpty = _queue.value.current == null
        change { addToQueue(it, tracks) }
        if (wasEmpty) start()
    }

    fun remove(uid: String) {
        val removal = removeItem(_queue.value, uid)
        change { removal.state }
    }

    fun reorderUpcoming(uids: List<String>) = change { reorderUpcoming(it, uids) }

    fun clearUpcoming() = change { clearUpcoming(it) }

    fun setShuffle(on: Boolean) = change { setShuffle(it, on) }

    fun toggleShuffle() = setShuffle(!_queue.value.shuffle)

    fun setRepeat(mode: RepeatMode) = change { it.copy(repeat = mode) }

    fun cycleRepeat() = setRepeat(cycleRepeat(_queue.value.repeat))

    /** play a song and keep going with songs like it */
    fun startRadio(track: Track) {
        newQueue { loadQueue(it.copy(shuffle = false, unshuffled = null), listOf(track), 0, PlayContext("radio", "${track.title} Radio", track.id)) }
        start()
        scope.launch {
            if (extendWithRadio().await() == 0) notice("Couldn’t find similar songs right now", error = true)
        }
    }

    // ---- what the notification and other controllers ask for, through the session

    /** another app asked to play from a position in the queue */
    fun jumpToIndex(index: Int, positionMs: Long) {
        if (index in _queue.value.items.indices) goTo(index, play = true, positionMs = positionMs.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0)
    }

    /** the system handing back the queue it was given for resuming: only lists from this app are taken */
    fun takeExternalItems(items: List<MediaItem>, startIndex: Int, startPositionMs: Long) {
        val state = _queue.value
        if (items.map { it.mediaId } != state.items.map { it.uid }) return
        if (startIndex in state.items.indices && startIndex != state.index) {
            goTo(startIndex, play = false, positionMs = startPositionMs.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0)
        }
    }

    // ---- inside

    private fun notice(text: String, error: Boolean = false) {
        _notices.tryEmit(Notice(text, error))
    }

    /** a whole new queue: radio answers for the old one are dropped */
    private fun newQueue(transform: (QueueState) -> QueueState) {
        generation++
        radio?.cancel()
        radio = null
        radioAskedFor = null
        failuresInARow = 0
        change(transform = transform)
    }

    private fun change(startPositionMs: Long = 0, transform: (QueueState) -> QueueState) {
        touched = true
        val before = _queue.value
        val after = transform(before)
        if (after == before) return
        _queue.value = after
        if (player == null && before.current?.uid != after.current?.uid) restingPositionMs = startPositionMs
        syncPlayer(startPositionMs)
        refreshStatus()
        scheduleSave()
    }

    /** bring the player's copy of the queue in line, keeping the playing song playing */
    private fun syncPlayer(startPositionMs: Long) {
        val exo = player ?: return
        val state = _queue.value
        val current = state.current
        applying = true
        try {
            if (current == null) {
                if (exo.mediaItemCount > 0) exo.clearMediaItems()
            } else {
                val uids = state.items.map { it.uid }
                val playing = exo.currentMediaItem?.mediaId
                if (exo.mediaItemCount == 0 || playing == null || playing !in uids) {
                    exo.setMediaItems(state.items.map { it.toMediaItem() }, state.index, startPositionMs)
                } else {
                    val old = List(exo.mediaItemCount) { exo.getMediaItemAt(it).mediaId }
                    val byUid = state.items.associateBy { it.uid }
                    for (step in planPlaylistSync(old, uids, playing)) {
                        when (step) {
                            is PlaylistStep.Remove -> exo.removeMediaItems(step.from, step.to)
                            is PlaylistStep.Insert -> exo.addMediaItems(step.at, step.uids.map { byUid.getValue(it).toMediaItem() })
                            is PlaylistStep.Move -> exo.moveMediaItem(step.from, step.to)
                        }
                    }
                    if (exo.currentMediaItem?.mediaId != current.uid) exo.seekTo(state.index, startPositionMs)
                }
            }
            val repeat = when (state.repeat) {
                RepeatMode.Off -> Player.REPEAT_MODE_OFF
                RepeatMode.All -> Player.REPEAT_MODE_ALL
                RepeatMode.One -> Player.REPEAT_MODE_ONE
            }
            if (exo.repeatMode != repeat) exo.repeatMode = repeat
            // the queue is already in shuffled order; the player's shuffle order is the identity, so this only tells controllers
            if (exo.shuffleModeEnabled != state.shuffle) exo.shuffleModeEnabled = state.shuffle
        } finally {
            applying = false
        }
    }

    private fun start() {
        val exo = player
        if (exo == null) {
            if (_queue.value.current != null) playWhenAttached = true
            refreshStatus()
            return
        }
        if (exo.mediaItemCount == 0) return
        when (exo.playbackState) {
            Player.STATE_IDLE -> exo.prepare()
            Player.STATE_ENDED -> exo.seekTo(exo.currentMediaItemIndex, 0)
        }
        exo.play()
    }

    private fun goTo(index: Int, play: Boolean, positionMs: Long = 0) {
        val state = _queue.value
        if (index !in state.items.indices) return
        if (index == state.index) {
            val exo = player
            if (exo != null && exo.mediaItemCount > 0) exo.seekTo(index, positionMs) else restingPositionMs = positionMs
        } else {
            change(positionMs) { it.copy(index = index) }
        }
        if (play) start()
        topUpRadio()
    }

    private fun rewindAndPause() {
        playWhenAttached = false
        val exo = player
        if (exo == null || exo.mediaItemCount == 0) {
            restingPositionMs = 0
        } else {
            exo.pause()
            exo.seekTo(exo.currentMediaItemIndex, 0)
        }
        refreshStatus()
        scheduleSave()
    }

    /** nothing comes next: find similar songs if autoplay is on, otherwise stop on the last song, rewound */
    private fun continueWithRadioOrStop(auto: Boolean) {
        if (!settings.autoplay.value || _queue.value.items.isEmpty()) return rewindAndPause()
        val from = _queue.value.current?.uid
        scope.launch {
            extendWithRadio().await()
            val state = _queue.value
            // something else was played meanwhile
            if (state.current?.uid != from) return@launch
            val target = nextIndex(state, auto)
            if (target != null && target != state.index) goTo(target, play = true) else rewindAndPause()
        }
    }

    private fun topUpRadio() {
        val state = _queue.value
        if (state.context?.kind == "radio" && state.upcoming.size <= 2) extendWithRadio()
    }

    /** add songs like the last one to the end of the queue; answers how many were added */
    private fun extendWithRadio(): Deferred<Int> {
        radio?.let { if (it.isActive && radioGeneration == generation) return it }
        val seed = _queue.value.items.lastOrNull()?.track ?: return CompletableDeferred(0)
        val asked = generation
        setRadioLoading(true)
        val job = scope.async {
            try {
                val found = catalog.radio(seed)
                if (asked != generation) return@async 0
                val known = _queue.value.items.takeLast(300).mapTo(HashSet()) { it.track.id }
                val more = found.filter { it.id !in known }.uniqueBy { it.id }
                if (more.isNotEmpty()) change { addToQueue(it, more) }
                more.size
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                0
            } finally {
                if (radio?.isActive != true || asked == generation) setRadioLoading(false)
            }
        }
        radio = job
        radioGeneration = asked
        return job
    }

    private fun setRadioLoading(on: Boolean) {
        if (_status.value.radioLoading != on) _status.value = _status.value.copy(radioLoading = on)
    }

    private fun onQueueEnded() {
        val from = _queue.value.current?.uid
        scope.launch {
            if (player?.playbackState != Player.STATE_ENDED || _queue.value.current?.uid != from) return@launch
            continueWithRadioOrStop(auto = true)
        }
    }

    private fun onFailed() {
        val item = _queue.value.current ?: return
        failuresInARow++
        if (failuresInARow >= MAX_FAILURES_IN_A_ROW) {
            failuresInARow = 0
            playWhenAttached = false
            player?.pause()
            notice("Playback stopped: several songs in a row wouldn’t load. Check your connection.", error = true)
            return
        }
        notice("Couldn’t play “${item.track.title}”, skipping", error = true)
        val target = nextIndex(_queue.value, auto = true)
        if (target != null) goTo(target, play = true) else continueWithRadioOrStop(auto = true)
    }

    private val listener = object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            if (applying) return
            val uid = mediaItem?.mediaId ?: return
            val state = _queue.value
            val index = state.items.indexOfFirst { it.uid == uid }
            if (index >= 0 && index != state.index) {
                _queue.value = state.copy(index = index)
                scheduleSave()
            }
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) topUpRadio()
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_ENDED && !applying) onQueueEnded()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) {
                failuresInARow = 0
                startTicking()
            } else {
                stopTicking()
                saveNow()
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            // handled after the player finishes reporting, not in the middle of it
            scope.launch { onFailed() }
        }

        override fun onEvents(player: Player, events: Player.Events) {
            refreshStatus()
        }
    }

    private fun refreshStatus() {
        val exo = player
        val current = _queue.value.current
        val fallbackDuration = current?.track?.durationMs ?: 0
        val radioLoading = _status.value.radioLoading
        _status.value = if (exo == null || exo.mediaItemCount == 0) {
            PlayerStatus(wantsToPlay = playWhenAttached, durationMs = fallbackDuration, radioLoading = radioLoading)
        } else {
            val state = exo.playbackState
            val wants = exo.playWhenReady && state != Player.STATE_IDLE && state != Player.STATE_ENDED
            val buffering = wants && state == Player.STATE_BUFFERING
            PlayerStatus(
                wantsToPlay = wants,
                playing = exo.isPlaying,
                buffering = buffering,
                waitingForNetwork = buffering && !connectivity.isOnline,
                durationMs = exo.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: fallbackDuration,
                radioLoading = radioLoading,
            )
        }
    }

    private fun startTicking() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                tick()
                delay(1_000)
            }
        }
    }

    private fun stopTicking() {
        ticker?.cancel()
        ticker = null
    }

    private fun tick() {
        val exo = player ?: return
        val state = _queue.value
        val current = state.current ?: return
        val duration = exo.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: current.track.durationMs
        // in real time: a sped-up song reaches its end sooner
        val remaining = ((duration - exo.currentPosition) / exo.playbackParameters.speed).toLong()
        // the queue is about to run out: find similar songs early so the next one is ready in time
        if (settings.autoplay.value && nextIndex(state, auto = true) == null && remaining in 1..PRELOAD_MS && radioAskedFor != current.uid) {
            radioAskedFor = current.uid
            extendWithRadio()
        }
        if (System.currentTimeMillis() - lastSave >= SAVE_EVERY_MS) saveNow()
    }

    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(800)
            saveNow()
        }
    }

    private fun saveNow() {
        saveJob?.cancel()
        saveJob = null
        lastSave = System.currentTimeMillis()
        store.save(_queue.value, positionMs())
    }

    private companion object {
        const val RESTART_AFTER_MS = 3_000L
        const val MAX_FAILURES_IN_A_ROW = 3
        /** how long before the end to look for similar songs, as on the desktop */
        const val PRELOAD_MS = 30_000L
        const val SAVE_EVERY_MS = 5_000L
    }
}

/** the player's copy of a queue item: the song's address and what the notification shows */
fun QueueItem.toMediaItem(): MediaItem = MediaItem.Builder()
    .setMediaId(uid)
    .setUri(track.playUri())
    .setMediaMetadata(
        MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artistNames.ifEmpty { null })
            .setAlbumTitle(track.album?.title)
            .setArtworkUri(sizedArtwork(track.artwork, 544)?.toUri())
            .setDurationMs(track.durationMs.takeIf { it > 0 })
            .setIsPlayable(true)
            .setIsBrowsable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
            .build(),
    )
    .build()
