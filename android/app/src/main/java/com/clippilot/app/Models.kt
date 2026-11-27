package com.clippilot.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** A word with its timing (seconds), from the on-device transcription. */
data class Word(val start: Double, val end: Double, val text: String)

data class Settings(
    val minSec: Int = 30,
    val maxSec: Int = 45,
    val count: Int = 5,
    val aspect: String = "9:16",
    val height: Int = 1080,
    val style: String = "bold",
    val subtitles: Boolean = true,
    val smartCrop: Boolean = true,
)

data class Clip(
    val id: String,
    var title: String,
    var start: Double,
    var end: Double,
    val score: Int,
    val hook: String?,
    val reason: String,
    val transcript: String,
    var file: String?,
    var cropX: Double = 0.5,
)

data class Project(
    val id: String,
    val name: String,
    val sourceUri: String,
    val duration: Double,
    val createdAt: Long,
    val settings: Settings,
    val words: List<Word>,
    val clips: MutableList<Clip>,
)

/** All projects are stored as JSON files in the app's private storage. Nothing leaves the phone. */
object Store {
    private fun dir(ctx: Context) = File(ctx.filesDir, "projects").apply { mkdirs() }
    fun clipsDir(ctx: Context) = File(ctx.filesDir, "clips").apply { mkdirs() }

    fun list(ctx: Context): List<Project> =
        dir(ctx).listFiles { f -> f.extension == "json" }.orEmpty()
            .mapNotNull { runCatching { fromJson(JSONObject(it.readText())) }.getOrNull() }
            .sortedByDescending { it.createdAt }

    fun save(ctx: Context, p: Project) = File(dir(ctx), "${p.id}.json").writeText(toJson(p).toString())

    fun delete(ctx: Context, p: Project) {
        p.clips.forEach { c -> c.file?.let { File(it).delete() } }
        File(dir(ctx), "${p.id}.json").delete()
    }

    private fun toJson(p: Project) = JSONObject().apply {
        put("id", p.id); put("name", p.name); put("sourceUri", p.sourceUri); put("duration", p.duration)
        put("createdAt", p.createdAt)
        put("settings", JSONObject().apply {
            val s = p.settings
            put("minSec", s.minSec); put("maxSec", s.maxSec); put("count", s.count); put("aspect", s.aspect)
            put("height", s.height); put("style", s.style); put("subtitles", s.subtitles); put("smartCrop", s.smartCrop)
        })
        put("words", JSONArray().apply { p.words.forEach { put(JSONArray().put(it.start).put(it.end).put(it.text)) } })
        put("clips", JSONArray().apply {
            p.clips.forEach { c ->
                put(JSONObject().apply {
                    put("id", c.id); put("title", c.title); put("start", c.start); put("end", c.end); put("score", c.score)
                    put("hook", c.hook ?: JSONObject.NULL); put("reason", c.reason); put("transcript", c.transcript)
                    put("file", c.file ?: JSONObject.NULL); put("cropX", c.cropX)
                })
            }
        })
    }

    private fun fromJson(o: JSONObject): Project {
        val s = o.getJSONObject("settings")
        val words = o.getJSONArray("words").let { a -> List(a.length()) { i -> a.getJSONArray(i).let { Word(it.getDouble(0), it.getDouble(1), it.getString(2)) } } }
        val clips = o.getJSONArray("clips").let { a ->
            MutableList(a.length()) { i ->
                a.getJSONObject(i).let {
                    Clip(it.getString("id"), it.getString("title"), it.getDouble("start"), it.getDouble("end"), it.getInt("score"),
                        it.optString("hook").takeIf { h -> h.isNotEmpty() && h != "null" }, it.getString("reason"), it.getString("transcript"),
                        it.optString("file").takeIf { f -> f.isNotEmpty() && f != "null" }, it.optDouble("cropX", 0.5))
                }
            }
        }
        return Project(
            o.getString("id"), o.getString("name"), o.getString("sourceUri"), o.getDouble("duration"), o.getLong("createdAt"),
            Settings(s.getInt("minSec"), s.getInt("maxSec"), s.getInt("count"), s.getString("aspect"), s.getInt("height"),
                s.getString("style"), s.getBoolean("subtitles"), s.getBoolean("smartCrop")),
            words, clips,
        )
    }
}
