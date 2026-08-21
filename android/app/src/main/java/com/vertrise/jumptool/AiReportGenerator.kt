package com.vertrise.jumptool

import com.vertrise.jumptool.analyzer.MetricsResult
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * AI 弹跳分析报告（原生版）：
 * 1) buildMetricsText 移植自 js/pose.js —— 把指标转成发给 AI 的中文数据摘要；
 * 2) 调用智谱 GLM chat/completions 生成报告（与网页版同 key、同提示词、非流式）。
 */
object AiReportGenerator {

    private const val GLM_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    private const val GLM_KEY = "d56cac79e59e4296b3239370560041cf.jSD9s7lYXAIZmc4r"
    private const val GLM_MODEL = "glm-4-flash"

    /** 生成中文数据摘要（与 js/pose.js buildMetricsText 对齐） */
    fun buildMetricsText(m: MetricsResult): String {
        val best = m.best ?: return ""
        val sb = StringBuilder()
        val tk = best.takeoff
        sb.append("起跳方式：").append(
            when (tk.type) {
                "single" -> "单脚起跳（起跳瞬间一只脚蹬地，摆动腿在空中）"
                "double" -> "双脚起跳（起跳前两脚本着地同时发力）"
                else -> "数据不足"
            }
        ).append('\n')
        sb.append("弹跳高度：").append(best.jump.heightCm).append("cm")
        if (best.jumpCount > 1) sb.append("，共识别 ").append(best.jumpCount).append(" 次弹跳")
        sb.append('\n')
        best.contactTime?.let { sb.append("触地时间：").append(it).append("s（连续两次弹跳之间）\n") }
        sb.append("屈膝深度：起跳前最深处膝角 ").append(best.kneeMin ?: "--").append("°")
        best.kneeMinTime?.let { sb.append("（出现在起跳前 ").append(kotlin.math.abs(it)).append("s）") }
        sb.append('\n')
        sb.append("屈髋深度：起跳前髋角最深处 ").append(best.hipMin ?: "--").append("°")
        best.hipMinTime?.let { sb.append("（出现在起跳前 ").append(kotlin.math.abs(it)).append("s）") }
        sb.append('\n')
        sb.append("起跳角度：身体前倾 ").append(best.leanAngle ?: "--").append("°（竖直为0°）")
        best.trajAngle?.let { sb.append("；腾空轨迹角 ").append(it).append("°（水平为0°）") }
        sb.append('\n')
        sb.append("摆臂速度：峰值角速度 ").append(if (best.armSwingDegS > 0) "${best.armSwingDegS}°/s" else "--")
        if (best.armSwingAmp > 0) sb.append("，摆幅 ").append(best.armSwingAmp).append("°")
        sb.append('\n')
        val stp = best.steps
        when {
            stp.found >= 2 -> sb.append("最后两步节奏：倒数第二步触地 ").append(stp.penultimateContact).append("s，最后一步触地 ")
                .append(stp.lastContact).append("s，最后一步/倒数第二步 = ").append(stp.ratio)
                .append(stp.gap?.let { "，两步间腾空 ${it}s" } ?: "").append('\n')
            stp.found == 1 -> sb.append("最后两步节奏：仅识别到最后一步触地 ").append(stp.lastContact)
                .append("s（可能是原地起跳、单脚起跳或助跑步数不足）\n")
            else -> sb.append("最后两步节奏：未能从脚部轨迹识别出助跑步\n")
        }
        val ld = best.landing
        sb.append("落地稳定性：落地膝角 ").append(ld.landingKnee ?: "--").append("°")
            .append("，落地后髋部横向摆动 ").append(ld.swayPct ?: "--").append("%腿长")
            .append("，稳定用时 ").append(ld.settleTime ?: "--").append("s\n")
        return sb.toString()
    }

    /** 调用 GLM 生成报告；返回 null 表示成功（text 为报告），否则错误信息 */
    fun generate(text: String): Pair<String?, String> {
        val sys = "你是 Vertrise跃升 的 AI 弹跳分析专家（资深弹跳/力量/体能教练）。你根据一段助跑起跳视频的姿态识别数据，给出专业、简洁、可执行的中文分析报告。\n" +
            "【弹跳技术要点（评估标准以此为准）】\n" +
            "起跳瞬间髋部（重心）应向上向前发力；屈膝深度（起跳前最深处膝角）反映蹲跳发力幅度，膝角越小蹲得越深；屈髋深度反映髋部参与程度；摆臂速度反映摆臂助力的爆发性；最后两步节奏（倒数第二步触地→最后一步触地→起跳）反映助跑衔接；落地稳定性看落地膝角与髋部横向摆动。\n\n" +
            "规则：\n" +
            "1. 严格按【】分节输出，六项指标逐项给评分（满分10分）与一句点评；\n" +
            "2. 判断我的弹跳类型（力量型/速度型/弹性型）时，结合屈膝深度、屈髋深度、触地时间、摆臂速度、腾空时间等数据说明依据，不要凭空猜测；\n" +
            "3. 数据缺失的项目明确说明“数据不足”，不要编造；\n" +
            "4. 训练建议要具体（动作名称、组数×次数、要点），注意安全。"
        val user = "我的弹跳姿态数据如下（由 AI 自动识别）：\n$text\n\n请按以下格式输出报告（不要省略任何一节）：\n" +
            "【逐项分析】\n起跳角度：分数/10 一句点评\n屈膝深度：分数/10 一句点评\n摆臂速度：分数/10 一句点评\n最后两步节奏：分数/10 一句点评\n落地稳定性：分数/10 一句点评\n" +
            "【弹跳类型】力量型/速度型/弹性型 + 判断依据\n" +
            "【弹跳短板】按优先级列出 1-3 个最需要改进的短板，每条说明原因\n" +
            "【训练建议】针对短板的具体训练动作与要点"

        val body = JSONObject()
            .put("model", GLM_MODEL)
            .put("temperature", 0.4)
            .put("max_tokens", 1600)
            .put("stream", false)
            .put("messages", JSONArray()
                .put(JSONObject().put("role", "system").put("content", sys))
                .put(JSONObject().put("role", "user").put("content", user)))

        val conn = URL(GLM_URL).openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 30000
            conn.readTimeout = 90000
            conn.doOutput = true
            conn.setRequestProperty("Authorization", "Bearer $GLM_KEY")
            conn.setRequestProperty("Content-Type", "application/json")
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
            val code = conn.responseCode
            if (code !in 200..299) {
                val err = conn.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
                Pair(null, "AI 报告失败（HTTP $code）：${err.take(120)}")
            } else {
                val resp = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                val json = JSONObject(resp)
                val content = json.optJSONArray("choices")?.optJSONObject(0)?.optJSONObject("message")?.optString("content")
                if (content.isNullOrBlank()) Pair(null, "AI 返回内容为空") else Pair(content, "")
            }
        } catch (e: Exception) {
            Pair(null, "网络异常：" + (e.message ?: "请重试"))
        } finally {
            conn.disconnect()
        }
    }
}
