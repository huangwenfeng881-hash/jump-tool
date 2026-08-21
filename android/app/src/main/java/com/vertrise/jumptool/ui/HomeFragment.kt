package com.vertrise.jumptool.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.MainActivity
import com.vertrise.jumptool.databinding.FragmentHomeBinding

/** 主页：品牌区 + AI 弹跳分析入口卡片 + 视频质量建议 + 反馈说明 */
class HomeFragment : Fragment() {

    private var _binding: FragmentHomeBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentHomeBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.btnStartAnalyze.setOnClickListener {
            (activity as? MainActivity)?.openAnalyze()
        }
        binding.cardAnalyze.setOnClickListener {
            (activity as? MainActivity)?.openAnalyze()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
