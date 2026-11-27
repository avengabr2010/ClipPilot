package com.clippilot.app

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import kotlinx.coroutines.tasks.await

/** On-device face detection (ML Kit) to keep the speaker in a vertical frame. */
object Reframer {
    data class VideoInfo(val width: Int, val height: Int, val duration: Double)

    fun info(ctx: Context, uri: Uri): VideoInfo {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(ctx, uri)
            var w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toInt() ?: 0
            var h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toInt() ?: 0
            val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toInt() ?: 0
            if (rot == 90 || rot == 270) { val t = w; w = h; h = t }
            val d = (r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLong() ?: 0L) / 1000.0
            if (w == 0 || h == 0) throw IllegalStateException("Vidéo illisible.")
            return VideoInfo(w, h, d)
        } finally {
            r.release()
        }
    }

    /** Median horizontal centre (0..1) of the most prominent face over the clip; 0.5 if none. */
    suspend fun faceCenterX(ctx: Context, uri: Uri, start: Double, end: Double): Double {
        val detector = FaceDetection.getClient(
            FaceDetectorOptions.Builder().setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST).setMinFaceSize(0.08f).build()
        )
        val r = MediaMetadataRetriever()
        val xs = ArrayList<Double>()
        try {
            r.setDataSource(ctx, uri)
            val samples = 10
            for (i in 0 until samples) {
                val t = start + (end - start) * (i + 0.5) / samples
                val frame: Bitmap = r.getScaledFrameAtTime((t * 1e6).toLong(), MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 480, 480) ?: continue
                val faces = detector.process(InputImage.fromBitmap(frame, 0)).await()
                faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }?.let {
                    xs.add(it.boundingBox.exactCenterX().toDouble() / frame.width)
                }
                frame.recycle()
            }
        } catch (_: Exception) {
            return 0.5
        } finally {
            r.release(); detector.close()
        }
        return if (xs.isEmpty()) 0.5 else xs.sorted()[xs.size / 2]
    }
}
