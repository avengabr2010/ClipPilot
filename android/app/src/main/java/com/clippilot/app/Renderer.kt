package com.clippilot.app

import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.text.SpannableString
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Crop
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.TextOverlay
import androidx.media3.effect.TextureOverlay
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import com.google.common.collect.ImmutableList
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.coroutineScope
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Subtitle look presets (mirrors the web templates, simplified for on-device rendering). */
data class SubStyle(val id: String, val name: String, val color: Int, val highlight: Int, val uppercase: Boolean, val perLine: Int, val size: Float, val box: Boolean)

val SUB_STYLES = listOf(
    SubStyle("classic", "Classique", Color.WHITE, Color.WHITE, false, 5, 0.045f, true),
    SubStyle("bold", "Bold", Color.WHITE, Color.parseColor("#A78BFA"), true, 3, 0.055f, true),
    SubStyle("karaoke", "Karaoké", Color.WHITE, Color.parseColor("#FACC15"), true, 4, 0.05f, true),
    SubStyle("gaming", "Gaming", Color.WHITE, Color.parseColor("#4ADE80"), true, 2, 0.06f, true),
)

fun outputSize(aspect: String, height: Int): Pair<Int, Int> {
    val short = if (height >= 1080) 1080 else 720
    val long = if (short == 1080) 1920 else 1280
    return when (aspect) { "1:1" -> short to short; "16:9" -> long to short; else -> short to long }
}

@UnstableApi
private class SubtitleOverlay(
    private val groups: List<List<Word>>, private val style: SubStyle, private val outH: Int,
    private val clipStart: Double, private val clipDur: Double,
) : TextOverlay() {
    override fun getText(presentationTimeUs: Long): SpannableString {
        var t = presentationTimeUs / 1e6
        if (t > clipDur + 0.5) t -= clipStart // timestamps may be absolute depending on the pipeline
        val g = groups.firstOrNull { t >= it.first().start - 0.05 && t <= it.last().end + 0.15 } ?: return SpannableString(" ")
        val texts = g.map { if (style.uppercase) it.text.uppercase() else it.text }
        val s = SpannableString(texts.joinToString(" "))
        val size = (style.size * outH).toInt()
        s.setSpan(AbsoluteSizeSpan(size), 0, s.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        s.setSpan(StyleSpan(android.graphics.Typeface.BOLD), 0, s.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        s.setSpan(ForegroundColorSpan(style.color), 0, s.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        if (style.box) s.setSpan(BackgroundColorSpan(Color.argb(170, 0, 0, 0)), 0, s.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        var pos = 0
        for ((i, w) in g.withIndex()) {
            val len = texts[i].length
            val active = if (style.id == "karaoke") t >= w.start else t >= w.start && t < (g.getOrNull(i + 1)?.start ?: (w.end + 0.3))
            if (active && style.highlight != style.color) s.setSpan(ForegroundColorSpan(style.highlight), pos, pos + len, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            pos += len + 1
        }
        return s
    }
}

object Renderer {
    private fun groups(words: List<Word>, perLine: Int): List<List<Word>> {
        val out = ArrayList<List<Word>>()
        var cur = ArrayList<Word>()
        for (w in words) {
            if (cur.isNotEmpty() && (cur.size >= perLine || w.start - cur.last().end > 0.6)) { out.add(cur); cur = ArrayList() }
            cur.add(w)
        }
        if (cur.isNotEmpty()) out.add(cur)
        return out
    }

    @UnstableApi
    suspend fun render(
        ctx: Context, source: Uri, info: Reframer.VideoInfo, clip: Clip, words: List<Word>, settings: Settings,
        onProgress: (Int) -> Unit,
    ): File {
        val (outW, outH) = outputSize(settings.aspect, settings.height)
        val target = outW.toDouble() / outH
        val src = info.width.toDouble() / info.height
        val effects = ArrayList<androidx.media3.common.Effect>()
        if (src > target + 0.01) {
            val frac = target / src
            val left = (clip.cropX - frac / 2).coerceIn(0.0, 1 - frac)
            effects.add(Crop((left * 2 - 1).toFloat(), ((left + frac) * 2 - 1).toFloat(), -1f, 1f))
        }
        effects.add(Presentation.createForWidthAndHeight(outW, outH, Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP))
        if (settings.subtitles) {
            val style = SUB_STYLES.firstOrNull { it.id == settings.style } ?: SUB_STYLES[0]
            val rel = words.filter { it.end > clip.start && it.start < clip.end }
                .map { Word(it.start - clip.start, it.end - clip.start, it.text) }
            if (rel.isNotEmpty()) {
                effects.add(OverlayEffect(ImmutableList.of<TextureOverlay>(SubtitleOverlay(groups(rel, style.perLine), style, outH, clip.start, clip.end - clip.start))))
            }
        }
        val item = MediaItem.Builder().setUri(source).setClippingConfiguration(
            MediaItem.ClippingConfiguration.Builder()
                .setStartPositionMs((clip.start * 1000).toLong())
                .setEndPositionMs((clip.end * 1000).toLong()).build()
        ).build()
        val edited = EditedMediaItem.Builder(item).setEffects(Effects(listOf(), effects)).build()
        val out = File(Store.clipsDir(ctx), "${clip.id}.mp4")
        out.delete()

        return withContext(Dispatchers.Main) {
            coroutineScope {
                lateinit var transformer: Transformer
                val poll = launch {
                    val holder = ProgressHolder()
                    while (true) {
                        delay(500)
                        if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) onProgress(holder.progress)
                    }
                }
                try {
                    suspendCancellableCoroutine { cont ->
                        transformer = Transformer.Builder(ctx)
                            .setVideoMimeType(MimeTypes.VIDEO_H264)
                            .setAudioMimeType(MimeTypes.AUDIO_AAC)
                            .addListener(object : Transformer.Listener {
                                override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                                    if (out.length() > 10_000) cont.resume(out)
                                    else cont.resumeWithException(IllegalStateException("Fichier exporté vide."))
                                }
                                override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                                    cont.resumeWithException(exportException)
                                }
                            }).build()
                        cont.invokeOnCancellation { transformer.cancel() }
                        transformer.start(edited, out.absolutePath)
                    }
                } finally {
                    poll.cancel()
                }
            }
        }
    }
}
