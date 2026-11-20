# -*- coding: utf-8 -*-
import pathlib
F = pathlib.Path(r"D:/jump app/android/app/src/main/java/com/vertrise/jumptool/ui/WebPageFragment.kt")
s = F.read_text(encoding="utf-8")

# 1) imports
s = s.replace("import androidx.activity.result.contract.ActivityResultContracts",
              "import androidx.activity.result.contract.ActivityResultContracts\nimport androidx.webkit.WebViewAssetLoader")

# 2) 初始化 asset loader + shouldInterceptRequest
old = """        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                handleUrl(request.url)"""
new = """        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(requireContext()))
            .build()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                handleUrl(request.url)"""
assert old in s, "webviewclient block not found"
s = s.replace(old, new)

# 3) 站内域名白名单加上 appassets
s = s.replace('val ours = host.endsWith("netlify.app") ||',
              'val ours = host == "appassets.androidplatform.net" ||\n            host.endsWith("netlify.app") ||')

# 4) WebResourceResponse import
s = s.replace("import android.webkit.WebResourceRequest",
              "import android.webkit.WebResourceRequest\nimport android.webkit.WebResourceResponse")
F.write_text(s, encoding="utf-8")
print("WebPageFragment patched")