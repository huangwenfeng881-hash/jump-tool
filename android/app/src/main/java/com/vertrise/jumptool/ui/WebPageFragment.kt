package com.vertrise.jumptool.ui

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.BuildConfig
import com.vertrise.jumptool.MainActivity
import com.vertrise.jumptool.SitePages
import com.vertrise.jumptool.databinding.FragmentWebBinding

/**
 * 站点功能页承载器：在 App 内打开网页端功能页（弹跳测量 / 动作分析 / 杠铃测速 /
 * 训练计划 / 记录 / 排行榜 / 会员 / 登录等），统一由原生顶栏控制返回与刷新。
 *
 * - 支持网页里的 <input type="file"> 选视频（Android 文件选择器）
 * - 站外链接（支付、邮件等）交给系统浏览器
 * - 加载失败给出原生兜底页，可重试
 */
class WebPageFragment : Fragment() {

    private var _binding: FragmentWebBinding? = null
    private val binding get() = _binding!!

    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val pageTitle: String get() = arguments?.getString(ARG_TITLE).orEmpty()
    private val page: String get() = arguments?.getString(ARG_PAGE).orEmpty()
    private val targetUrl: String get() = SitePages.url(page)

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = filePathCallback
        filePathCallback = null
        if (callback == null) return@registerForActivityResult
        val data = result.data
        val uris: Array<Uri>? = if (result.resultCode == Activity.RESULT_OK && data != null) {
            val clip = data.clipData
            when {
                clip != null -> Array(clip.itemCount) { clip.getItemAt(it).uri }
                data.data != null -> arrayOf(data.data!!)
                else -> null
            }
        } else null
        callback.onReceiveValue(uris)
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentWebBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.txtWebTitle.text = pageTitle
        binding.btnBack.setOnClickListener { (activity as? MainActivity)?.closeChild() }
        binding.btnReload.setOnClickListener {
            binding.panelError.visibility = View.GONE
            binding.webView.reload()
        }
        binding.btnRetry.setOnClickListener {
            binding.panelError.visibility = View.GONE
            binding.webView.loadUrl(targetUrl)
        }
        setupWebView()
        binding.webView.loadUrl(targetUrl)
    }

    private fun setupWebView() {
        val webView = binding.webView
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            allowFileAccess = true
            javaScriptCanOpenWindowsAutomatically = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }
        webView.setBackgroundColor(0xFFFFFFFF.toInt())
        if (BuildConfig.DEBUG) {
            @Suppress("DEPRECATION")
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                handleUrl(request.url)

            override fun onPageFinished(view: WebView, url: String) {
                _binding?.webProgress?.visibility = View.GONE
                injectAppSkin()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showError()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                val b = _binding ?: return
                b.webProgress.progress = newProgress
                b.webProgress.visibility = if (newProgress in 0..99) View.VISIBLE else View.GONE
            }

            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    val intent = params.createIntent()
                    intent.addCategory(Intent.CATEGORY_OPENABLE)
                    fileChooser.launch(intent)
                    true
                } catch (e: Exception) {
                    filePathCallback = null
                    false
                }
            }

            @Suppress("DEPRECATION")
            override fun onReceivedTitle(view: WebView, title: String?) {
                val b = _binding ?: return
                if (pageTitle.isBlank() && !title.isNullOrBlank()) {
                    b.txtWebTitle.text = title
                }
            }
        }
    }

    /** 站内链接留在 WebView，站外链接（支付/邮件等）交给系统浏览器 */
    private fun handleUrl(uri: Uri): Boolean {
        val scheme = uri.scheme ?: return false
        if (scheme != "http" && scheme != "https") return openExternal(uri)
        val host = uri.host ?: return false
        val ours = host.endsWith("netlify.app") ||
            host.endsWith("pages.dev") ||
            host.contains("jumptool") ||
            host == "localhost" ||
            host == "127.0.0.1"
        return if (ours) false else openExternal(uri)
    }

    private fun openExternal(uri: Uri): Boolean = try {
        startActivity(Intent(Intent.ACTION_VIEW, uri))
        true
    } catch (e: Exception) {
        true
    }

    /** 让内嵌页与 App 主色保持一致（仅覆盖站点设计变量，不改结构） */
    private fun injectAppSkin() {
        val js = "(function(){try{var r=document.documentElement;" +
            "r.style.setProperty('--accent','#5A6BF5');" +
            "r.style.setProperty('--accent-bright','#7C8CFF');" +
            "r.style.setProperty('--accent-dim','#4A59D6');" +
            "r.style.setProperty('--gradient','linear-gradient(135deg,#5A6BF5,#7C8CFF)');" +
            "r.style.setProperty('--btn-gradient','linear-gradient(135deg,#5A6BF5,#6C7CFF)');" +
            "r.style.setProperty('--glow','0 0 22px rgba(90,107,245,.28)');" +
            "var st=document.getElementById('vt-app-skin');" +
            "if(!st){st=document.createElement('style');st.id='vt-app-skin';" +
            "(document.head||document.documentElement).appendChild(st);}" +
            "st.textContent='nav.jt-nav{display:none !important}';" +
            "}catch(e){}})();"
        _binding?.webView?.evaluateJavascript(js, null)
    }

    private fun showError() {
        val b = _binding ?: return
        b.webProgress.visibility = View.GONE
        b.panelError.visibility = View.VISIBLE
    }

    /** 网页内还能后退时先回退网页；返回 false 表示交给外层关闭本页 */
    fun handleBack(): Boolean {
        val webView = _binding?.webView ?: return false
        if (webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return false
    }

    override fun onDestroyView() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        _binding?.webView?.let { webView ->
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.stopLoading()
            webView.destroy()
        }
        _binding = null
        super.onDestroyView()
    }

    companion object {
        private const val ARG_TITLE = "arg_title"
        private const val ARG_PAGE = "arg_page"

        fun newInstance(title: String, page: String): WebPageFragment {
            val fragment = WebPageFragment()
            val args = Bundle()
            args.putString(ARG_TITLE, title)
            args.putString(ARG_PAGE, page)
            fragment.arguments = args
            return fragment
        }
    }
}
