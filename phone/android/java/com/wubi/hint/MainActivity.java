package com.wubi.hint;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * 五笔打字提示器 · 手机版
 *
 * 整个程序是一个离线的网页（assets/www 下），这里只提供一个 WebView 外壳：
 *  - 允许 file:// 页面加载本地资源（targetSdk 30+ 默认关闭，必须显式打开）
 *  - 返回键：练习模式先退回日常模式，再按一次才退出
 *  - 把网页里的 console / 自检输出转到 logcat，方便真机排查
 *
 * 构建注意：本工程刻意不用匿名内部类和泛型嵌套类，辅助类都写成顶层类，
 * 因为 build-tools 34 的 d8 在本机转换这类 class 时会抛
 * NullPointerException: Cannot invoke "String.length()"，导致打包失败。
 */
public class MainActivity extends Activity {

    private static final String TAG = "WubiHint";
    private static final String START_URL = "file:///android_asset/www/index.html";

    private WebView web;
    /** 只有 adb 带 -e webdebug 1 启动时才打开 WebView 远程调试，平时关掉。 */
    private boolean webDebug = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 上次关掉时的夜间模式设置：首帧就把状态栏与 WebView 底色定好，避免闪白
        boolean night = false;
        try {
            night = "1".equals(getSharedPreferences(Bridge.PREF, MODE_PRIVATE)
                    .getString(Bridge.KEY_NIGHT, "0"));
        } catch (Throwable ignored) {
            // 读不到就当日间
        }

        Window w = getWindow();
        if (night) {
            w.setStatusBarColor(0xFF0E1420);
            w.setNavigationBarColor(0xFF0E1420);
        } else {
            w.setStatusBarColor(0xFF2F6BFF);
            w.setNavigationBarColor(0xFFEEF1F8);
        }

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(night ? 0xFF0E1420 : 0xFFEEF1F8);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        try {
            webDebug = getIntent() != null && "1".equals(getIntent().getStringExtra("webdebug"));
        } catch (Throwable ignored) {
            webDebug = false;
        }
        try {
            if (webDebug && Build.VERSION.SDK_INT >= 19) {
                WebView.setWebContentsDebuggingEnabled(true);
            }
        } catch (Throwable ignored) {
            // 调试开关失败不影响使用
        }

        web.setWebViewClient(new PageClient());
        web.setWebChromeClient(new LogClient());
        web.addJavascriptInterface(new Bridge(this, web), "AndroidHost");

        setContentView(web);
        web.loadUrl(startUrl());
        Log.i(TAG, "启动: " + startUrl());
    }

    /**
     * 起始地址。默认加载本地网页；
     * 若通过 adb 启动时带了 extra "query"（例如 ?selftest=1），则拼到后面，
     * 方便在模拟器/真机上跑自检与输入法测试：
     *   adb shell am start -n com.wubi.hint/.MainActivity -e query "?inputtest=1"
     */
    private String startUrl() {
        String extra = null;
        try {
            extra = getIntent() == null ? null : getIntent().getStringExtra("query");
        } catch (Throwable ignored) {
            // 拿不到就用默认地址
        }
        if (extra == null || extra.length() == 0) {
            return START_URL;
        }
        if (extra.charAt(0) != '?') {
            extra = "?" + extra;
        }
        return START_URL + extra;
    }

    /**
     * 返回键：先让网页自己处理（练习模式退回日常，返回 'handled'）；
     * 网页判断该退出时直接调 AndroidHost.exit()，这里不再同步等待返回值。
     */
    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        try {
            web.evaluateJavascript(
                    "(function(){try{return (window.__appBack&&window.__appBack())||'exit';}"
                            + "catch(e){return 'exit';}})()",
                    null);
        } catch (Throwable t) {
            finish();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) {
            web.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("AndroidHost");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
