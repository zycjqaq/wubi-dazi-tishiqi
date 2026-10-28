package com.wubi.hint;

import android.app.Activity;
import android.util.Log;
import android.webkit.WebView;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.security.MessageDigest;
import java.util.Random;

/**
 * 一次百度翻译请求（在后台线程执行）。
 *
 * 网页是 file:// 加载的，直接 fetch 会被浏览器的跨域策略拦掉（百度接口不返回
 * CORS 头），所以请求必须由原生层代发，结果再回灌给网页。
 *
 * 签名规则（百度官方）：sign = MD5(appid + q + salt + key)，全部小写十六进制。
 *
 * 注意：本类必须是顶层类，不能写成匿名内部类或 MainActivity 的嵌套类，
 * 否则 build-tools 34 的 d8 会抛 NullPointerException 导致打包失败。
 */
class NetTask implements Runnable {

    private static final String TAG = "WubiHint";
    private static final String API = "https://fanyi-api.baidu.com/api/trans/vip/translate";

    private final Activity host;
    private final WebView web;
    private final String id;
    private final String appid;
    private final String key;
    private final String text;
    private final String from;
    private final String to;

    NetTask(Activity host, WebView web, String id, String appid, String key,
            String text, String from, String to) {
        this.host = host;
        this.web = web;
        this.id = id;
        this.appid = appid;
        this.key = key;
        this.text = text;
        this.from = (from == null || from.length() == 0) ? "en" : from;
        this.to = (to == null || to.length() == 0) ? "zh" : to;
    }

    @Override
    public void run() {
        boolean ok = false;
        String payload;
        try {
            String salt = String.valueOf(new Random().nextInt(90000) + 10000);
            String sign = md5(appid + text + salt + key);
            String url = API
                    + "?q=" + URLEncoder.encode(text, "UTF-8")
                    + "&from=" + URLEncoder.encode(from, "UTF-8")
                    + "&to=" + URLEncoder.encode(to, "UTF-8")
                    + "&appid=" + URLEncoder.encode(appid, "UTF-8")
                    + "&salt=" + salt
                    + "&sign=" + sign;
            payload = httpGet(url);
            ok = true;
        } catch (Throwable t) {
            payload = t.getClass().getSimpleName()
                    + (t.getMessage() == null ? "" : (": " + t.getMessage()));
            Log.i(TAG, "[net] 失败 " + payload);
        }
        if (host != null) {
            host.runOnUiThread(new NetReply(web, id, ok, payload));
        }
    }

    private static String httpGet(String url) throws Exception {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("GET");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setUseCaches(false);
            c.setRequestProperty("Accept", "application/json");
            int code = c.getResponseCode();
            InputStream in = (code >= 200 && code < 300) ? c.getInputStream() : c.getErrorStream();
            if (in == null) {
                return "HTTP " + code;
            }
            BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) {
                sb.append(line);
            }
            r.close();
            return sb.toString();
        } finally {
            if (c != null) {
                c.disconnect();
            }
        }
    }

    static String md5(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] b = md.digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder(b.length * 2);
            for (int i = 0; i < b.length; i++) {
                int v = b[i] & 0xFF;
                if (v < 16) {
                    sb.append('0');
                }
                sb.append(Integer.toHexString(v));
            }
            return sb.toString();
        } catch (Throwable t) {
            return "";
        }
    }
}
