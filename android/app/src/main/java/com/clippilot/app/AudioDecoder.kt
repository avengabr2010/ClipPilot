package com.clippilot.app

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteOrder

/** Decodes the audio track of a video into 16 kHz mono 16-bit PCM, streamed in chunks. */
object AudioDecoder {
    const val RATE = 16000

    fun decode(ctx: Context, uri: Uri, onChunk: (ShortArray, Double) -> Unit) {
        val ex = MediaExtractor()
        ex.setDataSource(ctx, uri, null)
        val track = (0 until ex.trackCount).firstOrNull {
            ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        } ?: throw IllegalStateException("Cette vidéo ne contient pas de son.")
        ex.selectTrack(track)
        val fmt = ex.getTrackFormat(track)
        val duration = if (fmt.containsKey(MediaFormat.KEY_DURATION)) fmt.getLong(MediaFormat.KEY_DURATION) / 1e6 else 0.0
        val codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(fmt, null, null, 0)
        codec.start()
        var inRate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var pos = 0.0 // resampler position in input samples
        var produced = 0L
        try {
            while (true) {
                if (!inputDone) {
                    val i = codec.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val buf = codec.getInputBuffer(i)!!
                        val n = ex.readSampleData(buf, 0)
                        if (n < 0) {
                            codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true
                        } else {
                            codec.queueInputBuffer(i, 0, n, ex.sampleTime, 0); ex.advance()
                        }
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 10_000)
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    codec.outputFormat.let { inRate = it.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = it.getInteger(MediaFormat.KEY_CHANNEL_COUNT) }
                } else if (o >= 0) {
                    val buf = codec.getOutputBuffer(o)!!.order(ByteOrder.nativeOrder()).asShortBuffer()
                    val frames = buf.remaining() / channels
                    val mono = FloatArray(frames) { f ->
                        var s = 0f
                        for (c in 0 until channels) s += buf.get(f * channels + c)
                        s / channels
                    }
                    codec.releaseOutputBuffer(o, false)
                    val step = inRate.toDouble() / RATE
                    val out = ArrayList<Short>(frames)
                    while (pos < frames - 1) {
                        val i0 = pos.toInt(); val frac = pos - i0
                        out.add((mono[i0] * (1 - frac) + mono[i0 + 1] * frac).toInt().coerceIn(-32768, 32767).toShort())
                        pos += step
                    }
                    pos -= frames
                    if (out.isNotEmpty()) {
                        produced += out.size
                        onChunk(out.toShortArray(), if (duration > 0) (produced.toDouble() / RATE / duration).coerceAtMost(1.0) else 0.0)
                    }
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
        } finally {
            codec.stop(); codec.release(); ex.release()
        }
    }
}
