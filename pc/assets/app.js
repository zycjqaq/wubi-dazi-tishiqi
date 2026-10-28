/* ==========================================================
   五笔打字提示器 · 主程序
   日常模式：上面输入 → 下面输出（汉字上方标五笔字母，英文自动翻译）
   练习模式：上面是常用千字十篇 → 下面是输入区（逐字五笔提示 / 答案对照）
   全部离线运行，资源来自 resources/ 下的资源包
   ========================================================== */
(function () {
  'use strict';

  /* =========================================================
     0. 小工具
     ========================================================= */
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* 字符分类用到的正则（必须早于任何解析逻辑声明，供 isCJK 等提前调用） */
  var RE_CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  var RE_LETTER = /[A-Za-z]/;
  var RE_DIGIT = /[0-9]/;
  var RE_SPACE = /[\s\u3000]/;
  /* Unicode 属性转义在个别旧浏览器里不支持，构造失败时退回手写标点集 */
  var RE_PUNCT = null;
  try { RE_PUNCT = new RegExp('\\p{P}', 'u'); } catch (e) { RE_PUNCT = null; }
  var EXTRA_PUNCT = '～￥％＃＆＊＋－＝／＼＠·，。：；、？！…—《》〈〉“”‘’（）【】「」『』《》〈〉〈〉';

  function isCJK(c) {
    if (!c) return false;
    return RE_CJK.test(c);
  }

  /* =========================================================
     1. 资源包解析
     ========================================================= */
  var packs = window.__packs || { wubi: [], english: [], englishFix: [], chineseEn: [], common: [], articles: [] };

  var wubi = new Map();      // 汉字 -> 五笔全码
  var en2cn = new Map();     // 英文 -> 中文释义
  var cn2en = new Map();     // 中文词 -> [英文候选]
  var commonSet = new Set(); // 常用 1000 字
  var articles = [];         // [{title, text}]
  var enFix = new Map();     // 英文（单词或短语） -> 中文；值为 '' 表示不输出
  var enFixMaxWords = 1;     // 修正表里最长的短语有几个词

  function eachData(list, fn) {
    (list || []).forEach(function (p) {
      if (p && p.data != null) fn(p.data, p);
    });
  }

  // 五笔：每行 “汉字 全码”
  eachData(packs.wubi, function (data) {
    String(data).split('\n').forEach(function (line) {
      line = line.replace(/\s+$/, '');
      if (!line || line.charAt(0) === '#') return;
      var sp = line.search(/[\s\u3000]/);
      if (sp < 1) return;
      var ch = line.slice(0, sp);
      var code = line.slice(sp).replace(/^\s+/, '').split(/\s+/)[0];
      if (ch.length <= 2 && code) wubi.set(ch, code.toUpperCase());
    });
  });

  // 拆 “左<TAB>右”：优先 Tab，其次连续两个以上空格（方便记事本里手改）
  function splitPair(line) {
    var tab = line.indexOf('\t');
    if (tab > 0) return [line.slice(0, tab), line.slice(tab + 1)];
    var m = /\s{2,}/.exec(line);
    if (m && m.index > 0) return [line.slice(0, m.index), line.slice(m.index + m[0].length)];
    return null;
  }

  // 英汉：每行 “英文<TAB>中文释义”
  eachData(packs.english, function (data) {
    String(data).split('\n').forEach(function (line) {
      if (!line || line.charAt(0) === '#') return;
      var pr = splitPair(line);
      if (!pr) return;
      var w = pr[0].trim().toLowerCase();
      var t = pr[1].trim();
      if (w && t) en2cn.set(w, t);
    });
  });

  // 英译修正表：每行 “英文 = 中文”，等号右边留空表示不输出
  eachData(packs.englishFix, function (data) {
    String(data).split('\n').forEach(function (line) {
      line = line.replace(/\s+$/, '');
      if (!line || line.charAt(0) === '#') return;
      var eq = line.indexOf('=');
      if (eq < 1) return;
      var key = line.slice(0, eq).trim().toLowerCase().replace(/\s+/g, ' ');
      var val = line.slice(eq + 1).trim();
      if (!key) return;
      enFix.set(key, val);
      var n = key.split(' ').length;
      if (n > enFixMaxWords) enFixMaxWords = n;
    });
  });

  // 汉英：每行 “中文词<TAB>英文候选,英文候选”
  eachData(packs.chineseEn, function (data) {
    String(data).split('\n').forEach(function (line) {
      if (!line || line.charAt(0) === '#') return;
      var pr = splitPair(line);
      if (!pr) return;
      var zh = pr[0].trim();
      var en = pr[1].trim();
      if (zh && en) {
        cn2en.set(zh, en.split(',').map(function (s) { return s.trim(); }).filter(Boolean));
      }
    });
  });

  // 常用字
  eachData(packs.common, function (data) {
    Array.from(String(data)).forEach(function (c) {
      if (isCJK(c)) commonSet.add(c);
    });
  });

  // 文章
  eachData(packs.articles, function (data) {
    if (!Array.isArray(data)) return;
    data.forEach(function (a) {
      if (a && typeof a.text === 'string' && a.text.length) {
        articles.push({ title: a.title || '未命名', text: a.text });
      }
    });
  });

  /* =========================================================
     2. 字符分类（正则见文件开头的工具区，因为解析资源包时就会用到）
     ========================================================= */
  function kindOf(c) {
    if (!c) return 'other';
    if (isCJK(c)) return 'zh';
    if (RE_LETTER.test(c)) return 'en';
    if (RE_DIGIT.test(c)) return 'num';
    if (RE_SPACE.test(c)) return 'space';
    if (RE_PUNCT && RE_PUNCT.test(c)) return 'punct';
    if (EXTRA_PUNCT.indexOf(c) >= 0) return 'punct';
    return 'other';
  }

  // 练习时无需手打的字符（标点、空白、符号）
  function isSkipChar(c) {
    var k = kindOf(c);
    return k === 'punct' || k === 'space';
  }

  /* =========================================================
     3. 分词
     ========================================================= */
  function tokenize(text) {
    var chars = Array.from(text);
    var out = [];
    var i = 0;
    while (i < chars.length) {
      var k = kindOf(chars[i]);
      if (k === 'en') {
        var w = '';
        while (i < chars.length && (kindOf(chars[i]) === 'en' ||
               (chars[i] === "'" && kindOf(chars[i + 1] || '') === 'en'))) {
          w += chars[i]; i++;
        }
        out.push({ t: 'en', v: w });
      } else if (k === 'num') {
        var n = '';
        while (i < chars.length && (kindOf(chars[i]) === 'num' || ('.' === chars[i] && kindOf(chars[i + 1] || '') === 'num'))) {
          n += chars[i]; i++;
        }
        out.push({ t: 'num', v: n });
      } else if (k === 'space') {
        var s = '';
        while (i < chars.length && kindOf(chars[i]) === 'space') { s += chars[i]; i++; }
        out.push({ t: 'space', v: s });
      } else if (k === 'other') {
        var o = '';
        while (i < chars.length && kindOf(chars[i]) === 'other') { o += chars[i]; i++; }
        out.push({ t: 'other', v: o });
      } else {
        out.push({ t: k, v: chars[i] });
        i++;
      }
    }
    return out;
  }

  /* =========================================================
     4. 英文 → 中文
     ========================================================= */
  // 只取第一个义项：先按 ；/; 断句，再按 , 断开，避免一行译文太长
  function firstSense(v) {
    var s = String(v);
    s = s.split(/[;；]/)[0];
    s = s.split(/[,，]/)[0];
    return s.trim();
  }

  function stemCandidates(w) {
    var c = [];
    if (w.length < 3) return c;
    if (/ies$/.test(w)) c.push(w.slice(0, -3) + 'y');
    if (/ied$/.test(w)) c.push(w.slice(0, -3) + 'y');
    if (/es$/.test(w)) c.push(w.slice(0, -2));
    if (/s$/.test(w)) c.push(w.slice(0, -1));
    if (/ed$/.test(w)) { c.push(w.slice(0, -2)); c.push(w.slice(0, -1)); }
    if (/ing$/.test(w)) { c.push(w.slice(0, -3)); c.push(w.slice(0, -3) + 'e'); c.push(w.slice(0, -4)); }
    if (/ly$/.test(w)) c.push(w.slice(0, -2));
    if (/er$/.test(w)) c.push(w.slice(0, -2));
    if (/est$/.test(w)) c.push(w.slice(0, -3));
    return c;
  }

  /* 一个英文词的各种可能形式：原形 + 词形还原 + 所有格去掉 's */
  var formCache = Object.create(null);
  function wordForms(w) {
    var lw = String(w).toLowerCase();
    var hit = formCache[lw];
    if (hit) return hit;
    var out = [lw];
    var c = stemCandidates(lw);
    for (var i = 0; i < c.length; i++) {
      if (c[i] && out.indexOf(c[i]) < 0) out.push(c[i]);
    }
    if (/['’]s$/.test(lw)) out.push(lw.slice(0, -2));
    formCache[lw] = out;
    return out;
  }

  /* 修正表里的多词短语，按词数从多到少排好，匹配时先试长的 */
  var enPhrases = [];
  enFix.forEach(function (v, k) {
    if (k.indexOf(' ') > 0) enPhrases.push({ w: k.split(' '), v: v });
  });
  enPhrases.sort(function (a, b) { return b.w.length - a.w.length; });

  /* 在 words 这段里从第 0 个开始试短语匹配；命中返回短语对象 */
  function matchPhrase(words) {
    for (var p = 0; p < enPhrases.length; p++) {
      var ph = enPhrases[p];
      if (ph.w.length > words.length) continue;
      var all = true;
      for (var k = 0; k < ph.w.length; k++) {
        if (wordForms(words[k]).indexOf(ph.w[k]) < 0) { all = false; break; }
      }
      if (all) return ph;
    }
    return null;
  }

  /* 翻译一个英文词：null=词典没有；''=命中但无需输出（冠词等）；其它=中文 */
  function translateEnWord(word) {
    var forms = wordForms(word);
    var i, v;
    for (i = 0; i < forms.length; i++) {
      if (enFix.has(forms[i])) return enFix.get(forms[i]);
    }
    v = en2cn.get(forms[0]);
    if (v) return firstSense(v);
    for (i = 1; i < forms.length; i++) {
      if (enFix.has(forms[i])) return enFix.get(forms[i]);
    }
    for (i = 1; i < forms.length; i++) {
      v = en2cn.get(forms[i]);
      if (v) return firstSense(v);
    }
    return null;
  }

  function lookupEn(word) {
    var r = translateEnWord(word);
    return r == null ? '' : r;
  }

  /* 收尾整理：合并多余空格、去掉行首空格和标点前的空格 */
  function tidyItems(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind === 'gap') {
        var prev = out[out.length - 1];
        var next = items[i + 1];
        if (!prev || prev.kind === 'gap' || prev.kind === 'brk') continue;
        if (!next || next.kind === 'punct' || next.kind === 'brk' || next.kind === 'gap') continue;
        out.push(it);
      } else {
        out.push(it);
      }
    }
    return out;
  }

  /* =========================================================
     5. 中文 → 英文（实验性，最长匹配）
     ========================================================= */
  /* 高频字/词的英文优先表：反查词典里「家」的首选是 move，
     这类常见字用固定译法比按词频挑更靠谱 */
  var ZH_OVERRIDE = {
    '我': 'I', '你': 'you', '他': 'he', '她': 'she', '它': 'it', '我们': 'we', '你们': 'you', '他们': 'they',
    '是': 'is', '不': 'not', '有': 'have', '的': 'of', '在': 'at', '和': 'and', '也': 'also', '都': 'all',
    '人': 'person', '家': 'home', '上': 'up', '下': 'down', '中': 'middle', '大': 'big', '小': 'small',
    '好': 'good', '多': 'many', '少': 'few', '说': 'say', '去': 'go', '来': 'come', '看': 'look',
    '吃': 'eat', '喝': 'drink', '学': 'study', '买': 'buy', '做': 'do', '想': 'think', '要': 'want',
    '爱': 'love', '天': 'day', '日': 'day', '月': 'month', '年': 'year', '时': 'time', '间': 'space',
    '水': 'water', '火': 'fire', '山': 'mountain', '门': 'door', '车': 'car', '书': 'book',
    '工作': 'work', '学习': 'study', '今天': 'today', '明天': 'tomorrow', '昨天': 'yesterday',
    '早上': 'morning', '晚上': 'evening', '中午': 'noon', '现在': 'now', '中国': 'China',
    '北京': 'Beijing', '上海': 'Shanghai', '天安门': 'Tiananmen', '朋友': 'friend', '老师': 'teacher',
    '学生': 'student', '学校': 'school', '城市': 'city', '春天': 'spring', '天气': 'weather'
  };

  function buildZh2En(text) {
    var chars = Array.from(text);
    var items = [];
    var st = { zh: 0, en: 0, enOk: 0, other: 0, missEn: [], missOther: [], mode: 'zh2en' };
    var i = 0;
    var pendingSpace = false;
    while (i < chars.length) {
      var c = chars[i];
      var k = kindOf(c);
      if (k === 'zh') {
        st.zh++;
        var hit = null, len = 0, en = '';
        for (var L = 6; L >= 1; L--) {
          if (i + L > chars.length) continue;
          var seg = chars.slice(i, i + L).join('');
          if (Object.prototype.hasOwnProperty.call(ZH_OVERRIDE, seg)) {
            hit = seg; len = L; en = ZH_OVERRIDE[seg]; break;
          }
          if (cn2en.has(seg)) {
            hit = seg; len = L; en = cn2en.get(seg)[0]; break;
          }
        }
        if (pendingSpace && items.length) items.push({ kind: 'gap' });
        pendingSpace = false;
        if (hit) {
          items.push({ kind: 'plain', ch: en });
          st.enOk++;
          i += len;
        } else {
          items.push({ kind: 'foreign', ch: c });
          st.missOther.push(c);
          i++;
        }
      } else if (k === 'space') {
        pendingSpace = true;
        if (c === '\n') items.push({ kind: 'brk' });
        i++;
      } else if (k === 'punct') {
        if (pendingSpace && items.length) items.push({ kind: 'gap' });
        pendingSpace = false;
        items.push({ kind: 'punct', ch: c });
        i++;
      } else if (k === 'en' || k === 'num') {
        var w = '';
        while (i < chars.length && (kindOf(chars[i]) === 'en' || kindOf(chars[i]) === 'num')) { w += chars[i]; i++; }
        if (pendingSpace && items.length) items.push({ kind: 'gap' });
        pendingSpace = false;
        items.push({ kind: 'plain', ch: w });
      } else {
        if (pendingSpace && items.length) items.push({ kind: 'gap' });
        pendingSpace = false;
        items.push({ kind: 'foreign', ch: c });
        st.missOther.push(c);
        i++;
      }
    }
    return { items: items, stats: st };
  }

  /* =========================================================
     6. 构造输出（日常模式）
     ========================================================= */
  function pushZhString(items, s) {
    Array.from(s).forEach(function (c) {
      var k = kindOf(c);
      if (k === 'zh') items.push({ kind: 'zh', ch: c });
      else if (k === 'punct') items.push({ kind: 'punct', ch: c });
      else items.push({ kind: 'plain', ch: c });
    });
  }

  /* 联网翻译回来的中文：有汉字就照常标五笔码，但没有「离线词典」的意思，
     渲染时加 cell-net 以示区别 */
  function pushNetString(items, s) {
    Array.from(s).forEach(function (c) {
      var k = kindOf(c);
      if (k === 'zh') items.push({ kind: 'zhnet', ch: c });
      else if (k === 'punct') items.push({ kind: 'punct', ch: c });
      else items.push({ kind: 'plain', ch: c });
    });
  }

  /* 把整段英文按「连续的英文词（含中间空格）」切成若干段，
     联网翻译按段发送，返回 [{start, len, text, words}] */
  function enRuns(text) {
    var toks = tokenize(text);
    var runs = [], cur = null, pos = 0;
    function close() {
      if (!cur) return;
      var t = cur.text.replace(/\s+$/, '');
      cur.text = t;
      cur.len = t.length;
      cur = null;
    }
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.t === 'en') {
        if (!cur) { cur = { start: pos, len: 0, text: '', words: 0 }; runs.push(cur); }
        cur.text += t.v; cur.len += t.v.length; cur.words++;
      } else if (t.t === 'space' && cur) {
        cur.text += t.v; cur.len += t.v.length;
      } else {
        close();
      }
      pos += t.v.length;
    }
    close();
    return runs.filter(function (r) { return r.words > 0 && r.len > 0; });
  }

  /* repl: { 源文本起始下标: {len, zh, words} } —— 联网翻译的结果，按段替换 */
  function buildOutput(text, mode, repl) {
    if (mode === 'zh2en') return buildZh2En(text);

    var toks = tokenize(text);
    var items = [];
    var st = { zh: 0, en: 0, enOk: 0, other: 0, missEn: [], missOther: [], mode: mode, net: 0, netSeg: 0 };

    // 每个 token 在原文里的起始下标，用来和 repl 的键对齐
    var tokPos = [], pp = 0;
    for (var q = 0; q < toks.length; q++) { tokPos.push(pp); pp += toks[q].v.length; }

    /* 从 i 开始，收集「中间只隔空格」的相邻英文词，最多 max 个。
       返回 { words:[...], idxs:[每个词的 token 下标] } */
    function gatherWords(i, max) {
      var words = [toks[i].v];
      var idxs = [i];
      var k = i;
      while (words.length < max) {
        var j = k + 1;
        while (j < toks.length && toks[j].t === 'space') j++;
        if (j >= toks.length || toks[j].t !== 'en') break;
        words.push(toks[j].v);
        idxs.push(j);
        k = j;
      }
      return { words: words, idxs: idxs };
    }

    var i = 0;
    while (i < toks.length) {
      var tok = toks[i];
      switch (tok.t) {
        case 'zh':
          st.zh++;
          items.push({ kind: 'zh', ch: tok.v });
          i++;
          break;
        case 'punct':
          items.push({ kind: 'punct', ch: tok.v });
          i++;
          break;
        case 'num':
          items.push({ kind: 'num', ch: tok.v });
          i++;
          break;
        case 'space':
          items.push({ kind: tok.v.indexOf('\n') >= 0 ? 'brk' : 'gap' });
          i++;
          break;
        case 'other':
          st.other++;
          items.push({ kind: 'foreign', ch: tok.v });
          st.missOther.push(tok.v);
          i++;
          break;
        case 'en':
          if (mode === 'zh-only') {
            st.en++;
            items.push({ kind: 'plain', ch: tok.v });
            i++;
            break;
          }
          // 这一段英文已经有联网翻译结果 → 整段替换成中文
          if (repl && repl[tokPos[i]]) {
            var rp = repl[tokPos[i]];
            var endPos = tokPos[i] + rp.len;
            var jj = i;
            while (jj < toks.length && tokPos[jj] < endPos) jj++;
            st.en += rp.words;
            st.enOk += rp.words;
            st.net += rp.words;
            st.netSeg++;
            pushNetString(items, rp.zh);
            i = jj;
            break;
          }
          // 先试多词短语（look forward to / as soon as ...）
          var got = gatherWords(i, Math.max(2, enFixMaxWords));
          var ph = got.words.length >= 2 ? matchPhrase(got.words) : null;
          if (ph) {
            st.en += ph.w.length;
            st.enOk += ph.w.length;
            if (ph.v) pushZhString(items, ph.v);
            // 只跳过多词短语自身占用的词，后面的词还要继续翻译
            i = got.idxs[ph.w.length - 1] + 1;
            break;
          }
          // 单词
          st.en++;
          var zh = translateEnWord(tok.v);
          if (zh === null) {
            items.push({ kind: 'foreign', ch: tok.v });
            st.missEn.push(tok.v);
          } else {
            st.enOk++;
            if (zh) pushZhString(items, zh);
          }
          i++;
          break;
      }
    }

    return { items: tidyItems(items), stats: st };
  }

  /* =========================================================
     7. 渲染
     ========================================================= */

  /* 联网翻译状态：手机版 mobile.js 通过 window.__app.setNetState 设置，
     这里只负责显示；电脑版永远是空字符串 */
  var netPhase = '';
  var netMsg = '';

  /* 联网翻译结果：{ text: 原文, map: {起始下标: {len, zh, words}} } */
  var onlineRepl = null;
  var lastStats = null;
  var suppressHook = false;

  function cellEl(ch, code, cls) {
    var cell = el('span', 'cell' + (cls ? ' ' + cls : ''));
    var c = el('span', 'code', code || '');
    var h = el('span', 'ch', ch);
    cell.appendChild(c);
    cell.appendChild(h);
    return cell;
  }

  var CELL_CLASS = {
    zh: '',
    zhnet: 'cell-net',
    punct: 'cell-punct',
    num: 'cell-punct',
    plain: 'cell-plain',
    foreign: 'cell-foreign'
  };

  function itemsEl(items) {
    var wrap = el('div', 'out-line');
    items.forEach(function (it) {
      if (it.kind === 'gap') {
        wrap.appendChild(el('span', 'gap'));
      } else if (it.kind === 'brk') {
        wrap.appendChild(el('span', 'brk'));
      } else {
        var withCode = it.kind === 'zh' || it.kind === 'zhnet';
        var code = withCode ? (wubi.get(it.ch) || '') : '';
        var cls = CELL_CLASS[it.kind] || '';
        if (withCode && !code) cls = 'cell-nocode';
        wrap.appendChild(cellEl(it.ch, code, cls));
      }
    });
    return wrap;
  }

  function placeholderEl(text) {
    return el('div', 'placeholder', text);
  }

  function uniqList(arr, max) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length && out.length < max; i++) {
      var s = arr[i];
      if (!s || seen[s]) continue;
      seen[s] = 1;
      out.push(s);
    }
    var more = arr.length > out.length ? ' 等 ' + arr.length + ' 处' : '';
    return out.join('、') + more;
  }

  function noticeEl(kind, text) {
    var n = el('div', 'notice' + (kind ? ' notice-' + kind : ''));
    n.appendChild(el('span', 'dot', kind === 'bad' ? '✕' : (kind === 'ok' ? '✓' : '!')));
    n.appendChild(el('span', '', text));
    return n;
  }

  function tagText(st) {
    var parts = [];
    if (st.mode === 'zh2en') {
      parts.push('中→英 ' + st.enOk + ' 词');
    } else {
      if (st.zh) parts.push('五笔标注 ' + st.zh + ' 字');
      if (st.en) {
        if (st.mode === 'zh-only') parts.push('英文 ' + st.en + ' 词（原样）');
        else if (st.net) parts.push('英文 联网 ' + st.net + ' 词');
        else parts.push('英文 ' + st.enOk + '/' + st.en + ' 词');
      }
      if (st.other) parts.push('其他字符 ' + st.other + ' 处');
    }
    return parts.join(' · ');
  }

  function renderNotices(wrap, st) {
    wrap.innerHTML = '';
    var frag = document.createDocumentFragment();

    if (st.missOther.length) {
      frag.appendChild(noticeEl('bad',
        st.mode === 'zh2en'
          ? '这些字词汉英词典里没有，已按原样输出：' + uniqList(st.missOther, 12)
          : '无法理解（其他语言或不明字符），已按原样输出：' + uniqList(st.missOther, 12)));
    }
    if (st.missEn.length) {
      frag.appendChild(noticeEl('',
        '以下英文词未收录，已按原样输出：' + uniqList(st.missEn, 12)));
    }
    // 联网失败时已经提示「已用离线词典」，不再重复报离线翻译成功
    if (st.enOk > 0 && st.mode !== 'zh-only' && !(netPhase === 'fail' && !st.net)) {
      frag.appendChild(noticeEl('ok',
        st.mode === 'zh2en'
          ? '中文已译为英文：' + st.enOk + ' 个词。'
          : (st.net
            ? '英文已联网翻译：' + st.net + ' 个词。'
            : '英文已翻译成中文：' + st.enOk + ' 个词。')));
    }
    // 联网状态（由手机版 mobile.js 通过 setNetState 设置）
    if (netPhase === 'loading') {
      frag.appendChild(noticeEl('', netMsg || '正在联网翻译…'));
    } else if (netPhase === 'fail') {
      frag.appendChild(noticeEl('bad', netMsg || '联网翻译失败，已用离线词典。'));
    }
    wrap.appendChild(frag);
  }

  /* =========================================================
     8. 日常模式
     ========================================================= */
  var srcInput, outBody, outTag, noticeWrap, langSel, outPanel;

  function renderNormal() {
    var text = srcInput.value;
    var mode = langSel.value;
    outBody.innerHTML = '';
    noticeWrap.innerHTML = '';
    outTag.textContent = '';

    if (!text) {
      lastStats = null;
      outBody.appendChild(placeholderEl('在上面的输入框里输入文字，这里会给出输出'));
      if (!suppressHook) fireNetHook('', mode);
      return;
    }

    var repl = (onlineRepl && onlineRepl.text === text) ? onlineRepl.map : null;
    var r = buildOutput(text, mode, repl);
    lastStats = r.stats;
    outBody.appendChild(itemsEl(r.items));
    outTag.textContent = tagText(r.stats);
    renderNotices(noticeWrap, r.stats);

    if (!suppressHook) fireNetHook(text, mode);
  }

  function fireNetHook(text, mode) {
    try {
      if (typeof window.__netHook === 'function') window.__netHook(text, mode);
    } catch (e) { /* 联网是附加功能，出错不能影响主流程 */ }
  }

  function clearAll() {
    srcInput.value = '';
    renderNormal();
    srcInput.focus();
  }

  /* =========================================================
     9. 练习模式
     ========================================================= */
  var learn = {
    idx: 0,
    typed: '',
    status: [],
    startTime: 0,
    finished: false
  };

  var opt = { hint: true, compare: false };

  var articleBody, articleTitle, articleMeta, articleStats, articleSel,
      learnInput, progressFill, progressNum, learnNoticeWrap;

  function articleChars() {
    return articles.length ? Array.from(articles[learn.idx].text) : [];
  }

  function simulate() {
    var chars = articleChars();
    var typed = Array.from(learn.typed);
    // 输入法拼字中间态：末尾还在打拼音字母时不参与比对，
    // 等选字提交、字母被汉字替换后自然就正常比对了。
    while (typed.length && /[A-Za-z]/.test(typed[typed.length - 1])) typed.pop();
    var st = new Array(chars.length).fill('pending');
    var ai = 0, ti = 0;
    while (ai < chars.length) {
      var ac = chars[ai];
      if (isSkipChar(ac)) {
        if (ti < typed.length && typed[ti] === ac) ti++;
        st[ai] = 'auto';
        ai++;
        continue;
      }
      if (ti >= typed.length) break;
      st[ai] = typed[ti] === ac ? 'correct' : 'wrong';
      ai++;
      ti++;
    }
    learn.status = st;
  }

  function currentIndex() {
    for (var i = 0; i < learn.status.length; i++) {
      if (learn.status[i] === 'pending') return i;
    }
    return -1;
  }

  function counts() {
    var total = 0, done = 0, wrong = 0;
    var chars = articleChars();
    for (var i = 0; i < chars.length; i++) {
      if (isSkipChar(chars[i])) continue;
      total++;
      var s = learn.status[i];
      if (s === 'correct') done++;
      else if (s === 'wrong') { done++; wrong++; }
    }
    return { total: total, done: done, wrong: wrong };
  }

  function codeVisible(i) {
    if (opt.compare) return true;
    if (!opt.hint) return false;
    var s = learn.status[i];
    return s === 'correct' || s === 'wrong' || s === 'auto';
  }

  var lastCur = -2;

  function renderArticle() {
    if (!articles.length) return;
    var chars = articleChars();
    var cur = currentIndex();
    var body = articleBody;
    body.innerHTML = '';
    var line = el('div', 'out-line');

    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      var s = learn.status[i];
      var cls = '';
      if (isSkipChar(ch)) cls += ' cell-punct';
      if (s === 'correct') cls += ' cell-correct';
      else if (s === 'wrong') cls += ' cell-wrong';
      else if (s === 'auto') cls += ' cell-auto';
      if (i === cur) cls += ' cell-current';

      var code = codeVisible(i) ? (wubi.get(ch) || '') : '';
      var cell = cellEl(ch, code, cls.trim());
      cell.dataset.i = String(i);
      line.appendChild(cell);
    }
    body.appendChild(line);

    if (cur !== lastCur && cur >= 0) {
      var target = line.children[cur];
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    lastCur = cur;
  }

  function updateStats() {
    var c = counts();
    var pct = c.total ? Math.round(c.done / c.total * 100) : 0;
    if (progressFill) progressFill.style.width = pct + '%';
    if (progressNum) progressNum.textContent = c.done + ' / ' + c.total;
    if (articleStats) {
      articleStats.innerHTML = '';
      articleStats.appendChild(el('b', '', c.done + '/' + c.total));
      articleStats.appendChild(document.createTextNode(' 字'));
      if (c.wrong) {
        articleStats.appendChild(document.createTextNode(' · 错 '));
        articleStats.appendChild(el('span', 'err', String(c.wrong)));
      }
    }
  }

  function renderLearnNotice() {
    if (!learnNoticeWrap) return;
    learnNoticeWrap.innerHTML = '';
    var c = counts();
    if (c.total && c.done >= c.total) {
      var sec = learn.startTime ? ((Date.now() - learn.startTime) / 1000).toFixed(1) : '0';
      var txt = c.wrong === 0
        ? '本篇完成，用时 ' + sec + ' 秒，全部正确！'
        : '本篇完成，用时 ' + sec + ' 秒，错了 ' + c.wrong + ' 个字。';
      learnNoticeWrap.appendChild(noticeEl(c.wrong === 0 ? 'ok' : '', txt + ' 点「重来」可以再练一次。'));
    }
  }

  function resetLearn(focus) {
    learn.typed = '';
    learn.status = [];
    learn.startTime = 0;
    learn.finished = false;
    lastCur = -2;
    if (learnInput) learnInput.value = '';
    simulate();
    renderArticle();
    updateStats();
    if (learnNoticeWrap) learnNoticeWrap.innerHTML = '';
    if (focus && learnInput) learnInput.focus();
  }

  function loadArticle(idx) {
    learn.idx = Math.max(0, Math.min(idx, articles.length - 1));
    var art = articles[learn.idx];
    if (art) {
      if (articleTitle) articleTitle.textContent = art.title;
      if (articleMeta) articleMeta.textContent = '第 ' + (learn.idx + 1) + ' / ' + articles.length + ' 篇';
    }
    resetLearn(false);
  }

  function onLearnInput() {
    learn.typed = learnInput.value;
    if (!learn.startTime && learn.typed.length) learn.startTime = Date.now();
    simulate();
    renderArticle();
    updateStats();
    renderLearnNotice();
  }

  /* =========================================================
     10. 模式切换
     ========================================================= */
  var MODE = { normal: false, learn: false };
  var modeBtn, modeBtnText, modeBtnIcon;
  var paneInput, paneArticle, paneOutput, paneLearnInput;
  var tbNormal, tbLearn;

  function applyMode(mode) {
    var isLearn = mode === 'learn';
    paneInput.hidden = isLearn;
    paneArticle.hidden = !isLearn;
    paneOutput.hidden = isLearn;
    paneLearnInput.hidden = !isLearn;
    tbNormal.hidden = isLearn;
    tbLearn.hidden = !isLearn;

    modeBtnText.textContent = isLearn ? '日常 返回' : '练习 learn';
    modeBtnIcon.textContent = isLearn ? '↩' : '◎';
    modeBtn.title = isLearn ? '回到日常输入 / 输出' : '进入文章打字练习';

    if (isLearn) {
      if (!learn.status.length) loadArticle(learn.idx);
      else { renderArticle(); updateStats(); }
      learnInput.focus();
    } else {
      srcInput.focus();
    }
  }

  function toggleMode() {
    applyMode(MODE.learn ? 'normal' : 'learn');
    MODE.learn = !MODE.learn;
  }

  /* =========================================================
     11. 自检（打开 index.html?selftest=1 触发）
     ========================================================= */
  function runSelfTest() {
    var out = [];
    var pass = 0, fail = 0;
    function ok(name, cond, extra) {
      if (cond) { pass++; out.push('PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
      else { fail++; out.push('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
    }

    ok('五笔包已加载', wubi.size > 20000, wubi.size + ' 字');
    ok('五笔 上=hhgg', wubi.get('上') === 'HHGG', wubi.get('上'));
    ok('五笔 的=rqyy', wubi.get('的') === 'RQYY', wubi.get('的'));
    ok('五笔 下=ghi', wubi.get('下') === 'GHI', wubi.get('下'));
    ok('英汉包已加载', en2cn.size > 40000, en2cn.size + ' 词');
    ok('英汉 the→那（词典原值）', en2cn.get('the') === '那', en2cn.get('the'));
    ok('英汉 love→爱', /爱/.test(lookupEn('love')), lookupEn('love'));
    ok('词形还原 studies', lookupEn('studies') !== '', lookupEn('studies'));
    ok('汉英包已加载', cn2en.size > 40000, cn2en.size + ' 词');
    ok('常用字 1000', commonSet.size === 1000, String(commonSet.size));
    ok('文章 10 篇', articles.length === 10, String(articles.length));

    // 文章用字校验
    var badChar = [], notCommon = [];
    articles.forEach(function (a, ai) {
      Array.from(a.text).forEach(function (c) {
        if (isSkipChar(c)) return;
        if (!wubi.has(c)) badChar.push(a.title + ':' + c);
        if (!commonSet.has(c)) notCommon.push(a.title + ':' + c);
      });
    });
    ok('文章用字都有五笔码', badChar.length === 0, badChar.slice(0, 5).join(','));
    ok('文章用字都在常用 1000 内', notCommon.length === 0, notCommon.slice(0, 5).join(','));

    // 纯中文
    var r1 = buildOutput('我是中国人', 'auto');
    ok('中文输出 5 个字格', r1.items.filter(function (x) { return x.kind === 'zh'; }).length === 5);
    ok('中文每个字都有码', r1.items.filter(function (x) { return x.kind === 'zh'; })
      .every(function (x) { return !!wubi.get(x.ch); }));

    // 纯英文
    var r2 = buildOutput('I love you', 'auto');
    ok('英文翻译成中文', r2.stats.enOk === 3, JSON.stringify(r2.stats));
    ok('英文译文含汉字', r2.items.some(function (x) { return x.kind === 'zh'; }));

    // 其他语言
    var r3 = buildOutput('こんにちは', 'auto');
    ok('日文判定为无法理解', r3.stats.missOther.length > 0, String(r3.stats.other));

    // 混排
    var r4 = buildOutput('我爱 you，hello 世界', 'auto');
    ok('混排：中文 4 字', r4.items.filter(function (x) { return x.kind === 'zh'; }).length >= 4, String(r4.stats.zh));
    ok('混排：英文 2 词已译', r4.stats.enOk === 2, JSON.stringify(r4.stats.enOk));

    // 只标注五笔
    var r5 = buildOutput('hello 中文', 'zh-only');
    ok('只标注五笔不翻译', r5.stats.enOk === 0 && r5.items.some(function (x) { return x.kind === 'plain'; }));

    // 中→英
    var r6 = buildOutput('我爱你', 'zh2en');
    ok('中→英有输出', r6.items.length > 0 && r6.stats.enOk > 0, JSON.stringify(r6.stats));

    // 标点
    var r7 = buildOutput('你好，世界。', 'auto');
    ok('标点单独成格', r7.items.filter(function (x) { return x.kind === 'punct'; }).length === 2);

    // 英文修正表
    ok('修正表已加载', enFix.size >= 200, enFix.size + ' 条');
    function zhOf(r) {
      return r.items.map(function (x) { return x.ch; }).join('');
    }

    var f1 = buildOutput('The quick brown fox jumps over the lazy dog.', 'auto');
    var t1 = zhOf(f1);
    ok('冠词 the/a/an 不输出', t1.indexOf('那') < 0 && t1.indexOf('第一个字母') < 0, t1);
    ok('over 译作「越过」', t1.indexOf('越过') >= 0, t1);
    ok('英文句无漏译词', f1.stats.enOk === f1.stats.en, f1.stats.enOk + '/' + f1.stats.en);

    var f2 = buildOutput('He is a student and I am a teacher.', 'auto');
    var t2 = zhOf(f2);
    ok('is / am 都译作「是」', t2.split('是').length - 1 === 2, t2);
    ok('student / teacher 译对', t2.indexOf('学生') >= 0 && t2.indexOf('老师') >= 0, t2);

    var f3 = buildOutput('I look forward to your reply.', 'auto');
    var t3 = zhOf(f3);
    ok('短语 look forward to 命中', t3.indexOf('期待') >= 0, t3);

    var f4 = buildOutput("I don't know.", 'auto');
    var t4 = zhOf(f4);
    ok("缩写 don't 译作「不」", t4.indexOf('不知道') >= 0, t4);

    var f5 = buildOutput('We will get up at six tomorrow morning.', 'auto');
    var t5 = zhOf(f5);
    ok('短语 get up 命中', t5.indexOf('起床') >= 0, t5);
    ok('will 译作「将」', t5.indexOf('将') >= 0, t5);

    var f6 = buildOutput('  多余  空格  ', 'auto');
    ok('多余空格被合并', f6.items.filter(function (x) { return x.kind === 'gap'; }).length === 1,
      JSON.stringify(f6.items.map(function (x) { return x.kind; })));

    // 短语命中后，后面的词不能被吞掉
    var f7 = buildOutput('I want to make friends with you.', 'auto');
    var t7 = zhOf(f7);
    ok('短语后不吞词', t7.indexOf('你') >= 0, t7);
    ok('整句无漏译词', f7.stats.enOk === f7.stats.en, f7.stats.enOk + '/' + f7.stats.en);

    // 联网翻译：分段 + 按段替换
    var nr = enRuns('I love you，我很好。Hello world!');
    ok('联网分段：切出 2 段英文', nr.length === 2,
      JSON.stringify(nr.map(function (x) { return x.text; })));
    ok('联网分段：位置与长度对得上原文', nr[0].start === 0 && nr[0].len === 10,
      nr[0].start + '/' + nr[0].len);
    var nr2 = enRuns('  中文 hello world 中文  ');
    ok('联网分段：只取英文段', nr2.length === 1 && nr2[0].text === 'hello world',
      JSON.stringify(nr2));

    var rp = {};
    rp[0] = { len: 10, zh: '我爱你', words: 3 };
    var f8 = buildOutput('I love you，我很好。', 'auto', rp);
    var t8 = zhOf(f8);
    ok('联网替换生效', t8.indexOf('我爱你') >= 0, t8);
    ok('联网替换后中文照常标五笔',
      f8.items.filter(function (x) { return x.kind === 'zhnet'; }).length === 3, JSON.stringify(f8.stats));
    ok('联网替换不吞后面的中文', t8.indexOf('我很好') >= 0, t8);
    var f9 = buildOutput('I love you', 'zh-only', rp);
    ok('仅标注五笔时不做联网替换', f9.stats.net === 0, JSON.stringify(f9.stats));

    // 练习模拟：第一篇开头是「早上六点，」，打前 5 个字符 = 4 个汉字 + 1 个标点
    learn.idx = 0;
    learn.typed = Array.from(articles[0].text).slice(0, 5).join('');
    simulate();
    var c = counts();
    ok('练习模拟：标点自动跳过，已打 4 字', c.done === 4 && c.wrong === 0, JSON.stringify(c));

    // 打错字
    learn.typed = '早上七点';
    simulate();
    var c2 = counts();
    ok('练习模拟：错字被标记', c2.wrong === 1 && c2.done === 4, JSON.stringify(c2));

    out.unshift('==== 自检结果：' + pass + ' 通过 / ' + fail + ' 失败 ====');
    out.push('资源包：五笔 ' + wubi.size + ' 字 / 英汉 ' + en2cn.size + ' 词 / 汉英 ' + cn2en.size + ' 词 / 常用 ' + commonSet.size + ' 字 / 文章 ' + articles.length + ' 篇');

    var pre = el('pre', '', out.join('\n'));
    pre.id = 'selftest';
    document.body.insertBefore(pre, document.body.firstChild);
  }

  /* =========================================================
     12. 启动
     ========================================================= */
  function init() {
    srcInput = $('srcInput');
    outBody = $('outBody');
    outTag = $('outTag');
    noticeWrap = $('noticeWrap');
    langSel = $('langSel');
    outPanel = $('paneOutput');

    articleBody = $('articleBody');
    articleTitle = $('articleTitle');
    articleMeta = $('articleMeta');
    articleStats = $('articleStats');
    articleSel = $('articleSel');
    learnInput = $('learnInput');
    progressFill = $('progressFill');
    progressNum = $('progressNum');
    learnNoticeWrap = $('learnNoticeWrap');

    modeBtn = $('modeBtn');
    modeBtnText = $('modeBtnText');
    modeBtnIcon = $('modeBtnIcon');
    paneInput = $('paneInput');
    paneArticle = $('paneArticle');
    paneOutput = $('paneOutput');
    paneLearnInput = $('paneLearnInput');
    tbNormal = $('tbNormal');
    tbLearn = $('tbLearn');

    // 资源包概况
    var info = $('packInfo');
    if (info) {
      info.innerHTML = '';
      info.appendChild(el('div', '', '五笔 ' + wubi.size.toLocaleString() + ' 字'));
      info.appendChild(el('div', '', '英汉 ' + en2cn.size.toLocaleString() + ' 词'));
      info.appendChild(el('div', '', '常用 ' + commonSet.size.toLocaleString() + ' 字 · 文章 ' + articles.length + ' 篇'));
    }

    // 文章下拉
    if (articleSel) {
      articleSel.innerHTML = '';
      articles.forEach(function (a, i) {
        var o = el('option', '', (i + 1) + '. ' + a.title);
        o.value = String(i);
        articleSel.appendChild(o);
      });
    }

    // 事件
    srcInput.addEventListener('input', renderNormal);
    langSel.addEventListener('change', renderNormal);
    $('clearBtn').addEventListener('click', clearAll);
    modeBtn.addEventListener('click', toggleMode);

    articleSel.addEventListener('change', function () {
      loadArticle(parseInt(articleSel.value, 10) || 0);
      learnInput.focus();
    });

    $('restartBtn').addEventListener('click', function () { resetLearn(true); });

    var compareBtn = $('compareBtn');
    var hintBtn = $('hintBtn');

    function syncToggles() {
      compareBtn.textContent = '答案对照模式 ' + (opt.compare ? '开' : '关');
      compareBtn.classList.toggle('btn-on', opt.compare);
      compareBtn.setAttribute('aria-pressed', String(opt.compare));
      hintBtn.textContent = '逐字五笔提示 ' + (opt.hint ? '开' : '关');
      hintBtn.classList.toggle('btn-on', opt.hint);
      hintBtn.setAttribute('aria-pressed', String(opt.hint));
    }

    compareBtn.addEventListener('click', function () {
      opt.compare = !opt.compare;
      syncToggles();
      renderArticle();
    });

    hintBtn.addEventListener('click', function () {
      opt.hint = !opt.hint;
      syncToggles();
      renderArticle();
    });

    learnInput.addEventListener('input', onLearnInput);

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        toggleMode();
      }
    });

    syncToggles();

    // 支持 index.html?text=你好hello 预填输入框（方便演示与自测）
    var m = /[?&]text=([^&]*)/.exec(location.search);
    if (m) {
      try { srcInput.value = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e2) { srcInput.value = m[1]; }
    }
    // 支持 index.html?out=zh2en / ?out=zh-only 预设输出方式
    var mo = /[?&]out=([^&]*)/.exec(location.search);
    if (mo) {
      var ov = mo[1];
      if (ov === 'zh2en' || ov === 'zh-only' || ov === 'auto') langSel.value = ov;
    }
    // 支持 index.html?mode=learn 直接进入练习模式
    var wantLearn = /[?&]mode=learn/.test(location.search);

    renderNormal();
    if (articles.length) loadArticle(0);
    applyMode(wantLearn ? 'learn' : 'normal');
    MODE.learn = wantLearn;

    // 支持 index.html?mode=learn&typed=已打的字 预填练习输入（方便演示与自测）
    var mt = /[?&]typed=([^&]*)/.exec(location.search);
    if (mt && wantLearn) {
      var tv = '';
      try { tv = decodeURIComponent(mt[1].replace(/\+/g, ' ')); } catch (e3) { tv = mt[1]; }
      learnInput.value = tv;
      onLearnInput();
    }
    if (/[?&]compare=1/.test(location.search)) {
      opt.compare = true;
      syncToggles();
      renderArticle();
    }

    if (location.search.indexOf('selftest') >= 0) runSelfTest();

    // 供外部调试 / 自检使用
    window.__app = {
      wubi: wubi, en2cn: en2cn, cn2en: cn2en, enFix: enFix,
      commonSet: commonSet, articles: articles,
      tokenize: tokenize, buildOutput: buildOutput,
      lookupEn: lookupEn, simulate: simulate, counts: counts,
      learn: learn, opt: opt,
      enRuns: enRuns,
      /* 手机版联网翻译用：把 {起始下标:{len,zh,words}} 应用到输出上并重绘 */
      setOnlineRepl: function (text, map) {
        onlineRepl = (text == null) ? null : { text: text, map: map || {} };
        suppressHook = true;
        try { renderNormal(); } finally { suppressHook = false; }
      },
      /* 手机版联网翻译用：'loading' / 'fail' / '' */
      setNetState: function (phase, msg) {
        netPhase = phase || '';
        netMsg = msg || '';
        if (lastStats) renderNotices(noticeWrap, lastStats);
      },
      hasOnlineRepl: function () { return !!onlineRepl; },
      getNetState: function () { return { phase: netPhase, msg: netMsg }; }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
