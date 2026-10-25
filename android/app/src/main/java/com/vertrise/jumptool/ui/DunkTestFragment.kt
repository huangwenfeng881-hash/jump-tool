package com.vertrise.jumptool.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.DunkTest
import com.vertrise.jumptool.LocalStore
import com.vertrise.jumptool.MainActivity
import com.vertrise.jumptool.R
import com.vertrise.jumptool.SitePages
import com.vertrise.jumptool.databinding.FragmentDunkTestBinding

/** 扣篮潜力自测：3 个指标，中 2 个就起飞。尽量预填已知数据，减少输入。 */
class DunkTestFragment : Fragment() {

    private var _binding: FragmentDunkTestBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentDunkTestBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.btnBack.setOnClickListener { (activity as? MainActivity)?.closeChild() }
        binding.btnEval.setOnClickListener { evaluate() }
        binding.btnPlan.setOnClickListener {
            (activity as? MainActivity)?.openWeb("训练计划", SitePages.PLANS)
        }
        prefill()
    }

    private fun prefill() {
        val ctx = requireContext()
        val d = LocalStore.dunk(ctx)
        val snap = LocalStore.snapshot(ctx)
        if (d.standJump > 0) binding.edtStandJump.setText(d.standJump.toString())
        val vert = if (d.vertical > 0) d.vertical else snap.bestHeightCm
        if (vert > 0) {
            binding.edtVertical.setText(vert.toString())
            binding.txtVerticalHint.text = "垂直弹跳 · 已用最近一次 AI 分析 " + vert + "cm"
        }
        if (d.runReach > 0) binding.edtRunReach.setText(d.runReach.toString())
        if (d.score >= 0) {
            binding.txtLastHint.visibility = View.VISIBLE
            binding.txtLastHint.text = "上次自测：" + d.score + " / 3 · 改完数字重新测一次即可"
        }
    }

    private fun evaluate() {
        val stand = binding.edtStandJump.text.toString().toIntOrNull() ?: 0
        val vert = binding.edtVertical.text.toString().toIntOrNull() ?: 0
        val run = binding.edtRunReach.text.toString().toIntOrNull() ?: 0
        if (stand <= 0 || vert <= 0 || run <= 0) {
            toast("三项都填一下，没测过的估个大概也行")
            return
        }
        if (stand > 400 || vert > 200 || run > 450) {
            toast("数值看着不太对，确认一下单位是 cm")
            return
        }
        val r = DunkTest.evaluate(stand, vert, run)
        LocalStore.saveDunkTest(requireContext(), stand, vert, run, r.passed)
        render(r)
        binding.cardResult.visibility = View.VISIBLE
        binding.txtLastHint.visibility = View.GONE
    }

    private fun render(r: DunkTest.Result) {
        binding.txtScore.text = r.passed.toString() + " / 3"
        binding.txtVerdict.text = r.verdict
        binding.txtDetail.text = r.detail
        binding.txtPlan.text = "🏋️ 改善建议：" + r.plan
        val box = binding.resultMetrics
        box.removeAllViews()
        for (m in r.metrics) {
            val row = TextView(requireContext())
            val mark = if (m.passed) "✅" else "❌"
            val gap = if (m.passed) "" else "  还差 " + (m.target - m.value) + m.unit
            row.text = mark + "  " + m.name + "  " + m.value + m.unit + " / 达标 " + m.target + m.unit + gap
            row.textSize = 14f
            row.setTextColor(resources.getColor(
                if (m.passed) R.color.text_primary else R.color.text_secondary, null
            ))
            row.setPadding(0, 10, 0, 10)
            box.addView(row)
        }
    }

    private fun toast(msg: String) {
        Toast.makeText(requireContext(), msg, Toast.LENGTH_SHORT).show()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
