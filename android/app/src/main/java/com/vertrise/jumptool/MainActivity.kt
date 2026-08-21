package com.vertrise.jumptool

import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.vertrise.jumptool.databinding.ActivityMainBinding
import com.vertrise.jumptool.ui.AnalyzeFragment
import com.vertrise.jumptool.ui.HomeFragment
import com.vertrise.jumptool.ui.ProfileFragment
import com.vertrise.jumptool.ui.SettingsFragment

/**
 * Vertrise跃升 · 原生壳
 * 底部导航：主页 / 设置 / 我的；「AI 弹跳分析」为内嵌本地页面（WebViewAssetLoader 加载 assets/app）。
 * 分析页从主页卡片进入，全屏展示（隐藏底部导航），返回后恢复。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val homeFragment = HomeFragment()
    private val settingsFragment = SettingsFragment()
    private val profileFragment = ProfileFragment()
    private val analyzeFragment = AnalyzeFragment()

    private var currentTag = TAG_HOME
    private var analyzeOpen = false
    private var lastNight = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        lastNight = isNightMode()

        supportFragmentManager.beginTransaction()
            .add(R.id.fragmentContainer, homeFragment, TAG_HOME)
            .add(R.id.fragmentContainer, settingsFragment, TAG_SETTINGS)
            .add(R.id.fragmentContainer, profileFragment, TAG_PROFILE)
            .add(R.id.fragmentContainer, analyzeFragment, TAG_ANALYZE)
            .hide(settingsFragment).hide(profileFragment).hide(analyzeFragment)
            .commit()

        binding.bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_home -> showTab(TAG_HOME)
                R.id.nav_settings -> showTab(TAG_SETTINGS)
                R.id.nav_profile -> showTab(TAG_PROFILE)
            }
            true
        }
        // 默认选中主页
        binding.bottomNav.selectedItemId = R.id.nav_home
    }

    private fun showTab(tag: String) {
        if (analyzeOpen) return
        if (tag == currentTag) return
        val fm = supportFragmentManager
        fm.beginTransaction()
            .hide(fm.findFragmentByTag(currentTag)!!)
            .show(fm.findFragmentByTag(tag)!!)
            .commit()
        currentTag = tag
    }

    /** 主页卡片点击：全屏打开分析页 */
    fun openAnalyze() {
        if (analyzeOpen) return
        analyzeOpen = true
        binding.bottomNav.visibility = View.GONE
        supportFragmentManager.beginTransaction()
            .hide(supportFragmentManager.findFragmentByTag(currentTag)!!)
            .show(analyzeFragment)
            .commit()
        analyzeFragment.onShown()
    }

    /** 分析页返回主页 */
    fun closeAnalyze() {
        if (!analyzeOpen) return
        analyzeOpen = false
        binding.bottomNav.visibility = View.VISIBLE
        supportFragmentManager.beginTransaction()
            .hide(analyzeFragment)
            .show(supportFragmentManager.findFragmentByTag(currentTag)!!)
            .commit()
    }

    fun isAnalyzeOpen(): Boolean = analyzeOpen

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (analyzeOpen) {
            closeAnalyze()
        } else {
            super.onBackPressed()
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val night = isNightMode()
        if (night != lastNight) {
            lastNight = night
            analyzeFragment.onNightModeChanged(night)
        }
    }

    private fun isNightMode(): Boolean {
        val mask = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return mask == Configuration.UI_MODE_NIGHT_YES
    }

    companion object {
        private const val TAG_HOME = "home"
        private const val TAG_SETTINGS = "settings"
        private const val TAG_PROFILE = "profile"
        private const val TAG_ANALYZE = "analyze"
    }
}
