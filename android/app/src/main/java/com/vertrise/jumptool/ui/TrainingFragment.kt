package com.vertrise.jumptool.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.LocalStore
import com.vertrise.jumptool.R
import com.vertrise.jumptool.databinding.FragmentTrainingBinding

/** 训练：本周打卡进度 + 今日训练 + 计划/记录入口 */
class TrainingFragment : Fragment() {

    private var _binding: FragmentTrainingBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentTrainingBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        bindAppLinks(binding.root)
        buildWeekDots()
    }

    override fun onResume() {
        super.onResume()
        val s = LocalStore.snapshot(requireContext())
        binding.txtStreak.text = s.weekCount.toString() + " / " + LocalStore.WEEK_TARGET + " 次"
        buildWeekDots()
    }

    private fun buildWeekDots() {
        if (_binding == null) return
        val container = binding.weekDots
        container.removeAllViews()
        val done = minOf(LocalStore.snapshot(requireContext()).weekCount, 7)
        val density = resources.displayMetrics.density
        val size = (16 * density).toInt()
        for (i in 0 until 7) {
            val slot = FrameLayout(requireContext())
            slot.layoutParams = LinearLayout.LayoutParams(0, size, 1f)
            val dot = View(requireContext())
            dot.layoutParams = FrameLayout.LayoutParams(size, size, Gravity.CENTER)
            dot.setBackgroundResource(if (i < done) R.drawable.bg_dot else R.drawable.bg_dot_empty)
            slot.addView(dot)
            container.addView(slot)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
