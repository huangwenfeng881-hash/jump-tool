package com.vertrise.jumptool.ui

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader

/**
 * WebViewAssetLoader 封装：把 assets/app 映射到 https://appassets.androidplatform.net/app/。
 * 自定义 MIME：.mjs 必须是 application/javascript（ES Module 要求）、.wasm 用 application/wasm，
 * 否则 MediaPipe 的模块加载 / WebAssembly 实例化会失败。
 */
object WebViewAssetLoaderCompat {

    const val APP_BASE = "https://appassets.androidplatform.net/app/"

    fun create(context: Context): WebViewAssetLoader {
        return WebViewAssetLoader.Builder()
            .addPathHandler("/app/", object : WebViewAssetLoader.PathHandler {
                override fun handle(path: String): WebResourceResponse? {
                    // path 形如 "app/ai-jump.html"，直接对应 assets 目录
                    val assetPath = path
                    val mime = when {
                        assetPath.endsWith(".mjs") -> "application/javascript"
                        assetPath.endsWith(".js") -> "application/javascript"
                        assetPath.endsWith(".wasm") -> "application/wasm"
                        assetPath.endsWith(".task") -> "application/octet-stream"
                        assetPath.endsWith(".html") -> "text/html"
                        assetPath.endsWith(".htm") -> "text/html"
                        assetPath.endsWith(".css") -> "text/css"
                        assetPath.endsWith(".json") -> "application/json"
                        assetPath.endsWith(".txt") -> "text/plain; charset=utf-8"
                        assetPath.endsWith(".png") -> "image/png"
                        assetPath.endsWith(".jpg") -> "image/jpeg"
                        assetPath.endsWith(".jpeg") -> "image/jpeg"
                        assetPath.endsWith(".gif") -> "image/gif"
                        assetPath.endsWith(".svg") -> "image/svg+xml"
                        assetPath.endsWith(".webp") -> "image/webp"
                        assetPath.endsWith(".ico") -> "image/x-icon"
                        assetPath.endsWith(".woff") -> "font/woff"
                        assetPath.endsWith(".woff2") -> "font/woff2"
                        assetPath.endsWith(".mp4") -> "video/mp4"
                        assetPath.endsWith(".webm") -> "video/webm"
                        else -> "application/octet-stream"
                    }
                    return try {
                        val stream = context.assets.open(assetPath)
                        WebResourceResponse(mime, if (mime.startsWith("text/") || mime.contains("javascript")) "utf-8" else null, stream)
                    } catch (e: Exception) {
                        null
                    }
                }
            })
            .build()
    }
}
