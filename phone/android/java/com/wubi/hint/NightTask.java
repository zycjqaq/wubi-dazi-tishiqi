package com.wubi.hint;

import android.app.Activity;
import android.view.Window;

/**
 * 切换夜间模式时同步系统栏颜色（必须在 UI 线程执行）。
 *
 * 说明：这里刻意写成顶层类而不是匿名内部类，
 * 因为本机 build-tools 34 的 d8 在转换匿名内部类时会抛
 * NullPointerException: Cannot invoke "String.length()"。
 */
class NightTask implements Runnable {

    private final Activity host;
    private final boolean night;

    NightTask(Activity host, boolean night) {
        this.host = host;
        this.night = night;
    }

    @Override
    public void run() {
        if (host == null || host.isFinishing()) {
            return;
        }
        try {
            Window w = host.getWindow();
            if (night) {
                w.setStatusBarColor(0xFF0E1420);
                w.setNavigationBarColor(0xFF0E1420);
            } else {
                w.setStatusBarColor(0xFF2F6BFF);
                w.setNavigationBarColor(0xFFEEF1F8);
            }
        } catch (Throwable ignored) {
            // 系统栏上色失败不影响网页显示
        }
    }
}
