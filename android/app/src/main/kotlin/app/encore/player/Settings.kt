package app.encore.player

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

enum class ThemeMode(val key: String) {
    /** follow the phone */
    System("system"),
    /** Ember: dark */
    Ember("dark"),
    /** Moss: light */
    Moss("light");

    companion object {
        fun of(key: String?) = entries.firstOrNull { it.key == key } ?: Ember
    }
}

/**
 * The app's few settings. They're read before the first frame so the app opens in the right
 * colours, which is why they live in plain preferences rather than a file read in the background.
 */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    private val _theme = MutableStateFlow(ThemeMode.of(prefs.getString(THEME, null)))
    val theme: StateFlow<ThemeMode> = _theme

    /** one of the accent names in the theme; Ember by default, as on the desktop */
    private val _accent = MutableStateFlow(prefs.getString(ACCENT, null) ?: "ember")
    val accent: StateFlow<String> = _accent

    /** keep playing similar songs when the queue runs out */
    private val _autoplay = MutableStateFlow(prefs.getBoolean(AUTOPLAY, true))
    val autoplay: StateFlow<Boolean> = _autoplay

    /** what was searched lately, newest first */
    private val _recentSearches = MutableStateFlow(prefs.getString(RECENT_SEARCHES, null)?.split('\n')?.filter { it.isNotBlank() } ?: emptyList())
    val recentSearches: StateFlow<List<String>> = _recentSearches

    fun setTheme(mode: ThemeMode) {
        _theme.value = mode
        prefs.edit { putString(THEME, mode.key) }
    }

    fun setAccent(name: String) {
        _accent.value = name
        prefs.edit { putString(ACCENT, name) }
    }

    fun setAutoplay(on: Boolean) {
        _autoplay.value = on
        prefs.edit { putBoolean(AUTOPLAY, on) }
    }

    fun rememberSearch(query: String) {
        val text = query.trim().replace('\n', ' ')
        if (text.isEmpty()) return
        val list = (listOf(text) + _recentSearches.value.filterNot { it.equals(text, ignoreCase = true) }).take(MAX_RECENT)
        _recentSearches.value = list
        prefs.edit { putString(RECENT_SEARCHES, list.joinToString("\n")) }
    }

    fun forgetSearch(query: String) {
        val list = _recentSearches.value.filterNot { it == query }
        _recentSearches.value = list
        prefs.edit { putString(RECENT_SEARCHES, list.joinToString("\n")) }
    }

    fun clearSearches() {
        _recentSearches.value = emptyList()
        prefs.edit { remove(RECENT_SEARCHES) }
    }

    private companion object {
        const val THEME = "theme"
        const val ACCENT = "accent"
        const val AUTOPLAY = "autoplay"
        const val RECENT_SEARCHES = "recentSearches"
        const val MAX_RECENT = 12
    }
}
