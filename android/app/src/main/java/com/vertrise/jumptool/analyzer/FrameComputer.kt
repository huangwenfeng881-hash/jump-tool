package com.vertrise.jumptool.analyzer

import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import kotlin.math.acos
import kotlin.math.max
import kotlin.math.min

import kotlin.math.sqrt

/**
 * 单帧关键点 → 帧特征量（与 js/pose.js computeFrame 等价）。
 * MediaPipe 33 点索引约定与网页版完全一致：
 * 髋 23/24、膝 25/26、踝 27/28、脚跟 29/30、脚趾 31/32、肩 11/12、腕 15/16。
 */
object FrameComputer {

    /** 与 JS visible() 一致：visibility 未提供或 > 0.5 视为可见 */
    fun visible(lm: NormalizedLandmark?): Boolean {
        if (lm == null) return false
        val v = lm.visibility()
        return !v.isPresent || v.get() > 0.5f
    }

    /** 三点夹角（b 为顶点），与 JS angleAt 一致 */
    fun angleAt(a: NormalizedLandmark?, b: NormalizedLandmark?, c: NormalizedLandmark?): Double? {
        if (a == null || b == null || c == null) return null
        val v1x = a.x() - b.x()
        val v1y = a.y() - b.y()
        val v2x = c.x() - b.x()
        val v2y = c.y() - b.y()
        val m1 = sqrt(v1x * v1x + v1y * v1y)
        val m2 = sqrt(v2x * v2x + v2y * v2y)
        if (m1 == 0f || m2 == 0f) return null
        val dot = v1x * v2x + v1y * v2y
        val deg = acos(max(-1.0, min(1.0, (dot / (m1 * m2)).toDouble()))) * 180 / Math.PI
        return jsRound(deg * 10) / 10
    }

    private fun midOf(a: NormalizedLandmark?, b: NormalizedLandmark?): Pair<Float, Float>? {
        if (!visible(a) || !visible(b)) return null
        return Pair((a!!.x() + b!!.x()) / 2f, (a.y() + b.y()) / 2f)
    }

    /**
     * 计算帧特征量（不含 t/lost，由调用方填充）。
     * 返回 null 表示关键点不足（<33 点）。
     */
    fun computeFrame(lm: List<NormalizedLandmark>?): FrameFeature? {
        if (lm == null || lm.size < 33) return null
        val Lh = lm[23]; val Lk = lm[25]; val La = lm[27]
        val Rh = lm[24]; val Rk = lm[26]; val Ra = lm[28]
        val kneeL = if (visible(Lh) && visible(Lk) && visible(La)) angleAt(Lh, Lk, La) else null
        val kneeR = if (visible(Rh) && visible(Rk) && visible(Ra)) angleAt(Rh, Rk, Ra) else null
        val hipL = if (visible(lm[11]) && visible(lm[23]) && visible(lm[25])) angleAt(lm[11], lm[23], lm[25]) else null
        val hipR = if (visible(lm[12]) && visible(lm[24]) && visible(lm[26])) angleAt(lm[12], lm[24], lm[26]) else null

        // 重心近似：髋部中心
        var comY: Float? = null
        var comX: Float? = null
        if (visible(lm[23]) && visible(lm[24])) {
            comY = (lm[23].y() + lm[24].y()) / 2f
            comX = (lm[23].x() + lm[24].x()) / 2f
        } else if (visible(lm[23])) {
            comY = lm[23].y()
            comX = lm[23].x()
        }

        // 脚部最低点（踝/跟/趾 27-32）
        var feetY: Float? = null
        for (i in 27..32) {
            if (visible(lm[i]) && (feetY == null || lm[i].y() > feetY!!)) feetY = lm[i].y()
        }
        var leftFeetY: Float? = null
        var rightFeetY: Float? = null
        for (j in 27..32) {
            if (!visible(lm[j])) continue
            val isLeft = (j == 27 || j == 29 || j == 31)
            if (isLeft) { if (leftFeetY == null || lm[j].y() > leftFeetY!!) leftFeetY = lm[j].y() }
            else { if (rightFeetY == null || lm[j].y() > rightFeetY!!) rightFeetY = lm[j].y() }
        }

        val hipM = midOf(lm[23], lm[24])
        val ankM = midOf(lm[27], lm[28])
        val shM = midOf(lm[11], lm[12])
        val wrM = midOf(lm[15], lm[16])
        fun norm(v: Float?): Double? = if (v == null) null else jsRound((v * 1000).toDouble()) / 1000

        return FrameFeature(
            kneeL = kneeL, kneeR = kneeR, hipL = hipL, hipR = hipR,
            comH = if (comY == null) null else jsRound(((1 - comY) * 1000).toDouble()) / 10,
            comX = if (comX == null) null else jsRound((comX * 1000).toDouble()) / 10,
            feetY = feetY?.toDouble(),
            leftFeetY = if (leftFeetY == null) null else jsRound((leftFeetY * 1000).toDouble()) / 1000,
            rightFeetY = if (rightFeetY == null) null else jsRound((rightFeetY * 1000).toDouble()) / 1000,
            hipX = norm(hipM?.first), hipY = norm(hipM?.second),
            ankleX = norm(ankM?.first), ankleY = norm(ankM?.second),
            shX = norm(shM?.first), shY = norm(shM?.second),
            wrX = norm(wrM?.first), wrY = norm(wrM?.second)
        )
    }

    /** 单帧特征量（computeFrame 输出） */
    data class FrameFeature(
        val kneeL: Double?, val kneeR: Double?,
        val hipL: Double?, val hipR: Double?,
        val comH: Double?, val comX: Double?,
        val feetY: Double?,
        val leftFeetY: Double?, val rightFeetY: Double?,
        val hipX: Double?, val hipY: Double?,
        val ankleX: Double?, val ankleY: Double?,
        val shX: Double?, val shY: Double?,
        val wrX: Double?, val wrY: Double?
    ) {
        /** 转成分析用帧数据（t/lost 由调用方提供） */
        fun toFrame(t: Double, lost: Boolean): FrameData = FrameData(
            t = t, lost = lost,
            kneeL = kneeL, kneeR = kneeR, hipL = hipL, hipR = hipR,
            comH = comH, comX = comX,
            feetY = feetY, leftFeetY = leftFeetY, rightFeetY = rightFeetY,
            hipX = hipX, hipY = hipY,
            ankleX = ankleX, ankleY = ankleY,
            shX = shX, shY = shY,
            wrX = wrX, wrY = wrY
        )
    }
}
