package app.encore.player.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import app.encore.player.playback.Notice
import app.encore.player.ui.nav.Tab
import app.encore.player.ui.theme.Vyse
import kotlinx.coroutines.delay

// The glass bar of tabs along the bottom, and the short notes that rise above it.

private fun Tab.icon() = when (this) {
    Tab.Home -> Icons.Home
    Tab.Search -> Icons.Search
    Tab.Library -> Icons.Library
    Tab.You -> Icons.You
}

const val TAB_BAR_HEIGHT = 64

@Composable
fun BottomBar(modifier: Modifier = Modifier) {
    val ui = LocalAppUi.current
    val colors = Vyse.colors
    val haptics = LocalHapticFeedback.current
    val selected = ui.nav.tab
    // the light under the open tab slides across with a little spring
    val at by animateFloatAsState(selected.ordinal.toFloat(), spring(dampingRatio = 0.72f, stiffness = 520f), label = "tab")
    Box(
        modifier
            .fillMaxWidth()
            .glass(RectangleShape, GlassKind.Bar, shadow = false)
            .drawBehind { drawRect(colors.line, size = Size(size.width, 0.5.dp.toPx())) },
    ) {
        Row(
            Modifier
                // on wide screens the tabs gather in the middle, as wide as the mini player
                .align(Alignment.TopCenter)
                .widthIn(max = 640.dp)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars)
                .height(TAB_BAR_HEIGHT.dp)
                .drawBehind {
                    val cell = size.width / Tab.entries.size
                    val w = 60.dp.toPx()
                    val h = 32.dp.toPx()
                    drawRoundRect(
                        colors.accent.copy(alpha = if (colors.dark) 0.2f else 0.16f),
                        topLeft = Offset(cell * (at + 0.5f) - w / 2f, 7.dp.toPx()),
                        size = Size(w, h),
                        cornerRadius = CornerRadius(h / 2f),
                    )
                },
        ) {
            for (tab in Tab.entries) {
                val on = tab == selected
                Column(
                    Modifier
                        .weight(1f)
                        .height(TAB_BAR_HEIGHT.dp)
                        .pressable(
                            {
                                if (!on) haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                                ui.goTo(tab)
                            },
                            pressedScale = 0.9f,
                            label = tab.label,
                            role = Role.Tab,
                        ),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Spacer(Modifier.height(11.dp))
                    Icon(tab.icon(), null, tint = if (on) colors.accentInk else colors.ink2, size = 22.dp)
                    Spacer(Modifier.height(9.dp))
                    Txt(tab.label, Vyse.type.tab, color = if (on) colors.accentInk else colors.ink2, maxLines = 1)
                }
            }
        }
    }
}

/** a note that rises above the chrome for a moment */
@Composable
fun ToastHost(bottom: androidx.compose.ui.unit.Dp, modifier: Modifier = Modifier) {
    val ui = LocalAppUi.current
    val colors = Vyse.colors
    var shown by remember { mutableStateOf<Notice?>(null) }
    var visible by remember { mutableStateOf(false) }
    var count by remember { mutableIntStateOf(0) }
    LaunchedEffect(ui) {
        ui.notices.collect {
            shown = it
            visible = true
            count++
        }
    }
    LaunchedEffect(count) {
        if (count > 0) {
            delay(if (shown?.isError == true) 3600 else 2400)
            visible = false
        }
    }
    Box(modifier.fillMaxWidth().padding(bottom = bottom + 10.dp), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(
            visible = visible,
            enter = slideInVertically(spring(dampingRatio = 0.75f, stiffness = 500f)) { it / 2 } + fadeIn() + scaleIn(initialScale = 0.92f),
            exit = slideOutVertically { it / 3 } + fadeOut() + scaleOut(targetScale = 0.95f),
        ) {
            val notice = shown
            if (notice != null) {
                Row(
                    Modifier
                        .padding(horizontal = 24.dp)
                        .widthIn(max = 480.dp)
                        .glass(CircleShape, GlassKind.Menu)
                        .padding(horizontal = 18.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(if (notice.isError) Icons.Alert else Icons.Check, null, tint = if (notice.isError) colors.bad else colors.good, size = 18.dp)
                    Spacer(Modifier.width(10.dp))
                    Txt(notice.text, Vyse.type.callout, maxLines = 2)
                }
            }
        }
    }
}

/** a small dot, for marking things */
@Composable
fun Dot(modifier: Modifier = Modifier, color: androidx.compose.ui.graphics.Color = Vyse.colors.accent) {
    Box(modifier.size(6.dp).drawBehind { drawCircle(color) })
}
