package com.vertrise.jumptool.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.BackendHealth
import com.vertrise.jumptool.LocalStore
import com.vertrise.jumptool.SitePages
import com.vertrise.jumptool.databinding.FragmentHomeBinding

/** 首页：问候 + 服务状态 + 本周进度 + 关键数据 + 快捷入口 + 推荐训练 */
class HomeFragment : Fragment() {

    private var _binding: FragmentHomeBinding? = null
    private val binding get() = _binding!!

    /** 每个进程只自动探一次，避免来回切 Tab 反复请求 */
    private var healthChecked = false

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentHomeBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        bindAppLinks(binding.root)
        binding.btnContinue.setOnClickListener { openAppWeb("AI 教练", SitePages.TRAINER) }
        binding.btnBell.setOnClickListener {
            Toast.makeText(requireContext(), "暂无新消息", Toast.LENGTH_SHORT).show()
        }
        binding.btnServiceRetry.setOnClickListener {
            healthChecked = false
            binding.txtServiceStatus.text = "正在重新检测…"
            checkBackend()
        }
    }

    override fun onResume() {
        super.onResume()
        refresh()
        checkBackend()
    }

    private fun checkBackend() {
        if (healthChecked) return
        healthChecked = true
        BackendHealth.check { ok ->
            val b = _binding ?: return@check
            if (ok) {
                b.cardServiceStatus.visibility = View.GONE
            } else {
                b.txtServiceStatus.text = "云端服务暂时不可用"
                b.cardServiceStatus.visibility = View.VISIBLE
            }
        }
    }

    private fun refresh() {
        val s = LocalStore.snapshot(requireContext())
        binding.txtLastJump.text = if (s.lastHeightCm > 0) s.lastHeightCm.toString() + " cm" else "--"
        binding.txtBestJump.text = if (s.bestHeightCm > 0) s.bestHeightCm.toString() + " cm" else "--"
        binding.txtAnalysisCount.text = s.count.toString()

        val target = LocalStore.WEEK_TARGET
        val done = minOf(s.weekCount, target)
        binding.txtWeekCount.text = done.toString() + " / " + target
        binding.ringWeek.progress = done * 100 / target
        val dunk = LocalStore.dunk(requireContext())
        binding.txtDunkHint.text = if (dunk.score >= 0) {
            "上次自测 " + dunk.score + " / 3 · 点这里再测一次"
        } else {
            "3 个指标，中 2 个就起飞"
        }

        binding.txtWeekHint.text = when {
            s.count == 0 -> "完成一次弹跳分析即可开始记录"
            done >= target -> "本周目标已完成，继续保持！"
            else -> "再完成 " + (target - done) + " 次即可达成本周目标"
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
