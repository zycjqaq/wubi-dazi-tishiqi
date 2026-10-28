package com.wubi.hint;

import android.app.Activity;

/** 在主线程结束 Activity 的小任务（顶层类，避免匿名内部类）。 */
class FinishTask implements Runnable {

    private final Activity host;

    FinishTask(Activity host) {
        this.host = host;
    }

    @Override
    public void run() {
        if (host != null && !host.isFinishing()) {
            host.finish();
        }
    }
}
