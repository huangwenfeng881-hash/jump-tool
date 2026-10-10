package com.vertrise.jumptool.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.databinding.FragmentAnalyzeHubBinding

/** 分析：原生 AI 弹跳分析 + 网页端分析工具入口 */
class AnalyzeHubFragment : Fragment() {

    private var _binding: FragmentAnalyzeHubBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentAnalyzeHubBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        bindAppLinks(binding.root)
        binding.cardAnalyze.setOnClickListener { openAppNative("analyze") }
        binding.btnStartAnalyze.setOnClickListener { openAppNative("analyze") }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
