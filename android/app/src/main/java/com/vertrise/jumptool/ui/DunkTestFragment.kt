package com.vertrise.jumptool.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.DunkTest
import com.vertrise.jumptool.LocalStore
import com.vertrise.jumptool.MainActivity
import com.vertrise.jumptool.R
import com.vertrise.jumptool.SitePages
import com.vertrise.jumptool.databinding.FragmentDunkTestBinding

/**
 * 扣篮潜力自测：立定跳远 / 摸高差 / 站立摸高，三项中 2 项即「起飞线」。
 * 口径对齐 B站《3个指标自测扣篮潜力，中2个你就随便起飞！》。
 */
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
        if (d.standingReach > 0) binding.edtStandingReach.setText(d.standingReach.toString())
        val standReach = when {
            d.standReach > 0 -> d.standReach
            d.standingReach > 0 && snap.bestHeightCm > 0 -> d.standingReach + snap.bestHeightCm
            else -> 0
        }
        if (standReach > 0) {
            binding.edtStandReach.setText(standReach.toString())
            if (d.standReach <= 0) {
                binding.txtStandReachHint.text = "已用站立摸高 + 最近弹跳 " + snap.bestHeightCm + "cm 估算"
            }
        }
        if (d.runReach > 0) binding.edtRunReach.setText(d.runReach.toString())
        if (d.score >= 0) {
            binding.txtLastHint.visibility = View.VISIBLE
            binding.txtLastHint.text = "上次自测：" + d.score + " / 3 · 改完数字重新测一次"
        }
    }

    private fun evaluate() {
        val standJump = binding.edtStandJump.text.toString().toIntOrNull() ?: 0
        val standing = binding.edtStandingReach.text.toString().toIntOrNull() ?: 0
        val standReach = binding.edtStandReach.text.toString().toIntOrNull() ?: 0
        val runReach = binding.edtRunReach.text.toString().toIntOrNull() ?: 0
        if (standJump <= 0 || standing <= 0 || standReach <= 0 || runReach <= 0) {
            toast("四项都填一下，没测过的估个大概也行")
            return
        }
        if (standJump > 400 || standing > 300 || standReach > 450 || runReach > 450) {
            toast("数值看着不太对，确认一下单位是 cm")
            return
        }
        if (runReach < standReach) {
            toast("助跑摸高一般不低于原地摸高，检查一下")
            return
        }
        val r = DunkTest.evaluate(standJump, standing, standReach, runReach)
        LocalStore.saveDunkTest(requireContext(), standJump, standing, standReach, runReach, r.passed)
        render(r)
        binding.cardResult.visibility = View.VISIBLE
        binding.txtLastHint.visibility = View.GONE
    }

    private fun render(r: DunkTest.Result) {
        binding.txtScore.text = r.passed.toString() + " / 3"
        binding.txtVerdict.text = r.verdict
        binding.txtGap.text = "摸高差 " + (if (r.reachGap >= 0) "+" else "") + r.reachGap +
            " cm · 达标线 " + DunkTest.REACH_GAP_TARGET + " cm"
        binding.txtDetail.text = r.detail
        binding.txtPlan.text = "🏋️ 改善建议：" + r.plan
        val box = binding.resultMetrics
        box.removeAllViews()
        for (m in r.metrics) {
            val row = TextView(requireContext())
            val mark = if (m.passed) "√" else "×"
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
