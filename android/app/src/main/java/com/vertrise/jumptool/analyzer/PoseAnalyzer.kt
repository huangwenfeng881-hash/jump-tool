package com.vertrise.jumptool.analyzer

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.floor
import kotlin.math.round

/**
 * 原生视频分析管线：
 * SAF 视频 Uri → MediaMetadataRetriever 抽帧 → PoseLandmarker(VIDEO) 逐帧识别
 * → FrameComputer 转帧特征 → JumpAnalyzer 计算弹跳指标。
 * 参数与网页版 js/pose.js 完全一致（CPU delegate、numPoses=1、置信度 0.3、无平滑）。
 */
object PoseAnalyzer {

    data class Outcome(
        val frames: List<FrameData>,
        val fps: Double,
        val durationSec: Double,
        val metrics: MetricsResult,
        val error: String? = null,
        val aborted: Boolean = false
    )

    /** 阻塞执行（调用方放在后台线程）；cancelled 置 true 可中断 */
    fun analyze(
        context: Context,
        uri: Uri,
        sampleEvery: Int,
        cancelled: AtomicBoolean,
        onProgress: (done: Int, total: Int) -> Unit,
        onPhase: (String) -> Unit
    ): Outcome {
        val mmr = MediaMetadataRetriever()
        try {
            mmr.setDataSource(context, uri)
        } catch (e: Exception) {
            return Outcome(emptyList(), 30.0, 0.0, MetricsResult(false, "无法读取视频", emptyList(), null, emptyMap()), "无法读取视频：" + e.message)
        }
        val durationMs = try { mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLong() ?: 0L } catch (e: Exception) { 0L }
        val durationSec = durationMs / 1000.0
        if (durationSec <= 0) {
            mmr.release()
            return Outcome(emptyList(), 30.0, 0.0, MetricsResult(false, "视频时长无效", emptyList(), null, emptyMap()), "视频时长无效")
        }

        val fps = readFps(context, uri)
        val frameInterval = 1.0 / fps
        val total = floor(durationSec / (frameInterval * sampleEvery)).toInt()
        if (total <= 0) {
            mmr.release()
            return Outcome(emptyList(), fps, durationSec, MetricsResult(false, "视频过短", emptyList(), null, emptyMap()), "视频过短")
        }

        onPhase("loading-model")
        val landmarker = try {
            PoseLandmarker.createFromOptions(
                context,
                PoseLandmarker.PoseLandmarkerOptions.builder()
                    .setBaseOptions(BaseOptions.builder().setModelAssetPath("pose_landmarker_lite.task").setDelegate(Delegate.CPU).build())
                    .setRunningMode(RunningMode.VIDEO)
                    .setNumPoses(1)
                    .setMinPoseDetectionConfidence(0.3f)
                    .setMinPosePresenceConfidence(0.3f)
                    .setMinTrackingConfidence(0.3f)
                    .build()
            )
        } catch (e: Exception) {
            mmr.release()
            return Outcome(emptyList(), fps, durationSec, MetricsResult(false, "模型加载失败", emptyList(), null, emptyMap()), "模型加载失败：" + e.message)
        }

        onPhase("analyzing")
        val frames = ArrayList<FrameData>(total)
        var lostStreak = 0
        val maxLost = maxOf(10, round(total * 0.3).toInt())
        var inferSeq = 0
        var aborted = false

        for (i in 0..total) {
            if (cancelled.get()) { aborted = true; break }
            var t = i * frameInterval * sampleEvery
            t = round(t * fps) / fps
            if (t > durationSec + 1e-6) break

            val frame = try {
                val bmp = mmr.getFrameAtTime((t * 1_000_000L).toLong(), MediaMetadataRetriever.OPTION_CLOSEST)
                bmp
            } catch (e: Exception) { null }
            if (frame == null) {
                lostStreak++
                frames.add(lostFrame(t))
                if (lostStreak >= maxLost) { aborted = true; break }
                onProgress(i, total)
                continue
            }
            val rgb = if (frame.config == Bitmap.Config.ARGB_8888) frame else frame.copy(Bitmap.Config.ARGB_8888, false)
            var feat: FrameComputer.FrameFeature? = null
            try {
                val img: MPImage = BitmapImageBuilder(rgb).build()
                val ts = ++inferSeq
                val result: PoseLandmarkerResult = landmarker.detectForVideo(img, ts.toLong())
                val lms = result.landmarks()
                if (lms != null && lms.isNotEmpty() && lms[0].isNotEmpty()) {
                    feat = FrameComputer.computeFrame(lms[0])
                }
                img.close()
            } catch (e: Exception) {
                feat = null
            } finally {
                if (rgb !== frame) rgb.recycle()
                frame.recycle()
            }
            if (feat == null) {
                lostStreak++
                frames.add(lostFrame(t))
                if (lostStreak >= maxLost) { aborted = true; break }
            } else {
                lostStreak = 0
                frames.add(feat.toFrame(t, false))
            }
            onProgress(i, total)
        }

        landmarker.close()
        mmr.release()

        val metrics = JumpAnalyzer.computeJumpMetrics(frames, fps)
        return Outcome(frames, fps, durationSec, metrics, aborted = aborted)
    }

    private fun readFps(context: Context, uri: Uri): Double {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(context, uri, null)
            for (i in 0 until ex.trackCount) {
                val fmt = ex.getTrackFormat(i)
                val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("video/")) {
                    val fr = try { fmt.getInteger(MediaFormat.KEY_FRAME_RATE) } catch (e: Exception) { 0 }
                    if (fr > 0) return fr.toDouble()
                    break
                }
            }
        } catch (e: Exception) {
            // 读取失败回退 30
        } finally {
            try { ex.release() } catch (e: Exception) {}
        }
        return 30.0
    }

    /** 丢失帧：全部字段为 null（与 JS entryOf(lost) 一致） */
    private fun lostFrame(t: Double): FrameData = FrameData(
        t = t, lost = true,
        kneeL = null, kneeR = null, hipL = null, hipR = null,
        comH = null, comX = null,
        feetY = null, leftFeetY = null, rightFeetY = null,
        hipX = null, hipY = null, ankleX = null, ankleY = null,
        shX = null, shY = null, wrX = null, wrY = null
    )
}
