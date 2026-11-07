package app.encore.player.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import app.encore.player.core.PlayContext
import app.encore.player.core.SearchResults
import app.encore.player.core.SuggestedItem
import app.encore.player.core.TopResult
import app.encore.player.core.Track
import app.encore.player.data.Load
import app.encore.player.data.Paged
import app.encore.player.data.SearchModel
import app.encore.player.data.SearchTab
import app.encore.player.ui.AlbumCard
import app.encore.player.ui.AppUi
import app.encore.player.ui.ArtistCard
import app.encore.player.ui.Artwork
import app.encore.player.ui.BigTitle
import app.encore.player.ui.Carousel
import app.encore.player.ui.CarouselPlaceholder
import app.encore.player.ui.ExplicitBadge
import app.encore.player.ui.FilledIcons
import app.encore.player.ui.GlassKind
import app.encore.player.ui.Icon
import app.encore.player.ui.IconButton
import app.encore.player.ui.Icons
import app.encore.player.ui.LocalAppUi
import app.encore.player.ui.LocalChrome
import app.encore.player.ui.LocalHazeState
import app.encore.player.ui.Message
import app.encore.player.ui.PlaylistCard
import app.encore.player.ui.ProblemMessage
import app.encore.player.ui.RowPlaceholders
import app.encore.player.ui.SectionTitle
import app.encore.player.ui.Spinner
import app.encore.player.ui.StatusBarSpace
import app.encore.player.ui.TrackRow
import app.encore.player.ui.Txt
import app.encore.player.ui.glass
import app.encore.player.ui.nav.Tab
import app.encore.player.ui.pressable
import app.encore.player.ui.theme.Vyse
import app.encore.player.youtube.SearchKind
import dev.chrisbanes.haze.hazeSource
import dev.chrisbanes.haze.rememberHazeState

// Search: suggestions while typing, recent searches before, and results after, with tabs for
// each kind of thing. The field stays pinned at the top under glass.

private enum class SearchMode { Recent, Suggest, Results }

@Composable
fun SearchScreen() {
    val ui = LocalAppUi.current
    val model = ui.search
    val colors = Vyse.colors
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val density = LocalDensity.current
    val chrome = LocalChrome.current
    var focused by remember { mutableStateOf(false) }
    val text = model.field.text.toString()

    LaunchedEffect(model) {
        snapshotFlow { model.field.text.toString() }.collect { model.suggest(it) }
    }
    BackHandler(enabled = focused) { focus.clearFocus() }

    val mode = when {
        focused && text.isNotBlank() && text.trim() != model.submitted -> SearchMode.Suggest
        model.submitted == null || (focused && text.isBlank()) -> SearchMode.Recent
        else -> SearchMode.Results
    }
    val recentList = remember { LazyListState() }
    val suggestList = remember { LazyListState() }
    val tabLists = remember { SearchTab.entries.associateWith { LazyListState() } }
    val list = when (mode) {
        SearchMode.Recent -> recentList
        SearchMode.Suggest -> suggestList
        SearchMode.Results -> tabLists.getValue(model.tab)
    }
    LaunchedEffect(model.submitted) { tabLists.values.forEach { it.scrollToItem(0) } }
    LaunchedEffect(list.isScrollInProgress) { if (list.isScrollInProgress) keyboard?.hide() }
    val tabTaps = ui.nav.reselected[Tab.Search] ?: 0
    LaunchedEffect(tabTaps) { if (tabTaps > 0) list.animateScrollToItem(0) }

    fun submit(query: String) {
        model.submit(query)
        focus.clearFocus()
    }

    val pageHaze = rememberHazeState()
    var headerHeight by remember { mutableIntStateOf(0) }
    val top = with(density) { headerHeight.toDp() }
    val ime = with(density) { WindowInsets.ime.getBottom(density).toDp() }
    val bottom = maxOf(chrome.bottom, ime) + 24.dp
    val scrolled by remember(list) { derivedStateOf { list.canScrollBackward } }
    val columns = gridColumns()

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            state = list,
            modifier = Modifier.fillMaxSize().hazeSource(pageHaze),
            contentPadding = PaddingValues(top = top + 4.dp, bottom = bottom),
        ) {
            when (mode) {
                SearchMode.Recent -> recent(ui, ::submit)
                SearchMode.Suggest -> suggestions(ui, model, text, ::submit)
                SearchMode.Results -> results(ui, model, ::submit, columns)
            }
        }
        CompositionLocalProvider(LocalHazeState provides pageHaze) {
            Box(Modifier.fillMaxWidth().onSizeChanged { headerHeight = it.height }) {
                Box(
                    Modifier
                        .matchParentSize()
                        .graphicsLayer { alpha = if (scrolled) 1f else 0f }
                        .glass(RectangleShape, GlassKind.Bar, shadow = false),
                )
                Column(Modifier.fillMaxWidth()) {
                    StatusBarSpace()
                    AnimatedVisibility(
                        visible = !focused && model.submitted == null,
                        enter = expandVertically() + fadeIn(),
                        exit = shrinkVertically() + fadeOut(),
                    ) { BigTitle("Search") }
                    SearchField(model, focused, onFocus = { focused = it }, onSubmit = { submit(model.field.text.toString()) })
                    AnimatedVisibility(
                        visible = mode == SearchMode.Results,
                        enter = expandVertically() + fadeIn(),
                        exit = shrinkVertically() + fadeOut(),
                    ) { Tabs(model) }
                    Spacer(Modifier.height(6.dp))
                }
            }
        }
    }
}

@Composable
private fun SearchField(model: SearchModel, focused: Boolean, onFocus: (Boolean) -> Unit, onSubmit: () -> Unit) {
    val colors = Vyse.colors
    val requester = remember { FocusRequester() }
    Row(
        Modifier
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .fillMaxWidth()
            .height(48.dp)
            .clip(CircleShape)
            .background(colors.surface)
            .border(1.dp, if (focused) colors.accent.copy(alpha = 0.55f) else Color.Transparent, CircleShape)
            .pressable({ requester.requestFocus() }, pressedScale = 1f, label = "Search")
            .padding(start = 16.dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Search, null, tint = colors.ink2, size = 20.dp)
        Spacer(Modifier.width(10.dp))
        BasicTextField(
            state = model.field,
            modifier = Modifier
                .weight(1f)
                .focusRequester(requester)
                .onFocusChanged { onFocus(it.isFocused) },
            textStyle = Vyse.type.body.copy(color = colors.ink),
            cursorBrush = SolidColor(colors.accent),
            lineLimits = TextFieldLineLimits.SingleLine,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Search,
            ),
            onKeyboardAction = { onSubmit() },
            decorator = { field ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (model.field.text.isEmpty()) Txt("Songs, albums, artists", Vyse.type.body, color = colors.ink3, maxLines = 1)
                    field()
                }
            },
        )
        if (model.field.text.isNotEmpty()) {
            IconButton(Icons.Close, "Clear", {
                model.field.clearText()
                if (!focused) model.clear()
                requester.requestFocus()
            }, tint = colors.ink2, size = 18.dp)
        } else {
            Spacer(Modifier.width(14.dp))
        }
    }
}

@Composable
private fun Tabs(model: SearchModel) {
    val colors = Vyse.colors
    LazyRow(
        Modifier.fillMaxWidth().padding(top = 4.dp),
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(SearchTab.entries) { tab ->
            val on = model.tab == tab
            Box(
                Modifier
                    .height(36.dp)
                    .clip(CircleShape)
                    .background(if (on) colors.accent else colors.surface)
                    .pressable({ model.select(tab) }, pressedScale = 0.94f, label = tab.label)
                    .padding(horizontal = 16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Txt(tab.label, Vyse.type.callout, color = if (on) colors.onAccent else colors.ink, maxLines = 1)
            }
        }
    }
}

// ---- before typing

private fun LazyListScope.recent(ui: AppUi, submit: (String) -> Unit) {
    item(key = "recent") {
        val recent by ui.settings.recentSearches.collectAsState()
        val colors = Vyse.colors
        if (recent.isEmpty()) {
            Message(Icons.Search, "Find your music", "Search songs, albums, artists and playlists on YouTube Music.")
        } else {
            Column {
                Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Txt("Recent searches", Vyse.type.title3, Modifier.weight(1f))
                    Box(Modifier.pressable({ ui.settings.clearSearches() }, label = "Clear recent searches").padding(8.dp)) {
                        Txt("Clear", Vyse.type.callout, color = colors.accentInk)
                    }
                }
                for (query in recent) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .height(52.dp)
                            .pressable({ submit(query) }, pressedScale = 0.985f, label = "Search $query")
                            .padding(start = 20.dp, end = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.History, null, tint = colors.ink3, size = 20.dp)
                        Spacer(Modifier.width(14.dp))
                        Txt(query, Vyse.type.body, Modifier.weight(1f), maxLines = 1)
                        IconButton(Icons.Close, "Remove $query", { ui.settings.forgetSearch(query) }, tint = colors.ink3, size = 16.dp)
                    }
                }
            }
        }
    }
}

// ---- while typing

private fun LazyListScope.suggestions(ui: AppUi, model: SearchModel, typed: String, submit: (String) -> Unit) {
    val found = model.suggestions
    val queries = found?.queries.orEmpty().ifEmpty { listOf(typed.trim()) }
    items(queries, key = { "q:$it" }) { query ->
        val colors = Vyse.colors
        Row(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .pressable({ submit(query) }, pressedScale = 0.985f, label = "Search $query")
                .padding(start = 20.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Search, null, tint = colors.ink3, size = 19.dp)
            Spacer(Modifier.width(14.dp))
            // what's been typed in plain, the rest of the suggestion in bold
            val label = remember(query, typed) {
                val start = query.lowercase().indexOf(typed.trim().lowercase())
                buildAnnotatedString {
                    if (start == 0 && typed.isNotBlank()) {
                        append(query.substring(0, typed.trim().length))
                        withStyle(SpanStyle(fontWeight = FontWeight.ExtraBold)) { append(query.substring(typed.trim().length)) }
                    } else append(query)
                }
            }
            androidx.compose.foundation.text.BasicText(label, Modifier.weight(1f), style = Vyse.type.body.copy(color = colors.ink), maxLines = 1)
            IconButton(Icons.Fill, "Use $query", { model.field.setTextAndPlaceCursorAtEnd("$query ") }, tint = colors.ink3, size = 18.dp)
        }
    }
    val items = found?.items.orEmpty()
    if (items.isNotEmpty()) {
        item(key = "items-gap") { Spacer(Modifier.height(8.dp)) }
        items(items, key = { item ->
            when (item) {
                is SuggestedItem.OfTrack -> "t:${item.track.id}"
                is SuggestedItem.OfArtist -> "a:${item.artist.id}"
                is SuggestedItem.OfAlbum -> "l:${item.album.id}"
                is SuggestedItem.OfPlaylist -> "p:${item.playlist.id}"
            }
        }) { item -> SuggestedRow(ui, item) }
    }
}

@Composable
private fun SuggestedRow(ui: AppUi, item: SuggestedItem) {
    val colors = Vyse.colors
    val focus = LocalFocusManager.current
    val (art, title, round) = when (item) {
        is SuggestedItem.OfTrack -> Triple(item.track.artwork, item.track.title, false)
        is SuggestedItem.OfArtist -> Triple(item.artist.artwork, item.artist.name, true)
        is SuggestedItem.OfAlbum -> Triple(item.album.artwork, item.album.title, false)
        is SuggestedItem.OfPlaylist -> Triple(item.playlist.artwork, item.playlist.title, false)
    }
    val open = {
        focus.clearFocus()
        when (item) {
            is SuggestedItem.OfTrack -> ui.play(listOf(item.track), 0, PlayContext("track", item.track.title, item.track.id))
            is SuggestedItem.OfArtist -> ui.openArtist(item.artist.id)
            is SuggestedItem.OfAlbum -> ui.openAlbum(item.album.id)
            is SuggestedItem.OfPlaylist -> ui.openPlaylist(item.playlist.id)
        }
    }
    Row(
        Modifier
            .fillMaxWidth()
            .height(64.dp)
            .pressable(open, onLongClick = (item as? SuggestedItem.OfTrack)?.let { { ui.songMenu(it.track) } }, pressedScale = 0.985f, label = title)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Artwork(art, size = 48.dp, shape = if (round) CircleShape else RoundedCornerShape(8.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Txt(title, Vyse.type.bodyStrong, maxLines = 1)
            Spacer(Modifier.height(3.dp))
            Txt(item.subtitle, Vyse.type.caption, color = colors.ink2, maxLines = 1)
        }
    }
}

// ---- after searching

private fun LazyListScope.results(ui: AppUi, model: SearchModel, submit: (String) -> Unit, columns: Int) {
    when (val load = model.results) {
        null -> Unit
        is Load.Loading -> item(key = "loading") {
            Column {
                Spacer(Modifier.height(8.dp))
                RowPlaceholders(5)
                Spacer(Modifier.height(24.dp))
                CarouselPlaceholder()
            }
        }
        is Load.Failed -> item(key = "failed") { ProblemMessage(load.problem, onRetry = { model.retry() }) }
        is Load.Ready -> when (model.tab) {
            SearchTab.All -> everything(ui, model, load.value, submit)
            SearchTab.Songs -> paged(ui, model.songs, load.value.query, "songs", model::loadMoreSongs)
            SearchTab.Videos -> paged(ui, model.videos, load.value.query, "videos", model::loadMoreVideos)
            SearchTab.Albums, SearchTab.Artists, SearchTab.Playlists -> kind(model, model.tab.kind!!, columns)
        }
    }
}

private fun LazyListScope.everything(ui: AppUi, model: SearchModel, r: SearchResults, submit: (String) -> Unit) {
    val context = PlayContext("search", "“${r.query}”")
    if (r.showingFor != null) {
        item(key = "showing") {
            val colors = Vyse.colors
            Txt("Showing results for “${r.showingFor}”", Vyse.type.caption, color = colors.ink2, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
        }
    }
    if (r.didYouMean != null) {
        item(key = "didyoumean") {
            val colors = Vyse.colors
            Row(Modifier.padding(horizontal = 12.dp).pressable({ submit(r.didYouMean!!) }, label = "Search ${r.didYouMean}").padding(horizontal = 8.dp, vertical = 8.dp)) {
                Txt("Did you mean ", Vyse.type.callout, color = colors.ink2)
                Txt("${r.didYouMean}?", Vyse.type.callout, color = colors.accentInk)
            }
        }
    }
    if (r.isEmpty) {
        item(key = "none") {
            Message(Icons.Search, "No results for “${r.query}”", "Check the spelling, or try fewer words.")
        }
    }
    r.top?.let { top -> item(key = "top") { TopResultCard(ui, top, r) } }
    if (r.tracks.isNotEmpty()) {
        item(key = "songs-title") {
            SectionTitle("Songs", Modifier.padding(top = 18.dp), action = if (r.tracks.size > 4) "See all" else null, onAction = { model.select(SearchTab.Songs) })
        }
        itemsIndexed(r.tracks.take(4), key = { i, t -> "song:$i:${t.id}" }) { i, track ->
            TrackRow(track, onClick = { ui.play(model.songs.tracks.ifEmpty { r.tracks }, i, context) })
        }
    }
    if (r.albums.isNotEmpty()) {
        item(key = "albums") { Carousel("Albums", r.albums, key = { it.id }, Modifier.padding(top = 24.dp)) { AlbumCard(it) } }
    }
    if (r.artists.isNotEmpty()) {
        item(key = "artists") { Carousel("Artists", r.artists, key = { it.id }, Modifier.padding(top = 24.dp)) { ArtistCard(it) } }
    }
    if (r.videos.isNotEmpty()) {
        item(key = "videos-title") {
            SectionTitle("Videos", Modifier.padding(top = 24.dp), action = if (r.videos.size > 3) "See all" else null, onAction = { model.select(SearchTab.Videos) })
        }
        itemsIndexed(r.videos.take(3), key = { i, t -> "video:$i:${t.id}" }) { i, track ->
            TrackRow(track, onClick = { ui.play(model.videos.tracks.ifEmpty { r.videos }, i, context) }, showAlbum = false)
        }
    }
    if (r.playlists.isNotEmpty()) {
        item(key = "playlists") { Carousel("Playlists", r.playlists, key = { it.id }, Modifier.padding(top = 24.dp)) { PlaylistCard(it) } }
    }
    if (r.related.isNotEmpty()) {
        item(key = "related") {
            val colors = Vyse.colors
            Column(Modifier.padding(top = 24.dp)) {
                SectionTitle("Try also")
                Spacer(Modifier.height(10.dp))
                LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(r.related) { query ->
                        Row(
                            Modifier
                                .height(38.dp)
                                .clip(CircleShape)
                                .background(colors.surface)
                                .pressable({ submit(query) }, pressedScale = 0.95f, label = "Search $query")
                                .padding(horizontal = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Search, null, tint = colors.ink3, size = 15.dp)
                            Spacer(Modifier.width(6.dp))
                            Txt(query, Vyse.type.callout, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TopResultCard(ui: AppUi, top: TopResult, r: SearchResults) {
    val colors = Vyse.colors
    val shape = RoundedCornerShape(20.dp)
    data class Shown(val art: String?, val title: String, val line: String, val round: Boolean, val explicit: Boolean)
    val shown = when (top) {
        is TopResult.OfTrack -> Shown(top.track.artwork, top.track.title, "Song · ${top.track.artistNames}", false, top.track.explicit)
        is TopResult.OfAlbum -> Shown(top.album.artwork, top.album.title, listOfNotNull(top.album.kind ?: "Album", top.album.artists.joinToString(", ") { it.name }.ifBlank { null }).joinToString(" · "), false, false)
        is TopResult.OfArtist -> Shown(top.artist.artwork, top.artist.name, top.artist.subtitle ?: "Artist", true, false)
    }
    val playTrack: (Track) -> Unit = { track ->
        ui.play(listOf(track) + r.tracks.filter { it.id != track.id }, 0, PlayContext("search", "“${r.query}”"))
    }
    val open = {
        when (top) {
            is TopResult.OfTrack -> playTrack(top.track)
            is TopResult.OfAlbum -> ui.openAlbum(top.album.id)
            is TopResult.OfArtist -> ui.openArtist(top.artist.id)
        }
    }
    Column(Modifier.padding(top = 8.dp)) {
        SectionTitle("Top result")
        Spacer(Modifier.height(10.dp))
        Row(
            Modifier
                .padding(horizontal = 16.dp)
                .fillMaxWidth()
                .clip(shape)
                .background(colors.surface)
                .pressable(open, onLongClick = (top as? TopResult.OfTrack)?.let { { ui.songMenu(it.track) } }, pressedScale = 0.98f, label = shown.title)
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Artwork(shown.art, size = 84.dp, shape = if (shown.round) CircleShape else RoundedCornerShape(12.dp))
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Txt(shown.title, Vyse.type.title3, maxLines = 2)
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (shown.explicit) {
                        ExplicitBadge()
                        Spacer(Modifier.width(6.dp))
                    }
                    Txt(shown.line, Vyse.type.caption, color = colors.ink2, maxLines = 1)
                }
            }
            if (top is TopResult.OfTrack) {
                Spacer(Modifier.width(8.dp))
                Box(
                    Modifier
                        .size(46.dp)
                        .clip(CircleShape)
                        .background(colors.accent)
                        .pressable({ playTrack(top.track) }, pressedScale = 0.9f, label = "Play ${top.track.title}"),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(FilledIcons.Play, null, tint = colors.onAccent, size = 20.dp, modifier = Modifier.padding(start = 2.dp))
                }
            }
        }
    }
}

private fun LazyListScope.paged(ui: AppUi, list: Paged, query: String, what: String, loadMore: () -> Unit) {
    val context = PlayContext("search", "“$query”")
    if (list.tracks.isEmpty() && list.more == null) {
        item(key = "empty-$what") { Message(Icons.Search, "No $what for “$query”", "Try other words.") }
        return
    }
    itemsIndexed(list.tracks, key = { i, t -> "$what:$i:${t.id}" }) { i, track ->
        TrackRow(track, onClick = { ui.play(list.tracks, i, context) }, showAlbum = what == "songs")
        // the next page starts loading a little before the end comes into view
        if (i >= list.tracks.size - 6 && list.more != null && !list.loading && !list.failed) {
            LaunchedEffect(list.tracks.size) { loadMore() }
        }
    }
    if (list.loading) {
        item(key = "more-$what") {
            Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) { Spinner() }
        }
    } else if (list.failed) {
        item(key = "retry-$what") {
            val colors = Vyse.colors
            Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.pressable(loadMore, label = "Load more").padding(12.dp)) {
                    Txt("Couldn’t load more. Tap to try again.", Vyse.type.callout, color = colors.accentInk)
                }
            }
        }
    }
}

private fun LazyListScope.kind(model: SearchModel, kind: SearchKind, columns: Int) {
    when (val load = model.kinds[kind]) {
        null, is Load.Loading -> item(key = "kind-loading") {
            Column(Modifier.padding(top = 8.dp)) {
                CarouselPlaceholder(round = kind == SearchKind.Artists)
                Spacer(Modifier.height(24.dp))
                CarouselPlaceholder(round = kind == SearchKind.Artists)
            }
        }
        is Load.Failed -> item(key = "kind-failed") { ProblemMessage(load.problem, onRetry = { model.retryKind(kind) }) }
        is Load.Ready -> {
            val found = load.value
            when (kind) {
                SearchKind.Artists -> {
                    if (found.artists.isEmpty()) item(key = "none") { Message(Icons.Artist, "No artists found", null) }
                    items(found.artists, key = { "artist:${it.id}" }) { artist ->
                        val ui = LocalAppUi.current
                        val colors = Vyse.colors
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .height(72.dp)
                                .pressable({ ui.openArtist(artist.id) }, pressedScale = 0.985f, label = artist.name)
                                .padding(horizontal = 20.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Artwork(artist.artwork, size = 56.dp, shape = CircleShape)
                            Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f)) {
                                Txt(artist.name, Vyse.type.bodyStrong, maxLines = 1)
                                artist.subtitle?.let {
                                    Spacer(Modifier.height(3.dp))
                                    Txt(it, Vyse.type.caption, color = colors.ink2, maxLines = 1)
                                }
                            }
                            Icon(Icons.ChevronRight, null, tint = colors.ink3, size = 18.dp)
                        }
                    }
                }
                SearchKind.Albums -> grid(found.albums.map { it.id to { w: androidx.compose.ui.unit.Dp -> AlbumCard(it, width = w) } }, "No albums found", columns)
                SearchKind.Playlists -> grid(found.playlists.map { it.id to { w: androidx.compose.ui.unit.Dp -> PlaylistCard(it, width = w) } }, "No playlists found", columns)
            }
        }
    }
}

/** how many cards fit across: two on a phone held upright, more on a turned phone or a tablet */
@Composable
private fun gridColumns(): Int = ((LocalConfiguration.current.screenWidthDp - 40 + 14) / (160 + 14)).coerceAtLeast(2)

/** cards in rows of [columns] */
private fun LazyListScope.grid(cards: List<Pair<String, @Composable (androidx.compose.ui.unit.Dp) -> Unit>>, empty: String, columns: Int) {
    if (cards.isEmpty()) {
        item(key = "none") { Message(Icons.Album, empty, null) }
        return
    }
    items(cards.chunked(columns), key = { row -> "row:${row.first().first}" }) { row ->
        val width = ((LocalConfiguration.current.screenWidthDp - 40 - 14 * (columns - 1)) / columns).dp
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            for ((_, card) in row) card(width)
        }
    }
}
