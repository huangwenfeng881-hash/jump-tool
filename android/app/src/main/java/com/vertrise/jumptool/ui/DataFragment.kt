package com.vertrise.jumptool.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.LocalStore
import com.vertrise.jumptool.databinding.FragmentDataBinding

/** 数据：本机统计 + 进步曲线/排行榜/记录/杠铃图表入口 */
class DataFragment : Fragment() {

    private var _binding: FragmentDataBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentDataBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        bindAppLinks(binding.root)
    }

    override fun onResume() {
        super.onResume()
        val s = LocalStore.snapshot(requireContext())
        binding.txtDataLast.text = if (s.lastHeightCm > 0) s.lastHeightCm.toString() + " cm" else "--"
        binding.txtDataBest.text = if (s.bestHeightCm > 0) s.bestHeightCm.toString() + " cm" else "--"
        binding.txtDataCount.text = s.count.toString()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
