/* ==========================================================================
   КНИГА ВЯЗАНИЯ СПИЦАМИ — Интерактивное ядро AgeTech-каталога (Vanilla JS)
   ========================================================================== */

(function () {
  "use strict";

  var STORAGE_KEY = "kniga_vyazaniya_state_v1";
  var CATALOG = window.KNITTING_CATALOG || { categories: [], articles: [] };

  // Состояние пользователя (сохраняется в памяти браузера без регистрации)
  var defaultState = {
    fontScale: "normal", // 'normal' (20px) | 'large' (23px) | 'xlarge' (26px)
    theme: "day",        // 'day' | 'evening'
    favorites: [],       // массив slug
    counters: {},        // { [slug]: { activePart: string, values: { [partId]: number }, collapsed: false } }
    checkedSteps: {},    // { [slug]: { [stepId]: true } }
    rulerPositions: {},  // { [chartId]: number (px или %) }
    rulerVisible: true,
    lastOpened: null,    // { slug: string, updatedAt: number }
    ttsRate: 0.85,       // спокойный темп речи по умолчанию
    wakeLockEnabled: true
  };

  var state = loadState();

  // Оперативное состояние текущей страницы, озвучки, Wake Lock и окна схемы
  var runtime = {
    currentRoute: { view: "home", param: null },
    searchQuery: "",
    wakeLockSentinel: null,
    wakeLockSupported: "wakeLock" in navigator,
    wakeLockActive: false,
    tts: {
      supported: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
      speaking: false,
      paused: false,
      articleSlug: null,
      stepsQueue: [], // [{ stepId, label, sectionTitle, text }]
      currentIndex: 0,
      keepAliveTimer: null
    },
    chartModal: {
      isOpen: false,
      articleSlug: null,
      chartId: null,
      fitScale: 1,
      scale: 1,
      tx: 0,
      ty: 0,
      imgW: 1000,
      imgH: 1000
    },
    pendingConfirmAction: null,
    toastTimer: null
  };

  // ==========================================================================
  // 1. ХРАНИЛИЩЕ НАСТРОЕК И ДАННЫХ (localStorage)
  // ==========================================================================

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return cloneDefaults();
      var parsed = JSON.parse(raw);
      var merged = cloneDefaults();
      Object.keys(merged).forEach(function (k) {
        if (parsed[k] !== undefined && parsed[k] !== null) {
          merged[k] = parsed[k];
        }
      });
      return merged;
    } catch (e) {
      return cloneDefaults();
    }
  }

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(defaultState));
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // Игнорируем переполнение в приватном режиме
    }
  }

  function getArticleBySlug(slug) {
    for (var i = 0; i < CATALOG.articles.length; i++) {
      if (CATALOG.articles[i].slug === slug) return CATALOG.articles[i];
    }
    return null;
  }

  function getCategoryById(catId) {
    for (var i = 0; i < CATALOG.categories.length; i++) {
      if (CATALOG.categories[i].id === catId) return CATALOG.categories[i];
    }
    return null;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ==========================================================================
  // 2. УВЕДОМЛЕНИЯ (КРУПНЫЕ ТОСТЫ) И ДИАЛОГ ПОДТВЕРЖДЕНИЯ
  // ==========================================================================

  function showToast(message) {
    var el = document.getElementById("toast-region");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    if (runtime.toastTimer) clearTimeout(runtime.toastTimer);
    runtime.toastTimer = setTimeout(function () {
      el.hidden = true;
    }, 3200);
  }

  function openConfirmDialog(title, desc, onConfirm) {
    var modal = document.getElementById("confirm-modal");
    var titleEl = document.getElementById("confirm-title");
    var descEl = document.getElementById("confirm-desc");
    if (!modal) return;
    titleEl.textContent = title;
    descEl.textContent = desc;
    runtime.pendingConfirmAction = onConfirm;
    modal.hidden = false;
    var cancelBtn = document.getElementById("btn-confirm-cancel");
    if (cancelBtn) cancelBtn.focus();
  }

  function closeConfirmDialog() {
    var modal = document.getElementById("confirm-modal");
    if (modal) modal.hidden = true;
    runtime.pendingConfirmAction = null;
  }

  // ==========================================================================
  // 3. НАСТРОЙКИ ЧТЕНИЯ: РАЗМЕР БУКВ (А+) И ВЕЧЕРНИЙ ТЁПЛЫЙ СВЕТ
  // ==========================================================================

  function applyVisualPreferences() {
    var html = document.documentElement;
    html.setAttribute("data-font-scale", state.fontScale);
    html.setAttribute("data-theme", state.theme);

    var scaleLabel = document.getElementById("font-scale-label");
    if (scaleLabel) {
      var map = {
        normal: "Буквы 100%",
        large: "Крупно",
        xlarge: "Очень крупно"
      };
      scaleLabel.textContent = map[state.fontScale] || "Буквы";
    }

    var themeBtn = document.getElementById("btn-theme-toggle");
    var themeIcon = document.getElementById("theme-icon");
    var themeLabel = document.getElementById("theme-label");
    if (themeBtn && themeIcon && themeLabel) {
      var isEvening = state.theme === "evening";
      themeBtn.setAttribute("aria-pressed", isEvening ? "true" : "false");
      themeIcon.textContent = isEvening ? "☀" : "🌙";
      themeLabel.textContent = isEvening ? "Дневной" : "Вечерний";
    }
  }

  function cycleFontScale() {
    var order = ["normal", "large", "xlarge"];
    var idx = order.indexOf(state.fontScale);
    state.fontScale = order[(idx + 1) % order.length];
    saveState();
    applyVisualPreferences();

    var names = {
      normal: "Обычный крупный шрифт (20 пт)",
      large: "Увеличенный шрифт (23 пт)",
      xlarge: "Максимально крупный шрифт (26 пт)"
    };
    showToast(names[state.fontScale]);
  }

  function toggleTheme() {
    state.theme = state.theme === "evening" ? "day" : "evening";
    saveState();
    applyVisualPreferences();
    showToast(
      state.theme === "evening"
        ? "Включён тёплый вечерний свет для вязания при лампе"
        : "Включён светлый дневной режим"
    );
  }

  // ==========================================================================
  // 4. ИЗБРАННОЕ («МОЁ ЛЮБИМОЕ» БЕЗ ПАРОЛЕЙ)
  // ==========================================================================

  function isFavorite(slug) {
    return state.favorites.indexOf(slug) !== -1;
  }

  function toggleFavorite(slug) {
    var idx = state.favorites.indexOf(slug);
    var added = false;
    if (idx === -1) {
      state.favorites.push(slug);
      added = true;
    } else {
      state.favorites.splice(idx, 1);
    }
    saveState();
    showToast(
      added
        ? "♥ Добавлено в раздел «Моё любимое»"
        : "Убрано из раздела «Моё любимое»"
    );
    return added;
  }

  // ==========================================================================
  // 5. СЧЁТЧИК РЯДОВ (СОХРАНЕНИЕ ДЛЯ КАЖДОГО УЗОРА И ЛЕВОЙ/ПРАВОЙ ДЕТАЛИ)
  // ==========================================================================

  function ensureCounterState(article) {
    if (!state.counters[article.slug]) {
      var defaultPart =
        article.counterParts && article.counterParts.length
          ? article.counterParts[0].id
          : "main";
      state.counters[article.slug] = {
        activePart: defaultPart,
        values: {},
        collapsed: false
      };
    }
    var c = state.counters[article.slug];
    var parts =
      article.counterParts && article.counterParts.length
        ? article.counterParts
        : [{ id: "main", label: "Основное полотно" }];
    parts.forEach(function (p) {
      if (typeof c.values[p.id] !== "number") {
        c.values[p.id] = 0;
      }
    });
    if (!c.activePart || c.values[c.activePart] === undefined) {
      c.activePart = parts[0].id;
    }
    return c;
  }

  function getActivePartInfo(article) {
    var c = ensureCounterState(article);
    var parts =
      article.counterParts && article.counterParts.length
        ? article.counterParts
        : [{ id: "main", label: "Основное полотно" }];
    var activeObj = parts[0];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].id === c.activePart) {
        activeObj = parts[i];
        break;
      }
    }
    return {
      partId: activeObj.id,
      partLabel: activeObj.label,
      count: c.values[activeObj.id] || 0,
      collapsed: !!c.collapsed,
      parts: parts
    };
  }

  function changeRowCount(slug, delta) {
    var article = getArticleBySlug(slug);
    if (!article) return;
    var c = ensureCounterState(article);
    var next = Math.max(0, (c.values[c.activePart] || 0) + delta);
    c.values[c.activePart] = next;
    state.lastOpened = { slug: slug, updatedAt: Date.now() };
    saveState();

    // Лёгкий тактильный отклик на телефонах Android
    if (delta > 0 && navigator.vibrate) {
      try {
        navigator.vibrate(18);
      } catch (e) {}
    }

    renderCounterDock(article);
    syncChartModalCounter();
  }

  function switchCounterPart(slug, partId) {
    var article = getArticleBySlug(slug);
    if (!article) return;
    var c = ensureCounterState(article);
    c.activePart = partId;
    saveState();
    renderCounterDock(article);
    syncChartModalCounter();
  }

  function toggleCounterCollapse(slug) {
    var article = getArticleBySlug(slug);
    if (!article) return;
    var c = ensureCounterState(article);
    c.collapsed = !c.collapsed;
    saveState();
    renderCounterDock(article);
  }

  function requestResetCounter(slug) {
    var article = getArticleBySlug(slug);
    if (!article) return;
    var info = getActivePartInfo(article);
    if (info.count === 0) {
      showToast("Счётчик уже равен 0");
      return;
    }
    openConfirmDialog(
      "Сбросить счётчик рядов на 0?",
      "Сейчас выбрано «" + info.partLabel + "», связано рядов: " + info.count + ".",
      function () {
        var c = ensureCounterState(article);
        c.values[c.activePart] = 0;
        saveState();
        renderCounterDock(article);
        syncChartModalCounter();
        showToast("Счётчик «" + info.partLabel + "» обнулён");
      }
    );
  }

  function renderCounterDock(article) {
    var dock = document.getElementById("row-counter-dock");
    if (!dock) return;
    if (!article) {
      dock.hidden = true;
      document.body.classList.remove("has-counter-dock");
      return;
    }

    var info = getActivePartInfo(article);
    dock.hidden = false;
    document.body.classList.add("has-counter-dock");

    if (info.collapsed) {
      dock.innerHTML =
        '<div class="counter-dock-inner counter-collapsed-bar">' +
        '<div><strong>' +
        escapeHtml(info.partLabel) +
        ": ряд " +
        info.count +
        "</strong></div>" +
        '<div style="display:flex;gap:8px;">' +
        '<button type="button" class="chart-cnt-plus" data-action="cnt-plus" data-slug="' +
        escapeHtml(article.slug) +
        '">+1 ряд</button>' +
        '<button type="button" class="counter-collapse-btn" data-action="cnt-collapse" data-slug="' +
        escapeHtml(article.slug) +
        '">Развернуть ▲</button>' +
        "</div>" +
        "</div>";
      return;
    }

    var tabsHtml = info.parts
      .map(function (p) {
        var val = state.counters[article.slug].values[p.id] || 0;
        var activeCls = p.id === info.partId ? " is-active" : "";
        return (
          '<button type="button" class="part-tab-btn' +
          activeCls +
          '" data-action="cnt-part" data-slug="' +
          escapeHtml(article.slug) +
          '" data-part="' +
          escapeHtml(p.id) +
          '">' +
          escapeHtml(p.label) +
          " (" +
          val +
          ")</button>"
        );
      })
      .join("");

    dock.innerHTML =
      '<div class="counter-dock-inner">' +
      '<div class="counter-dock-top">' +
      '<div class="counter-parts-tabs" role="tablist" aria-label="Выбор детали для счёта рядов">' +
      tabsHtml +
      "</div>" +
      '<button type="button" class="counter-collapse-btn" data-action="cnt-collapse" data-slug="' +
      escapeHtml(article.slug) +
      '" aria-label="Свернуть панель счётчика">Свернуть ▼</button>' +
      "</div>" +
      '<div class="counter-main-row">' +
      '<div class="counter-readout" aria-live="polite">' +
      '<span class="counter-readout-label">Ряд</span>' +
      '<span class="counter-readout-num">' +
      info.count +
      "</span>" +
      "</div>" +
      '<button type="button" class="counter-btn-minus" data-action="cnt-minus" data-slug="' +
      escapeHtml(article.slug) +
      '" aria-label="Убавить один ряд">−1</button>' +
      '<button type="button" class="counter-btn-reset" data-action="cnt-reset" data-slug="' +
      escapeHtml(article.slug) +
      '" aria-label="Сбросить счётчик рядов">Сброс</button>' +
      '<button type="button" class="counter-btn-plus" data-action="cnt-plus" data-slug="' +
      escapeHtml(article.slug) +
      '">+1 ряд</button>' +
      "</div>" +
      "</div>";
  }

  // ==========================================================================
  // 6. ЗАПРЕТ ГАШЕНИЯ ЭКРАНА (SCREEN WAKE LOCK API)
  // ==========================================================================

  async function acquireWakeLockIfNeeded() {
    var shouldHold =
      state.wakeLockEnabled &&
      (runtime.currentRoute.view === "article" || runtime.chartModal.isOpen);

    if (!shouldHold) {
      await releaseWakeLock();
      updateWakeLockBarUI();
      return;
    }

    if (!runtime.wakeLockSupported) {
      runtime.wakeLockActive = false;
      updateWakeLockBarUI();
      return;
    }

    if (runtime.wakeLockSentinel && !runtime.wakeLockSentinel.released) {
      runtime.wakeLockActive = true;
      updateWakeLockBarUI();
      return;
    }

    try {
      var sentinel = await navigator.wakeLock.request("screen");
      runtime.wakeLockSentinel = sentinel;
      runtime.wakeLockActive = true;
      sentinel.addEventListener("release", function () {
        runtime.wakeLockActive = false;
        updateWakeLockBarUI();
      });
    } catch (err) {
      runtime.wakeLockActive = false;
    }
    updateWakeLockBarUI();
  }

  async function releaseWakeLock() {
    if (runtime.wakeLockSentinel) {
      try {
        await runtime.wakeLockSentinel.release();
      } catch (e) {}
      runtime.wakeLockSentinel = null;
    }
    runtime.wakeLockActive = false;
  }

  function updateWakeLockBarUI() {
    var bar = document.getElementById("wakelock-bar");
    var textEl = document.getElementById("wakelock-status-text");
    var btnEl = document.getElementById("btn-wakelock-toggle");
    if (!bar || !textEl || !btnEl) return;

    if (!runtime.wakeLockSupported) {
      bar.classList.remove("is-active");
      textEl.textContent =
        "ℹ Ваш браузер управляет подсветкой экрана автоматически. При чтении больших схем нажимайте «Открыть схему крупно».";
      btnEl.hidden = true;
      return;
    }

    btnEl.hidden = false;
    if (state.wakeLockEnabled && runtime.wakeLockActive) {
      bar.classList.add("is-active");
      textEl.textContent =
        "☀ Экран не гаснет: телефон остаётся включённым, пока открыто описание";
      btnEl.textContent = "Разрешить гаснуть";
    } else if (state.wakeLockEnabled && !runtime.wakeLockActive) {
      bar.classList.add("is-active");
      textEl.textContent =
        "☀ Режим «Экран не гаснет» включён (активируется при касании страницы)";
      btnEl.textContent = "Разрешить гаснуть";
    } else {
      bar.classList.remove("is-active");
      textEl.textContent =
        "🌙 Обычный режим экрана (телефон может гаснуть по таймеру)";
      btnEl.textContent = "Не гасить экран";
    }
  }

  // Повторный захват Wake Lock после возврата в браузер или первого касания
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      acquireWakeLockIfNeeded();
    }
  });

  // ==========================================================================
  // 7. ОЗВУЧКА ОПИСАНИЙ (WEB SPEECH API) + СЛОВАРЬ СОКРАЩЕНИЙ ВЯЗАЛЬЩИЦЫ
  // ==========================================================================

  function expandKnittingAbbreviations(text) {
    var s = " " + String(text || "") + " ";

    // Англоязычные и специальные обозначения бриоши и ажурных шалей
    s = s.replace(/\b2вм\.?\s*лиц\.?/gi, "две петли вместе лицевой");
    s = s.replace(/\bСнять\s*1\s*лиц\.?/gi, "снять одну петлю как лицевую");
    s = s.replace(/\bsl1yo\b/gi, "сделать накид и снять петлю как изнаночную");
    s = s.replace(/\bDecR\b/g, "двойное убавление вправо");
    s = s.replace(/\bs2kp\b/gi, "двойное центральное убавление");
    s = s.replace(/\bsk2p\b/gi, "убавление двух петель с протяжкой");
    s = s.replace(/\bk2tog\b/gi, "две вместе лицевой");
    s = s.replace(/\bk3tog\b/gi, "три вместе лицевой");
    s = s.replace(/\bssk\b/gi, "две вместе лицевой с наклоном влево");
    s = s.replace(/\bsssk\b/gi, "три вместе лицевой с наклоном влево");
    s = s.replace(/\bknit\s+tbl\b/gi, "лицевая за заднюю стенку");
    s = s.replace(/\bNupp\b/gi, "шишечка нупп");

    // Форматы размеров и резинок (36/37, 1х1, 10 × 10)
    s = s.replace(/(\d+)\s*[xх×]\s*(\d+)/gi, "$1 на $2");
    s = s.replace(/(\d+)\s*\/\s*(\d+)/g, "$1 $2");
    s = s.replace(/\bв\s+(\d+)\s*[–-]\s*(\d+)\b/gi, "с $1-го по $2-й");
    s = s.replace(/(^|\s)(\d+)\s*[–-]\s*(\d+)-й/g, "$1с $2-го по $3-й");
    s = s.replace(/(^|\s)(\d+)\s*[–-]\s*(\d+)-м/g, "$1с $2-го по $3-м");
    s = s.replace(/(\d+(?:,\d+)?)\s*[–-]\s*(\d+(?:,\d+)?)/g, "$1, $2");

    // Согласование числительных с сокращениями п., лиц., изн.
    s = s.replace(/\b1\s+п\.(?!\w)/g, "одна петля");
    s = s.replace(/\b2\s+п\.(?!\w)/g, "две петли");
    s = s.replace(/\b([34])\s+п\.(?!\w)/g, "$1 петли");
    s = s.replace(/\b(\d+)\s+п\.(?!\w)/g, "$1 петель");
    s = s.replace(/(^|\s)п\.(?=\s|[.,;:)!?]|$)/g, "$1петель");

    s = s.replace(/\b1\s+лиц\.(?!\w)/g, "одна лицевая");
    s = s.replace(/\b2\s+лиц\.(?!\w)/g, "две лицевые");
    s = s.replace(/\b([34])\s+лиц\.(?!\w)/g, "$1 лицевые");
    s = s.replace(/\b(\d+)\s+лиц\.(?!\w)/g, "$1 лицевых");
    s = s.replace(/(^|\s)лиц\.(?=\s|[.,;:)!?]|$)/g, "$1лицевыми");

    s = s.replace(/\b1\s+изн\.(?!\w)/g, "одна изнаночная");
    s = s.replace(/\b2\s+изн\.(?!\w)/g, "две изнаночные");
    s = s.replace(/\b([34])\s+изн\.(?!\w)/g, "$1 изнаночные");
    s = s.replace(/\b(\d+)\s+изн\.(?!\w)/g, "$1 изнаночных");
    s = s.replace(/(^|\s)изн\.(?=\s|[.,;:)!?]|$)/g, "$1изнаночными");

    // Прочие частые сокращения
    s = s.replace(/(^|\s)круг\.\s*р\.(?=\s|[.,;:)!?]|$)/g, "$1круговых рядов");
    s = s.replace(/(^|\s)круг\.(?=\s)/g, "$1круговых");
    s = s.replace(/(\d+)\s+р\.(?=\s|[.,;:)!?]|$)/g, "$1 рядов");
    s = s.replace(/(^|\s)ок\.(?=\s)/g, "$1около");
    s = s.replace(/(\d+(?:,\d+)?)\s*см(?=\s|[.,;:)!?]|$)/g, "$1 сантиметров");
    s = s.replace(/(\d+(?:,\d+)?)\s*мм(?=\s|[.,;:)!?]|$)/g, "$1 миллиметров");
    s = s.replace(/\*/g, " , повтор раппорта: ");

    return s.replace(/\s+/g, " ").trim();
  }

  function buildStepsQueueForArticle(article) {
    var queue = [];
    if (!article || !article.sections) return queue;
    article.sections.forEach(function (sec) {
      sec.steps.forEach(function (st) {
        queue.push({
          stepId: st.id,
          sectionTitle: sec.title,
          label: st.label,
          text: st.text
        });
      });
    });
    return queue;
  }

  function pickRussianVoice() {
    if (!runtime.tts.supported) return null;
    var voices = window.speechSynthesis.getVoices() || [];
    var ruVoices = voices.filter(function (v) {
      return v.lang && v.lang.toLowerCase().indexOf("ru") === 0;
    });
    if (!ruVoices.length) return null;
    // Предпочитаем качественные женские голоса (Milena, Irina, Google русский)
    for (var i = 0; i < ruVoices.length; i++) {
      var name = (ruVoices[i].name || "").toLowerCase();
      if (
        name.indexOf("irina") !== -1 ||
        name.indexOf("milena") !== -1 ||
        name.indexOf("google") !== -1 ||
        name.indexOf("yandex") !== -1
      ) {
        return ruVoices[i];
      }
    }
    return ruVoices[0];
  }

  function stopTts() {
    if (runtime.tts.keepAliveTimer) {
      clearInterval(runtime.tts.keepAliveTimer);
      runtime.tts.keepAliveTimer = null;
    }
    if (runtime.tts.supported) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
    runtime.tts.speaking = false;
    runtime.tts.paused = false;
    highlightSpokenStep(null);
    updateTtsControlsUI();
  }

  function speakStepAtIndex(article, index, autoAdvance) {
    if (!runtime.tts.supported) {
      showToast("В этом браузере голосовое чтение не поддерживается");
      return;
    }
    var queue = buildStepsQueueForArticle(article);
    if (!queue.length) return;
    if (index < 0) index = 0;
    if (index >= queue.length) {
      stopTts();
      showToast("Чтение описания завершено");
      return;
    }

    stopTts();

    runtime.tts.articleSlug = article.slug;
    runtime.tts.stepsQueue = queue;
    runtime.tts.currentIndex = index;
    runtime.tts.speaking = true;
    runtime.tts.paused = false;

    var item = queue[index];
    highlightSpokenStep(item.stepId);
    updateTtsControlsUI();

    var spokenString = expandKnittingAbbreviations(
      item.label + ". " + item.text
    );
    var utter = new SpeechSynthesisUtterance(spokenString);
    utter.lang = "ru-RU";
    utter.rate = state.ttsRate || 0.85;
    utter.pitch = 1.0;

    var voice = pickRussianVoice();
    if (voice) utter.voice = voice;

    utter.onend = function () {
      if (!runtime.tts.speaking) return;
      if (autoAdvance && runtime.tts.currentIndex + 1 < queue.length) {
        speakStepAtIndex(article, runtime.tts.currentIndex + 1, true);
      } else {
        stopTts();
      }
    };

    utter.onerror = function () {
      stopTts();
    };

    window.speechSynthesis.speak(utter);

    // Обход особенности Chrome, где длинная фраза может замирать через 14 секунд
    runtime.tts.keepAliveTimer = setInterval(function () {
      if (
        runtime.tts.speaking &&
        !runtime.tts.paused &&
        window.speechSynthesis.speaking
      ) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 12000);
  }

  function togglePlayPauseTts(article) {
    if (!runtime.tts.supported) {
      showToast("Голосовое чтение недоступно в вашем браузере");
      return;
    }
    if (!runtime.tts.speaking) {
      speakStepAtIndex(article, runtime.tts.currentIndex || 0, true);
      return;
    }
    if (runtime.tts.paused) {
      window.speechSynthesis.resume();
      runtime.tts.paused = false;
      updateTtsControlsUI();
    } else {
      window.speechSynthesis.pause();
      runtime.tts.paused = true;
      updateTtsControlsUI();
    }
  }

  function highlightSpokenStep(stepId) {
    var all = document.querySelectorAll(".step-item");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var btn = el.querySelector(".step-speak-btn");
      if (stepId && el.getAttribute("data-step-id") === stepId) {
        el.classList.add("is-speaking");
        if (btn) btn.textContent = "🔊 Читается…";
        try {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (e) {}
      } else {
        el.classList.remove("is-speaking");
        if (btn) btn.textContent = "🔊 Озвучить шаг";
      }
    }
  }

  function updateTtsControlsUI() {
    var mainBtn = document.getElementById("btn-tts-play");
    var statusSub = document.getElementById("tts-status-sub");
    if (!mainBtn) return;

    if (!runtime.tts.speaking) {
      mainBtn.textContent = "🔊 Читать описание вслух";
      if (statusSub) {
        statusSub.textContent =
          "Спокойный голос зачитает ряды по порядку, расшифровывая все сокращения (лиц., изн., п.).";
      }
    } else if (runtime.tts.paused) {
      mainBtn.textContent = "▶ Продолжить чтение";
      if (statusSub) {
        var pItem = runtime.tts.stepsQueue[runtime.tts.currentIndex];
        statusSub.textContent =
          "Пауза на шаге: «" + (pItem ? pItem.label : "") + "»";
      }
    } else {
      mainBtn.textContent = "⏸ Пауза";
      if (statusSub) {
        var cur = runtime.tts.stepsQueue[runtime.tts.currentIndex];
        statusSub.textContent =
          "Сейчас звучит шаг " +
          (runtime.tts.currentIndex + 1) +
          " из " +
          runtime.tts.stepsQueue.length +
          ": «" +
          (cur ? cur.label : "") +
          "»";
      }
    }
  }

  if (runtime.tts.supported && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = function () {};
  }

  // ==========================================================================
  // 8. ПОЛНОЭКРАННОЕ ОКНО СХЕМЫ С ПИНЧ-ЗУМОМ И ЛИНЕЙКОЙ РЯДА
  // ==========================================================================

  function openChartModal(articleSlug, chartId, directSrc, directTitle, directHint) {
    var article = getArticleBySlug(articleSlug);
    var chartObj = null;
    if (article && chartId) {
      for (var i = 0; i < article.charts.length; i++) {
        if (article.charts[i].id === chartId) {
          chartObj = article.charts[i];
          break;
        }
      }
    }

    var src = chartObj ? chartObj.src : directSrc;
    var title = chartObj ? chartObj.title : directTitle || "Схема узора";
    var hint = chartObj
      ? chartObj.hint || chartObj.subtitle || ""
      : directHint || "Двигайте схему одним пальцем, увеличивайте двумя пальцами или кнопками + и −.";
    var keyId = chartId || src;

    var modal = document.getElementById("chart-modal");
    var titleEl = document.getElementById("chart-modal-title");
    var hintEl = document.getElementById("chart-modal-hint");
    var imgEl = document.getElementById("chart-modal-img");
    var rulerEl = document.getElementById("chart-ruler");
    var rulerToggleBtn = document.getElementById("btn-toggle-ruler");

    if (!modal || !imgEl) return;

    runtime.chartModal.isOpen = true;
    runtime.chartModal.articleSlug = articleSlug;
    runtime.chartModal.chartId = keyId;

    titleEl.textContent = title;
    hintEl.textContent = hint;
    modal.hidden = false;
    document.body.style.overflow = "hidden";

    // Линейка ряда
    rulerEl.hidden = !state.rulerVisible;
    if (rulerToggleBtn) {
      rulerToggleBtn.setAttribute("aria-pressed", state.rulerVisible ? "true" : "false");
    }
    var savedPct = state.rulerPositions[keyId];
    var pct = typeof savedPct === "number" ? savedPct : 42;
    rulerEl.style.top = pct + "%";

    syncChartModalCounter();
    acquireWakeLockIfNeeded();

    imgEl.onload = function () {
      runtime.chartModal.imgW = imgEl.naturalWidth || 900;
      runtime.chartModal.imgH = imgEl.naturalHeight || 900;
      fitChartToViewport();
    };
    imgEl.src = src;
    imgEl.alt = title;

    var closeBtn = document.getElementById("btn-chart-close");
    if (closeBtn) closeBtn.focus();
  }

  function closeChartModal() {
    var modal = document.getElementById("chart-modal");
    if (!modal) return;
    modal.hidden = true;
    runtime.chartModal.isOpen = false;
    document.body.style.overflow = "";
    acquireWakeLockIfNeeded();
  }

  function fitChartToViewport() {
    var vp = document.getElementById("chart-viewport");
    if (!vp) return;
    var vw = vp.clientWidth || 360;
    var vh = vp.clientHeight || 480;
    var iw = runtime.chartModal.imgW || 800;
    var ih = runtime.chartModal.imgH || 800;

    var pad = 16;
    var fit = Math.min((vw - pad * 2) / iw, (vh - pad * 2) / ih);
    if (!isFinite(fit) || fit <= 0) fit = 1;

    runtime.chartModal.fitScale = fit;
    runtime.chartModal.scale = fit;
    runtime.chartModal.tx = Math.round((vw - iw * fit) / 2);
    runtime.chartModal.ty = Math.round((vh - ih * fit) / 2);
    applyChartTransform();
  }

  function clampChartPan() {
    var vp = document.getElementById("chart-viewport");
    if (!vp) return;
    var vw = vp.clientWidth || 360;
    var vh = vp.clientHeight || 480;
    var sw = runtime.chartModal.imgW * runtime.chartModal.scale;
    var sh = runtime.chartModal.imgH * runtime.chartModal.scale;

    // Не даём схеме «улететь» за пределы экрана: минимум 25% остаётся на виду
    var marginX = Math.min(120, vw * 0.35);
    var marginY = Math.min(120, vh * 0.35);

    var minTx = vw - sw - (vw - marginX);
    var maxTx = vw - marginX;
    if (sw <= vw) {
      runtime.chartModal.tx = Math.round((vw - sw) / 2);
    } else {
      minTx = vw - sw - 40;
      maxTx = 40;
      runtime.chartModal.tx = Math.max(minTx, Math.min(maxTx, runtime.chartModal.tx));
    }

    if (sh <= vh) {
      runtime.chartModal.ty = Math.round((vh - sh) / 2);
    } else {
      var minTy = vh - sh - 60;
      var maxTy = 60;
      runtime.chartModal.ty = Math.max(minTy, Math.min(maxTy, runtime.chartModal.ty));
    }
  }

  function zoomChartAroundPoint(factor, cx, cy) {
    var vp = document.getElementById("chart-viewport");
    if (!vp) return;
    if (cx === undefined || cy === undefined) {
      cx = vp.clientWidth / 2;
      cy = vp.clientHeight / 2;
    }

    var minScale = runtime.chartModal.fitScale * 0.75;
    var maxScale = runtime.chartModal.fitScale * 5.0;
    var oldScale = runtime.chartModal.scale;
    var newScale = Math.max(minScale, Math.min(maxScale, oldScale * factor));
    var ratio = newScale / oldScale;

    runtime.chartModal.tx = cx - (cx - runtime.chartModal.tx) * ratio;
    runtime.chartModal.ty = cy - (cy - runtime.chartModal.ty) * ratio;
    runtime.chartModal.scale = newScale;

    clampChartPan();
    applyChartTransform();
  }

  function applyChartTransform() {
    var stage = document.getElementById("chart-stage");
    var pctLabel = document.getElementById("zoom-pct-label");
    if (stage) {
      stage.style.transform =
        "translate3d(" +
        runtime.chartModal.tx.toFixed(1) +
        "px, " +
        runtime.chartModal.ty.toFixed(1) +
        "px, 0) scale(" +
        runtime.chartModal.scale.toFixed(4) +
        ")";
    }
    if (pctLabel && runtime.chartModal.fitScale > 0) {
      var relPct = Math.round(
        (runtime.chartModal.scale / runtime.chartModal.fitScale) * 100
      );
      pctLabel.textContent = relPct + "%";
    }
  }

  function syncChartModalCounter() {
    var box = document.getElementById("chart-inline-counter");
    if (!box) return;
    var article = getArticleBySlug(runtime.chartModal.articleSlug);
    if (!article) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var info = getActivePartInfo(article);
    var partEl = document.getElementById("chart-counter-part");
    var valEl = document.getElementById("chart-counter-val");
    if (partEl) partEl.textContent = info.partLabel;
    if (valEl) valEl.textContent = "Ряд: " + info.count;
  }

  function setRulerPercent(pct) {
    var clamped = Math.max(6, Math.min(82, pct));
    var rulerEl = document.getElementById("chart-ruler");
    if (rulerEl) {
      rulerEl.style.top = clamped.toFixed(1) + "%";
    }
    if (runtime.chartModal.chartId) {
      state.rulerPositions[runtime.chartModal.chartId] = clamped;
      saveState();
    }
  }

  function initChartModalGestures() {
    var vp = document.getElementById("chart-viewport");
    var handle = document.getElementById("chart-ruler-handle");
    if (!vp) return;

    var draggingPan = false;
    var panStartX = 0;
    var panStartY = 0;
    var origTx = 0;
    var origTy = 0;

    var pinching = false;
    var startPinchDist = 0;

    function getTouchDist(t1, t2) {
      var dx = t1.clientX - t2.clientX;
      var dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    vp.addEventListener(
      "touchstart",
      function (e) {
        if (e.target.closest("#chart-ruler")) return;
        if (e.touches.length === 2) {
          pinching = true;
          draggingPan = false;
          startPinchDist = getTouchDist(e.touches[0], e.touches[1]);
        } else if (e.touches.length === 1) {
          draggingPan = true;
          pinching = false;
          panStartX = e.touches[0].clientX;
          panStartY = e.touches[0].clientY;
          origTx = runtime.chartModal.tx;
          origTy = runtime.chartModal.ty;
        }
      },
      { passive: true }
    );

    vp.addEventListener(
      "touchmove",
      function (e) {
        if (e.target.closest("#chart-ruler")) return;
        if (pinching && e.touches.length === 2) {
          e.preventDefault();
          var dist = getTouchDist(e.touches[0], e.touches[1]);
          if (startPinchDist > 10) {
            var rect = vp.getBoundingClientRect();
            var midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            var midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
            zoomChartAroundPoint(dist / startPinchDist, midX, midY);
            startPinchDist = dist;
          }
        } else if (draggingPan && e.touches.length === 1) {
          e.preventDefault();
          runtime.chartModal.tx = origTx + (e.touches[0].clientX - panStartX);
          runtime.chartModal.ty = origTy + (e.touches[0].clientY - panStartY);
          clampChartPan();
          applyChartTransform();
        }
      },
      { passive: false }
    );

    vp.addEventListener("touchend", function () {
      draggingPan = false;
      pinching = false;
    });

    // Перетаскивание мышью на компьютере/планшете
    var mouseDown = false;
    vp.addEventListener("mousedown", function (e) {
      if (e.target.closest("#chart-ruler")) return;
      mouseDown = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      origTx = runtime.chartModal.tx;
      origTy = runtime.chartModal.ty;
    });

    window.addEventListener("mousemove", function (e) {
      if (!mouseDown || !runtime.chartModal.isOpen) return;
      runtime.chartModal.tx = origTx + (e.clientX - panStartX);
      runtime.chartModal.ty = origTy + (e.clientY - panStartY);
      clampChartPan();
      applyChartTransform();
    });

    window.addEventListener("mouseup", function () {
      mouseDown = false;
    });

    vp.addEventListener(
      "wheel",
      function (e) {
        if (!runtime.chartModal.isOpen) return;
        e.preventDefault();
        var rect = vp.getBoundingClientRect();
        var factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        zoomChartAroundPoint(factor, e.clientX - rect.left, e.clientY - rect.top);
      },
      { passive: false }
    );

    // Перетаскивание линейки ряда пальцем или мышью
    if (handle) {
      var draggingRuler = false;

      var moveRulerToClientY = function (clientY) {
        var rect = vp.getBoundingClientRect();
        if (!rect.height) return;
        var pct = ((clientY - rect.top - 22) / rect.height) * 100;
        setRulerPercent(pct);
      };

      handle.addEventListener(
        "touchstart",
        function (e) {
          draggingRuler = true;
          e.stopPropagation();
        },
        { passive: true }
      );

      window.addEventListener(
        "touchmove",
        function (e) {
          if (!draggingRuler || !e.touches.length) return;
          e.preventDefault();
          moveRulerToClientY(e.touches[0].clientY);
        },
        { passive: false }
      );

      window.addEventListener("touchend", function () {
        draggingRuler = false;
      });

      handle.addEventListener("mousedown", function (e) {
        draggingRuler = true;
        e.stopPropagation();
        e.preventDefault();
      });

      window.addEventListener("mousemove", function (e) {
        if (!draggingRuler) return;
        moveRulerToClientY(e.clientY);
      });

      window.addEventListener("mouseup", function () {
        draggingRuler = false;
      });
    }
  }

  // ==========================================================================
  // 9. ГОЛОСОВОЙ ПОИСК УЗОРА (SPEECH RECOGNITION API)
  // ==========================================================================

  function startVoiceSearch() {
    var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast(
        "Голосовой поиск не поддерживается этим браузером — введите слово в поле поиска выше"
      );
      return;
    }

    var btn = document.getElementById("btn-voice-search");
    var rec = new SpeechRec();
    rec.lang = "ru-RU";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    if (btn) {
      btn.classList.add("voice-listening");
      btn.textContent = "🎤 Говорите название узора…";
    }
    showToast("Говорите, например: «носки», «бриошь» или «шаль»");

    rec.onresult = function (event) {
      var phrase =
        event.results &&
        event.results[0] &&
        event.results[0][0] &&
        event.results[0][0].transcript
          ? event.results[0][0].transcript.trim()
          : "";
      if (phrase) {
        runtime.searchQuery = phrase;
        renderHomeView();
        var inp = document.getElementById("search-input");
        if (inp) inp.value = phrase;
        showToast("Поиск по запросу: «" + phrase + "»");
      }
    };

    rec.onerror = function () {
      showToast("Не удалось расслышать запрос. Попробуйте ещё раз.");
    };

    rec.onend = function () {
      var b = document.getElementById("btn-voice-search");
      if (b) {
        b.classList.remove("voice-listening");
        b.textContent = "🎤 Найти голосом";
      }
    };

    try {
      rec.start();
    } catch (e) {}
  }

  // ==========================================================================
  // 10. ШАБЛОНЫ КАРТОЧЕК И СТРАНИЦ (МАРШРУТИЗАТОР: ГЛАВНАЯ / РУБРИКА / ИЗБРАННОЕ / СТАТЬЯ)
  // ==========================================================================

  function updateHeaderNavigation(route) {
    var leftEl = document.getElementById("header-left");
    if (!leftEl) return;

    if (route.view === "home") {
      leftEl.innerHTML =
        '<a href="#/" class="brand-link" aria-label="Главная страница каталога">' +
        '<img src="./assets/icon.svg" alt="" class="brand-icon" width="44" height="44">' +
        '<span class="brand-text">' +
        '<strong class="brand-title">Книга вязания</strong>' +
        '<span class="brand-sub">Спицами · каталог</span>' +
        "</span>" +
        "</a>";
    } else if (route.view === "article") {
      var art = getArticleBySlug(route.param);
      var backHref = art ? "#/category/" + encodeURIComponent(art.categoryId) : "#/";
      leftEl.innerHTML =
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
        '<a href="#/" class="back-nav-btn">← На главную</a>' +
        (art
          ? '<a href="' +
            backHref +
            '" class="btn btn-secondary" style="min-height:54px;padding:10px 14px;font-size:0.88rem;">Рубрика: ' +
            escapeHtml(art.categoryTitle) +
            "</a>"
          : "") +
        "</div>";
    } else {
      leftEl.innerHTML =
        '<a href="#/" class="back-nav-btn">← Назад в каталог</a>';
    }
  }

  function renderArticleCardHTML(article) {
    var fav = isFavorite(article.slug);
    var favLabel = fav
      ? "♥ В любимом (сохранено)"
      : "♡ Отложить в любимое";
    var favCls = fav ? " btn-fav-active" : "";

    var specsPreview = (article.specs || [])
      .slice(0, 2)
      .map(function (s) {
        return (
          "<li><strong>" +
          escapeHtml(s.label) +
          ":</strong> " +
          escapeHtml(s.value) +
          "</li>"
        );
      })
      .join("");

    return (
      '<article class="article-card">' +
      '<a href="#/article/' +
      encodeURIComponent(article.slug) +
      '" class="article-card-media-link">' +
      '<img src="' +
      escapeHtml(article.coverImage) +
      '" alt="' +
      escapeHtml(article.title) +
      '" class="article-card-img" loading="lazy">' +
      "</a>" +
      '<div class="article-card-body">' +
      '<span class="article-cat-pill">Рубрика: ' +
      escapeHtml(article.categoryTitle) +
      "</span>" +
      '<h3 class="article-card-title"><a href="#/article/' +
      encodeURIComponent(article.slug) +
      '">' +
      escapeHtml(article.title) +
      "</a></h3>" +
      '<p class="article-card-sub">' +
      escapeHtml(article.subtitle) +
      "</p>" +
      '<ul class="article-quick-specs">' +
      specsPreview +
      "</ul>" +
      '<div class="article-card-actions">' +
      '<a href="#/article/' +
      encodeURIComponent(article.slug) +
      '" class="btn btn-primary">Открыть описание и схемы →</a>' +
      '<button type="button" class="btn btn-secondary' +
      favCls +
      '" data-action="toggle-fav" data-slug="' +
      escapeHtml(article.slug) +
      '">' +
      favLabel +
      "</button>" +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function filterArticlesByQuery(query) {
    var q = String(query || "")
      .toLowerCase()
      .trim();
    if (!q) return CATALOG.articles.slice();
    return CATALOG.articles.filter(function (a) {
      var haystack = [
        a.title,
        a.subtitle,
        a.categoryTitle,
        (a.tags || []).join(" "),
        (a.specs || [])
          .map(function (s) {
            return s.value;
          })
          .join(" ")
      ]
        .join(" ")
        .toLowerCase();
      return haystack.indexOf(q) !== -1;
    });
  }

  function buildContinueCardHTML() {
    if (!state.lastOpened || !state.lastOpened.slug) return "";
    var art = getArticleBySlug(state.lastOpened.slug);
    if (!art) return "";

    var info = getActivePartInfo(art);
    var checkedMap = state.checkedSteps[art.slug] || {};
    var doneCount = Object.keys(checkedMap).filter(function (k) {
      return checkedMap[k];
    }).length;

    return (
      '<section class="continue-card" aria-label="Продолжить начатое вязание">' +
      '<span class="continue-badge">Вы недавно вязали</span>' +
      '<h2 class="continue-title">' +
      escapeHtml(art.title) +
      "</h2>" +
      '<p class="continue-meta">' +
      escapeHtml(info.partLabel) +
      ": <strong>ряд " +
      info.count +
      "</strong>" +
      (doneCount > 0 ? " · отмечено шагов: " + doneCount : "") +
      "</p>" +
      '<a href="#/article/' +
      encodeURIComponent(art.slug) +
      '" class="btn btn-green btn-block">Продолжить с этого места →</a>' +
      "</section>"
    );
  }

  function renderHomeView() {
    var main = document.getElementById("app-main");
    if (!main) return;

    renderCounterDock(null);

    var filtered = filterArticlesByQuery(runtime.searchQuery);
    var favCount = state.favorites.length;

    var categoriesHtml = CATALOG.categories
      .map(function (cat) {
        var readyCount = CATALOG.articles.filter(function (a) {
          return a.categoryId === cat.id;
        }).length;

        var thumbHtml = cat.coverImage
          ? '<img src="' +
            escapeHtml(cat.coverImage) +
            '" alt="" class="category-thumb" loading="lazy">'
          : '<div class="category-num-badge" aria-hidden="true">' +
            escapeHtml(cat.code) +
            "</div>";

        var statusHtml =
          readyCount > 0
            ? '<div class="category-card-count">Готово на сайте: ' +
              readyCount +
              " описание (в полном архиве — " +
              cat.archiveCount +
              ")</div>"
            : '<div class="category-card-count is-pending">В архиве: ' +
              cat.archiveCount +
              " описаний (подключатся на 2-м этапе)</div>";

        var btnHtml =
          readyCount > 0
            ? '<a href="#/category/' +
              encodeURIComponent(cat.id) +
              '" class="btn btn-secondary btn-block">Открыть рубрику «' +
              escapeHtml(cat.shortTitle) +
              "» →</a>"
            : '<a href="#/category/' +
              encodeURIComponent(cat.id) +
              '" class="btn btn-secondary btn-block">Посмотреть информацию о рубрике</a>';

        return (
          '<div class="category-card">' +
          '<div class="category-card-top">' +
          thumbHtml +
          "<div>" +
          '<h3 class="category-card-title">' +
          escapeHtml(cat.title) +
          "</h3>" +
          statusHtml +
          "</div>" +
          "</div>" +
          '<p class="category-card-desc">' +
          escapeHtml(cat.description) +
          "</p>" +
          btnHtml +
          "</div>"
        );
      })
      .join("");

    var resultsTitle = runtime.searchQuery
      ? "Результаты поиска «" +
        escapeHtml(runtime.searchQuery) +
        "» (" +
        filtered.length +
        ")"
      : "Готовые описания и схемы (3 проверенных проекта)";

    var articlesHtml = filtered.length
      ? '<div class="articles-list">' +
        filtered.map(renderArticleCardHTML).join("") +
        "</div>"
      : '<div class="empty-state-box">' +
        "<h3>По запросу «" +
        escapeHtml(runtime.searchQuery) +
        "» ничего не нашлось</h3>" +
        "<p>Попробуйте слова «носки», «бриошь», «шапка» или «шаль».</p>" +
        '<button type="button" class="btn btn-primary" data-action="clear-search">Показать все описания</button>' +
        "</div>";

    main.innerHTML =
      '<section class="hero-box">' +
      '<h1 class="hero-title">Книга вязания спицами</h1>' +
      '<p class="hero-subtitle">Крупный шрифт, чёткие схемы на весь экран, чтение рядов голосом и автоматический счётчик рядов.</p>' +
      '<div class="search-panel" role="search">' +
      '<label for="search-input" style="font-weight:700;">Быстрый поиск по узорам и пряже:</label>' +
      '<div class="search-input-wrap">' +
      '<input type="search" id="search-input" class="search-input" placeholder="Например: носки, бриошь, шаль…" value="' +
      escapeHtml(runtime.searchQuery) +
      '">' +
      (runtime.searchQuery
        ? '<button type="button" class="search-clear-btn" data-action="clear-search" aria-label="Очистить поиск">✕</button>'
        : "") +
      "</div>" +
      '<div class="search-actions-row">' +
      '<button type="button" id="btn-voice-search" class="btn btn-secondary" data-action="voice-search">🎤 Найти голосом</button>' +
      "</div>" +
      "</div>" +
      "</section>" +
      buildContinueCardHTML() +
      '<a href="#/favorites" class="btn fav-banner-btn">' +
      "<span>♥ Моё любимое (отложенные описания)</span>" +
      '<span class="fav-count-pill">' +
      favCount +
      "</span>" +
      "</a>" +
      '<section aria-labelledby="pilot-list-heading">' +
      '<h2 id="pilot-list-heading" class="section-heading">' +
      resultsTitle +
      "</h2>" +
      '<p class="section-lead">Нажмите на любое изделие, чтобы открыть пошаговое описание, увеличить схемы или включить озвучку.</p>' +
      articlesHtml +
      "</section>" +
      '<section aria-labelledby="cats-heading">' +
      '<h2 id="cats-heading" class="section-heading">Все рубрики библиотеки (5 разделов)</h2>' +
      '<p class="section-lead">Для удобной проверки на телефоне сейчас перенесено по 1 материалу из 3 рубрик (со всеми фотографиями, схемами и PDF).</p>' +
      '<div class="categories-grid">' +
      categoriesHtml +
      "</div>" +
      "</section>";

    bindSearchInput();
  }

  function bindSearchInput() {
    var inp = document.getElementById("search-input");
    if (!inp) return;
    inp.addEventListener("input", function () {
      runtime.searchQuery = inp.value;
      var cursorPos = inp.selectionStart;
      renderHomeView();
      var newInp = document.getElementById("search-input");
      if (newInp) {
        newInp.focus();
        try {
          newInp.setSelectionRange(cursorPos, cursorPos);
        } catch (e) {}
      }
    });
  }

  function renderCategoryView(catId) {
    var main = document.getElementById("app-main");
    if (!main) return;
    renderCounterDock(null);

    var cat = getCategoryById(catId);
    if (!cat) {
      window.location.hash = "#/";
      return;
    }

    var items = CATALOG.articles.filter(function (a) {
      return a.categoryId === cat.id;
    });

    var contentHtml = items.length
      ? '<div class="articles-list">' +
        items.map(renderArticleCardHTML).join("") +
        "</div>"
      : '<div class="empty-state-box">' +
        "<h2>Материалы этой рубрики готовятся к переносу</h2>" +
        "<p>" +
        escapeHtml(
          cat.comingSoonNote ||
            "На первом тестовом этапе загружены 3 описания из рубрик «Носки», «Шапки» и «Шали»."
        ) +
        "</p>" +
        '<a href="#/" class="btn btn-primary" style="margin-top:12px;">← Вернуться к готовым описаниям</a>' +
        "</div>";

    main.innerHTML =
      '<div class="hero-box">' +
      '<span class="article-cat-pill">Рубрика ' +
      escapeHtml(cat.code) +
      "</span>" +
      '<h1 class="hero-title">' +
      escapeHtml(cat.title) +
      "</h1>" +
      '<p class="hero-subtitle">' +
      escapeHtml(cat.description) +
      "</p>" +
      "</div>" +
      contentHtml;
  }

  function renderFavoritesView() {
    var main = document.getElementById("app-main");
    if (!main) return;
    renderCounterDock(null);

    var favArticles = CATALOG.articles.filter(function (a) {
      return isFavorite(a.slug);
    });

    var listHtml = favArticles.length
      ? '<div class="articles-list">' +
        favArticles.map(renderArticleCardHTML).join("") +
        "</div>"
      : '<div class="empty-state-box">' +
        "<h2>В разделе «Моё любимое» пока пусто</h2>" +
        "<p>Нажмите кнопку <strong>«♡ Отложить в любимое»</strong> на любом понравившемся узоре — он появится здесь без паролей и регистрации.</p>" +
        '<a href="#/" class="btn btn-primary" style="margin-top:12px;">Посмотреть каталог описаний</a>' +
        "</div>";

    main.innerHTML =
      '<div class="hero-box">' +
      '<h1 class="hero-title">♥ Моё любимое</h1>' +
      '<p class="hero-subtitle">Отложенные описания сохраняются прямо на вашем телефоне.</p>' +
      "</div>" +
      listHtml;
  }

  function renderArticleView(slug) {
    var main = document.getElementById("app-main");
    if (!main) return;

    var article = getArticleBySlug(slug);
    if (!article) {
      window.location.hash = "#/";
      return;
    }

    // Запоминаем последнее открытое описание для карточки «Продолжить вязание»
    state.lastOpened = { slug: article.slug, updatedAt: Date.now() };
    ensureCounterState(article);
    saveState();

    runtime.tts.currentIndex = 0;

    var fav = isFavorite(article.slug);
    var favBtnLabel = fav
      ? "♥ В любимом (сохранено)"
      : "♡ Отложить в любимое";
    var favBtnCls = fav ? " btn-fav-active" : "";

    var specsHtml = (article.specs || [])
      .map(function (sp) {
        return (
          '<li class="specs-item">' +
          '<span class="specs-label">' +
          escapeHtml(sp.label) +
          "</span>" +
          '<span class="specs-val">' +
          escapeHtml(sp.value) +
          "</span>" +
          "</li>"
        );
      })
      .join("");

    var chartsHtml = (article.charts || [])
      .map(function (ch) {
        return (
          '<div class="chart-preview-box">' +
          '<h3 class="chart-preview-title">' +
          escapeHtml(ch.title) +
          "</h3>" +
          '<p class="chart-preview-sub">' +
          escapeHtml(ch.subtitle || "") +
          "</p>" +
          (ch.hint
            ? '<p class="chart-hint-note"><strong>Подсказка:</strong> ' +
              escapeHtml(ch.hint) +
              "</p>"
            : "") +
          '<button type="button" class="chart-img-btn" data-action="open-chart" data-slug="' +
          escapeHtml(article.slug) +
          '" data-chart-id="' +
          escapeHtml(ch.id) +
          '" aria-label="Увеличить схему ' +
          escapeHtml(ch.title) +
          ' на весь экран">' +
          '<img src="' +
          escapeHtml(ch.src) +
          '" alt="' +
          escapeHtml(ch.title) +
          '">' +
          "</button>" +
          '<button type="button" class="btn btn-primary btn-block" data-action="open-chart" data-slug="' +
          escapeHtml(article.slug) +
          '" data-chart-id="' +
          escapeHtml(ch.id) +
          '">🔍 Открыть эту схему на весь экран (с линейкой рядов)</button>' +
          "</div>"
        );
      })
      .join("");

    var glossaryHtml = (article.glossary || [])
      .map(function (g) {
        return (
          '<div class="glossary-item">' +
          '<div class="glossary-term">' +
          escapeHtml(g.term) +
          "</div>" +
          '<p class="glossary-def">' +
          escapeHtml(g.definition) +
          "</p>" +
          "</div>"
        );
      })
      .join("");

    var checkedForSlug = state.checkedSteps[article.slug] || {};
    var stepGlobalIdx = 0;

    var sectionsHtml = (article.sections || [])
      .map(function (sec) {
        var linkedChartBtn = "";
        if (sec.chartId) {
          linkedChartBtn =
            '<button type="button" class="btn btn-secondary stage-open-chart-btn no-print" data-action="open-chart" data-slug="' +
            escapeHtml(article.slug) +
            '" data-chart-id="' +
            escapeHtml(sec.chartId) +
            '">🔍 Открыть схему к этому этапу</button>';
        }

        var stepsHtml = (sec.steps || [])
          .map(function (st) {
            var myIdx = stepGlobalIdx++;
            var isDone = !!checkedForSlug[st.id];
            return (
              '<div class="step-item' +
              (isDone ? " is-done" : "") +
              '" data-step-id="' +
              escapeHtml(st.id) +
              '">' +
              '<div class="step-top-bar">' +
              '<label class="step-check-label">' +
              '<input type="checkbox" class="step-checkbox" data-action="check-step" data-slug="' +
              escapeHtml(article.slug) +
              '" data-step-id="' +
              escapeHtml(st.id) +
              '"' +
              (isDone ? " checked" : "") +
              ">" +
              "<span>" +
              escapeHtml(st.label) +
              "</span>" +
              "</label>" +
              '<button type="button" class="step-speak-btn no-print" data-action="speak-step" data-slug="' +
              escapeHtml(article.slug) +
              '" data-step-index="' +
              myIdx +
              '">🔊 Озвучить шаг</button>' +
              "</div>" +
              '<p class="step-text">' +
              escapeHtml(st.text) +
              "</p>" +
              "</div>"
            );
          })
          .join("");

        return (
          '<section class="stage-card">' +
          '<div class="stage-header">' +
          '<h2 class="stage-title">' +
          escapeHtml(sec.title) +
          "</h2>" +
          linkedChartBtn +
          "</div>" +
          '<div class="steps-list">' +
          stepsHtml +
          "</div>" +
          "</section>"
        );
      })
      .join("");

    var extraPhotos = (article.photos || []).slice(1);
    var galleryHtml = extraPhotos.length
      ? '<section class="specs-card">' +
        '<h2 class="card-block-title">Дополнительные фотографии модели</h2>' +
        '<div class="photos-stack">' +
        extraPhotos
          .map(function (ph) {
            return (
              '<figure class="photo-figure">' +
              '<img src="' +
              escapeHtml(ph.src) +
              '" alt="' +
              escapeHtml(ph.caption) +
              '" loading="lazy">' +
              '<figcaption class="photo-caption">' +
              escapeHtml(ph.caption) +
              "</figcaption>" +
              "</figure>"
            );
          })
          .join("") +
        "</div>" +
        "</section>"
      : "";

    var speedOptions = [
      { val: 0.75, label: "Медленно" },
      { val: 0.85, label: "Спокойно" },
      { val: 1.0, label: "Обычно" }
    ];
    var speedChipsHtml = speedOptions
      .map(function (opt) {
        var sel = Math.abs((state.ttsRate || 0.85) - opt.val) < 0.03 ? " is-selected" : "";
        return (
          '<button type="button" class="speed-chip' +
          sel +
          '" data-action="tts-speed" data-rate="' +
          opt.val +
          '">' +
          opt.label +
          "</button>"
        );
      })
      .join("");

    main.innerHTML =
      // 1. Шапка описания
      '<article>' +
      '<header class="article-header-card">' +
      '<span class="article-cat-pill">Рубрика: ' +
      escapeHtml(article.categoryTitle) +
      "</span>" +
      '<h1 class="article-title-main">' +
      escapeHtml(article.title) +
      "</h1>" +
      '<p class="article-subtitle-main">' +
      escapeHtml(article.subtitle) +
      "</p>" +
      '<div class="article-hero-photo-wrap">' +
      '<img src="' +
      escapeHtml(article.coverImage) +
      '" alt="' +
      escapeHtml(article.title) +
      '" class="article-hero-photo">' +
      "</div>" +
      '<div class="article-top-actions no-print">' +
      '<button type="button" id="btn-article-fav" class="btn btn-secondary' +
      favBtnCls +
      '" data-action="toggle-fav" data-slug="' +
      escapeHtml(article.slug) +
      '">' +
      favBtnLabel +
      "</button>" +
      '<a href="#charts-anchor" class="btn btn-primary" data-action="jump-charts">🔍 Перейти сразу к схемам (' +
      article.charts.length +
      ")</a>" +
      "</div>" +
      "</header>" +
      // 2. Индикатор «Экран не гаснет»
      '<div id="wakelock-bar" class="wakelock-bar no-print">' +
      '<span id="wakelock-status-text" class="wakelock-status-text">☀ Проверяем защиту экрана от гашения…</span>' +
      '<button type="button" id="btn-wakelock-toggle" class="wakelock-toggle-btn" data-action="toggle-wakelock">Переключить</button>' +
      "</div>" +
      // 3. Голосовое чтение описания вслух
      '<section class="tts-card no-print" aria-label="Голосовое чтение описания">' +
      '<div class="tts-card-header">' +
      "<div>" +
      '<h2 class="tts-title">🔊 Слушать описание голосом (руки свободны)</h2>' +
      '<p id="tts-status-sub" class="tts-sub">Спокойный голос зачитает ряды по порядку, расшифровывая все сокращения (лиц., изн., п.).</p>' +
      "</div>" +
      "</div>" +
      '<div class="tts-controls-grid">' +
      '<button type="button" id="btn-tts-play" class="btn btn-green btn-tts-main" data-action="tts-play" data-slug="' +
      escapeHtml(article.slug) +
      '">🔊 Читать описание вслух</button>' +
      '<button type="button" class="btn btn-secondary" data-action="tts-repeat" data-slug="' +
      escapeHtml(article.slug) +
      '">↺ Повторить шаг</button>' +
      '<button type="button" class="btn btn-secondary" data-action="tts-next" data-slug="' +
      escapeHtml(article.slug) +
      '">Дальше →</button>' +
      "</div>" +
      '<div class="tts-speed-row">' +
      '<span class="tts-speed-label">Скорость голоса:</span>' +
      speedChipsHtml +
      '<button type="button" class="speed-chip" data-action="tts-stop" style="margin-left:auto;">⏹ Стоп</button>' +
      "</div>" +
      "</section>" +
      // 4. Паспорт изделия (Размеры, пряжа, спицы, плотность)
      '<section class="specs-card">' +
      '<h2 class="card-block-title">Пряжа, спицы и плотность вязания</h2>' +
      '<ul class="specs-list">' +
      specsHtml +
      "</ul>" +
      "</section>" +
      // 5. Схемы узора (крупно + увеличение на весь экран с линейкой)
      '<section id="charts-anchor" class="charts-section-card">' +
      '<h2 class="card-block-title">Схемы узора (нажмите, чтобы открыть на весь экран)</h2>' +
      '<div class="charts-stack">' +
      chartsHtml +
      "</div>" +
      "</section>" +
      // 6. Условные обозначения и приёмы
      '<section class="glossary-card">' +
      '<h2 class="card-block-title">Узоры, петли и условные обозначения</h2>' +
      '<div class="glossary-list">' +
      glossaryHtml +
      "</div>" +
      "</section>" +
      // 7. Пошаговое выполнение работы
      sectionsHtml +
      // 8. Дополнительные фотографии
      galleryHtml +
      // 9. Печать крупным шрифтом + скачивание оригинального PDF со схемами
      '<section class="print-download-card no-print">' +
      '<h2 class="card-block-title">Распечатать на бумаге или сохранить PDF</h2>' +
      '<p style="margin:0 0 16px;color:var(--text-muted);">Вы можете распечатать чистое описание очень крупным шрифтом без лишних кнопок или открыть оригинальный архивный PDF со всеми схемами.</p>' +
      '<div class="article-card-actions">' +
      '<button type="button" class="btn btn-primary" data-action="print-large">🖨 Печать / сохранить крупным шрифтом</button>' +
      '<a href="' +
      escapeHtml(article.originalPdf) +
      '" target="_blank" rel="noopener" class="btn btn-secondary">📄 Открыть оригинальный PDF со схемами</a>' +
      "</div>" +
      '<p class="source-credit">Первоисточник модели: <a href="' +
      escapeHtml(article.sourceUrl) +
      '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(article.sourceName) +
      "</a></p>" +
      "</section>" +
      "</article>";

    renderCounterDock(article);
    acquireWakeLockIfNeeded();
  }

  // ==========================================================================
  // 11. МАРШРУТИЗАТОР И ОБРАБОТЧИКИ СОБЫТИЙ
  // ==========================================================================

  function parseHash() {
    var hash = window.location.hash || "#/";
    if (hash.indexOf("#/article/") === 0) {
      return {
        view: "article",
        param: decodeURIComponent(hash.slice("#/article/".length))
      };
    }
    if (hash.indexOf("#/category/") === 0) {
      return {
        view: "category",
        param: decodeURIComponent(hash.slice("#/category/".length))
      };
    }
    if (hash.indexOf("#/favorites") === 0) {
      return { view: "favorites", param: null };
    }
    return { view: "home", param: null };
  }

  function handleRouteChange() {
    stopTts();
    if (runtime.chartModal.isOpen) {
      closeChartModal();
    }

    var route = parseHash();
    runtime.currentRoute = route;
    updateHeaderNavigation(route);

    if (route.view === "article") {
      renderArticleView(route.param);
    } else if (route.view === "category") {
      releaseWakeLock();
      renderCategoryView(route.param);
    } else if (route.view === "favorites") {
      releaseWakeLock();
      renderFavoritesView();
    } else {
      releaseWakeLock();
      renderHomeView();
    }

    window.scrollTo(0, 0);
  }

  function bindGlobalEvents() {
    // Кнопки шапки
    var fontBtn = document.getElementById("btn-font-scale");
    if (fontBtn) fontBtn.addEventListener("click", cycleFontScale);

    var themeBtn = document.getElementById("btn-theme-toggle");
    if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

    // Делегирование всех кнопок с атрибутом data-action
    document.addEventListener("click", function (e) {
      // Любое касание на странице описания помогает активировать Wake Lock на мобильных браузерах
      if (
        runtime.currentRoute.view === "article" &&
        state.wakeLockEnabled &&
        !runtime.wakeLockActive
      ) {
        acquireWakeLockIfNeeded();
      }

      var btn = e.target.closest("[data-action]");
      if (!btn) return;

      var action = btn.getAttribute("data-action");
      var slug = btn.getAttribute("data-slug");

      if (action === "toggle-fav" && slug) {
        e.preventDefault();
        var nowFav = toggleFavorite(slug);
        if (runtime.currentRoute.view === "favorites") {
          renderFavoritesView();
        } else {
          btn.textContent = nowFav
            ? "♥ В любимом (сохранено)"
            : "♡ Отложить в любимое";
          btn.classList.toggle("btn-fav-active", nowFav);
          var favCountPill = document.querySelector(".fav-count-pill");
          if (favCountPill) favCountPill.textContent = String(state.favorites.length);
        }
        return;
      }

      if (action === "clear-search") {
        e.preventDefault();
        runtime.searchQuery = "";
        renderHomeView();
        return;
      }

      if (action === "voice-search") {
        e.preventDefault();
        startVoiceSearch();
        return;
      }

      if (action === "jump-charts") {
        e.preventDefault();
        var anchor = document.getElementById("charts-anchor");
        if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      if (action === "toggle-wakelock") {
        e.preventDefault();
        state.wakeLockEnabled = !state.wakeLockEnabled;
        saveState();
        acquireWakeLockIfNeeded();
        showToast(
          state.wakeLockEnabled
            ? "☀ Включена защита от гашения экрана"
            : "🌙 Защита от гашения экрана выключена"
        );
        return;
      }

      // Озвучка описания (TTS)
      if (action === "tts-play" && slug) {
        var artPlay = getArticleBySlug(slug);
        if (artPlay) togglePlayPauseTts(artPlay);
        return;
      }

      if (action === "tts-repeat" && slug) {
        var artRep = getArticleBySlug(slug);
        if (artRep) speakStepAtIndex(artRep, runtime.tts.currentIndex || 0, true);
        return;
      }

      if (action === "tts-next" && slug) {
        var artNext = getArticleBySlug(slug);
        if (artNext) {
          var nextIdx = runtime.tts.speaking
            ? runtime.tts.currentIndex + 1
            : (runtime.tts.currentIndex || 0) + 1;
          speakStepAtIndex(artNext, nextIdx, true);
        }
        return;
      }

      if (action === "tts-stop") {
        stopTts();
        return;
      }

      if (action === "tts-speed") {
        var rate = parseFloat(btn.getAttribute("data-rate") || "0.85");
        state.ttsRate = rate;
        saveState();
        var chips = document.querySelectorAll("[data-action='tts-speed']");
        for (var i = 0; i < chips.length; i++) {
          chips[i].classList.toggle("is-selected", chips[i] === btn);
        }
        if (runtime.tts.speaking && runtime.tts.articleSlug) {
          var curArt = getArticleBySlug(runtime.tts.articleSlug);
          if (curArt) speakStepAtIndex(curArt, runtime.tts.currentIndex, true);
        } else {
          showToast("Скорость чтения сохранена");
        }
        return;
      }

      if (action === "speak-step" && slug) {
        var stepIdx = parseInt(btn.getAttribute("data-step-index") || "0", 10);
        var artStep = getArticleBySlug(slug);
        if (artStep) {
          if (
            runtime.tts.speaking &&
            !runtime.tts.paused &&
            runtime.tts.currentIndex === stepIdx
          ) {
            stopTts();
          } else {
            speakStepAtIndex(artStep, stepIdx, true);
          }
        }
        return;
      }

      // Открытие схемы на весь экран
      if (action === "open-chart" && slug) {
        var chartId = btn.getAttribute("data-chart-id");
        openChartModal(slug, chartId);
        return;
      }

      // Печать крупным шрифтом
      if (action === "print-large") {
        stopTts();
        window.print();
        return;
      }

      // Счётчик рядов
      if (action === "cnt-plus" && slug) {
        changeRowCount(slug, 1);
        return;
      }
      if (action === "cnt-minus" && slug) {
        changeRowCount(slug, -1);
        return;
      }
      if (action === "cnt-reset" && slug) {
        requestResetCounter(slug);
        return;
      }
      if (action === "cnt-part" && slug) {
        switchCounterPart(slug, btn.getAttribute("data-part"));
        return;
      }
      if (action === "cnt-collapse" && slug) {
        toggleCounterCollapse(slug);
        return;
      }
    });

    // Чекбоксы выполненных этапов
    document.addEventListener("change", function (e) {
      var cb = e.target.closest("[data-action='check-step']");
      if (!cb) return;
      var slug = cb.getAttribute("data-slug");
      var stepId = cb.getAttribute("data-step-id");
      if (!slug || !stepId) return;

      if (!state.checkedSteps[slug]) state.checkedSteps[slug] = {};
      state.checkedSteps[slug][stepId] = cb.checked;
      saveState();

      var card = cb.closest(".step-item");
      if (card) card.classList.toggle("is-done", cb.checked);
    });

    // Кнопки внутри полноэкранного окна схемы
    document.getElementById("btn-chart-close").addEventListener("click", closeChartModal);
    document.getElementById("btn-zoom-in").addEventListener("click", function () {
      zoomChartAroundPoint(1.35);
    });
    document.getElementById("btn-zoom-out").addEventListener("click", function () {
      zoomChartAroundPoint(1 / 1.35);
    });
    document.getElementById("btn-zoom-reset").addEventListener("click", fitChartToViewport);

    document.getElementById("btn-toggle-ruler").addEventListener("click", function () {
      state.rulerVisible = !state.rulerVisible;
      saveState();
      var rulerEl = document.getElementById("chart-ruler");
      var btn = document.getElementById("btn-toggle-ruler");
      if (rulerEl) rulerEl.hidden = !state.rulerVisible;
      if (btn) btn.setAttribute("aria-pressed", state.rulerVisible ? "true" : "false");
    });

    document.getElementById("btn-ruler-up").addEventListener("click", function () {
      var cur =
        state.rulerPositions[runtime.chartModal.chartId] !== undefined
          ? state.rulerPositions[runtime.chartModal.chartId]
          : 42;
      setRulerPercent(cur - 4);
    });

    document.getElementById("btn-ruler-down").addEventListener("click", function () {
      var cur =
        state.rulerPositions[runtime.chartModal.chartId] !== undefined
          ? state.rulerPositions[runtime.chartModal.chartId]
          : 42;
      setRulerPercent(cur + 4);
    });

    document.getElementById("btn-chart-row-plus").addEventListener("click", function () {
      if (runtime.chartModal.articleSlug) {
        changeRowCount(runtime.chartModal.articleSlug, 1);
      }
    });

    document.getElementById("btn-chart-row-minus").addEventListener("click", function () {
      if (runtime.chartModal.articleSlug) {
        changeRowCount(runtime.chartModal.articleSlug, -1);
      }
    });

    // Модальное окно подтверждения сброса счётчика
    document.getElementById("btn-confirm-cancel").addEventListener("click", closeConfirmDialog);
    document.getElementById("btn-confirm-yes").addEventListener("click", function () {
      var fn = runtime.pendingConfirmAction;
      closeConfirmDialog();
      if (typeof fn === "function") fn();
    });

    // Клавиша Escape закрывает модальные окна
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!document.getElementById("confirm-modal").hidden) {
          closeConfirmDialog();
        } else if (runtime.chartModal.isOpen) {
          closeChartModal();
        }
      }
    });

    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener("resize", function () {
      if (runtime.chartModal.isOpen) {
        clampChartPan();
        applyChartTransform();
      }
    });
  }

  // ==========================================================================
  // 12. РЕГИСТРАЦИЯ SERVICE WORKER ДЛЯ РАБОТЫ ОФЛАЙН (НА ДАЧЕ / БЕЗ СЕТИ)
  // ==========================================================================

  function registerOfflineWorker() {
    if ("serviceWorker" in navigator && window.location.protocol.indexOf("http") === 0) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("./sw.js").catch(function () {});
      });
    }
  }

  // Запуск приложения
  applyVisualPreferences();
  initChartModalGestures();
  bindGlobalEvents();
  handleRouteChange();
  registerOfflineWorker();
})();
