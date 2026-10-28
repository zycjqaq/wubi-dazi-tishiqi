package com.wubi.hint;

import android.webkit.WebView;

/**
 * 把百度翻译的结果回灌给网页：在 UI 线程里调 window.__netDone(id, ok, payload)。
 *
 * 注意：必须是顶层类（d8 对匿名内部类会崩）。
 */
class NetReply implements Runnable {

    private final WebView web;
    private final String id;
    private final boolean ok;
    private final String payload;

    NetReply(WebView web, String id, boolean ok, String payload) {
        this.web = web;
        this.id = id;
        this.ok = ok;
        this.payload = payload == null ? "" : payload;
    }

    @Override
    public void run() {
        if (web == null) {
            return;
        }
        String js = "(function(){try{if(window.__netDone){window.__netDone("
                + esc(id) + "," + (ok ? "true" : "false") + "," + esc(payload)
                + ");}}catch(e){}})()";
        try {
            web.evaluateJavascript(js, null);
        } catch (Throwable t) {
            // 页面已销毁时忽略
        }
    }

    /** 生成带引号的 JS 字符串字面量（含转义）。 */
    private static String esc(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 16);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\u2028': sb.append("\\u2028"); break;
                case '\u2029': sb.append("\\u2029"); break;
                default:
                    if (c < 0x20) {
                        String h = Integer.toHexString(c);
                        sb.append("\\u");
                        for (int k = h.length(); k < 4; k++) {
                            sb.append('0');
                        }
                        sb.append(h);
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
        return sb.toString();
    }
}
