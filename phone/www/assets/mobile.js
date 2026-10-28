/* ===== 五笔打字提示器 · 手机版增强（在 app.js 之后加载，不改动主程序） ===== */
(function () {
  'use strict';

  /* ---------- 1. 把日志送到 Android（logcat），便于真机排查 ---------- */
  function sendLog(s) {
    try {
      if (window.AndroidHost && window.AndroidHost.log) {
        window.AndroidHost.log(String(s));
        return true;
      }
    } catch (e) { /* 忽略 */ }
    try { if (window.console) console.log(s); } catch (e2) { /* 忽略 */ }
    return false;
  }

  window.addEventListener('error', function (e) {
    sendLog('[JS-ERROR] ' + ((e && (e.message || (e.error && e.error.message))) || '未知')
      + ' @' + ((e && e.filename) || '') + ':' + ((e && e.lineno) || 0));
  });

  /* ---------- 2. 返回键：侧边栏开着先关侧边栏，练习模式退回日常，再按才退出 ---------- */
  window.__appBack = function () {
    if (closeSheet()) return 'handled';
    if (closeSide()) return 'handled';
    var art = document.getElementById('paneArticle');
    if (art && !art.hidden) {
      var btn = document.getElementById('modeBtn');
      if (btn) { btn.click(); return 'handled'; }
    }
    // 网页侧判断该退出：直接通知 Android 结束 Activity
    try {
      if (window.AndroidHost && window.AndroidHost.exit) {
        window.AndroidHost.exit();
      }
    } catch (e) { /* 忽略 */ }
    return 'exit';
  };

  /* ---------- 3. 软键盘弹出后，让正在输入的区域保持可见 ---------- */
  function keepVisible(ta) {
    if (!ta) return;
    ta.addEventListener('focus', function () {
      // 等软键盘动画结束再滚动
      setTimeout(function () {
        try { ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {
          try { ta.scrollIntoView(false); } catch (e2) { /* 忽略 */ }
        }
      }, 300);
    });
  }

  /* ---------- 5. 手机上占位提示改短，避免被截断 ---------- */
  function shortPlaceholders() {
    var a = document.getElementById('srcInput');
    var b = document.getElementById('learnInput');
    if (a) a.setAttribute('placeholder', '在这里输入：汉字标五笔，英文翻译成中文…');
    if (b) b.setAttribute('placeholder', '点这里开始打字，打一个字上方就出现它的五笔字母…');
  }

  /* ---------- 4. 练习模式：进入时自动聚焦输入框 ---------- */  function watchMode() {
    var art = document.getElementById('paneArticle');
    var input = document.getElementById('learnInput');
    if (!art || !input || typeof MutationObserver === 'undefined') return;
    var wasLearn = !art.hidden;
    new MutationObserver(function () {
      var isLearn = !art.hidden;
      if (isLearn && !wasLearn) {
        setTimeout(function () { try { input.focus(); } catch (e) { /* 忽略 */ } }, 120);
      }
      wasLearn = isLearn;
    }).observe(art, { attributes: true, attributeFilter: ['hidden'] });
  }

  /* ---------- 5. 真机自检：把 ?selftest=1 的结果写进 logcat ---------- */
  function reportSelfTest() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var pre = document.getElementById('selftest');
      if (pre) {
        clearInterval(timer);
        sendLog('[SELFTEST-BEGIN]');
        (pre.textContent || '').split('\n').forEach(function (line) {
          if (line) sendLog(line);
        });
        sendLog('[SELFTEST-END]');
        return;
      }
      if (tries > 60) {
        clearInterval(timer);
        sendLog('[SELFTEST] 超时：没有找到 #selftest');
      }
    }, 250);
  }

  /* ---------- 6. 中文输入法（拼音）拼字过程中不要逐字母比对 ---------- */
  /*
   * 手机打中文走输入法：先输入拼音字母、再选字，期间 textarea 的 value 会先变成
   * "zao" 这种拼音串。若主程序在每个 input 事件都跑一次比对，练习模式会把
   * 每个拼音字母都判成错字。这里在 document 捕获阶段拦掉「正在拼字」时的
   * input 事件，等 compositionend 之后再补发一次真正的 input。
   */
  function guardComposition() {
    var composing = false;

    document.addEventListener('compositionstart', function (e) {
      var t = e.target;
      if (t && (t.id === 'srcInput' || t.id === 'learnInput')) composing = true;
    }, true);

    document.addEventListener('compositionend', function (e) {
      var t = e.target;
      if (!t || (t.id !== 'srcInput' && t.id !== 'learnInput')) return;
      composing = false;
      // 部分输入法在 compositionend 之后不补发 input，这里兜一次
      setTimeout(function () {
        try { t.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) { /* 忽略 */ }
      }, 0);
    }, true);

    document.addEventListener('input', function (e) {
      if (!composing) return;
      var t = e.target;
      if (!t || (t.id !== 'srcInput' && t.id !== 'learnInput')) return;
      // 拼字中间态：不让主程序拿去比对/渲染
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);
  }

  /* ---------- 7. 真机中文输入法自检（?inputtest=1） ---------- */
  /*
   * 在真实 WebView 里模拟输入法拼字过程：compositionstart → 拼音串 input →
   * compositionend → 提交汉字，检查练习模式不会把拼音字母判成错字。
   * 结果通过 AndroidHost.log 打到 logcat，便于没有真机时用模拟器验收。
   */
  function inputTest() {
    var ta = document.getElementById('learnInput');
    var stats = document.getElementById('articleStats');
    if (!ta || !stats) { sendLog('[INPUTTEST] 找不到练习输入框'); return; }

    function s() { return (stats.textContent || '').replace(/\s+/g, ' ').trim(); }
    function fire(type) {
      var ev;
      try {
        ev = new CompositionEvent(type, { bubbles: true, cancelable: true, data: '' });
      } catch (e) {
        ev = document.createEvent('CompositionEvent');
        ev.initCompositionEvent(type, true, true, window, '', '');
      }
      ta.dispatchEvent(ev);
    }
    function input() { ta.dispatchEvent(new Event('input', { bubbles: true })); }
    function wait(ms, fn) { setTimeout(fn, ms); }

    var lines = [];
    function step(label, expect) {
      lines.push(label + ' → ' + s() + (expect ? '（期望 ' + expect + '）' : ''));
    }

    ta.focus();
    ta.value = '';
    fire('compositionstart');
    ta.value = 'z'; input();
    step('拼字中 z');
    ta.value = 'zao'; input();
    step('拼字中 zao');
    ta.value = '早'; fire('compositionend');
    wait(200, function () {
      step('提交「早」', '1/73 错 0');
      var afterCompose = s();

      ta.value = '早上'; input();
      wait(150, function () {
        step('再输入「上」', '2/73 错 0');

        ta.value = '早上七'; input();
        wait(150, function () {
          step('故意打错「七」', '3/73 错 1');
          var finalState = s();

          var okCompose = /^0\/73/.test(afterCompose) === false && /1\/73/.test(afterCompose);
          var okWrong = /3\/73/.test(finalState) && /错 1/.test(finalState);

          sendLog('[INPUTTEST-BEGIN]');
          for (var i = 0; i < lines.length; i++) sendLog(lines[i]);
          sendLog('[INPUTTEST] 拼字中不误判: ' + (okCompose ? 'PASS' : 'FAIL'));
          sendLog('[INPUTTEST] 错字能标记: ' + (okWrong ? 'PASS' : 'FAIL'));
          sendLog('[INPUTTEST-END] ' + ((okCompose && okWrong) ? '全部通过' : '有失败'));
        });
      });
    });
  }

  /* ---------- 8. 左侧边栏 + 夜间模式 ---------- */
  var sideOpen = false;

  function el(id) { return document.getElementById(id); }

  function isDark() {
    return (' ' + document.documentElement.className + ' ').indexOf(' dark ') >= 0;
  }

  /* 关侧边栏；返回 true 表示这次确实关掉了（给返回键用） */
  function closeSide() {
    if (!sideOpen) return false;
    sideOpen = false;
    var bar = el('sideBar');
    var mask = el('sideMask');
    var tog = el('sideToggle');
    if (bar) { bar.classList.remove('show'); bar.setAttribute('aria-hidden', 'true'); }
    if (tog) tog.setAttribute('aria-expanded', 'false');
    if (mask) {
      mask.classList.remove('show');
      // 等淡出动画结束再藏起来
      setTimeout(function () { if (!sideOpen && mask) mask.hidden = true; }, 220);
    }
    return true;
  }

  function openSide() {
    var bar = el('sideBar');
    var mask = el('sideMask');
    var tog = el('sideToggle');
    if (!bar || !mask) return;
    sideOpen = true;
    mask.hidden = false;
    // 强制一次重排再加 show，保证 transition 生效（不依赖 requestAnimationFrame，
    // 因为 WebView 在后台或不可见时 rAF 可能不执行）
    void mask.offsetWidth;
    mask.classList.add('show');
    bar.classList.add('show');
    bar.setAttribute('aria-hidden', 'false');
    if (tog) tog.setAttribute('aria-expanded', 'true');
  }

  function toggleSide() {
    if (sideOpen) closeSide(); else openSide();
  }

  /* 记住主题：App 里存 SharedPreferences，浏览器里存 localStorage */
  function saveTheme(dark) {
    var v = dark ? '1' : '0';
    try {
      if (window.AndroidHost && window.AndroidHost.setNight) window.AndroidHost.setNight(dark);
    } catch (e) { /* 忽略 */ }
    try { localStorage.setItem('wubi-theme', dark ? 'dark' : 'light'); } catch (e2) { /* 忽略 */ }
    sendLog('[THEME] ' + (dark ? '夜间模式' : '正常模式') + ' saved=' + v);
  }

  function applyTheme(dark, remember) {
    var de = document.documentElement;
    if (dark) {
      if (!isDark()) de.className = (de.className ? de.className + ' ' : '') + 'dark';
    } else {
      de.className = (' ' + de.className + ' ').replace(/\s+dark\s+/g, ' ').trim();
    }
    // 状态栏颜色跟着变
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0e1420' : '#2f6bff');
    // 按钮状态 + 文案
    var btn = el('themeBtn');
    var lab = el('themeLabel');
    if (btn) btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    if (lab) lab.textContent = dark ? '正常模式' : '夜间模式';
    if (remember) saveTheme(dark);
  }

  function setupSide() {
    var tog = el('sideToggle');
    var mask = el('sideMask');
    var bar = el('sideBar');
    var themeBtn = el('themeBtn');
    if (!tog || !mask || !bar) return;

    tog.addEventListener('click', function (e) {
      e.preventDefault();
      toggleSide();
    });
    mask.addEventListener('click', function () { closeSide(); });

    // 抽屉里点空白不关，点月亮才切主题
    if (themeBtn) {
      themeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        applyTheme(!isDark(), true);
      });
    }

    // 抽屉里左右滑动手势：向右滑关闭
    var startX = 0, startY = 0, tracking = false;
    bar.addEventListener('touchstart', function (e) {
      if (!e.touches || !e.touches.length) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });
    bar.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      if (dx > 55 && Math.abs(dy) < 70) closeSide();
    }, { passive: true });

    // 初始状态与保存的主题保持一致
    applyTheme(isDark(), false);
  }

  /* ---------- 9. 联网翻译（可选开关，百度翻译 API） ---------- */
  /*
   * 纯离线版的英文是逐词对译，词义对了但语序还是英文的。
   * 打开这个开关后，每段英文整段发给百度翻译，回来的是通顺中文。
   *
   * 几条硬规矩：
   *  - 中文标五笔永远在本地算，一个汉字都不上传；
   *  - 没网 / 超时 / 额度用完 / 没填密钥 → 自动退回离线词典，功能不退化；
   *  - 同一段英文只请求一次，结果缓存在本地；
   *  - 百度免费版 QPS=1，所以请求排队、两次之间至少隔 1.1 秒。
   */
  var NET = {
    on: false,
    appid: '',
    key: '',
    seq: 0,
    pending: {},
    cache: {},
    cur: null,
    timer: 0,
    busy: false,
    queue: [],
    nextAt: 0,
    pumpTimer: 0,
    used: { ym: '', chars: 0 },
    budget: 40000,
    budgetHit: false
  };

  var NET_ERR = {
    '52001': '请求超时，请重试',
    '52002': '百度服务系统错误',
    '52003': 'APP ID 或密钥不正确',
    '54000': '必填参数为空',
    '54001': '签名错误（密钥不对）',
    '54003': '访问太频繁，请稍后再试',
    '54004': '账户余额不足',
    '54005': '请求太频繁，请稍后再试',
    '58000': '客户端 IP 非法',
    '58001': '不支持的语言方向',
    '58002': '服务已关闭',
    '90107': '认证未通过'
  };

  function lsGet(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* 存不下只影响记忆 */ }
  }

  function netLoad() {
    NET.on = lsGet('wubi-net-on', '0') === '1';
    NET.appid = lsGet('wubi-net-appid', '');
    NET.key = lsGet('wubi-net-key', '');
    var b = parseInt(lsGet('wubi-net-budget', '40000'), 10);
    NET.budget = isNaN(b) ? 40000 : b;
    try { NET.cache = JSON.parse(lsGet('wubi-net-cache', '{}')) || {}; } catch (e) { NET.cache = {}; }
  }

  function netSave() {
    lsSet('wubi-net-on', NET.on ? '1' : '0');
    lsSet('wubi-net-appid', NET.appid);
    lsSet('wubi-net-key', NET.key);
    lsSet('wubi-net-budget', String(NET.budget));
  }

  /* ---------- 每月额度统计：按自然月累计发送的字符数 ---------- */
  function netMonthKey() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }

  function netUsedLoad() {
    var o = null;
    try { o = JSON.parse(lsGet('wubi-net-used', '')); } catch (e) { o = null; }
    var ym = netMonthKey();
    if (!o || o.ym !== ym || typeof o.chars !== 'number') o = { ym: ym, chars: 0 };
    NET.used = o;
    return o;
  }

  function netUsedSave() {
    try { lsSet('wubi-net-used', JSON.stringify(NET.used)); } catch (e) { /* 忽略 */ }
  }

  function netRefreshUsage() {
    var box = el('setUsage');
    if (!box) return;
    netUsedLoad();
    var c = NET.used.chars;
    if (NET.budget > 0) {
      box.textContent = '本月联网已用 ' + c + ' / ' + NET.budget + ' 字符（' + NET.used.ym + '）';
      box.className = 'sheet-usage' + (c >= NET.budget ? ' sheet-usage-full'
        : (c >= NET.budget * 0.8 ? ' sheet-usage-warn' : ''));
    } else {
      box.textContent = '本月联网已用 ' + c + ' 字符（未设上限，' + NET.used.ym + '）';
      box.className = 'sheet-usage';
    }
  }

  function netStopForBudget() {
    NET.budgetHit = true;
    if (NET.on) { NET.on = false; netSave(); netRefreshUI(); }
    window.__app.setNetState('fail',
      '本月联网字符数已到 ' + NET.budget + ' 上限，已自动关闭联网（下月自动重置）。');
    sendLog('[NET] 额度已满，自动关闭联网 used=' + NET.used.chars);
  }

  function netAddUsed(n) {
    netUsedLoad();
    NET.used.chars += n;
    netUsedSave();
    netRefreshUI();
    if (NET.budget > 0 && NET.used.chars >= NET.budget) netStopForBudget();
  }

  function netOverBudget() {
    netUsedLoad();
    return NET.budget > 0 && NET.used.chars >= NET.budget;
  }

  function netSaveCache() {
    var keys = Object.keys(NET.cache);
    if (keys.length > 400) {
      for (var i = 0; i < keys.length - 400; i++) delete NET.cache[keys[i]];
    }
    try { lsSet('wubi-net-cache', JSON.stringify(NET.cache)); } catch (e) { /* 忽略 */ }
  }

  function hasBridge() {
    try { return !!(window.AndroidHost && window.AndroidHost.translate); } catch (e) { return false; }
  }

  /* 发一条翻译请求；cb(中文, 错误说明)，两者只会有其一 */
  function netCall(text, cb) {
    if (!hasBridge()) { cb(null, '当前环境没有联网桥接'); return; }
    if (!NET.appid || !NET.key) { cb(null, '还没有填 APP ID / 密钥'); return; }
    var id = 'n' + (++NET.seq);
    NET.pending[id] = cb;
    try {
      window.AndroidHost.translate(id, NET.appid, NET.key, text, 'en', 'zh');
    } catch (e) {
      delete NET.pending[id];
      cb(null, '调用原生失败');
      return;
    }
    setTimeout(function () {
      if (NET.pending[id]) { delete NET.pending[id]; cb(null, '请求超时'); }
    }, 9000);
  }

  /* 原生层拿到结果后回调这里 */
  window.__netDone = function (id, ok, payload) {
    var cb = NET.pending[id];
    if (!cb) return;
    delete NET.pending[id];
    if (!ok) { cb(null, '网络错误：' + String(payload).slice(0, 90)); return; }
    var j;
    try { j = JSON.parse(payload); } catch (e) { cb(null, '返回内容无法解析'); return; }
    if (j && j.error_code) {
      cb(null, (NET_ERR[j.error_code] || '翻译服务返回错误') + '（' + j.error_code + '）');
      return;
    }
    var out = '';
    if (j && j.trans_result) {
      for (var i = 0; i < j.trans_result.length; i++) out += j.trans_result[i].dst || '';
    }
    if (!out) { cb(null, '没有拿到译文'); return; }
    cb(out, null);
  };

  /* 请求排队：免费版 QPS=1，两次请求至少隔 1.1 秒 */
  function netEnqueue(run, done) {
    NET.queue.push({ run: run, done: done });
    netPump();
  }

  function netPump() {
    if (NET.busy || !NET.queue.length) return;
    if (netOverBudget()) {
      var rest = NET.queue.splice(0, NET.queue.length);
      for (var q = 0; q < rest.length; q++) rest[q].done(null, '本月额度已用完');
      netStopForBudget();
      return;
    }
    var wait = NET.nextAt - Date.now();
    if (wait > 0) {
      if (!NET.pumpTimer) {
        NET.pumpTimer = setTimeout(function () { NET.pumpTimer = 0; netPump(); }, wait);
      }
      return;
    }
    NET.busy = true;
    var job = NET.queue.shift();
    netCall(job.run.text, function (zh, err) {
      NET.busy = false;
      NET.nextAt = Date.now() + 1300;
      if (zh) netAddUsed(job.run.text.length);
      job.done(zh, err);
      netPump();
    });
  }

  /* 单次请求超过百度上限（标准版 1000 字符）时按词切开，逐块翻再拼起来 */
  function chunkText(s, max) {
    if (s.length <= max) return [s];
    var parts = s.split(' '), out = [], cur = '';
    for (var i = 0; i < parts.length; i++) {
      var w = parts[i];
      if (cur && (cur.length + 1 + w.length) > max) { out.push(cur); cur = w; }
      else { cur = cur ? cur + ' ' + w : w; }
    }
    if (cur) out.push(cur);
    return out.length ? out : [s];
  }

  /* 开始翻译一整段输入：能命中缓存的部分先直接替换，其余排队 */
  function netStart(text, runs) {
    if (NET.cur && NET.cur.text === text) return;
    var cur = { text: text, map: {}, need: 0, done: 0, fail: 0 };
    NET.cur = cur;
    var tasks = [];
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      var hit = NET.cache[r.text];
      if (hit) {
        cur.map[r.start] = { len: r.len, zh: hit, words: r.words };
        continue;
      }
      var chunks = chunkText(r.text, 900);
      if (chunks.length === 1) {
        tasks.push({ run: r, idx: 0, total: 1, text: chunks[0] });
      } else {
        r._parts = new Array(chunks.length);
        for (var k = 0; k < chunks.length; k++) {
          tasks.push({ run: r, idx: k, total: chunks.length, text: chunks[k] });
        }
      }
    }
    var cachedCount = Object.keys(cur.map).length;
    if (cachedCount) window.__app.setOnlineRepl(text, cur.map);
    if (!tasks.length) { window.__app.setNetState('', ''); return; }

    cur.need = tasks.length;
    window.__app.setNetState('loading', '正在联网翻译…');
    tasks.forEach(function (t) {
      netEnqueue({ text: t.text }, function (zh, err) {
        if (NET.cur !== cur) return;   // 输入已经变了，丢弃这次结果
        cur.done++;
        var run = t.run;
        if (zh) {
          if (t.total === 1) {
            NET.cache[run.text] = zh;
            netSaveCache();
            cur.map[run.start] = { len: run.len, zh: zh, words: run.words };
            window.__app.setOnlineRepl(text, cur.map);
            if (!NET.budgetHit) window.__app.setNetState('', '');
          } else {
            run._parts[t.idx] = zh;
            var allOk = true;
            for (var m = 0; m < run._parts.length; m++) if (!run._parts[m]) allOk = false;
            if (allOk) {
              var joined = run._parts.join('');
              NET.cache[run.text] = joined;
              netSaveCache();
              cur.map[run.start] = { len: run.len, zh: joined, words: run.words };
              window.__app.setOnlineRepl(text, cur.map);
              if (!NET.budgetHit) window.__app.setNetState('', '');
            }
          }
        } else {
          cur.fail++;
          if (cur.done >= cur.need && cur.fail >= cur.need - cachedCount) {
            window.__app.setNetState('fail',
              '联网翻译失败：' + (err || '未知原因') + '，已用离线词典。');
          }
        }
      });
    });
  }

  /* app.js 每次渲染完输出区都会调这里 */
  function netHook(text, mode) {
    if (NET.timer) { clearTimeout(NET.timer); NET.timer = 0; }
    if (!NET.on || mode === 'zh-only' || mode === 'zh2en' || !text) {
      NET.cur = null;
      window.__app.setNetState('', '');
      if (window.__app.hasOnlineRepl && window.__app.hasOnlineRepl()) window.__app.setOnlineRepl(null);
      return;
    }
    if (NET.cur && NET.cur.text === text) return;
    var runs = window.__app.enRuns(text);
    if (!runs.length) {
      NET.cur = null;
      window.__app.setNetState('', '');
      return;
    }
    // 停手 0.9 秒再发，避免边打边发、白烧额度
    NET.timer = setTimeout(function () { NET.timer = 0; netStart(text, runs); }, 900);
  }
  window.__netHook = netHook;

  function setLog(msg, kind) {
    var box = el('setLog');
    if (!box) return;
    box.textContent = msg || '';
    box.className = 'sheet-log' + (kind ? ' sheet-log-' + kind : '');
  }

  function netRefreshUI() {
    var btn = el('netBtn');
    var tip = el('netTip');
    if (btn) btn.setAttribute('aria-pressed', NET.on ? 'true' : 'false');
    netUsedLoad();
    if (tip) {
      if (NET.budgetHit || (NET.budget > 0 && NET.used.chars >= NET.budget)) {
        tip.textContent = '本月额度已用完，联网已自动关闭（下月自动重置，或在翻译设置里调高上限）。';
      } else if (!NET.appid || !NET.key) {
        tip.textContent = '还没填 APP ID 和密钥：点下面「翻译设置」，3 分钟就能申请一个。';
      } else if (NET.on) {
        tip.textContent = '已开启：英文整段发给百度翻译（本月已用 ' + NET.used.chars + ' 字符），中文标五笔始终在本地。';
      } else {
        tip.textContent = '已关闭：英文用本地词典逐词翻译，不联网。';
      }
    }
    netRefreshUsage();
  }

  /* 开关刚打开 / 刚存完密钥时，让输入框里已有的英文立刻重新走一遍联网 */
  function netRetrigger() {
    var ta = el('srcInput'), sel = el('langSel');
    if (!ta || !window.__netHook) return;
    NET.cur = null;
    window.__netHook(ta.value || '', sel ? sel.value : 'auto');
  }

  function netToggle() {
    if (!NET.on && netOverBudget()) {
      netStopForBudget();
      openSheet();
      setLog('本月额度已用完（' + NET.used.chars + ' / ' + NET.budget + ' 字符），可在上面调高上限或等下月重置', 'bad');
      return;
    }
    NET.on = !NET.on;
    if (NET.on) NET.budgetHit = false;
    netSave();
    netRefreshUI();
    NET.cur = null;
    if (window.__app.hasOnlineRepl && window.__app.hasOnlineRepl()) window.__app.setOnlineRepl(null);
    window.__app.setNetState('', '');
    sendLog('[NET] 联网翻译 ' + (NET.on ? '开' : '关'));
    if (NET.on && (!NET.appid || !NET.key)) openSheet();
    else netRetrigger();
  }

  /* ---------- 10. 翻译设置面板 ---------- */
  var sheetOpen = false;

  function openSheet() {
    var m = el('setMask'), s = el('setSheet');
    if (!m || !s) return;
    closeSide();
    sheetOpen = true;
    if (el('setAppId')) el('setAppId').value = NET.appid;
    if (el('setKey')) el('setKey').value = NET.key;
    if (el('setBudget')) el('setBudget').value = String(NET.budget);
    if (el('setKey')) el('setKey').type = 'password';
    if (el('setEye')) el('setEye').textContent = '👁';
    setLog('');
    netRefreshUsage();
    m.hidden = false;
    void m.offsetWidth;
    m.classList.add('show');
    s.classList.add('show');
    s.setAttribute('aria-hidden', 'false');
  }

  function closeSheet() {
    if (!sheetOpen) return false;
    sheetOpen = false;
    var m = el('setMask'), s = el('setSheet');
    if (s) { s.classList.remove('show'); s.setAttribute('aria-hidden', 'true'); }
    if (m) {
      m.classList.remove('show');
      setTimeout(function () { if (!sheetOpen && m) m.hidden = true; }, 240);
    }
    return true;
  }

  function netTest() {
    NET.appid = (el('setAppId').value || '').trim();
    NET.key = (el('setKey').value || '').trim();
    if (!NET.appid || !NET.key) { setLog('请先填 APP ID 和密钥', 'bad'); return; }
    setLog('正在测试…');
    netCall('Hello, how are you today?', function (zh, err) {
      if (zh) setLog('成功：' + zh, 'ok');
      else setLog('失败：' + err, 'bad');
      sendLog('[NET] 测试 ' + (zh ? '成功 ' + zh : '失败 ' + err));
    });
  }

  function netSaveForm() {
    NET.appid = (el('setAppId').value || '').trim();
    NET.key = (el('setKey').value || '').trim();
    var b = parseInt((el('setBudget') ? el('setBudget').value : '') || '40000', 10);
    NET.budget = isNaN(b) || b < 0 ? 40000 : b;
    if (NET.appid && NET.key) NET.on = true;
    NET.budgetHit = false;
    netSave();
    netRefreshUI();
    NET.cur = null;
    window.__app.setNetState('', '');
    if (window.__app.hasOnlineRepl && window.__app.hasOnlineRepl()) window.__app.setOnlineRepl(null);
    setLog(NET.appid && NET.key ? '已保存，联网翻译已开启' : '已保存（还缺 APP ID 或密钥）', 'ok');
    sendLog('[NET] 保存 appid=' + (NET.appid ? '有' : '无') + ' key=' + (NET.key ? '有' : '无')
      + ' budget=' + NET.budget);
    if (NET.on) netRetrigger();
    setTimeout(function () { closeSheet(); }, 600);
  }

  function setupNet() {
    var btn = el('netBtn');
    var setBtn = el('netSetBtn');
    if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); netToggle(); });
    if (setBtn) setBtn.addEventListener('click', function (e) { e.preventDefault(); openSheet(); });
    if (el('setMask')) el('setMask').addEventListener('click', function () { closeSheet(); });
    if (el('setClose')) el('setClose').addEventListener('click', function () { closeSheet(); });
    if (el('setSave')) el('setSave').addEventListener('click', netSaveForm);
    if (el('setTest')) el('setTest').addEventListener('click', netTest);
    if (el('setEye')) el('setEye').addEventListener('click', function () {
      var k = el('setKey');
      if (!k) return;
      var show = k.type === 'password';
      k.type = show ? 'text' : 'password';
      el('setEye').textContent = show ? '🙈' : '👁';
    });
    netRefreshUI();
  }

  function boot() {
    keepVisible(document.getElementById('srcInput'));
    keepVisible(document.getElementById('learnInput'));
    watchMode();
    guardComposition();
    shortPlaceholders();
    setupSide();
    netLoad();
    setupNet();
    /* 首屏如果已经有内容（例如 ?text= 预填），补跑一次联网 */
    setTimeout(netRetrigger, 400);

    sendLog('[BOOT] WebView 就绪，桥接=' + (!!(window.AndroidHost && window.AndroidHost.version))
      + ' 版本=' + (window.AndroidHost && window.AndroidHost.version ? window.AndroidHost.version() : '-')
      + ' UA=' + navigator.userAgent);

    if (location.search.indexOf('selftest') >= 0) reportSelfTest();
    if (location.search.indexOf('probe') >= 0) setTimeout(probe, 400);
    if (location.search.indexOf('inputtest') >= 0) setTimeout(inputTest, 800);
    // ?side=1 自动拉开侧边栏（截图与验收用）
    if (/[?&]side=1\b/.test(location.search)) setTimeout(openSide, 300);
  }

  /* ---------- 6. 布局探针（?probe=1）：找出把页面撑宽的元素 ---------- */
  function probe() {
    var de = document.documentElement;
    var lines = [];
    lines.push('innerWidth=' + window.innerWidth);
    lines.push('clientWidth=' + de.clientWidth);
    lines.push('scrollWidth=' + de.scrollWidth);
    lines.push('devicePixelRatio=' + window.devicePixelRatio);
    var vw = de.clientWidth;
    var worst = [];
    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var r = el.getBoundingClientRect();
      if (r.width <= 0) continue;
      if (r.right > vw + 1 || r.width > vw + 1) {
        worst.push(el.tagName.toLowerCase()
          + (el.id ? '#' + el.id : '')
          + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : '')
          + ' w=' + Math.round(r.width) + ' right=' + Math.round(r.right));
      }
    }
    lines.push('溢出元素 ' + worst.length + ' 个:');
    for (var j = 0; j < Math.min(worst.length, 25); j++) lines.push('  ' + worst[j]);
    var pre = document.createElement('pre');
    pre.id = 'probe';
    pre.style.cssText = 'position:absolute;left:0;top:0;background:#fff;color:#000;font:11px/1.4 monospace;z-index:99999;max-width:100%;white-space:pre-wrap';
    pre.textContent = lines.join('\n');
    document.body.insertBefore(pre, document.body.firstChild);
    sendLog('[PROBE] ' + lines.join(' | '));
  }

  window.__mobile = { sendLog: sendLog };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 60); });
  } else {
    setTimeout(boot, 60);
  }
})();
