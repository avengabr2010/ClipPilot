package com.clippilot.app

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import androidx.annotation.OptIn
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.util.UnstableApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

sealed interface Screen {
    data object Home : Screen
    data class New(val uri: Uri, val name: String, val duration: Double) : Screen
    data object Processing : Screen
    data class Detail(val projectId: String) : Screen
}

class ClipViewModel(app: Application) : AndroidViewModel(app) {
    private val ctx get() = getApplication<Application>()
    var screen by mutableStateOf<Screen>(Screen.Home)
    val projects = mutableStateListOf<Project>()
    var stage by mutableStateOf("")
    var progress by mutableStateOf(0f)
    var error by mutableStateOf<String?>(null)
    var busyClip by mutableStateOf<String?>(null)
    private var job: Job? = null

    init { reload() }

    fun reload() { projects.clear(); projects.addAll(Store.list(ctx)) }

    fun project(id: String) = projects.firstOrNull { it.id == id }

    fun pick(uri: Uri) {
        error = null
        viewModelScope.launch {
            try {
                val info = withContext(Dispatchers.IO) { Reframer.info(ctx, uri) }
                if (info.duration < 10) throw IllegalStateException("La vidéo doit durer au moins 10 secondes.")
                screen = Screen.New(uri, displayName(uri), info.duration)
            } catch (e: Exception) {
                error = e.message ?: "Vidéo illisible."
            }
        }
    }

    private fun displayName(uri: Uri): String =
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        }?.substringBeforeLast('.') ?: "Vidéo"

    @OptIn(UnstableApi::class)
    fun start(uri: Uri, name: String, settings: Settings) {
        screen = Screen.Processing
        error = null
        job = viewModelScope.launch {
            val id = UUID.randomUUID().toString()
            val local = File(File(ctx.filesDir, "sources").apply { mkdirs() }, "$id.mp4")
            try {
                stage = "Copie de la vidéo"; progress = 0f
                withContext(Dispatchers.IO) {
                    ctx.contentResolver.openInputStream(uri)!!.use { input -> local.outputStream().use { input.copyTo(it) } }
                }
                val src = Uri.fromFile(local)
                val info = withContext(Dispatchers.IO) { Reframer.info(ctx, src) }

                stage = "Transcription (hors ligne)"
                val words = withContext(Dispatchers.Default) {
                    Transcriber.transcribe(ctx, src) { p -> progress = (p * 0.6).toFloat() }
                }
                if (words.size < 15) throw IllegalStateException("Trop peu de parole détectée dans la vidéo.")

                stage = "Recherche des meilleurs moments"; progress = 0.62f
                val clips = withContext(Dispatchers.Default) {
                    Analyzer.select(words, settings.minSec, settings.maxSec, settings.count, info.duration)
                }
                if (clips.isEmpty()) throw IllegalStateException("Aucun passage exploitable. Essayez une autre durée de clip.")

                val project = Project(id, name, src.toString(), info.duration, System.currentTimeMillis(), settings, words, clips.toMutableList())
                for ((i, clip) in clips.withIndex()) {
                    val base = 0.65f + 0.35f * i / clips.size
                    if (settings.smartCrop) {
                        stage = "Recadrage du clip ${i + 1}/${clips.size}"
                        clip.cropX = Reframer.faceCenterX(ctx, src, clip.start, clip.end)
                    }
                    stage = "Montage du clip ${i + 1}/${clips.size}"
                    val file = Renderer.render(ctx, src, info, clip, words, settings) { p ->
                        progress = base + 0.35f / clips.size * p / 100f
                    }
                    clip.file = file.absolutePath
                    Store.save(ctx, project)
                }
                Store.save(ctx, project)
                reload()
                screen = Screen.Detail(id)
            } catch (e: kotlinx.coroutines.CancellationException) {
                local.delete(); screen = Screen.Home; throw e
            } catch (e: Throwable) {
                error = e.message ?: "Le traitement a échoué."
                if (project(id) == null) local.delete()
                screen = Screen.Home
            }
        }
    }

    fun cancel() { job?.cancel() }

    @OptIn(UnstableApi::class)
    fun rerender(p: Project, clip: Clip, newStart: Double, newEnd: Double, title: String) {
        busyClip = clip.id
        viewModelScope.launch {
            try {
                clip.start = newStart.coerceAtLeast(0.0); clip.end = newEnd.coerceAtMost(p.duration); clip.title = title
                val src = Uri.parse(p.sourceUri)
                val info = withContext(Dispatchers.IO) { Reframer.info(ctx, src) }
                clip.file = Renderer.render(ctx, src, info, clip, p.words, p.settings) {}.absolutePath
                Store.save(ctx, p); reload()
            } catch (e: Exception) {
                error = e.message ?: "Export impossible."
            } finally {
                busyClip = null
            }
        }
    }

    fun delete(p: Project) {
        Store.delete(ctx, p)
        File(Uri.parse(p.sourceUri).path ?: "").delete()
        reload(); screen = Screen.Home
    }

    fun deleteClip(p: Project, c: Clip) {
        c.file?.let { File(it).delete() }
        p.clips.remove(c); Store.save(ctx, p); reload()
    }
}
