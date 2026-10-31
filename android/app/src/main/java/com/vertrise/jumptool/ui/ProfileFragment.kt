package com.vertrise.jumptool.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.BuildConfig
import com.vertrise.jumptool.CloudFeatures
import com.vertrise.jumptool.databinding.FragmentProfileBinding

/** 我的：账号、训练与设置入口，底部展示版本信息 */
class ProfileFragment : Fragment() {

    private var _binding: FragmentProfileBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentProfileBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        bindAppLinks(binding.root)
        binding.txtAppVersion.text = "Vertrise跃升 v" + BuildConfig.VERSION_NAME

        // 云端未启用时，整个"账户"区块（用户卡 / 登录注册 / 我的资料 / 会员中心）不展示
        if (!CloudFeatures.ENABLED) {
            binding.cardUser.visibility = View.GONE
            binding.titleAccount.visibility = View.GONE
            binding.cardAccount.visibility = View.GONE
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
