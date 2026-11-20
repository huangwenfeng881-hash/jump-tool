package com.vertrise.jumptool

import android.content.Context
import com.vertrise.jumptool.analyzer.MetricsResult
import org.json.JSONObject
import java.io.File
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * 纠错反馈上传。
 *
 * 后端（Supabase）已下线，为避免「点一次必然失败」，这里改成：
 *   1) 先尝试云端（代理 → 直连）；
 *   2) 全部失败就把反馈写进本机文件（filesDir/feedback_pending.jsonl），
 *      等云端恢复后由 flushPending() 补传。
 * 返回 null 表示「已收到」；lastSavedLocally 标记是走了本机落盘。
 */
object FeedbackUploader {

    @Volatile
    var lastSavedLocally: Boolean = false
        private set

    /** 提交反馈；返回 null 表示已处理（云端成功或本机落盘），否则返回错误信息 */
    fun submit(
        issue: String,
        liftoff: Double?,
        landing: Double?,
        height: Double?,
        metricsJson: JSONObject?,
        ctx: Context? = null
    ): String? {
        lastSavedLocally = false
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

        var lastError: String? = null
        for (base in SupabaseConfig.ENDPOINTS) {
            val err = post(base, row)
            if (err == null) return null
            lastError = err
        }

        // 云端不可用：落本机，别让用户白点
        return if (saveLocal(ctx, row)) {
            lastSavedLocally = true
            null
        } else {
            lastError
        }
    }

    private fun saveLocal(ctx: Context?, row: JSONObject): Boolean {
        if (ctx == null) return false
        return try {
            val f = File(ctx.filesDir, "feedback_pending.jsonl")
            f.appendText(row.toString() + "\n", Charsets.UTF_8)
            true
        } catch (e: Exception) {
            false
        }
    }

    /** 把本机积压的反馈补传到云端；返回成功上传的条数 */
    fun flushPending(ctx: Context): Int {
        val f = File(ctx.filesDir, "feedback_pending.jsonl")
        if (!f.exists()) return 0
        var ok = 0
        val keep = StringBuilder()
        f.forEachLine { line ->
            if (line.isBlank()) return@forEachLine
            var sent = false
            for (base in SupabaseConfig.ENDPOINTS) {
                if (post(base, JSONObject(line)) == null) { sent = true; break }
            }
            if (sent) ok++ else keep.append(line).append("\n")
        }
        if (ok > 0) {
            runCatching { if (keep.isEmpty()) f.delete() else f.writeText(keep.toString()) }
        }
        return ok
    }

    private fun post(base: String, row: JSONObject): String? {
        val conn = URL(base + "/rest/v1/analysis_feedback").openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.doOutput = true
            conn.setRequestProperty("apikey", SupabaseConfig.ANON_KEY)
            conn.setRequestProperty("Authorization", "Bearer " + SupabaseConfig.ANON_KEY)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Prefer", "return=minimal")
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(row.toString()) }
            val code = conn.responseCode
            if (code in 200..299) null else "提交失败（HTTP " + code + "）"
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
