package app.encore.player.youtube

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

// YouTube's answers are deep, loosely typed JSON that changes shape now and then. These helpers
// read a path and give null instead of throwing when something isn't there, like the desktop
// app's mappers do.

internal fun JsonElement?.obj(): JsonObject? = this as? JsonObject

internal fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

/** a number, also when YouTube sends it as a string ("contentLength": "4194304") */
internal fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.let { it.doubleOrNull ?: it.content.toDoubleOrNull() }

internal fun JsonElement?.bool(): Boolean? = (this as? JsonPrimitive)?.booleanOrNull

/** follows object keys and array indexes, e.g. at("contents", 0, "musicShelfRenderer") */
internal fun JsonElement?.at(vararg path: Any): JsonElement? {
    var node = this
    for (step in path) {
        node = when (step) {
            is String -> (node as? JsonObject)?.get(step)
            is Int -> (node as? JsonArray)?.getOrNull(step)
            else -> null
        } ?: return null
    }
    return node
}

internal fun JsonElement?.list(vararg path: Any): List<JsonElement> = (at(*path) as? JsonArray) ?: emptyList()

/** the first value under `key` anywhere inside, depth first in document order */
internal fun JsonElement?.find(key: String): JsonElement? {
    when (this) {
        is JsonObject -> {
            this[key]?.let { return it }
            for (value in values) value.find(key)?.let { return it }
        }
        is JsonArray -> for (value in this) value.find(key)?.let { return it }
        else -> Unit
    }
    return null
}

/** every value under `key` anywhere inside, in document order */
internal fun JsonElement?.findAll(key: String): List<JsonElement> {
    val out = ArrayList<JsonElement>()
    fun walk(node: JsonElement?) {
        when (node) {
            is JsonObject -> for ((k, value) in node) {
                if (k == key) out += value
                walk(value)
            }
            is JsonArray -> node.forEach(::walk)
            else -> Unit
        }
    }
    walk(this)
    return out
}

/** one piece of a YouTube text, with where it links to */
internal data class Run(
    val text: String,
    val browseId: String? = null,
    val pageType: String? = null,
    val videoId: String? = null,
    val musicVideoType: String? = null,
) {
    val isArtistLink get() = browseId?.startsWith("UC") == true
    val isAlbumLink get() = browseId?.startsWith("MPR") == true
}

internal fun runs(text: JsonElement?): List<Run> {
    val list = text.list("runs")
    if (list.isEmpty()) return text.at("simpleText").str()?.let { listOf(Run(it)) } ?: emptyList()
    return list.map { run ->
        val endpoint = run.at("navigationEndpoint")
        val browse = endpoint.at("browseEndpoint")
        val watch = endpoint.at("watchEndpoint")
        Run(
            text = run.at("text").str() ?: "",
            browseId = browse.at("browseId").str(),
            pageType = browse.at("browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig", "pageType").str(),
            videoId = watch.at("videoId").str(),
            musicVideoType = watch.at("watchEndpointMusicSupportedConfigs", "watchEndpointMusicConfig", "musicVideoType").str(),
        )
    }
}

internal fun textOf(text: JsonElement?): String = runs(text).joinToString("") { it.text }

internal fun List<Run>.joined(): String = joinToString("") { it.text }
