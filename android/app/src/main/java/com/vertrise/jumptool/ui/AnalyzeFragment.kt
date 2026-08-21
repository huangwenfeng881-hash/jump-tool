package com.vertrise.jumptool.ui

import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.FeedbackUploader
import com.vertrise.jumptool.R
import com.vertrise.jumptool.analyzer.JumpAnalyzer
import com.vertrise.jumptool.analyzer.MetricsResult
import com.vertrise.jumptool.analyzer.PoseAnalyzer
import com.vertrise.jumptool.databinding.FragmentAnalyzeBinding
import java.util.concurrent.atomic.AtomicBoolean

/**
 * AI 弹跳分析（全原生）：
 * 选视频（SAF）→ PoseAnalyzer 逐帧识别（后台线程）→ JumpAnalyzer 指标 → 结果卡片 + 纠错反馈。
 */
class AnalyzeFragment : Fragment() {

    private var _binding: FragmentAnalyzeBinding? = null
    private val binding get() = _binding!!

    private val mainHandler = Handler(Looper.getMainLooper())
    private var cancelled = AtomicBoolean(false)
    private var analyzingThread: Thread? = null

    private var lastOutcome: PoseAnalyzer.Outcome? = null

    private val pickVideo = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            val takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION
            requireContext().contentResolver.takePersistableUriPermission(uri, takeFlags)
            startAnalyze(uri)
        }
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentAnalyzeBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.btnPickVideo.setOnClickListener {
            pickVideo.launch(arrayOf("video/*"))
        }
        binding.btnCancelAnalyze.setOnClickListener {
            cancelled.set(true)
            binding.txtAnalyzing.text = "正在取消…"
        }
        binding.btnReAnalyze.setOnClickListener { showSelect() }
        binding.btnFbSubmit.setOnClickListener { submitFeedback() }
        binding.btnGenReport.setOnClickListener { generateReport() }
    }

    /** 从主页进入时调用（原生版无需加载网页） */
    fun onShown() {
        // 无需操作；若上次分析被中断则复位
        if (analyzingThread == null || !analyzingThread!!.isAlive) {
            cancelled.set(false)
        }
    }

    fun onNightModeChanged(nightNow: Boolean) {
        // 原生 UI 自动跟随系统主题，无需处理
    }

    private fun startAnalyze(uri: Uri) {
        cancelled.set(false)
        showAnalyzing()
        binding.progressBar.progress = 0
        binding.txtAnalyzing.text = "准备分析…"
        val sampleEvery = when (binding.radioSample.checkedRadioButtonId) {
            R.id.sample2 -> 2
            R.id.sample3 -> 3
            else -> 1
        }
        analyzingThread = Thread {
            val outcome = PoseAnalyzer.analyze(
                context = requireContext(),
                uri = uri,
                sampleEvery = sampleEvery,
                cancelled = cancelled,
                onProgress = { done, total ->
                    mainHandler.post {
                        if (total > 0) {
                            binding.progressBar.progress = (done * 100 / total)
                            binding.txtAnalyzing.text = "姿态识别中 $done/$total 帧"
                        }
                    }
                },
                onPhase = { phase ->
                    mainHandler.post {
                        binding.txtAnalyzing.text = if (phase == "loading-model") "正在加载识别模型…" else "正在分析…"
                    }
                }
            )
            mainHandler.post {
                if (cancelled.get()) {
                    toast("已取消")
                    showSelect()
                    return@post
                }
                if (outcome.error != null) {
                    binding.txtResultError.visibility = View.VISIBLE
                    binding.txtResultError.text = outcome.error
                    showResult()
                    return@post
                }
                lastOutcome = outcome
                renderResult(outcome)
            }
        }.also { it.start() }
    }

    private fun renderResult(outcome: PoseAnalyzer.Outcome) {
        val m = outcome.metrics
        binding.txtResultError.visibility = View.GONE
        if (!m.ok) {
            binding.txtResultError.visibility = View.VISIBLE
            val dbg = m.debug
            val hint = when {
                (dbg["lostPct"] as? Number)?.toInt()?.let { it >= 40 } == true ->
                    "未识别到弹跳：姿态丢失率 ${dbg["lostPct"]}%。建议换人物更大、更清晰的视频重试。"
                (dbg["flightSegs"] as? Number)?.toInt()?.let { it > 0 } == true ->
                    "未识别到弹跳：检测到 ${dbg["flightSegs"]} 次脚离地，但髋部抬升不足。建议重拍：助跑至少 2~3 步、完整拍到起跳和落地。"
                else -> "未识别到弹跳：请确认视频包含完整的助跑起跳与落地，或换一段视频重试。"
            }
            binding.txtResultError.text = hint
        } else {
            renderMetrics(m, outcome.fps)
        }
        showResult()
    }

    private fun renderMetrics(m: MetricsResult, fps: Double) {
        val grid = binding.metricsGrid
        grid.removeAllViews()
        val best = m.best ?: return

        // 弹跳高度（带误差提示）
        addMetric(grid, "📏 弹跳高度", best.jump.heightCm.toString() + " cm",
            if (best.jumpCount > 1) "共 ${best.jumpCount} 次弹跳" else "测量存在一定误差，建议与卷尺/摸高实测对照")

        // 起跳/落地时刻（秒 + 帧号，便于与人工标注对比）
        val loFrame = Math.round(best.jump.liftoffTime * fps)
        val laFrame = Math.round(best.jump.landingTime * fps)
        addMetric(grid, "⏱ 离地 / 落地时刻",
            "${best.jump.liftoffTime}s / ${best.jump.landingTime}s",
            "对应帧号：离地≈$loFrame 帧 · 落地≈$laFrame 帧（${fps.toInt()}fps）· 腾空 ${best.jump.flightTime}s")

        // 起跳方式
        val tk = best.takeoff
        val tkTxt = when (tk.type) {
            "single" -> "单脚起跳"
            "double" -> "双脚起跳"
            else -> "--"
        }
        val tkSub = when (tk.type) {
            "single" -> "摆动腿在空中，单脚蹬地"
            "double" -> "两脚本着地同时发力"
            else -> "数据不足"
        }
        addMetric(grid, "🦶 起跳方式", tkTxt, tkSub)

        addMetric(grid, "📐 起跳角度", best.leanAngle?.let { "$it°" } ?: "--",
            best.trajAngle?.let { "轨迹角 $it°" } ?: "数据不足")
        addMetric(grid, "💨 摆臂速度", if (best.armSwingDegS > 0) "${best.armSwingDegS}°/s" else "--",
            if (best.armSwingAmp > 0) "摆幅 ${best.armSwingAmp}°" else "")

        // 最后两步
        val stp = best.steps
        val (stepTxt, stepSub) = when {
            stp.found >= 2 -> Pair("比 ${stp.ratio}",
                "最后一步 ${stp.lastContact}s / 倒数第二步 ${stp.penultimateContact}s")
            stp.found == 1 -> Pair("仅 1 步", "最后一步触地 ${stp.lastContact}s")
            else -> Pair("--", "未识别到助跑步")
        }
        addMetric(grid, "👣 最后两步节奏", stepTxt, stepSub)

        // 落地稳定性
        val ld = best.landing
        addMetric(grid, "🛬 落地稳定性", ld.swayPct?.let { "$it%" } ?: "--",
            "落地膝角 ${ld.landingKnee?.let { "$it°" } ?: "--"} · 稳定用时 ${ld.settleTime?.let { "$it s" } ?: "--"}")
    }

    private fun addMetric(grid: LinearLayout, name: String, value: String, sub: String) {
        val card = layoutInflater.inflate(R.layout.item_metric_card, grid, false)
        card.findViewById<android.widget.TextView>(R.id.metricName).text = name
        card.findViewById<android.widget.TextView>(R.id.metricValue).text = value
        card.findViewById<android.widget.TextView>(R.id.metricSub).text = sub
        grid.addView(card)
    }

    private fun generateReport() {
        val outcome = lastOutcome ?: return
        if (!outcome.metrics.ok) {
            binding.txtAiReport.text = "未识别到弹跳，无法生成报告。"
            return
        }
        binding.btnGenReport.isEnabled = false
        binding.txtAiReport.text = "⏳ AI 正在分析，预计 10~40 秒，请稍候…"
        Thread {
            val text = com.vertrise.jumptool.AiReportGenerator.buildMetricsText(outcome.metrics)
            val (report, err) = com.vertrise.jumptool.AiReportGenerator.generate(text)
            mainHandler.post {
                binding.btnGenReport.isEnabled = true
                if (report != null) {
                    binding.txtAiReport.text = report
                } else {
                    binding.txtAiReport.text = err
                }
            }
        }.start()
    }

    private fun submitFeedback() {
        val issue = binding.edtFbIssue.text.toString().trim()
        val lo = binding.edtFbLiftoff.text.toString().toDoubleOrNull()
        val ld = binding.edtFbLanding.text.toString().toDoubleOrNull()
        val h = binding.edtFbHeight.text.toString().toDoubleOrNull()
        if (issue.isEmpty() && lo == null && ld == null && h == null) {
            binding.txtFbMsg.text = "请至少填写一项实际情况或问题描述"
            return
        }
        val outcome = lastOutcome ?: return
        binding.btnFbSubmit.isEnabled = false
        binding.txtFbMsg.text = "正在提交…"
        Thread {
            val metrics = if (outcome.metrics.ok) FeedbackUploader.metricsOf(outcome.metrics, outcome.fps) else null
            val err = FeedbackUploader.submit(issue, lo, ld, h, metrics)
            mainHandler.post {
                binding.btnFbSubmit.isEnabled = true
                if (err == null) {
                    binding.txtFbMsg.text = "✅ 已提交反馈，感谢帮助改进算法！"
                    binding.edtFbIssue.text.clear()
                    binding.edtFbLiftoff.text.clear()
                    binding.edtFbLanding.text.clear()
                    binding.edtFbHeight.text.clear()
                } else {
                    binding.txtFbMsg.text = err
                }
            }
        }.start()
    }

    private fun showSelect() {
        binding.panelSelect.visibility = View.VISIBLE
        binding.panelAnalyzing.visibility = View.GONE
        binding.panelResult.visibility = View.GONE
    }

    private fun showAnalyzing() {
        binding.panelSelect.visibility = View.GONE
        binding.panelAnalyzing.visibility = View.VISIBLE
        binding.panelResult.visibility = View.GONE
    }

    private fun showResult() {
        binding.panelSelect.visibility = View.GONE
        binding.panelAnalyzing.visibility = View.GONE
        binding.panelResult.visibility = View.VISIBLE
    }

    private fun toast(msg: String) {
        Toast.makeText(requireContext(), msg, Toast.LENGTH_SHORT).show()
    }

    override fun onDestroyView() {
        cancelled.set(true)
        super.onDestroyView()
        _binding = null
    }
}
