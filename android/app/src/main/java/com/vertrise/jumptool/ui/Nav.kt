package com.vertrise.jumptool.ui

import android.view.View
import androidx.fragment.app.Fragment
import com.vertrise.jumptool.MainActivity

/** 页面内统一跳转入口 */
fun Fragment.bindAppLinks(root: View) {
    WebLinkBinder.bind(
        root,
        openWeb = { title, page -> (activity as? MainActivity)?.openWeb(title, page) },
        openNative = { key -> (activity as? MainActivity)?.openNative(key) }
    )
}

fun Fragment.openAppWeb(title: String, page: String) {
    (activity as? MainActivity)?.openWeb(title, page)
}

fun Fragment.openAppNative(key: String) {
    (activity as? MainActivity)?.openNative(key)
}
