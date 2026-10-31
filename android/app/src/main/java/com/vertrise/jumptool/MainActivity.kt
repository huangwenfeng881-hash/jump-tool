package com.vertrise.jumptool

import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.databinding.ActivityMainBinding
import com.vertrise.jumptool.ui.AnalyzeFragment
import com.vertrise.jumptool.ui.AnalyzeHubFragment
import com.vertrise.jumptool.ui.DataFragment
import com.vertrise.jumptool.ui.DunkTestFragment
import com.vertrise.jumptool.ui.HomeFragment
import com.vertrise.jumptool.ui.ProfileFragment
import com.vertrise.jumptool.ui.SettingsFragment
import com.vertrise.jumptool.ui.TrainingFragment
import com.vertrise.jumptool.ui.WebPageFragment

/**
 * Vertrise跃升 · 原生主壳
 *
 * 底部 5 个 Tab：首页 / 训练 / 分析 / 数据 / 我的。
 * 分析类与站点功能页作为「全屏子页面」叠在 Tab 之上（隐藏底部导航，返回键逐级回退）：
 *  - AI 弹跳分析：全原生（本机 MediaPipe，视频不上传）
 *  - 弹跳测量 / 动作分析 / 杠铃测速 / 训练计划 / 记录 / 排行榜 / 会员 / 登录等：内嵌网页，与网页端同一版本
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val tabFragments = LinkedHashMap<String, Fragment>()
    private var currentTab = TAG_HOME
    private var currentChild: Fragment? = null
    private var lastNight = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        lastNight = isNightMode()

        if (savedInstanceState == null) {
            tabFragments[TAG_HOME] = HomeFragment()
            tabFragments[TAG_TRAINING] = TrainingFragment()
            tabFragments[TAG_ANALYZE] = AnalyzeHubFragment()
            tabFragments[TAG_DATA] = DataFragment()
            tabFragments[TAG_PROFILE] = ProfileFragment()

            val ft = supportFragmentManager.beginTransaction()
            tabFragments.forEach { (tag, fragment) ->
                ft.add(R.id.fragmentContainer, fragment, tag)
                if (tag != currentTab) ft.hide(fragment)
            }
            ft.commitNow()
        } else {
            // Activity 重建（如深浅色切换）：保留当前 Tab，关闭全屏子页面，避免两侧状态不一致
            currentTab = savedInstanceState.getString(STATE_TAB) ?: TAG_HOME
            supportFragmentManager.findFragmentById(R.id.childContainer)?.let { child ->
                supportFragmentManager.beginTransaction().remove(child).commitNow()
            }
            currentChild = null
            binding.childContainer.visibility = View.GONE
            binding.mainContent.visibility = View.VISIBLE
            for (tag in TAB_TAGS) {
                supportFragmentManager.findFragmentByTag(tag)?.let { tabFragments[tag] = it }
            }
            val ft = supportFragmentManager.beginTransaction()
            tabFragments.forEach { (tag, fragment) ->
                if (tag == currentTab) ft.show(fragment) else ft.hide(fragment)
            }
            ft.commitNow()
        }

        binding.bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_home -> showTab(TAG_HOME)
                R.id.nav_training -> showTab(TAG_TRAINING)
                R.id.nav_analyze -> showTab(TAG_ANALYZE)
                R.id.nav_data -> showTab(TAG_DATA)
                R.id.nav_profile -> showTab(TAG_PROFILE)
            }
            true
        }
        binding.bottomNav.selectedItemId = tabItemId(currentTab)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_TAB, currentTab)
    }

    private fun tabItemId(tag: String): Int = when (tag) {
        TAG_TRAINING -> R.id.nav_training
        TAG_ANALYZE -> R.id.nav_analyze
        TAG_DATA -> R.id.nav_data
        TAG_PROFILE -> R.id.nav_profile
        else -> R.id.nav_home
    }

    fun showTab(tag: String) {
        if (currentChild != null) closeChild()
        if (tag == currentTab) return
        val fm = supportFragmentManager
        val to = fm.findFragmentByTag(tag) ?: return
        val from = fm.findFragmentByTag(currentTab)
        val ft = fm.beginTransaction().show(to)
        if (from != null) ft.hide(from)
        ft.commit()
        currentTab = tag
    }

    fun openAnalyze() {
        val fragment = AnalyzeFragment()
        openChild(fragment, TAG_ANALYZE_CHILD)
        fragment.onShown()
    }

    fun openSettings() {
        openChild(SettingsFragment(), TAG_SETTINGS_CHILD)
    }

    fun openDunkTest() {
        openChild(DunkTestFragment(), TAG_DUNK_CHILD)
    }

    fun openWeb(title: String, page: String) {
        if (CloudFeatures.isCloudPage(page)) {
            Toast.makeText(this, "该功能暂未开放", Toast.LENGTH_SHORT).show()
            return
        }
        openChild(WebPageFragment.newInstance(title, page), TAG_WEB_CHILD)
    }

    fun openNative(key: String) {
        when (key) {
            "analyze" -> openAnalyze()
            "settings" -> openSettings()
            "dunk" -> openDunkTest()
        }
    }

    private fun openChild(fragment: Fragment, tag: String) {
        val previous = currentChild
        if (previous != null) {
            supportFragmentManager.beginTransaction().remove(previous).commitNow()
        }
        currentChild = fragment
        binding.mainContent.visibility = View.GONE
        binding.childContainer.visibility = View.VISIBLE
        supportFragmentManager.beginTransaction()
            .replace(R.id.childContainer, fragment, tag)
            .commitNow()
    }

    fun closeChild() {
        val child = currentChild ?: return
        currentChild = null
        supportFragmentManager.beginTransaction().remove(child).commitNow()
        binding.childContainer.visibility = View.GONE
        binding.mainContent.visibility = View.VISIBLE
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val child = currentChild
        if (child is WebPageFragment && child.handleBack()) return
        if (child != null) {
            closeChild()
            return
        }
        super.onBackPressed()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val night = isNightMode()
        if (night != lastNight) {
            lastNight = night
            recreate()
        }
    }

    private fun isNightMode(): Boolean {
        val mask = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return mask == Configuration.UI_MODE_NIGHT_YES
    }

    companion object {
        private const val STATE_TAB = "state_tab"

        private val TAB_TAGS = listOf("home", "training", "analyze_hub", "data", "profile")

        private const val TAG_HOME = "home"
        private const val TAG_TRAINING = "training"
        private const val TAG_ANALYZE = "analyze_hub"
        private const val TAG_DATA = "data"
        private const val TAG_PROFILE = "profile"
        private const val TAG_ANALYZE_CHILD = "analyze_child"
        private const val TAG_SETTINGS_CHILD = "settings_child"
        private const val TAG_DUNK_CHILD = "dunk_child"
        private const val TAG_WEB_CHILD = "web_child"
    }
}
