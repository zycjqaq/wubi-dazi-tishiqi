package com.wubi.hint;

import android.app.Activity;
import android.content.SharedPreferences;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

/**
 * 网页与 Android 之间的桥：
 *  - log(msg)      把网页日志写进 logcat
 *  - version()     返回版本号，网页用来判断是否在 App 里运行
 *  - exit()        网页判断该退出时，结束 Activity
 *  - getNight()    读「夜间模式」开关（"1" / "0"），网页首屏渲染前调用，避免闪白
 *  - setNight(on)  记住夜间模式并同步状态栏颜色
 *  - translate(..) 代网页请求百度翻译（file:// 下 fetch 会被跨域策略拦掉）
 */
class Bridge {

    private static final String TAG = "WubiHint";

    /** 设置文件名与键名，MainActivity 启动时也读这一份 */
    static final String PREF = "wubi";
    static final String KEY_NIGHT = "night";

    private final Activity host;
    private final WebView web;

    Bridge(Activity host, WebView web) {
        this.host = host;
        this.web = web;
    }

    @JavascriptInterface
    public void log(String msg) {
        Log.i(TAG, "[js] " + msg);
    }

    @JavascriptInterface
    public String version() {
        return "1.4";
    }

    @JavascriptInterface
    public void exit() {
        if (host == null) {
            return;
        }
        host.runOnUiThread(new FinishTask(host));
    }

    @JavascriptInterface
    public String getNight() {
        if (host == null) {
            return "0";
        }
        try {
            SharedPreferences sp = host.getSharedPreferences(PREF, Activity.MODE_PRIVATE);
            return sp.getString(KEY_NIGHT, "0");
        } catch (Throwable t) {
            return "0";
        }
    }

    @JavascriptInterface
    public void setNight(boolean on) {
        if (host == null) {
            return;
        }
        try {
            SharedPreferences sp = host.getSharedPreferences(PREF, Activity.MODE_PRIVATE);
            sp.edit().putString(KEY_NIGHT, on ? "1" : "0").apply();
        } catch (Throwable ignored) {
            // 存不下也不影响本次显示
        }
        host.runOnUiThread(new NightTask(host, on));
    }

    /**
     * 代发一次百度翻译请求。结果通过 window.__netDone(id, ok, payload) 回灌。
     * 立刻返回，不阻塞网页；真正的网络请求在后台线程里跑。
     */
    @JavascriptInterface
    public void translate(String id, String appid, String key, String text,
                          String from, String to) {
        if (host == null || text == null || text.length() == 0) {
            return;
        }
        Log.i(TAG, "[net] 请求 " + id + " 长度=" + text.length());
        Thread t = new Thread(new NetTask(host, web, id, appid, key, text, from, to));
        t.setDaemon(true);
        t.start();
    }
}
