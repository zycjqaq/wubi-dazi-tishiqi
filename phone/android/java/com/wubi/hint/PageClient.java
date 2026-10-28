package com.wubi.hint;

import android.util.Log;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 只允许站内（file:// / about:）导航，其余一律拦下。
 *
 * 写成顶层类而不是 MainActivity 的嵌套类：build-tools 34 的 d8
 * 在本机对嵌套/匿名类会抛 NullPointerException 导致打包失败。
 */
class PageClient extends WebViewClient {

    private static final String TAG = "WubiHint";

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return !(url != null && (url.startsWith("file://") || url.startsWith("about:")));
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        Log.i(TAG, "页面加载完成: " + url);
    }
}
