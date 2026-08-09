package com.vertrise.jumptool

import android.annotation.SuppressLint
import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.*
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

class MainActivity : AppCompatActivity() {

    companion object {
        // 站点地址：线上始终最新版；如需离线包可改为 file:///android_asset/index.html
        private const val HOME_URL = "https://jumptool.netlify.app"
    }

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private var doubleBackToExit = false

    private val cameraPermLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) {
                Toast.makeText(this, "未授权相机，视频上传功能可能受限", Toast.LENGTH_SHORT).show()
            }
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 仅 debug 构建开启远程调试（release 自动关闭）：通过 debuggable flag 判断
        if ((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)

        // Android 15 (targetSdk 35) 默认 edge-to-edge：内容会延伸到状态栏/导航栏后面。
        // 关闭 edge-to-edge，让系统为状态栏/导航栏自动留出空间，WebView 从内容区开始渲染，
        // 避免顶部导航/登录区域被状态栏遮挡。
        WindowCompat.setDecorFitsSystemWindows(window, true)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = false
        settings.mediaPlaybackRequiresUserGesture = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        // 摄像头授权标记（视频上传）
        settings.setMediaPlaybackRequiresUserGesture(false)
        // 响应式站点：按 viewport meta 渲染，禁用概览缩放避免页面被压缩导致布局错位
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = false

        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
        }

        // 视频/相机相关权限：进页面时预请求相机（用户可拒绝，不影响浏览）
        if (Build.VERSION.SDK_INT >= 23 && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED) {
            cameraPermLauncher.launch(Manifest.permission.CAMERA)
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
                progressBar.visibility = if (newProgress >= 100) View.GONE else View.VISIBLE
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                // 允许 WebRTC/摄像头/麦克风权限请求（MediaPipe 视频分析用）
                request?.grant(request.resources)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                // 站内链接继续在 WebView 打开；站外（如支付收银台 www.ezfp.cn）用系统浏览器
                if (isExternalUrl(url)) {
                    try {
                        startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url)))
                    } catch (e: Exception) {
                        // 无浏览器可用时回退到 WebView 内打开
                        return false
                    }
                    return true
                }
                view?.loadUrl(url)
                return true
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                // 主框架错误才提示；子资源错误忽略
                if (request?.isForMainFrame == true) {
                    Toast.makeText(this@MainActivity, "加载失败，请检查网络", Toast.LENGTH_SHORT).show()
                }
            }
        }

        // 支持视频全屏（部分页面无全屏按钮，保持默认）
        webView.setDownloadListener { url, _, _, _, _ ->
            try {
                startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (e: Exception) {
                Toast.makeText(this, "无法打开下载链接", Toast.LENGTH_SHORT).show()
            }
        }

        val savedUrl = savedInstanceState?.getString("url")
        webView.loadUrl(savedUrl ?: HOME_URL)
    }

    private fun isExternalUrl(url: String): Boolean {
        return !url.startsWith(HOME_URL)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            if (doubleBackToExit) {
                super.onBackPressed()
            } else {
                doubleBackToExit = true
                Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show()
                webView.postDelayed({ doubleBackToExit = false }, 2000)
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("url", webView.url)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
