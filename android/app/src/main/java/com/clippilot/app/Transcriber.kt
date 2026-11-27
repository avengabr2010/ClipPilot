package com.clippilot.app

import android.content.Context
import android.net.Uri
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File

/** Offline speech-to-text with Vosk. The French model ships inside the APK (assets/model-fr). */
object Transcriber {
    private var model: Model? = null

    private fun modelDir(ctx: Context): File {
        val target = File(ctx.filesDir, "model-fr")
        val marker = File(target, ".ok")
        if (!marker.exists()) {
            target.deleteRecursively()
            copyAssets(ctx, "model-fr", target)
            marker.writeText(BuildConfig.VERSION_NAME)
        }
        return target
    }

    private fun copyAssets(ctx: Context, path: String, dest: File) {
        val children = ctx.assets.list(path).orEmpty()
        if (children.isEmpty()) {
            dest.parentFile?.mkdirs()
            ctx.assets.open(path).use { input -> dest.outputStream().use { input.copyTo(it) } }
        } else {
            dest.mkdirs()
            children.forEach { copyAssets(ctx, "$path/$it", File(dest, it)) }
        }
    }

    @Synchronized
    private fun load(ctx: Context): Model = model ?: Model(modelDir(ctx).absolutePath).also { model = it }

    fun transcribe(ctx: Context, uri: Uri, onProgress: (Double) -> Unit): List<Word> {
        val rec = Recognizer(load(ctx), AudioDecoder.RATE.toFloat())
        rec.setWords(true)
        val words = ArrayList<Word>()
        fun collect(json: String) {
            val arr = JSONObject(json).optJSONArray("result") ?: return
            for (i in 0 until arr.length()) {
                val w = arr.getJSONObject(i)
                words.add(Word(w.getDouble("start"), w.getDouble("end"), w.getString("word")))
            }
        }
        try {
            AudioDecoder.decode(ctx, uri) { chunk, progress ->
                if (rec.acceptWaveForm(chunk, chunk.size)) collect(rec.result)
                onProgress(progress)
            }
            collect(rec.finalResult)
        } finally {
            rec.close()
        }
        return words
    }
}
