/* ==========================================================================
   КНИГА ВЯЗАНИЯ СПИЦАМИ — Интерактивное ядро 2026 (v3)
   Плоский природный стиль, всплывающее Избранное, полная озвучка 0.6x без обрывов,
   схемы во весь экран с кружком-подсказкой и туториал в стиле матового стекла со стрелочкой.
   ========================================================================== */

(function () {
  "use strict";

  var STORAGE_KEY = "kniga_vyazaniya_state_v3";
  var PREV_KEYS = ["kniga_vyazaniya_state_v2", "kniga_vyazaniya_state_v1"];
  var CATALOG = window.KNITTING_CATALOG || { categories: [], articles: [] };

  // По умолчанию очень медленная скорость 0.6x
  var TTS_SPEEDS = [0.6, 0.75, 0.9, 0.5];

  var defaultState = {
    fontScale: "normal",        // 'normal' (20px) | 'large' (23px) | 'xlarge' (26px)
    theme: "day",               // 'day' | 'evening'
    favorites: [],              // массив slug
    lastOpened: null,           // { slug: string, updatedAt: number }
    ttsRate: 0.6,               // очень медленный голос по умолчанию (0.6x)
    micPermissionGranted: false,// скрывать ли надпись про доступ к микрофону
    seenHints: {}               // { homeCard: true, voiceBtn: true }
  };

  var state = loadState();

  var runtime = {
    currentRoute: { view: "home", param: null },
    searchQuery: "",
    lastScrollY: 0,
    favPopupOpen: false,
    wakeLockSentinel: null,
    wakeLockSupported: "wakeLock" in navigator,
    tts: {
      supported: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
      active: false,
      speaking: false,
      paused: false,
      articleSlug: null,
      stepsQueue: [],
      currentIndex: 0,
      chunks: [],
      currentChunkIndex: 0,
      sessionToken: 0,
      utterPool: [],        // защита от сборки мусора мобильных браузеров
      speakDelayTimer: null,
      watchdogTimer: null,
      lastSpeakStartedAt: 0
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
      imgH: 1000,
      hintTimer: null,
      isLandscapeLocked: false
    },
    onboarding: {
      activeHintId: null,
      activeTargetEl: null,
      observer: null
    },
    toastTimer: null
  };

  // ==========================================================================
  // 1. ХРАНИЛИЩЕ НАСТРОЕК + БЕРЕЖНЫЙ ПЕРЕНОС ИЗБРАННОГО
  // ==========================================================================

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(defaultState));
  }

  function loadState() {
    var base = cloneDefaults();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        Object.keys(base).forEach(function (k) {
          if (parsed[k] !== undefined && parsed[k] !== null) {
            base[k] = parsed[k];
          }
        });
        return base;
      }
      for (var i = 0; i < PREV_KEYS.length; i++) {
        var oldRaw = localStorage.getItem(PREV_KEYS[i]);
        if (oldRaw) {
          var old = JSON.parse(oldRaw);
          if (Array.isArray(old.favorites)) base.favorites = old.favorites;
          if (old.fontScale) base.fontScale = old.fontScale;
          if (old.theme) base.theme = old.theme;
          if (old.lastOpened) base.lastOpened = old.lastOpened;
          break;
        }
      }
    } catch (e) {}
    return base;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
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

  function showToast(message) {
    var el = document.getElementById("toast-region");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    if (runtime.toastTimer) clearTimeout(runtime.toastTimer);
    runtime.toastTimer = setTimeout(function () {
      el.hidden = true;
    }, 2600);
  }

  // ==========================================================================
  // 2. ШАПКА САЙТА (АВТОСКРЫТИЕ ПРИ СКРОЛЛЕ ВНИЗ, А+ И ВЕЧЕРНИЙ РЕЖИМ)
  // ==========================================================================

  function applyVisualPreferences() {
    var html = document.documentElement;
    html.setAttribute("data-font-scale", state.fontScale);
    html.setAttribute("data-theme", state.theme);

    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute("content", state.theme === "evening" ? "#EAE5DA" : "#F7F6F1");
    }

    var scaleLabel = document.getElementById("font-scale-label");
    if (scaleLabel) {
      var map = {
        normal: "100%",
        large: "Крупно",
        xlarge: "Макс."
      };
      scaleLabel.textContent = map[state.fontScale] || "100%";
    }

    var themeBtn = document.getElementById("btn-theme-toggle");
    var themeIcon = document.getElementById("theme-icon");
    var themeLabel = document.getElementById("theme-label");
    if (themeBtn && themeIcon && themeLabel) {
      var isEvening = state.theme === "evening";
      themeBtn.setAttribute("aria-pressed", isEvening ? "true" : "false");
      themeIcon.textContent = isEvening ? "☀" : "🌙";
      themeLabel.textContent = isEvening ? "День" : "Вечер";
    }
  }

  function cycleFontScale() {
    var order = ["normal", "large", "xlarge"];
    var idx = order.indexOf(state.fontScale);
    state.fontScale = order[(idx + 1) % order.length];
    saveState();
    applyVisualPreferences();
    positionActiveCoachmark();

    var names = {
      normal: "Стандартный крупный шрифт",
      large: "Увеличенный шрифт",
      xlarge: "Максимально крупный шрифт"
    };
    showToast(names[state.fontScale]);
  }

  function toggleTheme() {
    state.theme = state.theme === "evening" ? "day" : "evening";
    saveState();
    applyVisualPreferences();
    showToast(state.theme === "evening" ? "Вечерний режим" : "Дневной режим");
  }

  function showHeaderBar() {
    var header = document.getElementById("site-header");
    if (header) header.classList.remove("is-hidden");
  }

  function initHeaderAutoHide() {
    runtime.lastScrollY = window.pageYOffset || 0;
    window.addEventListener(
      "scroll",
      function () {
        var header = document.getElementById("site-header");
        if (!header || runtime.chartModal.isOpen || runtime.favPopupOpen) return;

        var currentY = Math.max(0, window.pageYOffset || document.documentElement.scrollTop || 0);
        var delta = currentY - runtime.lastScrollY;

        if (currentY <= 40) {
          header.classList.remove("is-hidden");
        } else if (delta > 8 && currentY > 56) {
          header.classList.add("is-hidden");
        } else if (delta < -8) {
          header.classList.remove("is-hidden");
        }

        runtime.lastScrollY = currentY;
        positionActiveCoachmark();
      },
      { passive: true }
    );
  }

  // ==========================================================================
  // 3. ИЗБРАННОЕ: ИКОНКА «СЕРДЕЧКО» В ШАПКЕ + СОВРЕМЕННЫЙ POPUP ПОВЕРХ ЭКРАНА
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
    syncHeaderHeartBadge();
    showToast(added ? "Сохранено в Избранное" : "Убрано из Избранного");
    return added;
  }

  function syncHeaderHeartBadge() {
    var btn = document.getElementById("btn-header-fav");
    var badge = document.getElementById("header-fav-badge");
    var count = state.favorites.length;
    if (btn) {
      btn.classList.toggle("has-items", count > 0);
    }
    if (badge) {
      if (count > 0) {
        badge.textContent = String(count);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
  }

  function openFavoritesPopup() {
    var popup = document.getElementById("favorites-popup");
    if (!popup) return;
    dismissActiveCoachmark(false);
    renderFavoritesPopupContent();
    popup.hidden = false;
    runtime.favPopupOpen = true;
    document.body.style.overflow = "hidden";
  }

  function closeFavoritesPopup() {
    var popup = document.getElementById("favorites-popup");
    if (!popup) return;
    popup.hidden = true;
    runtime.favPopupOpen = false;
    if (!runtime.chartModal.isOpen) {
      document.body.style.overflow = "";
    }
  }

  function renderFavoritesPopupContent() {
    var listEl = document.getElementById("favorites-popup-list");
    if (!listEl) return;

    var favArticles = CATALOG.articles.filter(function (a) {
      return isFavorite(a.slug);
    });

    if (!favArticles.length) {
      listEl.innerHTML =
        '<div class="empty-state-box" style="background:rgba(255,255,255,0.65);box-shadow:none;">' +
        '<p style="margin:0 0 6px;font-weight:700;">Пока нет сохранённых тем</p>' +
        '<p style="margin:0;color:var(--text-muted);font-size:0.92rem;">Нажмите «♡ В избранное» на любом описании, и оно появится здесь.</p>' +
        "</div>";
      return;
    }

    listEl.innerHTML = favArticles
      .map(function (art) {
        return (
          '<div class="fav-glass-card">' +
          '<a href="#/article/' +
          encodeURIComponent(art.slug) +
          '" class="fav-glass-link" data-action="select-fav-item">' +
          '<img src="' +
          escapeHtml(art.coverImage) +
          '" alt="" class="fav-glass-thumb">' +
          '<span class="fav-glass-info">' +
          '<span class="fav-glass-title">' +
          escapeHtml(art.title) +
          "</span>" +
          '<span class="fav-glass-cat">' +
          escapeHtml(art.categoryTitle) +
          "</span>" +
          "</span>" +
          "</a>" +
          '<button type="button" class="fav-glass-remove" data-action="remove-fav-popup" data-slug="' +
          escapeHtml(art.slug) +
          '" aria-label="Убрать из избранного">✕</button>' +
          "</div>"
        );
      })
      .join("");
  }

  // ==========================================================================
  // 4. ФОНОВАЯ ЗАЩИТА ЭКРАНА ОТ ГАШЕНИЯ (БЕЗ ВИЗУАЛЬНОГО БЛОКА НА ЭКРАНЕ)
  // ==========================================================================

  async function syncSilentWakeLock() {
    var shouldHold =
      runtime.currentRoute.view === "article" || runtime.chartModal.isOpen;

    if (!shouldHold) {
      if (runtime.wakeLockSentinel) {
        try {
          await runtime.wakeLockSentinel.release();
        } catch (e) {}
        runtime.wakeLockSentinel = null;
      }
      return;
    }

    if (!runtime.wakeLockSupported) return;
    if (runtime.wakeLockSentinel && !runtime.wakeLockSentinel.released) return;

    try {
      runtime.wakeLockSentinel = await navigator.wakeLock.request("screen");
    } catch (e) {}
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      syncSilentWakeLock();
    }
  });

  // ==========================================================================
  // 5. ФУНКЦИЯ «ЧИТАТЬ ВСЛУХ» (0.6×, ДОЧИТЫВАНИЕ ДО КОНЦА БЕЗ ОБРЫВОВ, БОКОВЫЕ КНОПКИ)
  // ==========================================================================

  function expandKnittingAbbreviations(text) {
    var s = " " + String(text || "") + " ";

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

    s = s.replace(/(\d+)\s*[xх×]\s*(\d+)/gi, "$1 на $2");
    s = s.replace(/(\d+)\s*\/\s*(\d+)/g, "$1 $2");
    s = s.replace(/\bв\s+(\d+)\s*[–-]\s*(\d+)\b/gi, "с $1-го по $2-й");
    s = s.replace(/(^|\s)(\d+)\s*[–-]\s*(\d+)-й/g, "$1с $2-го по $3-й");
    s = s.replace(/(^|\s)(\d+)\s*[–-]\s*(\d+)-м/g, "$1с $2-го по $3-м");
    s = s.replace(/(\d+(?:,\d+)?)\s*[–-]\s*(\d+(?:,\d+)?)/g, "$1, $2");

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

    s = s.replace(/(^|\s)круг\.\s*р\.(?=\s|[.,;:)!?]|$)/g, "$1круговых рядов");
    s = s.replace(/(^|\s)круг\.(?=\s)/g, "$1круговых");
    s = s.replace(/(\d+)\s+р\.(?=\s|[.,;:)!?]|$)/g, "$1 рядов");
    s = s.replace(/(^|\s)ок\.(?=\s)/g, "$1около");
    s = s.replace(/(\d+(?:,\d+)?)\s*см(?=\s|[.,;:)!?]|$)/g, "$1 сантиметров");
    s = s.replace(/(\d+(?:,\d+)?)\s*мм(?=\s|[.,;:)!?]|$)/g, "$1 миллиметров");
    s = s.replace(/\*/g, " , повтор раппорта: ");

    // Убираем спецсимволы, которые могут обрывать мобильные синтезаторы речи
    s = s.replace(/[«»"“”]/g, " ");
    s = s.replace(/\s*[—–]\s*/g, ", ");

    return s.replace(/\s+/g, " ").trim();
  }

  /*
   * Короткие фразы до 75 символов гарантируют отсутствие 14-секундного обрыва
   * в Android Chrome и iOS Safari даже при самой медленной скорости 0.5x–0.6x.
   */
  function splitIntoSpeechChunks(fullText) {
    var clean = String(fullText || "").replace(/\s+/g, " ").trim();
    if (!clean) return [];

    var rawSentences = clean.replace(/([.!?;])\s+/g, "$1\n").split("\n");
    var chunks = [];
    var MAX_LEN = 75;

    for (var i = 0; i < rawSentences.length; i++) {
      var part = rawSentences[i].trim();
      if (!part) continue;

      while (part.length > MAX_LEN) {
        var cut = -1;
        var seps = [", ", ": ", ") "];
        for (var p = 0; p < seps.length; p++) {
          var idx = part.lastIndexOf(seps[p], MAX_LEN);
          if (idx > 24 && idx > cut) {
            cut = idx + seps[p].length - 1;
          }
        }
        if (cut === -1) {
          cut = part.lastIndexOf(" ", MAX_LEN);
        }
        if (cut <= 0) {
          cut = MAX_LEN;
        }
        chunks.push(part.slice(0, cut + 1).trim());
        part = part.slice(cut + 1).trim();
      }
      if (part) chunks.push(part);
    }

    return chunks;
  }

  function buildStepsQueueForArticle(article) {
    var queue = [];
    if (!article || !article.sections) return queue;
    article.sections.forEach(function (sec, secIdx) {
      sec.steps.forEach(function (st, stIdx) {
        // В начале каждого нового этапа озвучиваем и заголовок этапа
        var prefix = stIdx === 0 ? sec.title + ". " : "";
        queue.push({
          stepId: st.id,
          sectionIndex: secIdx,
          label: st.label,
          fullSpeechText: prefix + st.label + ". " + st.text
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

  function clearTtsTimers() {
    if (runtime.tts.speakDelayTimer) {
      clearTimeout(runtime.tts.speakDelayTimer);
      runtime.tts.speakDelayTimer = null;
    }
    if (runtime.tts.watchdogTimer) {
      clearInterval(runtime.tts.watchdogTimer);
      runtime.tts.watchdogTimer = null;
    }
  }

  function startTtsWatchdog(article) {
    if (runtime.tts.watchdogTimer) clearInterval(runtime.tts.watchdogTimer);
    runtime.tts.watchdogTimer = setInterval(function () {
      if (!runtime.tts.active || !runtime.tts.speaking || runtime.tts.paused) return;
      if (!runtime.tts.supported) return;

      var elapsed = Date.now() - runtime.tts.lastSpeakStartedAt;
      // Если мобильный браузер закончил фразу, но «проглотил» событие onend — двигаемся дальше!
      if (
        elapsed > 1600 &&
        !window.speechSynthesis.speaking &&
        !window.speechSynthesis.pending
      ) {
        runtime.tts.currentChunkIndex++;
        speakCurrentChunk(article);
      }
    }, 1200);
  }

  function stopTts() {
    runtime.tts.sessionToken++;
    clearTtsTimers();
    runtime.tts.utterPool = [];
    if (runtime.tts.supported) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
    runtime.tts.active = false;
    runtime.tts.speaking = false;
    runtime.tts.paused = false;
    runtime.tts.chunks = [];
    runtime.tts.currentChunkIndex = 0;
    document.body.classList.remove("tts-rail-open");
    highlightSpokenStep(null, false);
    updateTtsUI();
  }

  function speakCurrentChunk(article) {
    if (!runtime.tts.supported) return;

    var chunks = runtime.tts.chunks;
    if (runtime.tts.currentChunkIndex >= chunks.length) {
      // Текущий абзац дочитан полностью -> автоматически переходим к следующему до конца статьи!
      if (runtime.tts.currentIndex + 1 < runtime.tts.stepsQueue.length) {
        prepareAndSpeakStep(article, runtime.tts.currentIndex + 1, true, false);
      } else {
        stopTts();
        showToast("Текст прочитан до конца");
      }
      return;
    }

    var myToken = ++runtime.tts.sessionToken;
    var phrase = chunks[runtime.tts.currentChunkIndex];
    var utter = new SpeechSynthesisUtterance(phrase);

    // Кольцевой буфер защищает объект от удаления сборщиком мусора в Android/iOS
    runtime.tts.utterPool.push(utter);
    if (runtime.tts.utterPool.length > 6) {
      runtime.tts.utterPool.shift();
    }

    utter.lang = "ru-RU";
    utter.rate = state.ttsRate || 0.6;
    utter.pitch = 1.0;

    var voice = pickRussianVoice();
    if (voice) utter.voice = voice;

    utter.onend = function () {
      if (myToken !== runtime.tts.sessionToken) return;
      if (!runtime.tts.speaking || runtime.tts.paused) return;
      runtime.tts.currentChunkIndex++;
      speakCurrentChunk(article);
    };

    utter.onerror = function (ev) {
      if (myToken !== runtime.tts.sessionToken) return;
      if (ev && (ev.error === "interrupted" || ev.error === "canceled")) return;
      if (runtime.tts.speaking && !runtime.tts.paused) {
        runtime.tts.currentChunkIndex++;
        speakCurrentChunk(article);
      }
    };

    runtime.tts.lastSpeakStartedAt = Date.now();
    try {
      window.speechSynthesis.speak(utter);
    } catch (e) {
      stopTts();
    }
  }

  /*
   * needCancelFirst = true только при ручном переключении пользователем
   * (микро-задержка 55 мс устраняет баг Android Chrome, где cancel() отменяет следующий speak()).
   */
  function prepareAndSpeakStep(article, index, allowGentleScroll, needCancelFirst) {
    if (!runtime.tts.supported) {
      showToast("Голосовое чтение не поддерживается в этом браузере");
      return;
    }
    var queue = buildStepsQueueForArticle(article);
    if (!queue.length) return;
    if (index < 0) index = 0;
    if (index >= queue.length) {
      stopTts();
      showToast("Текст прочитан до конца");
      return;
    }

    runtime.tts.sessionToken++;
    if (runtime.tts.speakDelayTimer) {
      clearTimeout(runtime.tts.speakDelayTimer);
      runtime.tts.speakDelayTimer = null;
    }

    if (needCancelFirst) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }

    var item = queue[index];
    var expanded = expandKnittingAbbreviations(item.fullSpeechText);
    var chunks = splitIntoSpeechChunks(expanded);

    runtime.tts.articleSlug = article.slug;
    runtime.tts.stepsQueue = queue;
    runtime.tts.currentIndex = index;
    runtime.tts.chunks = chunks;
    runtime.tts.currentChunkIndex = 0;
    runtime.tts.active = true;
    runtime.tts.speaking = true;
    runtime.tts.paused = false;

    document.body.classList.add("tts-rail-open");
    highlightSpokenStep(item.stepId, !!allowGentleScroll);
    updateTtsUI();
    startTtsWatchdog(article);

    if (needCancelFirst) {
      runtime.tts.speakDelayTimer = setTimeout(function () {
        runtime.tts.speakDelayTimer = null;
        if (runtime.tts.active && runtime.tts.speaking && !runtime.tts.paused) {
          speakCurrentChunk(article);
        }
      }, 55);
    } else {
      speakCurrentChunk(article);
    }
  }

  function togglePlayPauseTts(article) {
    if (!runtime.tts.supported) {
      showToast("Голосовое чтение недоступно в вашем браузере");
      return;
    }
    if (!runtime.tts.active) {
      // Начинаем читать с самого начала текста описания (кнопка стоит прямо над ним!)
      prepareAndSpeakStep(article, 0, false, true);
      return;
    }
    if (runtime.tts.paused || !runtime.tts.speaking) {
      if (!runtime.tts.chunks.length) {
        prepareAndSpeakStep(article, runtime.tts.currentIndex || 0, false, true);
        return;
      }
      runtime.tts.paused = false;
      runtime.tts.speaking = true;
      var curStep = runtime.tts.stepsQueue[runtime.tts.currentIndex];
      if (curStep) highlightSpokenStep(curStep.stepId, false);
      updateTtsUI();
      startTtsWatchdog(article);
      runtime.tts.speakDelayTimer = setTimeout(function () {
        if (runtime.tts.active && runtime.tts.speaking && !runtime.tts.paused) {
          speakCurrentChunk(article);
        }
      }, 45);
    } else {
      runtime.tts.sessionToken++;
      clearTtsTimers();
      runtime.tts.paused = true;
      runtime.tts.speaking = false;
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
      updateTtsUI();
    }
  }

  function cycleTtsSpeed() {
    var cur = state.ttsRate || 0.6;
    var bestIdx = 0;
    for (var i = 0; i < TTS_SPEEDS.length; i++) {
      if (Math.abs(TTS_SPEEDS[i] - cur) < 0.03) {
        bestIdx = i;
        break;
      }
    }
    var nextRate = TTS_SPEEDS[(bestIdx + 1) % TTS_SPEEDS.length];
    state.ttsRate = nextRate;
    saveState();

    showToast("Скорость голоса: " + nextRate + "×");
    updateTtsUI();

    if (runtime.tts.active && runtime.tts.speaking && !runtime.tts.paused) {
      var art = getArticleBySlug(runtime.tts.articleSlug);
      if (art) {
        runtime.tts.sessionToken++;
        try {
          window.speechSynthesis.cancel();
        } catch (e) {}
        runtime.tts.speakDelayTimer = setTimeout(function () {
          if (runtime.tts.active && runtime.tts.speaking && !runtime.tts.paused) {
            speakCurrentChunk(art);
          }
        }, 55);
      }
    }
  }

  function highlightSpokenStep(stepId, allowGentleScroll) {
    var all = document.querySelectorAll(".step-row");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var btn = el.querySelector(".step-mini-speak");
      if (stepId && el.getAttribute("data-step-id") === stepId) {
        el.classList.add("is-speaking");
        if (btn) {
          btn.textContent = runtime.tts.paused ? "▶ Дальше" : "⏸ Пауза";
        }
        if (allowGentleScroll) {
          var rect = el.getBoundingClientRect();
          var vh = window.innerHeight || 640;
          if (rect.top < 64 || rect.bottom > vh - 40) {
            try {
              el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            } catch (e) {}
          }
        }
      } else {
        el.classList.remove("is-speaking");
        if (btn) btn.textContent = "🔊 Отсюда";
      }
    }
  }

  function updateTtsUI() {
    var rail = document.getElementById("tts-fab-rail");
    var toggleIcon = document.getElementById("fab-tts-toggle-icon");
    var toggleText = document.getElementById("fab-tts-toggle-text");
    var speedVal = document.getElementById("fab-tts-speed-val");
    var mainBtn = document.getElementById("btn-voice-main");

    if (speedVal) {
      speedVal.textContent = (state.ttsRate || 0.6) + "×";
    }

    if (rail) {
      rail.hidden = !runtime.tts.active;
    }

    if (toggleIcon && toggleText) {
      if (runtime.tts.speaking && !runtime.tts.paused) {
        toggleIcon.textContent = "⏸";
        toggleText.textContent = "Пауза";
      } else {
        toggleIcon.textContent = "▶";
        toggleText.textContent = "Старт";
      }
    }

    if (mainBtn) {
      if (!runtime.tts.active) {
        mainBtn.textContent = "🔊 Читать вслух";
      } else if (runtime.tts.speaking && !runtime.tts.paused) {
        mainBtn.textContent = "⏸ Пауза";
      } else {
        mainBtn.textContent = "▶ Продолжить чтение";
      }
    }

    if (runtime.tts.active && runtime.tts.stepsQueue[runtime.tts.currentIndex]) {
      var sid = runtime.tts.stepsQueue[runtime.tts.currentIndex].stepId;
      highlightSpokenStep(sid, false);
    }
  }

  if (runtime.tts.supported && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = function () {};
  }

  // ==========================================================================
  // 6. СХЕМЫ УЗОРОВ ВО ВЕСЬ ЭКРАН + ВСПЛЫВАЮЩАЯ ПОДСКАЗКА И МАЛЕНЬКИЙ КРУЖОК
  // ==========================================================================

  function clearChartHintTimer() {
    if (runtime.chartModal.hintTimer) {
      clearTimeout(runtime.chartModal.hintTimer);
      runtime.chartModal.hintTimer = null;
    }
  }

  function showChartHintForSeconds(seconds) {
    var bubble = document.getElementById("chart-hint-bubble");
    var dot = document.getElementById("chart-hint-dot");
    if (!bubble || !dot) return;

    clearChartHintTimer();
    bubble.hidden = false;
    dot.hidden = true;

    runtime.chartModal.hintTimer = setTimeout(function () {
      collapseChartHintToDot();
    }, seconds * 1000);
  }

  function collapseChartHintToDot() {
    clearChartHintTimer();
    var bubble = document.getElementById("chart-hint-bubble");
    var dot = document.getElementById("chart-hint-dot");
    if (bubble) bubble.hidden = true;
    if (dot) dot.hidden = false;
  }

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
      ? chartObj.hint || chartObj.subtitle || "Раздвигайте схему двумя пальцами для увеличения."
      : directHint || "Раздвигайте изображение двумя пальцами или поверните телефон горизонтально.";

    var modal = document.getElementById("chart-modal");
    var titleEl = document.getElementById("chart-modal-title");
    var hintEl = document.getElementById("chart-modal-hint");
    var imgEl = document.getElementById("chart-modal-img");

    if (!modal || !imgEl || !src) return;

    dismissActiveCoachmark(false);

    runtime.chartModal.isOpen = true;
    runtime.chartModal.articleSlug = articleSlug;
    runtime.chartModal.chartId = chartId || src;

    titleEl.textContent = title;
    hintEl.textContent = hint;
    modal.hidden = false;
    document.body.style.overflow = "hidden";

    // Подсказка появляется на 12 секунд (10–15 сек), затем остаётся маленький кружок
    showChartHintForSeconds(12);
    syncSilentWakeLock();

    var applyLoadedDimensions = function () {
      if (!runtime.chartModal.isOpen) return;
      runtime.chartModal.imgW = imgEl.naturalWidth || 1000;
      runtime.chartModal.imgH = imgEl.naturalHeight || 1000;
      requestAnimationFrame(function () {
        fitChartToViewport();
      });
    };

    imgEl.onload = applyLoadedDimensions;
    imgEl.src = src;
    imgEl.alt = title;
    if (imgEl.complete && imgEl.naturalWidth > 0) {
      applyLoadedDimensions();
    }
  }

  function closeChartModal() {
    clearChartHintTimer();
    var modal = document.getElementById("chart-modal");
    if (modal) modal.hidden = true;
    runtime.chartModal.isOpen = false;
    if (!runtime.favPopupOpen) {
      document.body.style.overflow = "";
    }

    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
    if (screen.orientation && screen.orientation.unlock) {
      try {
        screen.orientation.unlock();
      } catch (e) {}
    }
    runtime.chartModal.isLandscapeLocked = false;
    syncSilentWakeLock();
  }

  function toggleChartLandscapeMode() {
    var modal = document.getElementById("chart-modal");
    if (!modal) return;

    if (!runtime.chartModal.isLandscapeLocked) {
      var reqFs =
        modal.requestFullscreen ||
        modal.webkitRequestFullscreen ||
        document.documentElement.requestFullscreen;
      if (reqFs) {
        Promise.resolve(reqFs.call(modal))
          .then(function () {
            if (screen.orientation && screen.orientation.lock) {
              return screen.orientation.lock("landscape");
            }
          })
          .then(function () {
            runtime.chartModal.isLandscapeLocked = true;
            setTimeout(fitChartToViewport, 180);
          })
          .catch(function () {
            showToast("Поверните телефон горизонтально для максимального просмотра");
            setTimeout(fitChartToViewport, 180);
          });
      } else {
        showToast("Поверните телефон горизонтально для максимального просмотра");
      }
    } else {
      if (screen.orientation && screen.orientation.unlock) {
        try {
          screen.orientation.unlock();
        } catch (e) {}
      }
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(function () {});
      }
      runtime.chartModal.isLandscapeLocked = false;
      setTimeout(fitChartToViewport, 180);
    }
  }

  function fitChartToViewport() {
    var vp = document.getElementById("chart-viewport");
    if (!vp) return;
    var vw = vp.clientWidth || window.innerWidth || 360;
    var vh = vp.clientHeight || window.innerHeight || 640;
    var iw = runtime.chartModal.imgW || 1000;
    var ih = runtime.chartModal.imgH || 1000;

    var pad = 4;
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
    var vw = vp.clientWidth || window.innerWidth || 360;
    var vh = vp.clientHeight || window.innerHeight || 640;
    var sw = runtime.chartModal.imgW * runtime.chartModal.scale;
    var sh = runtime.chartModal.imgH * runtime.chartModal.scale;

    if (sw <= vw) {
      runtime.chartModal.tx = Math.round((vw - sw) / 2);
    } else {
      runtime.chartModal.tx = Math.max(vw - sw - 24, Math.min(24, runtime.chartModal.tx));
    }

    if (sh <= vh) {
      runtime.chartModal.ty = Math.round((vh - sh) / 2);
    } else {
      runtime.chartModal.ty = Math.max(vh - sh - 24, Math.min(24, runtime.chartModal.ty));
    }
  }

  function zoomChartAroundPoint(factor, cx, cy) {
    var vp = document.getElementById("chart-viewport");
    if (!vp) return;
    if (cx === undefined || cy === undefined) {
      cx = vp.clientWidth / 2;
      cy = vp.clientHeight / 2;
    }

    var minScale = runtime.chartModal.fitScale * 0.9;
    var maxScale = runtime.chartModal.fitScale * 6.0;
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
  }

  function initChartModalGestures() {
    var vp = document.getElementById("chart-viewport");
    if (!vp) return;

    var draggingPan = false;
    var panStartX = 0;
    var panStartY = 0;
    var origTx = 0;
    var origTy = 0;

    var pinching = false;
    var startPinchDist = 0;
    var lastTapTime = 0;

    function getTouchDist(t1, t2) {
      var dx = t1.clientX - t2.clientX;
      var dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    vp.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length === 2) {
          pinching = true;
          draggingPan = false;
          startPinchDist = getTouchDist(e.touches[0], e.touches[1]);
        } else if (e.touches.length === 1) {
          var now = Date.now();
          if (now - lastTapTime < 280) {
            var rect = vp.getBoundingClientRect();
            var tx = e.touches[0].clientX - rect.left;
            var ty = e.touches[0].clientY - rect.top;
            if (runtime.chartModal.scale > runtime.chartModal.fitScale * 1.25) {
              fitChartToViewport();
            } else {
              zoomChartAroundPoint(2.2, tx, ty);
            }
            lastTapTime = 0;
            return;
          }
          lastTapTime = now;

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

    var mouseDown = false;
    vp.addEventListener("mousedown", function (e) {
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
        var factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
        zoomChartAroundPoint(factor, e.clientX - rect.left, e.clientY - rect.top);
      },
      { passive: false }
    );
  }

  // ==========================================================================
  // 7. ОБУЧЕНИЕ: МАТОВОЕ СТЕКЛО + СТРЕЛОЧКА ТОЧНО НА КНОПКУ + ТОЧНЫЙ ТЕКСТ ТЗ
  // ==========================================================================

  function disconnectOnboardingObserver() {
    if (runtime.onboarding.observer) {
      runtime.onboarding.observer.disconnect();
      runtime.onboarding.observer = null;
    }
  }

  function dismissActiveCoachmark(markSeen) {
    if (markSeen && runtime.onboarding.activeHintId) {
      state.seenHints[runtime.onboarding.activeHintId] = true;
      saveState();
    }
    if (runtime.onboarding.activeTargetEl) {
      runtime.onboarding.activeTargetEl.removeAttribute("data-coach-highlight");
      runtime.onboarding.activeTargetEl = null;
    }
    runtime.onboarding.activeHintId = null;
    var pop = document.getElementById("onboarding-popover");
    if (pop) pop.hidden = true;
  }

  function positionActiveCoachmark() {
    var pop = document.getElementById("onboarding-popover");
    var target = runtime.onboarding.activeTargetEl;
    if (!pop || pop.hidden || !target) return;

    var rect = target.getBoundingClientRect();
    var vw = window.innerWidth || 390;
    var vh = window.innerHeight || 800;

    // Если кнопка полностью ушла за пределы экрана — временно не сдвигаем в пустоту
    if (rect.bottom < 0 || rect.top > vh) return;

    var popWidth = Math.min(vw - 32, 370);
    pop.style.width = popWidth + "px";

    var targetCenterX = rect.left + rect.width / 2;
    var left = Math.round(targetCenterX - popWidth / 2);
    left = Math.max(16, Math.min(vw - popWidth - 16, left));
    pop.style.left = left + "px";

    var arrowLeft = Math.max(24, Math.min(popWidth - 24, targetCenterX - left));
    pop.style.setProperty("--arrow-left", arrowLeft + "px");

    var popHeight = pop.offsetHeight || 150;
    var spaceBelow = vh - rect.bottom;

    if (spaceBelow >= popHeight + 24 || rect.top < popHeight + 24) {
      // Размещаем под кнопкой, стрелочка указывает вверх точно на кнопку
      pop.setAttribute("data-arrow-dir", "up");
      pop.style.top = Math.round(rect.bottom + 14) + "px";
    } else {
      // Размещаем над кнопкой, стрелочка указывает вниз точно на кнопку
      pop.setAttribute("data-arrow-dir", "down");
      pop.style.top = Math.max(12, Math.round(rect.top - popHeight - 14)) + "px";
    }
  }

  function showCoachmark(hintId, targetEl, text) {
    if (state.seenHints[hintId]) return;
    if (runtime.chartModal.isOpen || runtime.favPopupOpen) return;
    if (runtime.onboarding.activeHintId) return;
    if (!targetEl) return;

    var pop = document.getElementById("onboarding-popover");
    var textEl = document.getElementById("onboarding-popover-text");
    if (!pop || !textEl) return;

    runtime.onboarding.activeHintId = hintId;
    runtime.onboarding.activeTargetEl = targetEl;
    targetEl.setAttribute("data-coach-highlight", "true");

    textEl.textContent = text;
    pop.hidden = false;

    requestAnimationFrame(function () {
      positionActiveCoachmark();
    });
  }

  function setupHomeOnboarding() {
    disconnectOnboardingObserver();
    dismissActiveCoachmark(false);
    // При первом заходе на главную ненавязчиво показываем, как открыть описание, если ещё не видели подсказку озвучки
    if (state.seenHints.homeCard || state.seenHints.voiceBtn) return;

    setTimeout(function () {
      if (runtime.currentRoute.view !== "home" || runtime.searchQuery) return;
      var firstBtn = document.querySelector(".article-card .btn-primary");
      if (firstBtn) {
        showCoachmark(
          "homeCard",
          firstBtn,
          "Нажмите сюда, чтобы открыть описание узора, схемы и озвучку текста"
        );
      }
    }, 500);
  }

  function setupArticleOnboarding() {
    disconnectOnboardingObserver();
    dismissActiveCoachmark(false);
    if (state.seenHints.voiceBtn) return;

    var voiceBtn = document.getElementById("btn-voice-main");
    if (!voiceBtn) return;

    var exactTzText =
      "Нажмите сюда — включится озвучка. Появятся кнопочки паузы и скорости. Так вы можете слушать текст, а не читать его сами";

    if (!("IntersectionObserver" in window)) {
      showCoachmark("voiceBtn", voiceBtn, exactTzText);
      return;
    }

    var obs = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting && !state.seenHints.voiceBtn) {
            showCoachmark("voiceBtn", voiceBtn, exactTzText);
            obs.disconnect();
            break;
          }
        }
      },
      {
        root: null,
        rootMargin: "-10% 0px -15% 0px",
        threshold: 0.5
      }
    );

    obs.observe(voiceBtn);
    runtime.onboarding.observer = obs;
  }

  // ==========================================================================
  // 8. ГОЛОСОВОЙ ПОИСК + НАДПИСЬ О ДОСТУПЕ К МИКРОФОНУ (ИСЧЕЗАЕТ ПОСЛЕ ПОДТВЕРЖДЕНИЯ)
  // ==========================================================================

  function checkInitialMicPermission() {
    if (state.micPermissionGranted) return;
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: "microphone" })
        .then(function (status) {
          if (status.state === "granted") {
            markMicPermissionConfirmed();
          }
          status.onchange = function () {
            if (status.state === "granted") {
              markMicPermissionConfirmed();
            }
          };
        })
        .catch(function () {});
    }
  }

  function markMicPermissionConfirmed() {
    if (!state.micPermissionGranted) {
      state.micPermissionGranted = true;
      saveState();
    }
    var note = document.getElementById("mic-permission-note");
    if (note) note.hidden = true;
  }

  function startVoiceSearch() {
    var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast("Голосовой поиск не поддерживается в этом браузере");
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

    // Как только браузер получил доступ к микрофону и начал слушать — скрываем подсказку навсегда!
    rec.onaudiostart = function () {
      markMicPermissionConfirmed();
    };

    rec.onresult = function (event) {
      markMicPermissionConfirmed();
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
      }
    };

    rec.onerror = function (ev) {
      if (ev && (ev.error === "not-allowed" || ev.error === "service-not-allowed")) {
        showToast("Пожалуйста, разрешите доступ к микрофону в браузере");
      } else {
        showToast("Не удалось расслышать запрос. Попробуйте ещё раз");
      }
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
  // 9. ШАБЛОНЫ СТРАНИЦ (ГЛАВНАЯ / КАТЕГОРИЯ / СТАТЬЯ)
  // ==========================================================================

  function updateHeaderNavigation(route) {
    var leftEl = document.getElementById("header-left");
    if (!leftEl) return;

    if (route.view === "home") {
      // На главной вместо обрезающегося текста — крупная иконка «Сердечко» (Избранное)
      leftEl.innerHTML =
        '<button type="button" id="btn-header-fav" class="header-heart-btn" data-action="open-fav-popup" aria-label="Открыть избранное">' +
        '<svg class="heart-svg" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">' +
        '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>' +
        "</svg>" +
        '<span id="header-fav-badge" class="header-fav-badge" hidden>0</span>' +
        "</button>";
      syncHeaderHeartBadge();
    } else {
      // В статье и рубрике — только лаконичная кнопка «← Назад» (без названия рубрики!)
      leftEl.innerHTML = '<a href="#/" class="back-nav-btn">← Назад</a>';
    }
  }

  function renderArticleCardHTML(article) {
    var fav = isFavorite(article.slug);
    var favLabel = fav ? "♥ В избранном" : "♡ В избранное";
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
      '<span class="article-cat-tag">' +
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
      '" class="btn btn-primary">Открыть описание</a>' +
      '<button type="button" class="btn btn-sand' +
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

    return (
      '<section class="continue-card section-spacer" aria-label="Недавно открытое описание">' +
      '<span class="continue-badge">Вы недавно открывали</span>' +
      '<h2 class="continue-title">' +
      escapeHtml(art.title) +
      "</h2>" +
      '<a href="#/article/' +
      encodeURIComponent(art.slug) +
      '" class="btn btn-primary btn-block">Вернуться к описанию</a>' +
      "</section>"
    );
  }

  function renderHomeView() {
    var main = document.getElementById("app-main");
    if (!main) return;

    var hasQuery = runtime.searchQuery.trim().length > 0;
    var filtered = filterArticlesByQuery(runtime.searchQuery);

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
            ? '<div class="category-card-count">Доступно описаний: ' + readyCount + "</div>"
            : '<div class="category-card-count is-pending">В подготовке (' +
              cat.archiveCount +
              ")</div>";

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
          '<a href="#/category/' +
          encodeURIComponent(cat.id) +
          '" class="btn btn-sand btn-block">Открыть рубрику</a>' +
          "</div>"
        );
      })
      .join("");

    var resultsHeading = hasQuery
      ? "Найдено по запросу «" +
        escapeHtml(runtime.searchQuery.trim()) +
        "»: " +
        filtered.length
      : "Описания и схемы";

    var articlesHtml = filtered.length
      ? '<div class="articles-list">' +
        filtered.map(renderArticleCardHTML).join("") +
        "</div>"
      : '<div class="empty-state-box">' +
        '<p style="margin:0 0 8px;font-weight:700;font-size:1.1rem;">По запросу «' +
        escapeHtml(runtime.searchQuery.trim()) +
        "» пока нет описаний</p>" +
        '<p style="margin:0 0 18px;color:var(--text-muted);">Попробуйте слова «носки», «бриошь», «шапка» или «шаль».</p>' +
        '<button type="button" class="btn btn-primary" data-action="clear-search">Показать все описания</button>' +
        "</div>";

    var micHintHtml = state.micPermissionGranted
      ? ""
      : '<p id="mic-permission-note" class="mic-permission-note">При первом запуске разрешите доступ к микрофону</p>';

    main.innerHTML =
      // 1. Отделённое название сайта (без лишнего подзаголовка-описания!)
      '<div class="home-title-block">' +
      '<h1 class="home-main-title">Книга вязания спицами</h1>' +
      "</div>" +
      // 2. Чистый плоский блок поиска
      '<section class="search-card" role="search">' +
      '<div class="search-input-wrap">' +
      '<input type="search" id="search-input" class="search-input" aria-label="Поиск узора" placeholder="Найти узор: носки, шапка, шаль…" value="' +
      escapeHtml(runtime.searchQuery) +
      '">' +
      (runtime.searchQuery
        ? '<button type="button" class="search-clear-btn" data-action="clear-search" aria-label="Очистить поиск">✕</button>'
        : "") +
      "</div>" +
      '<button type="button" id="btn-voice-search" class="btn voice-search-btn" data-action="voice-search">🎤 Найти голосом</button>' +
      micHintHtml +
      "</section>" +
      // 3. СРАЗУ под кнопкой поиска — результаты поиска / карточки описаний (ничто их не перекрывает!)
      '<section id="results-section" aria-labelledby="pilot-list-heading">' +
      '<h2 id="pilot-list-heading" class="section-heading">' +
      resultsHeading +
      "</h2>" +
      articlesHtml +
      "</section>" +
      // 4. Недавно открытая тема и рубрики показываются ниже (и скрываются во время ввода поиска)
      (hasQuery
        ? ""
        : buildContinueCardHTML() +
          '<section class="section-spacer" aria-labelledby="cats-heading">' +
          '<h2 id="cats-heading" class="section-heading">Рубрики каталога</h2>' +
          '<div class="categories-grid">' +
          categoriesHtml +
          "</div>" +
          "</section>");

    bindSearchInput();
    setupHomeOnboarding();
  }

  function bindSearchInput() {
    var inp = document.getElementById("search-input");
    if (!inp) return;
    inp.addEventListener("input", function () {
      dismissActiveCoachmark(false);
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
    disconnectOnboardingObserver();
    dismissActiveCoachmark(false);

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
        '<p style="margin:0 0 8px;font-weight:700;font-size:1.15rem;">Материалы рубрики в подготовке</p>' +
        '<p style="margin:0 0 18px;color:var(--text-muted);">' +
        escapeHtml(
          cat.comingSoonNote ||
            "На первом тестовом этапе открыты описания в рубриках «Носки», «Шапки» и «Шали»."
        ) +
        "</p>" +
        '<a href="#/" class="btn btn-primary">Вернуться в каталог</a>' +
        "</div>";

    main.innerHTML =
      '<div class="home-title-block">' +
      '<h1 class="home-main-title">' +
      escapeHtml(cat.title) +
      "</h1>" +
      '<p style="margin:8px 0 0;color:var(--text-muted);">' +
      escapeHtml(cat.description) +
      "</p>" +
      "</div>" +
      contentHtml;
  }

  function renderArticleView(slug) {
    var main = document.getElementById("app-main");
    if (!main) return;

    var article = getArticleBySlug(slug);
    if (!article) {
      window.location.hash = "#/";
      return;
    }

    state.lastOpened = { slug: article.slug, updatedAt: Date.now() };
    saveState();

    runtime.tts.currentIndex = 0;

    var fav = isFavorite(article.slug);
    var favBtnLabel = fav ? "♥ В избранном" : "♡ В избранное";
    var favBtnCls = fav ? " btn-fav-active" : "";

    var specsHtml = (article.specs || [])
      .map(function (sp) {
        return (
          "<li>" +
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

    // Схемы узора — без лишнего заголовка «Схемы узора (нажмите на картинку — откроется во весь экран)»
    var chartsHtml = (article.charts || [])
      .map(function (ch) {
        return (
          '<div class="chart-card">' +
          '<h3 class="chart-card-title">' +
          escapeHtml(ch.title) +
          "</h3>" +
          (ch.subtitle
            ? '<p class="chart-card-sub">' + escapeHtml(ch.subtitle) + "</p>"
            : "") +
          '<button type="button" class="chart-img-trigger" data-action="open-chart" data-slug="' +
          escapeHtml(article.slug) +
          '" data-chart-id="' +
          escapeHtml(ch.id) +
          '" aria-label="Открыть схему ' +
          escapeHtml(ch.title) +
          '">' +
          '<img src="' +
          escapeHtml(ch.src) +
          '" alt="' +
          escapeHtml(ch.title) +
          '">' +
          "</button>" +
          '<button type="button" class="btn btn-sand btn-block" data-action="open-chart" data-slug="' +
          escapeHtml(article.slug) +
          '" data-chart-id="' +
          escapeHtml(ch.id) +
          '">Открыть схему крупно</button>' +
          "</div>"
        );
      })
      .join("");

    var glossaryHtml = (article.glossary || [])
      .map(function (g) {
        return (
          "<div>" +
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

    var stepGlobalIdx = 0;
    var sectionsHtml = (article.sections || [])
      .map(function (sec) {
        var linkedChartBtn = sec.chartId
          ? '<button type="button" class="stage-chart-pill no-print" data-action="open-chart" data-slug="' +
            escapeHtml(article.slug) +
            '" data-chart-id="' +
            escapeHtml(sec.chartId) +
            '">Схема</button>'
          : "";

        var stepsHtml = (sec.steps || [])
          .map(function (st) {
            var myIdx = stepGlobalIdx++;
            return (
              '<div class="step-row" data-step-id="' +
              escapeHtml(st.id) +
              '">' +
              '<div class="step-row-head">' +
              '<span class="step-label">' +
              escapeHtml(st.label) +
              "</span>" +
              '<button type="button" class="step-mini-speak no-print" data-action="speak-step" data-slug="' +
              escapeHtml(article.slug) +
              '" data-step-index="' +
              myIdx +
              '">🔊 Отсюда</button>' +
              "</div>" +
              '<p class="step-text">' +
              escapeHtml(st.text) +
              "</p>" +
              "</div>"
            );
          })
          .join("");

        return (
          '<section class="stage-section">' +
          '<div class="stage-header">' +
          '<h2 class="stage-title">' +
          escapeHtml(sec.title) +
          "</h2>" +
          linkedChartBtn +
          "</div>" +
          '<div class="steps-flow">' +
          stepsHtml +
          "</div>" +
          "</section>"
        );
      })
      .join("");

    var extraPhotos = (article.photos || []).slice(1);
    var galleryHtml = extraPhotos.length
      ? '<section class="photos-stack">' +
        extraPhotos
          .map(function (ph) {
            return (
              '<figure class="photo-figure" data-action="open-photo" data-slug="' +
              escapeHtml(article.slug) +
              '" data-src="' +
              escapeHtml(ph.src) +
              '" data-caption="' +
              escapeHtml(ph.caption) +
              '">' +
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
        "</section>"
      : "";

    main.innerHTML =
      "<article>" +
      // 1. Вступление без рамок
      '<header class="article-intro">' +
      '<span class="article-cat-tag">' +
      escapeHtml(article.categoryTitle) +
      "</span>" +
      '<h1 class="article-title-main">' +
      escapeHtml(article.title) +
      "</h1>" +
      '<p class="article-subtitle-main">' +
      escapeHtml(article.subtitle) +
      "</p>" +
      '<img src="' +
      escapeHtml(article.coverImage) +
      '" alt="' +
      escapeHtml(article.title) +
      '" class="article-hero-photo" data-action="open-photo" data-slug="' +
      escapeHtml(article.slug) +
      '" data-src="' +
      escapeHtml(article.coverImage) +
      '" data-caption="' +
      escapeHtml(article.title) +
      '" style="cursor:zoom-in;">' +
      '<div class="article-actions-bar no-print">' +
      '<button type="button" id="btn-article-fav" class="btn btn-sand' +
      favBtnCls +
      '" data-action="toggle-fav" data-slug="' +
      escapeHtml(article.slug) +
      '">' +
      favBtnLabel +
      "</button>" +
      '<a href="#charts-anchor" class="btn btn-sand" data-action="jump-charts">Перейти к схемам</a>' +
      "</div>" +
      "</header>" +
      // 2. Пряжа и спицы
      '<section class="specs-surface">' +
      '<h2 class="block-heading">Пряжа и спицы</h2>' +
      '<ul class="specs-list">' +
      specsHtml +
      "</ul>" +
      "</section>" +
      // 3. Схемы (чистые карточки без лишнего заголовка-инструкции)
      '<section id="charts-anchor" class="charts-flow">' +
      chartsHtml +
      "</section>" +
      // 4. Условные обозначения
      '<section class="glossary-section">' +
      '<h2 class="block-heading">Условные обозначения</h2>' +
      '<div class="glossary-list">' +
      glossaryHtml +
      "</div>" +
      "</section>" +
      // 5. Кнопка «Читать вслух» НЕПОСРЕДСТВЕННО в начале текста описания (без лишних надписей!)
      '<div class="voice-trigger-wrap no-print">' +
      '<button type="button" id="btn-voice-main" class="btn btn-primary btn-block" data-action="tts-play" data-slug="' +
      escapeHtml(article.slug) +
      '">🔊 Читать вслух</button>' +
      "</div>" +
      // 6. Текст описания во всю ширину экрана без вложенных коробок
      '<div class="article-text-flow">' +
      sectionsHtml +
      "</div>" +
      // 7. Дополнительные фотографии
      galleryHtml +
      // 8. Печать и оригинальный PDF
      '<section class="print-section no-print">' +
      '<div class="article-card-actions">' +
      '<button type="button" class="btn btn-primary" data-action="print-large">🖨 Печать крупным шрифтом</button>' +
      '<a href="' +
      escapeHtml(article.originalPdf) +
      '" target="_blank" rel="noopener" class="btn btn-sand">📄 Скачать PDF со схемами</a>' +
      "</div>" +
      '<p class="source-credit">Источник: <a href="' +
      escapeHtml(article.sourceUrl) +
      '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(article.sourceName) +
      "</a></p>" +
      "</section>" +
      "</article>";

    syncSilentWakeLock();
    setupArticleOnboarding();
  }

  // ==========================================================================
  // 10. МАРШРУТИЗАТОР И ОБРАБОТЧИКИ СОБЫТИЙ
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
    return { view: "home", param: null };
  }

  function handleRouteChange() {
    stopTts();
    if (runtime.chartModal.isOpen) closeChartModal();
    if (runtime.favPopupOpen) closeFavoritesPopup();
    showHeaderBar();

    var route = parseHash();
    runtime.currentRoute = route;
    updateHeaderNavigation(route);

    if (route.view === "article") {
      renderArticleView(route.param);
    } else if (route.view === "category") {
      syncSilentWakeLock();
      renderCategoryView(route.param);
    } else {
      syncSilentWakeLock();
      renderHomeView();
    }

    window.scrollTo(0, 0);
    runtime.lastScrollY = 0;
  }

  function bindGlobalEvents() {
    document.getElementById("btn-font-scale").addEventListener("click", cycleFontScale);
    document.getElementById("btn-theme-toggle").addEventListener("click", toggleTheme);

    // Закрытие popup Избранного
    document.getElementById("btn-fav-popup-close").addEventListener("click", closeFavoritesPopup);
    document.getElementById("favorites-popup").addEventListener("click", function (e) {
      if (e.target === e.currentTarget) {
        closeFavoritesPopup();
      }
    });

    // Плавающие боковые кнопки озвучки
    document.getElementById("fab-tts-toggle").addEventListener("click", function () {
      var art = getArticleBySlug(runtime.tts.articleSlug || runtime.currentRoute.param);
      if (art) togglePlayPauseTts(art);
    });

    document.getElementById("fab-tts-speed").addEventListener("click", cycleTtsSpeed);

    document.getElementById("fab-tts-repeat").addEventListener("click", function () {
      var art = getArticleBySlug(runtime.tts.articleSlug || runtime.currentRoute.param);
      if (art) {
        prepareAndSpeakStep(art, runtime.tts.currentIndex || 0, false, true);
      }
    });

    document.getElementById("fab-tts-next").addEventListener("click", function () {
      var art = getArticleBySlug(runtime.tts.articleSlug || runtime.currentRoute.param);
      if (art) {
        prepareAndSpeakStep(art, (runtime.tts.currentIndex || 0) + 1, true, true);
      }
    });

    document.getElementById("fab-tts-stop").addEventListener("click", stopTts);

    // Закрытие матовой подсказки туториала
    document.getElementById("btn-onboarding-ok").addEventListener("click", function () {
      dismissActiveCoachmark(true);
    });

    // Подсказка и кружок в окне схемы
    document.getElementById("chart-hint-bubble").addEventListener("click", collapseChartHintToDot);
    document.getElementById("chart-hint-dot").addEventListener("click", function () {
      showChartHintForSeconds(18);
    });

    document.getElementById("btn-chart-close").addEventListener("click", closeChartModal);
    document.getElementById("btn-chart-rotate").addEventListener("click", toggleChartLandscapeMode);
    document.getElementById("btn-zoom-in").addEventListener("click", function () {
      zoomChartAroundPoint(1.35);
    });
    document.getElementById("btn-zoom-out").addEventListener("click", function () {
      zoomChartAroundPoint(1 / 1.35);
    });
    document.getElementById("btn-zoom-reset").addEventListener("click", fitChartToViewport);

    // Общее делегирование кликов
    document.addEventListener("click", function (e) {
      if (runtime.currentRoute.view === "article") {
        syncSilentWakeLock();
      }

      var targetActionEl = e.target.closest("[data-action]");
      var highlighted = e.target.closest("[data-coach-highlight='true']");
      if (highlighted) {
        dismissActiveCoachmark(true);
      }

      if (!targetActionEl) return;

      var action = targetActionEl.getAttribute("data-action");
      var slug = targetActionEl.getAttribute("data-slug");

      if (action === "open-fav-popup") {
        e.preventDefault();
        openFavoritesPopup();
        return;
      }

      if (action === "select-fav-item") {
        closeFavoritesPopup();
        return;
      }

      if (action === "remove-fav-popup" && slug) {
        e.preventDefault();
        toggleFavorite(slug);
        renderFavoritesPopupContent();
        if (runtime.currentRoute.view === "home") {
          renderHomeView();
        }
        return;
      }

      if (action === "toggle-fav" && slug) {
        e.preventDefault();
        var nowFav = toggleFavorite(slug);
        targetActionEl.textContent = nowFav ? "♥ В избранном" : "♡ В избранное";
        targetActionEl.classList.toggle("btn-fav-active", nowFav);
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

      if (action === "tts-play" && slug) {
        var artPlay = getArticleBySlug(slug);
        if (artPlay) togglePlayPauseTts(artPlay);
        return;
      }

      if (action === "speak-step" && slug) {
        var stepIdx = parseInt(targetActionEl.getAttribute("data-step-index") || "0", 10);
        var artStep = getArticleBySlug(slug);
        if (artStep) {
          if (runtime.tts.active && runtime.tts.currentIndex === stepIdx) {
            togglePlayPauseTts(artStep);
          } else {
            // Читает с выбранного места непрерывно до конца описания без обрыва!
            prepareAndSpeakStep(artStep, stepIdx, false, true);
          }
        }
        return;
      }

      if (action === "open-chart" && slug) {
        openChartModal(slug, targetActionEl.getAttribute("data-chart-id"));
        return;
      }

      if (action === "open-photo" && slug) {
        openChartModal(
          slug,
          null,
          targetActionEl.getAttribute("data-src"),
          targetActionEl.getAttribute("data-caption") || "Фотография модели",
          "Раздвигайте фотографию двумя пальцами или поверните экран горизонтально."
        );
        return;
      }

      if (action === "print-large") {
        stopTts();
        window.print();
        return;
      }
    });

    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (runtime.chartModal.isOpen) closeChartModal();
        else if (runtime.favPopupOpen) closeFavoritesPopup();
      }
    });

    window.addEventListener("hashchange", handleRouteChange);

    var onViewportChange = function () {
      if (runtime.chartModal.isOpen) {
        setTimeout(fitChartToViewport, 80);
      }
      positionActiveCoachmark();
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onViewportChange);
    }
  }

  function registerOfflineWorker() {
    if ("serviceWorker" in navigator && window.location.protocol.indexOf("http") === 0) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("./sw.js?v=3").catch(function () {});
      });
    }
  }

  applyVisualPreferences();
  checkInitialMicPermission();
  initHeaderAutoHide();
  initChartModalGestures();
  bindGlobalEvents();
  handleRouteChange();
  registerOfflineWorker();
})();
