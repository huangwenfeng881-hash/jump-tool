package com.vertrise.jumptool.analyzer

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Kotlin 移植回归测试：对网页版引擎（js/pose.js）生成的夹具逐视频对比。
 * 夹具：_fixtures/fx_*.json（由 _dump-batch.cjs + _dump-poses.html 生成，
 * 含 poseData（输入帧）+ metrics（网页版期望输出）+ fps）。
 * 容差：时间 ±0.035s（约 1 帧@30fps）、高度 ±0.6cm、角度/比值按字段放宽。
 */
class JumpAnalyzerRegressionTest {

    private fun fixtureDir(): File {
        val res = javaClass.getResource("/fixtures/synth_double.json")
        if (res != null) return File(res.toURI()).parentFile
        val byCwd = File(System.getProperty("user.dir"), "src/test/resources/fixtures")
        if (byCwd.isDirectory) return byCwd
        throw AssertionError("找不到夹具目录（先运行 node _gen-synth-fixtures.cjs 并复制到 src/test/resources/fixtures）")
    }

    private fun parseFrame(o: JSONObject): FrameData {
        fun d(name: String): Double? = if (o.isNull(name)) null else o.optDouble(name)
        return FrameData(
            t = o.optDouble("t"),
            lost = o.optBoolean("lost", false),
            kneeL = d("kneeL"), kneeR = d("kneeR"),
            hipL = d("hipL"), hipR = d("hipR"),
            comH = d("comH"), comX = d("comX"),
            feetY = d("feetY"), leftFeetY = d("leftFeetY"), rightFeetY = d("rightFeetY"),
            hipX = d("hipX"), hipY = d("hipY"),
            ankleX = d("ankleX"), ankleY = d("ankleY"),
            shX = d("shX"), shY = d("shY"),
            wrX = d("wrX"), wrY = d("wrY")
        )
    }

    private fun near(actual: Double?, expected: Double?, tol: Double, label: String) {
        if (expected == null) { assertTrue("$label: 期望 null 但得到 $actual", actual == null); return }
        assertNotNull("$label: 期望 $expected 但得到 null", actual)
        assertTrue(
            "$label: 期望 $expected 实际 $actual（容差 $tol）",
            kotlin.math.abs(actual!! - expected) <= tol
        )
    }

    @Test
    fun allFixturesMatchWebEngine() {
        val files = fixtureDir().listFiles { f -> f.name.startsWith("fx_") || f.name.startsWith("synth_") }
            ?.filter { it.name.endsWith(".json") }?.sortedBy { it.name } ?: emptyList()
        assertTrue("夹具目录为空", files.isNotEmpty())

        var passed = 0
        for (f in files) {
            val root = JSONObject(f.readText(Charsets.UTF_8))
            val video = root.optString("video", f.name)
            val fps = root.optDouble("fps", 30.0)
            val exp = root.optJSONObject("metrics")
            if (root.has("error") && !root.isNull("error")) {
                // 网页端分析失败（如视频损坏），跳过该夹具
                println("SKIP $video: 网页端错误 ${root.optString("error")}")
                continue
            }
            val arr = root.getJSONArray("poseData")
            val data = ArrayList<FrameData>(arr.length())
            for (i in 0 until arr.length()) data.add(parseFrame(arr.getJSONObject(i)))

            val got = JumpAnalyzer.computeJumpMetrics(data, fps)
            if (exp == null) {
                // 网页端无 metrics（分析中断等）
                println("SKIP $video: 网页端无 metrics（aborted=${root.optBoolean("aborted")}）")
                continue
            }
            val expOk = exp.optBoolean("ok")
            assertEquals("$video: ok 不一致", expOk, got.ok)
            if (!expOk) {
                println("PASS $video: 双方均未识别到弹跳")
                passed++
                continue
            }

            val eb = exp.getJSONObject("best")
            val gb = got.best
            assertNotNull("$video: 网页端 ok 但 Kotlin best 为 null", gb)

            val ej = eb.getJSONObject("jump")
            val gj = gb!!.jump
            near(gj.liftoffTime, ej.optDouble("liftoffTime"), 0.035, "$video liftoff")
            near(gj.landingTime, ej.optDouble("landingTime"), 0.035, "$video landing")
            near(gj.flightTime, ej.optDouble("flightTime"), 0.05, "$video flight")
            near(gj.heightCm, ej.optDouble("heightCm"), 0.6, "$video height")
            assertEquals("$video: source", ej.optString("source", "feet"), gj.source)

            near(gb.kneeMin, if (eb.isNull("kneeMin")) null else eb.optDouble("kneeMin"), 3.0, "$video kneeMin")
            near(gb.hipMin, if (eb.isNull("hipMin")) null else eb.optDouble("hipMin"), 3.0, "$video hipMin")
            near(gb.leanAngle, if (eb.isNull("leanAngle")) null else eb.optDouble("leanAngle"), 2.0, "$video leanAngle")
            near(gb.trajAngle, if (eb.isNull("trajAngle")) null else eb.optDouble("trajAngle"), 2.0, "$video trajAngle")
            near(gb.armSwingDegS, if (eb.isNull("armSwingDegS")) null else eb.optDouble("armSwingDegS"), 40.0, "$video armSwingDegS")
            near(gb.armSwingAmp, if (eb.isNull("armSwingAmp")) null else eb.optDouble("armSwingAmp"), 12.0, "$video armSwingAmp")
            assertEquals("$video: jumpCount", eb.optInt("jumpCount", 1), gb.jumpCount)
            near(gb.bestLift, if (eb.isNull("bestLift")) null else eb.optDouble("bestLift"), 0.012, "$video bestLift")

            val et = eb.optJSONObject("takeoff")
            if (et != null) {
                assertEquals("$video: takeoff.type", et.optString("type", "unknown"), gb.takeoff.type)
            }
            val es = eb.optJSONObject("steps")
            if (es != null) {
                assertEquals("$video: steps.found", es.optInt("found", 0), gb.steps.found)
                near(gb.steps.lastContact, if (es.isNull("lastContact")) null else es.optDouble("lastContact"), 0.035, "$video lastContact")
                near(gb.steps.penultimateContact, if (es.isNull("penultimateContact")) null else es.optDouble("penultimateContact"), 0.035, "$video penultimateContact")
                near(gb.steps.ratio, if (es.isNull("ratio")) null else es.optDouble("ratio"), 0.06, "$video ratio")
            }
            val el = eb.optJSONObject("landing")
            if (el != null) {
                near(gb.landing.landingKnee, if (el.isNull("landingKnee")) null else el.optDouble("landingKnee"), 3.0, "$video landingKnee")
                near(gb.landing.swayPct, if (el.isNull("swayPct")) null else el.optDouble("swayPct"), 6.0, "$video swayPct")
                near(gb.landing.settleTime, if (el.isNull("settleTime")) null else el.optDouble("settleTime"), 0.06, "$video settleTime")
            }
            passed++
            println("PASS $video (height ${ej.optDouble("heightCm")}cm)")
        }
        println("通过 $passed/${files.size} 个夹具")
        assertTrue("无可用夹具断言", passed > 0)
    }
}
