package app.encore.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import app.encore.player.BuildConfig
import app.encore.player.ThemeMode
import app.encore.player.ui.BigTitle
import app.encore.player.ui.Icon
import app.encore.player.ui.Icons
import app.encore.player.ui.LocalAppUi
import app.encore.player.ui.Message
import app.encore.player.ui.Page
import app.encore.player.ui.StatusBarSpace
import app.encore.player.ui.Switch
import app.encore.player.ui.Txt
import app.encore.player.ui.nav.Tab
import app.encore.player.ui.pressable
import app.encore.player.ui.theme.ACCENTS
import app.encore.player.ui.theme.AccentPreset
import app.encore.player.ui.theme.Vyse

// Library (filled in by the next update) and You: appearance, playback and about.

@Composable
fun LibraryScreen() {
    val ui = LocalAppUi.current
    Page(title = "Library", list = rememberLazyListState(), tab = Tab.Library, titleBottom = rootTitleBottom()) {
        item(key = "top") {
            Column {
                StatusBarSpace()
                BigTitle("Library")
            }
        }
        item(key = "empty") {
            Message(
                Icons.Library,
                "Your library lives here",
                "Songs you like, playlists you make and albums you save will gather on this page.",
                action = "Find music",
                onAction = { ui.goTo(Tab.Search) },
            )
        }
    }
}

/** a titled group of settings on a soft panel */
@Composable
private fun Group(title: String, content: @Composable ColumnScope.() -> Unit) {
    val colors = Vyse.colors
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
        Txt(title.uppercase(), Vyse.type.eyebrow, color = colors.ink3, modifier = Modifier.padding(start = 6.dp, bottom = 8.dp))
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(22.dp))
                .background(colors.surface)
                .border(0.5.dp, colors.line, RoundedCornerShape(22.dp)),
            content = content,
        )
    }
}

/** a little picture of each look */
private fun DrawScope.drawLook(dark: Boolean, accent: Color) {
    if (dark) {
        drawRect(Color(0xFF030303))
        drawRect(Brush.radialGradient(listOf(accent.copy(alpha = 0.7f), accent.copy(alpha = 0.2f), Color.Transparent), center = Offset(size.width * 0.9f, size.height * 1.05f), radius = size.width * 0.9f))
        drawRect(Brush.radialGradient(listOf(Color(255, 213, 194).copy(alpha = 0.35f), Color.Transparent), center = Offset(size.width, size.height * 0.6f), radius = size.width * 0.5f))
    } else {
        drawRect(Brush.verticalGradient(listOf(Color(0xFFECECEA), Color(0xFFDCDCD6))))
        drawRect(Brush.radialGradient(listOf(Color(98, 140, 40).copy(alpha = 0.55f), Color.Transparent), center = Offset(size.width * 0.8f, size.height * 1.0f), radius = size.width * 0.8f))
        drawRect(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.8f), Color.Transparent), center = Offset(size.width * 0.45f, size.height * 0.3f), radius = size.width * 0.6f))
    }
    // a glass bar along the bottom, as in the app
    val bar = size.height * 0.2f
    drawRect(if (dark) Color.White.copy(alpha = 0.08f) else Color.White.copy(alpha = 0.6f), topLeft = Offset(0f, size.height - bar), size = Size(size.width, bar))
    // and a line of text
    drawRect(if (dark) Color.White.copy(alpha = 0.75f) else Color(0xFF17153B).copy(alpha = 0.75f), topLeft = Offset(size.width * 0.12f, size.height * 0.18f), size = Size(size.width * 0.42f, size.height * 0.07f))
    drawRect(if (dark) Color.White.copy(alpha = 0.35f) else Color(0xFF17153B).copy(alpha = 0.35f), topLeft = Offset(size.width * 0.12f, size.height * 0.31f), size = Size(size.width * 0.28f, size.height * 0.05f))
}

@Composable
private fun ThemePicker(selected: ThemeMode, onSelect: (ThemeMode) -> Unit) {
    val colors = Vyse.colors
    val options = listOf(
        Triple(ThemeMode.Ember, "Ember", Icons.Moon),
        Triple(ThemeMode.Moss, "Moss", Icons.Sun),
        Triple(ThemeMode.System, "Automatic", Icons.SunMoon),
    )
    Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        for ((mode, label, icon) in options) {
            val on = mode == selected
            Column(
                Modifier
                    .weight(1f)
                    .pressable({ onSelect(mode) }, pressedScale = 0.95f, label = "$label look", role = Role.RadioButton),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                val shape = RoundedCornerShape(14.dp)
                Box(
                    Modifier
                        .fillMaxWidth()
                        .aspectRatio(0.78f)
                        .clip(shape)
                        .drawBehind {
                            when (mode) {
                                ThemeMode.Ember -> drawLook(true, colors.accent)
                                ThemeMode.Moss -> drawLook(false, colors.accent)
                                ThemeMode.System -> {
                                    drawLook(false, colors.accent)
                                    val half = Path().apply {
                                        moveTo(0f, 0f)
                                        lineTo(size.width, 0f)
                                        lineTo(0f, size.height)
                                        close()
                                    }
                                    clipPath(half) { drawLook(true, colors.accent) }
                                }
                            }
                        }
                        .border(if (on) 2.dp else 0.5.dp, if (on) colors.accent else colors.line, shape),
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(icon, null, tint = if (on) colors.accentInk else colors.ink2, size = 15.dp)
                    Spacer(Modifier.width(5.dp))
                    Txt(label, Vyse.type.callout, color = if (on) colors.accentInk else colors.ink, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun Swatch(preset: AccentPreset, on: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Vyse.colors
    Box(
        modifier
            .size(46.dp)
            .pressable(onClick, pressedScale = 0.88f, label = "${preset.name} accent", role = Role.RadioButton),
        contentAlignment = Alignment.Center,
    ) {
        if (on) Box(Modifier.size(46.dp).border(2.dp, colors.ink, CircleShape))
        val fill = preset.logo?.let { (a, b) -> Brush.linearGradient(listOf(a, b)) }
        Box(
            Modifier
                .size(if (on) 36.dp else 40.dp)
                .clip(CircleShape)
                .then(if (fill != null) Modifier.background(fill) else Modifier.background(preset.color)),
            contentAlignment = Alignment.Center,
        ) {
            if (on) Icon(Icons.Check, null, tint = Color.White, size = 18.dp)
        }
    }
}

@Composable
private fun AccentPicker(selected: String, onSelect: (String) -> Unit) {
    val colors = Vyse.colors
    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 2.dp, bottom = 10.dp)) {
            Icon(Icons.Palette, null, tint = colors.ink2, size = 18.dp)
            Spacer(Modifier.width(10.dp))
            Txt("Accent", Vyse.type.bodyStrong)
            Spacer(Modifier.weight(1f))
            Txt(ACCENTS.firstOrNull { it.id == selected }?.name ?: "", Vyse.type.caption, color = colors.ink2)
        }
        for (row in ACCENTS.chunked(6)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                for (preset in row) Swatch(preset, preset.id == selected, { onSelect(preset.id) })
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun SettingSwitch(icon: ImageVector, title: String, detail: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val colors = Vyse.colors
    Row(
        Modifier
            .fillMaxWidth()
            .pressable({ onChange(!checked) }, pressedScale = 0.99f, label = title, role = Role.Switch)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = colors.ink2, size = 20.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Txt(title, Vyse.type.bodyStrong)
            Spacer(Modifier.height(2.dp))
            Txt(detail, Vyse.type.caption, color = colors.ink2)
        }
        Spacer(Modifier.width(12.dp))
        Switch(checked, onChange, title)
    }
}

@Composable
private fun Hairline() {
    val colors = Vyse.colors
    Box(Modifier.fillMaxWidth().padding(start = 16.dp).height(0.5.dp).drawBehind { drawRect(colors.line) })
}

/** the app's mark: a glowing disc in the accent's own colours */
@Composable
private fun Logo(size: androidx.compose.ui.unit.Dp) {
    val colors = Vyse.colors
    Box(
        Modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.28f))
            .background(Brush.linearGradient(colors.logo)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.AudioLines, null, tint = Color.White, size = size * 0.52f)
    }
}

@Composable
fun YouScreen() {
    val ui = LocalAppUi.current
    val settings = ui.settings
    val colors = Vyse.colors
    val theme by settings.theme.collectAsState()
    val accent by settings.accent.collectAsState()
    val autoplay by settings.autoplay.collectAsState()
    Page(title = "You", list = rememberLazyListState(), tab = Tab.You, titleBottom = rootTitleBottom()) {
        item(key = "top") {
            Column {
                StatusBarSpace()
                BigTitle("You")
            }
        }
        item(key = "appearance") {
            Group("Appearance") {
                ThemePicker(theme) { settings.setTheme(it) }
                Hairline()
                AccentPicker(accent) { settings.setAccent(it) }
            }
        }
        item(key = "playback") {
            Group("Playback") {
                SettingSwitch(Icons.Infinity, "Autoplay", "When the queue ends, keep going with similar songs", autoplay) { settings.setAutoplay(it) }
            }
        }
        item(key = "about") {
            Group("About") {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Logo(48.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Txt("Vyse Music", Vyse.type.title3)
                        Spacer(Modifier.height(2.dp))
                        Txt("Version ${BuildConfig.VERSION_NAME}", Vyse.type.caption, color = colors.ink2)
                    }
                }
                Hairline()
                Txt(
                    "Music streams straight from YouTube Music. Your queue and settings stay on this phone.",
                    Vyse.type.caption,
                    color = colors.ink2,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }
        item(key = "end") { Box(Modifier.fillMaxSize().height(12.dp)) }
    }
}
