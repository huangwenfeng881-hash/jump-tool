package com.vertrise.jumptool

import com.vertrise.jumptool.analyzer.MetricsResult
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/** 纠错反馈上传：匿名提交到 Supabase analysis_feedback 表（与网页版同一后端） */
object FeedbackUploader {

    private const val SUPABASE_URL = "https://iszxoejqhjpucczfsdfo.supabase.co"
    private const val ANON_KEY = "sb_publishable_34izFFx3h1vs_NnJkfBsEw_7rWbpawp"

    /** 提交反馈；返回 null 表示成功，否则返回错误信息 */
    fun submit(issue: String, liftoff: Double?, landing: Double?, height: Double?, metricsJson: JSONObject?): String? {
        val row = JSONObject()
        row.put("user_id", JSONObject.NULL)
        row.put("video_name", "android-app")
        row.put("video_sec", JSONObject.NULL)
        row.put("fps", JSONObject.NULL)
        row.put("frames", JSONObject.NULL)
        if (metricsJson != null) row.put("metrics", metricsJson)
        if (liftoff != null) row.put("actual_liftoff", liftoff)
        if (landing != null) row.put("actual_landing", landing)
        if (height != null) row.put("actual_height_cm", height)
        row.put("issue", issue.ifBlank { "（未填写问题描述）" })

        val conn = URL("$SUPABASE_URL/rest/v1/analysis_feedback").openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.doOutput = true
            conn.setRequestProperty("apikey", ANON_KEY)
            conn.setRequestProperty("Authorization", "Bearer $ANON_KEY")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Prefer", "return=minimal")
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(row.toString()) }
            val code = conn.responseCode
            if (code in 200..299) null else "提交失败（HTTP $code）"
        } catch (e: Exception) {
            "网络异常：" + (e.message ?: "请重试")
        } finally {
            conn.disconnect()
        }
    }

    /** 从分析结果构造 metrics JSON（与网页版 analysis_feedback.metrics 结构一致的精简版） */
    fun metricsOf(m: MetricsResult, fps: Double): JSONObject? {
        val best = m.best ?: return null
        val o = JSONObject()
        o.put("ok", true)
        o.put("fps", fps)
        o.put("jumpCount", best.jumpCount)
        o.put("jump", JSONObject()
            .put("liftoffTime", best.jump.liftoffTime)
            .put("landingTime", best.jump.landingTime)
            .put("flightTime", best.jump.flightTime)
            .put("heightCm", best.jump.heightCm))
        o.put("takeoff", JSONObject().put("type", best.takeoff.type))
        o.put("steps", JSONObject()
            .put("found", best.steps.found)
            .put("lastContact", best.steps.lastContact ?: JSONObject.NULL)
            .put("penultimateContact", best.steps.penultimateContact ?: JSONObject.NULL)
            .put("ratio", best.steps.ratio ?: JSONObject.NULL))
        o.put("landing", JSONObject()
            .put("landingKnee", best.landing.landingKnee ?: JSONObject.NULL)
            .put("swayPct", best.landing.swayPct ?: JSONObject.NULL)
            .put("settleTime", best.landing.settleTime ?: JSONObject.NULL))
        o.put("leanAngle", best.leanAngle ?: JSONObject.NULL)
        o.put("armSwingDegS", best.armSwingDegS)
        o.put("kneeMin", best.kneeMin ?: JSONObject.NULL)
        return o
    }
}
