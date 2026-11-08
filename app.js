/* ==========================================================================
   КНИГА ВЯЗАНИЯ СПИЦАМИ — Интерактивное ядро AgeTech-каталога (Vanilla JS)
   Версия v2: автоскрытие шапки, плавающие боковые кнопки озвучки (0.6x без обрывов),
   эстетичное обучение при прокрутке и схемы во весь экран с кружком-подсказкой.
   ========================================================================== */

(function () {
  "use strict";

  var STORAGE_KEY = "kniga_vyazaniya_state_v2";
  var LEGACY_KEY = "kniga_vyazaniya_state_v1";
  var CATALOG = window.KNITTING_CATALOG || { categories: [], articles: [] };

  // Доступные скорости озвучки (изначально очень медленная — 0.6x)
  var TTS_SPEEDS = [0.6, 0.75, 0.9, 0.5];

  var defaultState = {
    fontScale: "normal",   // 'normal' (20px) | 'large' (23px) | 'xlarge' (26px)
    theme: "day",          // 'day' | 'evening'
    favorites: [],         // массив slug
    checkedSteps: {},      // { [slug]: { [stepId]: true } }
    lastOpened: null,      // { slug: string, updatedAt: number }
    ttsRate: 0.6,          // изначально очень медленный голос (0.6)
    wakeLockEnabled: true,
    onboardingDisabled: false,
    seenHints: {}          // { homeWelcome: true, voiceStart: true, chartOpen: true, stepSpeak: true }
  };

  var state = loadState();

  var runtime = {
    currentRoute: { view: "home", param: null },
    searchQuery: "",
    lastScrollY: 0,
    wakeLockSentinel: null,
    wakeLockSupported: "wakeLock" in navigator,
    wakeLockActive: false,
    tts: {
      supported: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
      active: false,         // открыта ли боковая панель кнопок озвучки
      speaking: false,       // произносится ли сейчас речь
      paused: false,         // поставлено ли на паузу
      autoAdvance: true,     // переходить ли автоматически к следующему шагу
      articleSlug: null,
      stepsQueue: [],        // [{ stepId, label, sectionTitle, text }]
      currentIndex: 0,
      chunks: [],            // части текущего абзаца для чтения без обрывов
      currentChunkIndex: 0,
      sessionToken: 0,       // защита от ложных срабатываний onend после cancel()
      activeUtterance: null  // ссылка от сборки мусора мобильного браузера
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
      observer: null,
      autoHideTimer: null
    },
    toastTimer: null
  };

  // ==========================================================================
  // 1. СОХРАНЕНИЕ НАСТРОЕК (С ПЕРЕНОСОМ ИЗБРАННОГО ИЗ ПЕРВОЙ ВЕРСИИ)
  // ==========================================================================

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(defaultState));
  }

  function loadState() {
    var base = cloneDefaults();
    try {
      var rawV2 = localStorage.getItem(STORAGE_KEY);
      if (rawV2) {
        var parsed = JSON.parse(rawV2);
        Object.keys(base).forEach(function (k) {
          if (parsed[k] !== undefined && parsed[k] !== null) {
            base[k] = parsed[k];
          }
        });
        return base;
      }
      // Мягкая миграция избранного и отмеченных шагов из v1 (с новой скоростью 0.6!)
      var rawV1 = localStorage.getItem(LEGACY_KEY);
      if (rawV1) {
        var old = JSON.parse(rawV1);
        if (Array.isArray(old.favorites)) base.favorites = old.favorites;
        if (old.checkedSteps && typeof old.checkedSteps === "object") {
          base.checkedSteps = old.checkedSteps;
        }
        if (old.fontScale) base.fontScale = old.fontScale;
        if (old.theme) base.theme = old.theme;
        if (old.lastOpened) base.lastOpened = old.lastOpened;
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
    }, 2800);
  }

  // ==========================================================================
  // 2. ВЕРХНЯЯ ПАНЕЛЬ: КОМПАКТНЫЕ КНОПКИ И АВТОСКРЫТИЕ ПРИ ПРОКРУТКЕ ВНИЗ
  // ==========================================================================

  function applyVisualPreferences() {
    var html = document.documentElement;
    html.setAttribute("data-font-scale", state.fontScale);
    html.setAttribute("data-theme", state.theme);

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
    showToast(
      state.theme === "evening"
        ? "Тёплый вечерний свет включён"
        : "Дневной светлый режим включён"
    );
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
        if (!header || runtime.chartModal.isOpen) return;

        var currentY = Math.max(0, window.pageYOffset || document.documentElement.scrollTop || 0);
        var delta = currentY - runtime.lastScrollY;

        if (currentY <= 44) {
          header.classList.remove("is-hidden");
        } else if (delta > 9 && currentY > 64) {
          // Прокрутка вниз — плавно убираем верхний блок, освобождая весь экран
          header.classList.add("is-hidden");
        } else if (delta < -9) {
          // Прокрутка вверх — сразу возвращаем верхний блок
          header.classList.remove("is-hidden");
        }

        runtime.lastScrollY = currentY;
      },
      { passive: true }
    );
  }

  // ==========================================================================
  // 3. ИЗБРАННОЕ («МОЁ ЛЮБИМОЕ» БЕЗ ПАРОЛЕЙ)
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
        ? "♥ Сохранено в «Моё любимое»"
        : "Убрано из «Моё любимое»"
    );
    return added;
  }

  // ==========================================================================
  // 4. ЗАПРЕТ ГАШЕНИЯ ЭКРАНА (SCREEN WAKE LOCK API)
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
      bar.hidden = true;
      return;
    }

    bar.hidden = false;
    if (state.wakeLockEnabled) {
      bar.classList.add("is-active");
      textEl.textContent = "☀ Экран не гаснет, пока открыто описание";
      btnEl.textContent = "Выключить";
    } else {
      bar.classList.remove("is-active");
      textEl.textContent = "🌙 Обычное гашение экрана по таймеру";
      btnEl.textContent = "Не гасить";
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      acquireWakeLockIfNeeded();
    }
  });

  // ==========================================================================
  // 5. ПОЛНАЯ ОЗВУЧКА БЕЗ ОБРЫВОВ (0.6×) + ПЛАВАЮЩИЕ БОКОВЫЕ КНОПКИ
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

    return s.replace(/\s+/g, " ").trim();
  }

  /*
   * Разбиваем длинный абзац на короткие смысловые фразы (до ~95 символов).
   * Это полностью устраняет обрыв озвучки на середине текста в мобильных браузерах
   * даже на самой медленной скорости 0.5x–0.6x!
   */
  function splitIntoSpeechChunks(fullText) {
    var clean = String(fullText || "").replace(/\s+/g, " ").trim();
    if (!clean) return [];

    // Сначала делим по концам предложений и точкам с запятой (без lookbehind для 100% совместимости со всеми iPhone/Android)
    var rawSentences = clean.replace(/([.!?;])\s+/g, "$1\n").split("\n");
    var chunks = [];
    var MAX_LEN = 95;

    for (var i = 0; i < rawSentences.length; i++) {
      var part = rawSentences[i].trim();
      if (!part) continue;

      while (part.length > MAX_LEN) {
        // Ищем ближайшую запятую, тире или двоеточие до MAX_LEN
        var cut = -1;
        var punctuation = [", ", " — ", ": ", ") "];
        for (var p = 0; p < punctuation.length; p++) {
          var idx = part.lastIndexOf(punctuation[p], MAX_LEN);
          if (idx > 28 && idx > cut) {
            cut = idx + punctuation[p].length - 1;
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

  function findFirstVisibleStepIndex() {
    var items = document.querySelectorAll(".step-item");
    if (!items.length) return 0;
    var vh = window.innerHeight || 640;
    for (var i = 0; i < items.length; i++) {
      var rect = items[i].getBoundingClientRect();
      if (rect.bottom > 80 && rect.top < vh * 0.85) {
        return i;
      }
    }
    return 0;
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

  function stopTts() {
    runtime.tts.sessionToken++;
    runtime.tts.activeUtterance = null;
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
    highlightSpokenStep(null, false);
    updateTtsUI();
  }

  function speakCurrentChunk(article) {
    if (!runtime.tts.supported) return;

    var chunks = runtime.tts.chunks;
    if (runtime.tts.currentChunkIndex >= chunks.length) {
      // Весь текущий абзац прочитан ДО КОНЦА!
      if (
        runtime.tts.autoAdvance &&
        runtime.tts.currentIndex + 1 < runtime.tts.stepsQueue.length
      ) {
        startSpeakingStep(article, runtime.tts.currentIndex + 1, true, true);
      } else {
        // Одиночный абзац или конец статьи прочитан полностью — переводим в режим паузы/готовности
        runtime.tts.speaking = false;
        runtime.tts.paused = true;
        runtime.tts.currentChunkIndex = 0;
        updateTtsUI();
      }
      return;
    }

    var myToken = ++runtime.tts.sessionToken;
    var phrase = chunks[runtime.tts.currentChunkIndex];
    var utter = new SpeechSynthesisUtterance(phrase);
    runtime.tts.activeUtterance = utter; // защита от GC

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
      // Если мобильный движок пропустил фразу по таймауту, переходим к следующей вместо обрыва!
      if (ev && ev.error === "interrupted") return;
      if (runtime.tts.speaking && !runtime.tts.paused) {
        runtime.tts.currentChunkIndex++;
        speakCurrentChunk(article);
      }
    };

    try {
      window.speechSynthesis.speak(utter);
    } catch (e) {
      stopTts();
    }
  }

  function startSpeakingStep(article, index, autoAdvance, allowGentleScroll) {
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

    runtime.tts.sessionToken++;
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}

    var item = queue[index];
    var expanded = expandKnittingAbbreviations(item.label + ". " + item.text);
    var chunks = splitIntoSpeechChunks(expanded);

    runtime.tts.articleSlug = article.slug;
    runtime.tts.stepsQueue = queue;
    runtime.tts.currentIndex = index;
    runtime.tts.chunks = chunks;
    runtime.tts.currentChunkIndex = 0;
    runtime.tts.autoAdvance = !!autoAdvance;
    runtime.tts.active = true;
    runtime.tts.speaking = true;
    runtime.tts.paused = false;

    // Не дёргаем экран при нажатии кнопки! Мягко подкручиваем только при автопереходе к следующему шагу ниже экрана
    highlightSpokenStep(item.stepId, !!allowGentleScroll);
    updateTtsUI();

    speakCurrentChunk(article);
  }

  function togglePlayPauseTts(article) {
    if (!runtime.tts.supported) {
      showToast("Голосовое чтение недоступно в вашем браузере");
      return;
    }
    if (!runtime.tts.active) {
      var startIdx = findFirstVisibleStepIndex();
      startSpeakingStep(article, startIdx, true, false);
      return;
    }
    if (runtime.tts.paused || !runtime.tts.speaking) {
      // Надёжное продолжение с текущей фразы на всех смартфонах (Android / iOS)
      if (!runtime.tts.chunks.length) {
        startSpeakingStep(article, runtime.tts.currentIndex || 0, runtime.tts.autoAdvance, false);
        return;
      }
      runtime.tts.paused = false;
      runtime.tts.speaking = true;
      var curStep = runtime.tts.stepsQueue[runtime.tts.currentIndex];
      if (curStep) highlightSpokenStep(curStep.stepId, false);
      updateTtsUI();
      speakCurrentChunk(article);
    } else {
      // Надёжная пауза без потери фразы
      runtime.tts.sessionToken++;
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

    var labels = {
      "0.5": "Скорость 0.5× (самая медленная)",
      "0.6": "Скорость 0.6× (очень медленно)",
      "0.75": "Скорость 0.75× (спокойно)",
      "0.9": "Скорость 0.9× (побыстрее)"
    };
    showToast(labels[String(nextRate)] || "Скорость голоса: " + nextRate + "×");

    updateTtsUI();

    // Если сейчас идёт чтение — сразу применяем новую скорость с текущей фразы!
    if (runtime.tts.active && runtime.tts.speaking && !runtime.tts.paused) {
      var art = getArticleBySlug(runtime.tts.articleSlug);
      if (art) {
        runtime.tts.sessionToken++;
        try {
          window.speechSynthesis.cancel();
        } catch (e) {}
        speakCurrentChunk(art);
      }
    }
  }

  function highlightSpokenStep(stepId, allowGentleScroll) {
    var all = document.querySelectorAll(".step-item");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var btn = el.querySelector(".step-speak-btn");
      if (stepId && el.getAttribute("data-step-id") === stepId) {
        el.classList.add("is-speaking");
        if (btn) {
          btn.textContent = runtime.tts.paused ? "▶ Продолжить" : "⏸ Пауза";
        }
        if (allowGentleScroll) {
          var rect = el.getBoundingClientRect();
          var vh = window.innerHeight || 640;
          if (rect.top < 60 || rect.bottom > vh - 40) {
            try {
              el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            } catch (e) {}
          }
        }
      } else {
        el.classList.remove("is-speaking");
        if (btn) btn.textContent = "🔊 Озвучить";
      }
    }
  }

  function updateTtsUI() {
    var rail = document.getElementById("tts-fab-rail");
    var toggleIcon = document.getElementById("fab-tts-toggle-icon");
    var toggleText = document.getElementById("fab-tts-toggle-text");
    var speedVal = document.getElementById("fab-tts-speed-val");
    var topStartBtn = document.getElementById("btn-voice-main");

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

    if (topStartBtn) {
      if (!runtime.tts.active) {
        topStartBtn.textContent = "🔊 Читать вслух (медленно " + (state.ttsRate || 0.6) + "×)";
      } else if (runtime.tts.speaking && !runtime.tts.paused) {
        topStartBtn.textContent = "⏸ Пауза озвучки";
      } else {
        topStartBtn.textContent = "▶ Продолжить озвучку";
      }
    }

    // Обновляем текст кнопки на активном абзаце
    if (runtime.tts.active && runtime.tts.stepsQueue[runtime.tts.currentIndex]) {
      var sid = runtime.tts.stepsQueue[runtime.tts.currentIndex].stepId;
      highlightSpokenStep(sid, false);
    }
  }

  if (runtime.tts.supported && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = function () {};
  }

  // ==========================================================================
  // 6. ПОЛНОЭКРАННЫЙ ПРОСМОТР СХЕМЫ (НА 100% ЭКРАНА + ВСПЛЫВАЮЩАЯ ПОДСКАЗКА И КРУЖОК)
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

    dismissActiveCoachmark(true);

    runtime.chartModal.isOpen = true;
    runtime.chartModal.articleSlug = articleSlug;
    runtime.chartModal.chartId = chartId || src;

    titleEl.textContent = title;
    hintEl.textContent = hint;
    modal.hidden = false;
    document.body.style.overflow = "hidden";

    // При открытии подсказка появляется на 12 секунд (10–15 сек), затем остаётся кружок
    showChartHintForSeconds(12);
    acquireWakeLockIfNeeded();

    var applyLoadedDimensions = function () {
      if (!runtime.chartModal.isOpen) return;
      runtime.chartModal.imgW = imgEl.naturalWidth || 1000;
      runtime.chartModal.imgH = imgEl.naturalHeight || 1000;
      // Двойной rAF гарантирует точные размеры экрана после открытия модального окна
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
    document.body.style.overflow = "";

    // Выходим из полноэкранного системного режима, если он включался для автоповорота
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
    if (screen.orientation && screen.orientation.unlock) {
      try {
        screen.orientation.unlock();
      } catch (e) {}
    }
    runtime.chartModal.isLandscapeLocked = false;
    acquireWakeLockIfNeeded();
  }

  function toggleChartLandscapeMode() {
    var modal = document.getElementById("chart-modal");
    if (!modal) return;

    // Пробуем перевести в системный полноэкранный горизонтальный режим (работает на Android Chrome)
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
            showToast("Поверните телефон горизонтально — схема развернётся во весь экран");
            setTimeout(fitChartToViewport, 180);
          });
      } else {
        showToast("Поверните телефон горизонтально — схема развернётся во весь экран");
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

  /*
   * Схема сразу открывается максимально крупно, занимая практически 100% экрана
   * (как в портретном, так и в горизонтальном положении телефона).
   */
  function fitChartToViewport() {
    var vp = document.getElementById("chart-viewport");
    if (!vp) return;
    var vw = vp.clientWidth || window.innerWidth || 360;
    var vh = vp.clientHeight || window.innerHeight || 640;
    var iw = runtime.chartModal.imgW || 1000;
    var ih = runtime.chartModal.imgH || 1000;

    var pad = 4; // минимальный отступ 4px — картинка занимает практически весь экран!
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
      var minTx = vw - sw - 24;
      var maxTx = 24;
      runtime.chartModal.tx = Math.max(minTx, Math.min(maxTx, runtime.chartModal.tx));
    }

    if (sh <= vh) {
      runtime.chartModal.ty = Math.round((vh - sh) / 2);
    } else {
      var minTy = vh - sh - 24;
      var maxTy = 24;
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
          // Двойное касание увеличивает участок схемы в 2.2 раза или возвращает на весь экран
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

    // Поддержка мыши
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
  // 7. ЭСТЕТИЧНОЕ МИНИ-ОБУЧЕНИЕ ПО МЕРЕ ПРОКРУТКИ (COACHMARKS)
  // ==========================================================================

  function disconnectOnboardingObserver() {
    if (runtime.onboarding.observer) {
      runtime.onboarding.observer.disconnect();
      runtime.onboarding.observer = null;
    }
  }

  function dismissActiveCoachmark(markSeen) {
    if (runtime.onboarding.autoHideTimer) {
      clearTimeout(runtime.onboarding.autoHideTimer);
      runtime.onboarding.autoHideTimer = null;
    }
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

  function showCoachmark(hintId, targetEl, title, desc) {
    if (state.onboardingDisabled || state.seenHints[hintId]) return;
    if (runtime.chartModal.isOpen) return;
    if (runtime.onboarding.activeHintId) return; // не накладываем подсказки друг на друга

    var pop = document.getElementById("onboarding-popover");
    var titleEl = document.getElementById("onboarding-popover-title");
    var descEl = document.getElementById("onboarding-popover-desc");
    if (!pop || !titleEl || !descEl) return;

    runtime.onboarding.activeHintId = hintId;
    runtime.onboarding.activeTargetEl = targetEl || null;
    if (targetEl) {
      targetEl.setAttribute("data-coach-highlight", "true");
    }

    titleEl.textContent = title;
    descEl.textContent = desc;
    pop.hidden = false;

    // Автоматически отмечаем подсказку прочитанной через 16 секунд, чтобы не мешать чтению
    runtime.onboarding.autoHideTimer = setTimeout(function () {
      dismissActiveCoachmark(true);
    }, 16000);
  }

  function setupHomeOnboarding() {
    disconnectOnboardingObserver();
    dismissActiveCoachmark(false);
    if (state.onboardingDisabled || state.seenHints.homeWelcome) return;

    setTimeout(function () {
      if (runtime.currentRoute.view !== "home") return;
      var firstOpenBtn = document.querySelector(".article-card .btn-primary");
      showCoachmark(
        "homeWelcome",
        firstOpenBtn,
        "Добро пожаловать в Книгу вязания!",
        "Нажмите «Открыть описание и схемы» на любом изделии — внутри текст можно слушать медленным голосом, а схемы раскрывать во весь экран."
      );
    }, 600);
  }

  function setupArticleScrollOnboarding() {
    disconnectOnboardingObserver();
    dismissActiveCoachmark(false);
    if (state.onboardingDisabled) return;

    var hintConfigs = [
      {
        id: "voiceStart",
        selector: "#btn-voice-main",
        title: "Нажмите сюда — включится озвучка голосом",
        desc: "Голос читает очень медленно и разборчиво (скорость 0,6). Сбоку появятся аккуратные кнопки паузы и скорости."
      },
      {
        id: "chartOpen",
        selector: ".chart-img-btn",
        title: "Нажмите на картинку схемы — она раскроется во весь экран",
        desc: "Когда схема открыта, поверните телефон горизонтально — так видна каждая петелька."
      },
      {
        id: "stepSpeak",
        selector: ".step-speak-btn",
        title: "Можно озвучить любой нужный абзац",
        desc: "Нажмите «🔊 Озвучить» рядом с этапом — голос спокойно прочитает этот абзац до самого конца."
      }
    ];

    if (!("IntersectionObserver" in window)) {
      var firstUnseen = hintConfigs.filter(function (h) {
        return !state.seenHints[h.id];
      })[0];
      if (firstUnseen) {
        var elFallback = document.querySelector(firstUnseen.selector);
        if (elFallback) {
          showCoachmark(firstUnseen.id, elFallback, firstUnseen.title, firstUnseen.desc);
        }
      }
      return;
    }

    var obs = new IntersectionObserver(
      function (entries) {
        if (state.onboardingDisabled || runtime.chartModal.isOpen) return;
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (!entry.isIntersecting) continue;
          var hintId = entry.target.getAttribute("data-coach-id");
          if (!hintId || state.seenHints[hintId]) continue;
          if (runtime.onboarding.activeHintId) continue;

          for (var k = 0; k < hintConfigs.length; k++) {
            if (hintConfigs[k].id === hintId) {
              showCoachmark(
                hintConfigs[k].id,
                entry.target,
                hintConfigs[k].title,
                hintConfigs[k].desc
              );
              break;
            }
          }
        }
      },
      {
        root: null,
        rootMargin: "-12% 0px -18% 0px",
        threshold: 0.45
      }
    );

    hintConfigs.forEach(function (cfg) {
      if (state.seenHints[cfg.id]) return;
      var target = document.querySelector(cfg.selector);
      if (target) {
        target.setAttribute("data-coach-id", cfg.id);
        obs.observe(target);
      }
    });

    runtime.onboarding.observer = obs;
  }

  function resetOnboardingHints() {
    state.onboardingDisabled = false;
    state.seenHints = {};
    saveState();
    showToast("Подсказки включены снова");
    if (runtime.currentRoute.view === "article") {
      setupArticleScrollOnboarding();
    } else if (runtime.currentRoute.view === "home") {
      setupHomeOnboarding();
    }
  }

  // ==========================================================================
  // 8. ГОЛОСОВОЙ ПОИСК УЗОРА (SPEECH RECOGNITION API)
  // ==========================================================================

  function startVoiceSearch() {
    var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast(
        "Голосовой поиск не поддерживается этим браузером — введите слово в поле выше"
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
    showToast("Скажите, например: «носки», «бриошь» или «шаль»");

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
        showToast("Найдено по запросу: «" + phrase + "»");
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
  // 9. ШАБЛОНЫ СТРАНИЦ (ГЛАВНАЯ / РУБРИКА / ЛЮБИМОЕ / ТЕМА ВЯЗАНИЯ)
  // ==========================================================================

  function updateHeaderNavigation(route) {
    var leftEl = document.getElementById("header-left");
    if (!leftEl) return;

    if (route.view === "home") {
      leftEl.innerHTML =
        '<a href="#/" class="brand-link" aria-label="Главная страница каталога">' +
        '<img src="./assets/icon.svg" alt="" class="brand-icon" width="30" height="30">' +
        '<strong class="brand-title">Книга вязания</strong>' +
        "</a>";
    } else if (route.view === "article") {
      var art = getArticleBySlug(route.param);
      var backHref = art ? "#/category/" + encodeURIComponent(art.categoryId) : "#/";
      leftEl.innerHTML =
        '<div style="display:flex;gap:6px;align-items:center;min-width:0;">' +
        '<a href="#/" class="back-nav-btn">← Назад</a>' +
        (art
          ? '<a href="' +
            backHref +
            '" class="header-cat-link">' +
            escapeHtml(art.categoryTitle) +
            "</a>"
          : "") +
        "</div>";
    } else {
      leftEl.innerHTML = '<a href="#/" class="back-nav-btn">← В каталог</a>';
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

    var checkedMap = state.checkedSteps[art.slug] || {};
    var doneCount = Object.keys(checkedMap).filter(function (k) {
      return checkedMap[k];
    }).length;

    return (
      '<section class="continue-card" aria-label="Недавно открытое описание">' +
      '<span class="continue-badge">Вы недавно открывали</span>' +
      '<h2 class="continue-title">' +
      escapeHtml(art.title) +
      "</h2>" +
      (doneCount > 0
        ? '<p class="continue-meta">Отмечено выполненных этапов: ' + doneCount + "</p>"
        : "") +
      '<a href="#/article/' +
      encodeURIComponent(art.slug) +
      '" class="btn btn-green btn-block">Вернуться к этому описанию →</a>' +
      "</section>"
    );
  }

  function renderHomeView() {
    var main = document.getElementById("app-main");
    if (!main) return;

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
            ? '<div class="category-card-count">На сайте: ' +
              readyCount +
              " описание (в полном архиве — " +
              cat.archiveCount +
              ")</div>"
            : '<div class="category-card-count is-pending">В архиве: ' +
              cat.archiveCount +
              " описаний (2-й этап)</div>";

        var btnHtml =
          readyCount > 0
            ? '<a href="#/category/' +
              encodeURIComponent(cat.id) +
              '" class="btn btn-secondary btn-block">Открыть рубрику «' +
              escapeHtml(cat.shortTitle) +
              "» →</a>"
            : '<a href="#/category/' +
              encodeURIComponent(cat.id) +
              '" class="btn btn-secondary btn-block">О рубрике</a>';

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
      '<p class="hero-subtitle">Крупный шрифт, схемы во весь экран и спокойное чтение описания голосом.</p>' +
      '<div class="search-panel" role="search">' +
      '<label for="search-input" style="font-weight:700;">Поиск по узорам и пряже:</label>' +
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
      '<p class="section-lead">Нажмите на изделие, чтобы открыть описание, развернуть схемы во весь экран или включить озвучку.</p>' +
      articlesHtml +
      "</section>" +
      '<section aria-labelledby="cats-heading">' +
      '<h2 id="cats-heading" class="section-heading">Рубрики библиотеки (5 разделов)</h2>' +
      '<div class="categories-grid">' +
      categoriesHtml +
      "</div>" +
      "</section>";

    bindSearchInput();
    setupHomeOnboarding();
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
    disconnectOnboardingObserver();
    dismissActiveCoachmark(false);

    var favArticles = CATALOG.articles.filter(function (a) {
      return isFavorite(a.slug);
    });

    var listHtml = favArticles.length
      ? '<div class="articles-list">' +
        favArticles.map(renderArticleCardHTML).join("") +
        "</div>"
      : '<div class="empty-state-box">' +
        "<h2>В разделе «Моё любимое» пока пусто</h2>" +
        "<p>Нажмите <strong>«♡ Отложить в любимое»</strong> на понравившемся узоре — он сохранится здесь без паролей.</p>" +
        '<a href="#/" class="btn btn-primary" style="margin-top:12px;">Посмотреть каталог описаний</a>' +
        "</div>";

    main.innerHTML =
      '<div class="hero-box">' +
      '<h1 class="hero-title">♥ Моё любимое</h1>' +
      '<p class="hero-subtitle">Отложенные описания всегда под рукой на вашем телефоне.</p>' +
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

    state.lastOpened = { slug: article.slug, updatedAt: Date.now() };
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
          '" aria-label="Открыть схему ' +
          escapeHtml(ch.title) +
          ' во весь экран">' +
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
          '">🔍 Открыть схему во весь экран</button>' +
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
            '">🔍 Схема к этапу</button>';
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
              '">🔊 Озвучить</button>' +
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
        "</div>" +
        "</section>"
      : "";

    main.innerHTML =
      '<article>' +
      // 1. Шапка описания
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
      '<div class="article-hero-photo-wrap" data-action="open-photo" data-slug="' +
      escapeHtml(article.slug) +
      '" data-src="' +
      escapeHtml(article.coverImage) +
      '" data-caption="' +
      escapeHtml(article.title) +
      '" style="cursor:zoom-in;">' +
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
      '<a href="#charts-anchor" class="btn btn-primary" data-action="jump-charts">🔍 Схемы узора (' +
      article.charts.length +
      ")</a>" +
      "</div>" +
      "</header>" +
      // 2. Аккуратная компактная полоса включения голоса (управление выезжает сбоку плавающими кнопками!)
      '<div class="voice-start-strip no-print">' +
      '<div class="voice-start-info">' +
      "<strong>Медленное чтение голосом</strong>" +
      "<span>Кнопки паузы и скорости появятся сбоку экрана</span>" +
      "</div>" +
      '<button type="button" id="btn-voice-main" class="voice-start-btn" data-action="tts-play" data-slug="' +
      escapeHtml(article.slug) +
      '">🔊 Читать вслух (медленно ' +
      (state.ttsRate || 0.6) +
      "×)</button>" +
      "</div>" +
      // 3. Компактный статус защиты экрана от гашения
      '<div id="wakelock-bar" class="wakelock-bar no-print">' +
      '<span id="wakelock-status-text" class="wakelock-status-text">☀ Экран не гаснет</span>' +
      '<button type="button" id="btn-wakelock-toggle" class="wakelock-toggle-btn" data-action="toggle-wakelock">Переключить</button>' +
      "</div>" +
      // 4. Пряжа, спицы и плотность
      '<section class="specs-card">' +
      '<h2 class="card-block-title">Пряжа, спицы и плотность вязания</h2>' +
      '<ul class="specs-list">' +
      specsHtml +
      "</ul>" +
      "</section>" +
      // 5. Схемы узора (нажатие открывает на 100% экрана)
      '<section id="charts-anchor" class="charts-section-card">' +
      '<h2 class="card-block-title">Схемы узора (нажмите на картинку — откроется во весь экран)</h2>' +
      '<div class="charts-stack">' +
      chartsHtml +
      "</div>" +
      "</section>" +
      // 6. Условные обозначения
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
      // 9. Печать крупным шрифтом и оригинальный PDF
      '<section class="print-download-card no-print">' +
      '<h2 class="card-block-title">Распечатать на бумаге или сохранить PDF</h2>' +
      '<p style="margin:0 0 14px;color:var(--text-muted);">Вы можете распечатать чистое описание очень крупным шрифтом или открыть архивный PDF со схемами.</p>' +
      '<div class="article-card-actions">' +
      '<button type="button" class="btn btn-primary" data-action="print-large">🖨 Печать крупным шрифтом</button>' +
      '<a href="' +
      escapeHtml(article.originalPdf) +
      '" target="_blank" rel="noopener" class="btn btn-secondary">📄 Оригинальный PDF со схемами</a>' +
      "</div>" +
      '<p class="source-credit">Первоисточник модели: <a href="' +
      escapeHtml(article.sourceUrl) +
      '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(article.sourceName) +
      "</a></p>" +
      '<button type="button" class="replay-hints-link" data-action="replay-hints">Показать подсказки по сайту заново</button>' +
      "</section>" +
      "</article>";

    acquireWakeLockIfNeeded();
    setupArticleScrollOnboarding();
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
    showHeaderBar();

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
    runtime.lastScrollY = 0;
  }

  function bindGlobalEvents() {
    document.getElementById("btn-font-scale").addEventListener("click", cycleFontScale);
    document.getElementById("btn-theme-toggle").addEventListener("click", toggleTheme);

    // Плавающие боковые кнопки озвучки (#tts-fab-rail)
    document.getElementById("fab-tts-toggle").addEventListener("click", function () {
      var art = getArticleBySlug(runtime.tts.articleSlug || runtime.currentRoute.param);
      if (art) togglePlayPauseTts(art);
    });

    document.getElementById("fab-tts-speed").addEventListener("click", cycleTtsSpeed);

    document.getElementById("fab-tts-repeat").addEventListener("click", function () {
      var art = getArticleBySlug(runtime.tts.articleSlug || runtime.currentRoute.param);
      if (art) {
        startSpeakingStep(art, runtime.tts.currentIndex || 0, runtime.tts.autoAdvance, false);
      }
    });

    document.getElementById("fab-tts-next").addEventListener("click", function () {
      var art = getArticleBySlug(runtime.tts.articleSlug || runtime.currentRoute.param);
      if (art) {
        startSpeakingStep(art, (runtime.tts.currentIndex || 0) + 1, true, true);
      }
    });

    document.getElementById("fab-tts-stop").addEventListener("click", stopTts);

    // Кнопки обучения (coachmarks)
    document.getElementById("btn-onboarding-ok").addEventListener("click", function () {
      dismissActiveCoachmark(true);
    });
    document.getElementById("btn-onboarding-skip-all").addEventListener("click", function () {
      state.onboardingDisabled = true;
      saveState();
      disconnectOnboardingObserver();
      dismissActiveCoachmark(true);
      showToast("Подсказки скрыты");
    });

    // Всплывающая подсказка и кружок внутри окна схемы
    document.getElementById("chart-hint-bubble").addEventListener("click", function () {
      // Повторное нажатие на сам текст подсказки сразу скрывает его в кружок
      collapseChartHintToDot();
    });

    document.getElementById("chart-hint-dot").addEventListener("click", function () {
      // Нажатие на кружок снова показывает текст подсказки на 18 секунд (15–20 сек)
      showChartHintForSeconds(18);
    });

    // Кнопки внутри окна схемы
    document.getElementById("btn-chart-close").addEventListener("click", closeChartModal);
    document.getElementById("btn-chart-rotate").addEventListener("click", toggleChartLandscapeMode);
    document.getElementById("btn-zoom-in").addEventListener("click", function () {
      zoomChartAroundPoint(1.35);
    });
    document.getElementById("btn-zoom-out").addEventListener("click", function () {
      zoomChartAroundPoint(1 / 1.35);
    });
    document.getElementById("btn-zoom-reset").addEventListener("click", fitChartToViewport);

    // Делегирование кнопок на страницах
    document.addEventListener("click", function (e) {
      if (
        runtime.currentRoute.view === "article" &&
        state.wakeLockEnabled &&
        !runtime.wakeLockActive
      ) {
        acquireWakeLockIfNeeded();
      }

      var btn = e.target.closest("[data-action]");
      if (!btn) return;

      // Если пользователь нажал на подсвеченный подсказкой элемент — засчитываем подсказку
      if (btn.getAttribute("data-coach-highlight") === "true") {
        dismissActiveCoachmark(true);
      }

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
        return;
      }

      if (action === "tts-play" && slug) {
        var artPlay = getArticleBySlug(slug);
        if (artPlay) togglePlayPauseTts(artPlay);
        return;
      }

      if (action === "speak-step" && slug) {
        var stepIdx = parseInt(btn.getAttribute("data-step-index") || "0", 10);
        var artStep = getArticleBySlug(slug);
        if (artStep) {
          if (
            runtime.tts.active &&
            runtime.tts.currentIndex === stepIdx
          ) {
            togglePlayPauseTts(artStep);
          } else {
            // Озвучивает выбранный абзац полностью до последнего слова без прокрутки вверх/вниз
            startSpeakingStep(artStep, stepIdx, false, false);
          }
        }
        return;
      }

      if (action === "open-chart" && slug) {
        var chartId = btn.getAttribute("data-chart-id");
        openChartModal(slug, chartId);
        return;
      }

      if (action === "open-photo" && slug) {
        var phSrc = btn.getAttribute("data-src");
        var phCap = btn.getAttribute("data-caption");
        openChartModal(
          slug,
          null,
          phSrc,
          phCap || "Фотография модели",
          "Раздвигайте фотографию двумя пальцами или поверните телефон горизонтально."
        );
        return;
      }

      if (action === "print-large") {
        stopTts();
        window.print();
        return;
      }

      if (action === "replay-hints") {
        resetOnboardingHints();
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

    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && runtime.chartModal.isOpen) {
        closeChartModal();
      }
    });

    window.addEventListener("hashchange", handleRouteChange);

    // Автоматическая подгонка схемы на 100% экрана при повороте телефона в горизонтальный режим
    var onViewportChange = function () {
      if (runtime.chartModal.isOpen) {
        setTimeout(fitChartToViewport, 80);
      }
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onViewportChange);
    }
  }

  // ==========================================================================
  // 11. SERVICE WORKER (ОБНОВЛЁННЫЙ КЭШ V2)
  // ==========================================================================

  function registerOfflineWorker() {
    if ("serviceWorker" in navigator && window.location.protocol.indexOf("http") === 0) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("./sw.js").catch(function () {});
      });
    }
  }

  applyVisualPreferences();
  initHeaderAutoHide();
  initChartModalGestures();
  bindGlobalEvents();
  handleRouteChange();
  registerOfflineWorker();
})();
