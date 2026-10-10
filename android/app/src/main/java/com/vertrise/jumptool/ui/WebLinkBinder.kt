package com.vertrise.jumptool.ui

import android.view.View
import android.view.ViewGroup

/**
 * 通过布局里的 android:tag 统一绑定点击行为，避免为每个入口写一份监听代码。
 *   page:jump.html|弹跳测量   → 打开内嵌功能页
 *   native:analyze            → 打开原生页面（AI 弹跳分析 / 设置）
 */
object WebLinkBinder {

    fun bind(root: View, openWeb: (String, String) -> Unit, openNative: (String) -> Unit) {
        walk(root, openWeb, openNative)
    }

    private fun walk(v: View, openWeb: (String, String) -> Unit, openNative: (String) -> Unit) {
        val tag = v.tag
        if (tag is String) {
            when {
                tag.startsWith("page:") -> {
                    val raw = tag.removePrefix("page:")
                    val cut = raw.indexOf('|')
                    val page = if (cut >= 0) raw.substring(0, cut) else raw
                    val title = if (cut >= 0) raw.substring(cut + 1) else page
                    v.setOnClickListener { openWeb(title, page) }
                }
                tag.startsWith("native:") -> {
                    val key = tag.removePrefix("native:")
                    v.setOnClickListener { openNative(key) }
                }
            }
        }
        if (v is ViewGroup) {
            for (i in 0 until v.childCount) walk(v.getChildAt(i), openWeb, openNative)
        }
    }
}
