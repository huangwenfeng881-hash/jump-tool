package com.vertrise.jumptool.ui

import android.annotation.SuppressLint
import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.R

/**
 * AI 弹跳分析页：WebView 加载本地打包页面（assets/app/ai-jump.html）。
 * 通过 WebViewAssetLoader 将 assets 映射为 https://appassets.androidplatform.net/app/，
 * 使 ES Module / wasm / fetch 正常工作（file:// 下 MediaPipe 无法加载）。
 */
class AnalyzeFragment : Fragment() {

    private var webView: WebView? = null
    private var night = false
    private var loaded = false

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val frame = FrameLayout(requireContext())
        frame.setBackgroundColor(Color.TRANSPARENT)
        return frame
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        if (webView == null) {
            webView = createWebView().also { wv ->
                (view as FrameLayout).addView(
                    wv,
                    FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                )
            }
            night = isNightMode()
        }
    }

    /** 每次从主页进入分析页时调用：首次或重新加载页面 */
    fun onShown() {
        if (webView == null) return
        if (!loaded) {
            loaded = true
            night = isNightMode()
            webView?.loadUrl(pageUrl())
        }
    }

    /** 系统深色模式切换时重载页面（页面通过 ?theme= 参数跟随） */
    fun onNightModeChanged(nightNow: Boolean) {
        val wv = webView ?: return
        if (nightNow == night) return
        night = nightNow
        wv.loadUrl(pageUrl())
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        val wv = WebView(requireContext())
        wv.setBackgroundColor(Color.TRANSPARENT)
        val settings = wv.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mediaPlaybackRequiresUserGesture = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        val assetLoader = WebViewAssetLoaderCompat.create(requireContext())

        wv.webViewClient = object : WebViewClient() {
            // 站内链接（弹跳测量/登录等）在 App 内没有对应页面，一律拦截不跳转
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                return !url.startsWith(WebViewAssetLoaderCompat.APP_BASE)
            }

            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val uri = request?.url ?: return null
                return assetLoader.shouldInterceptRequest(uri)
            }
        }
        return wv
    }

    private fun pageUrl(): String {
        val theme = if (isNightMode()) "dark" else "light"
        return WebViewAssetLoaderCompat.APP_BASE + "ai-jump.html?theme=" + theme
    }

    private fun isNightMode(): Boolean {
        val mask = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return mask == Configuration.UI_MODE_NIGHT_YES
    }

    override fun onDestroyView() {
        // WebView 保留实例，避免切换时重新加载（状态由 MainActivity 的 show/hide 管理）
        (view as? FrameLayout)?.removeAllViews()
        super.onDestroyView()
    }
}
