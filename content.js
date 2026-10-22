// content.js - v2.1: Automatically detects Topic Tests (25 questions) vs Quizzes (10 questions), clicks "Click to Begin", and submits after the final question

let solvedQuestionHashes = new Set();
let handledEndedMediaKeys = new Set();
let isBusy = false;
let hudElement = null;
let hookedVideos = new WeakSet();
let lastFrameProgressClickAt = 0;

const SELECTORS = {
  questionContainers: [
    ".Assessment_Main_Body_Content_Question",
    ".Question_Contents",
    ".Practice_Question_Body",
    ".question-container",
    ".assessment-question",
    "[data-tid='question-prompt']",
    "[data-tid*='question-stem']",
    ".question-stem",
    ".stem",
    ".prompt",
    "#question-text"
  ],
  checkAnswerButtons: [
    "#btnCheck",
    "input[value='Done']",
    "input[value='Check']",
    "button.done-retry-btn",
    "[data-tid='check-button']",
    "[data-tid='submit-answer-button']"
  ],
  nextQuestionButtons: [
    "#nextQuestion",
    "#next_question",
    "#btnNext",
    "a.next-question",
    ".next-question",
    "[data-tid='next-button']",
    "button.next-btn",
    "input[type='button'][value='Next' i]",
    "a[title*='Next Question' i]"
  ],
  submitQuizButtons: [
    "#btnSubmit",
    "#submitBtn",
    "#submit",
    "input[value='Submit']",
    "input[value='Submit Assessment']",
    "input[value='Submit Exam']",
    "input[value='Finish']",
    "button[data-tid='submit-assessment']",
    "button[data-tid='submit-button']",
    "button.submit-quiz",
    ".complete-btn",
    "input[type='button'][value*='Submit' i]",
    "button[aria-label*='Submit' i]"
  ],
  confirmSubmitModalButtons: [
    ".ui-dialog-buttonset button:first-child",
    ".ui-dialog-buttonset button",
    ".modal-footer button.btn-primary",
    "[data-tid='confirm-submit-button']",
    "button.confirm",
    "input[value='Yes']",
    "input[value='OK']",
    "input[value='Confirm']",
    ".modal-dialog button[aria-label*='Submit' i]",
    ".dialog-buttons button:first-child"
  ],
  startQuizButtons: [
    "#btnStart",
    "#btnBegin",
    "#startBtn",
    "input[value='Start']",
    "input[value='Start Assessment']",
    "input[value='Start Quiz']",
    "input[value='Begin']",
    "input[value='Begin Assessment']",
    "button[data-tid='start-button']",
    "button[data-tid='start-assessment-button']",
    "button[data-tid='start-activity-button']",
    "button.start-button",
    "a.btn-start",
    "a.start-activity"
  ],
  nextFrameButtons: [
    "li.FrameRight:not(.disabled) a",
    "li.FrameRight:not(.disabled)",
    ".FrameRight:not(.disabled) a",
    ".FrameRight:not(.disabled)",
    "#uid1_next:not(.disabled)",
    "[data-tid='next-frame-button']",
    "button[aria-label*='Next Frame' i]",
    "button[aria-label*='Next Slide' i]"
  ],
  nextActivityButtons: [
    "a.footnav.goRight:not(.disabled)",
    "li.footnav.goRight:not(.disabled) a",
    ".footnav.goRight:not(.disabled)",
    "#next-activity:not(.disabled)",
    "#nextActivity:not(.disabled)",
    ".next-activity:not(.disabled)",
    "[data-tid='next-activity-button']",
    "button[aria-label*='Next Activity' i]",
    "a[title*='Next Activity' i]"
  ],
  videoPlayButtons: [
    "#uid1_play",
    ".vjs-big-play-button",
    ".vjs-play-control.vjs-paused",
    "[data-tid='play-button']",
    "button[aria-label='Play' i]"
  ],
  invisBlocker: "#invis-o-div"
};

function updateHud(text, color = "#38bdf8") {
  if (window !== window.top) {
    try {
      window.top.postMessage({ type: "EDG_AI_HUD", text, color }, "*");
    } catch (_) {}
    return;
  }
  if (!document.body) return;
  if (!hudElement) {
    hudElement = document.createElement("div");
    hudElement.id = "edg-ai-hud";
    Object.assign(hudElement.style, {
      position: "fixed",
      bottom: "14px",
      left: "14px",
      zIndex: "2147483647",
      background: "rgba(15, 23, 42, 0.94)",
      color: "#f8fafc",
      border: "1px solid #334155",
      borderLeft: `4px solid ${color}`,
      borderRadius: "8px",
      padding: "8px 12px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: "12px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
      pointerEvents: "none",
      maxWidth: "380px",
      lineHeight: "1.35"
    });
    document.body.appendChild(hudElement);
  }
  hudElement.style.borderLeftColor = color;
  hudElement.textContent = text;
}

window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "EDG_AI_HUD" && window === window.top) {
    updateHud(e.data.text, e.data.color);
  }
});

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["enabled", "autoAdvance", "autoSubmit", "autoSubmitQuiz", "autoStartQuiz", "autoPlayVideos", "delayMs"],
      (res) => resolve({
        enabled: res.enabled !== false,
        autoAdvance: res.autoAdvance !== false,
        autoSubmit: res.autoSubmit !== false,
        autoSubmitQuiz: res.autoSubmitQuiz !== false,
        autoStartQuiz: res.autoStartQuiz !== false,
        autoPlayVideos: res.autoPlayVideos !== false,
        delayMs: Math.max(600, Number(res.delayMs) || 1400)
      })
    );
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function isElementVisible(el) {
  if (!el) return false;
  const win = el.ownerDocument?.defaultView || window;
  let cur = el;
  while (cur && cur.nodeType === 1) {
    const style = win.getComputedStyle(cur);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) {
      return false;
    }
    cur = cur.parentElement;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const vw = win.innerWidth || document.documentElement.clientWidth || 1920;
  const vh = win.innerHeight || document.documentElement.clientHeight || 1080;
  return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
}

function isElementDisabled(el) {
  if (!el) return true;
  if (
    el.disabled ||
    el.classList.contains("disabled") ||
    el.classList.contains("inactive") ||
    el.classList.contains("locked") ||
    el.getAttribute("aria-disabled") === "true"
  ) {
    return true;
  }
  const parent = el.closest("li, button, a, div.footnav");
  if (
    parent &&
    (parent.classList.contains("disabled") ||
      parent.classList.contains("inactive") ||
      parent.classList.contains("locked") ||
      parent.getAttribute("aria-disabled") === "true")
  ) {
    return true;
  }
  return false;
}

function triggerSingleClick(el) {
  if (!el) return;
  const win = el.ownerDocument?.defaultView || window;
  const eventInit = { bubbles: true, cancelable: true, view: win };
  el.dispatchEvent(new MouseEvent("pointerdown", eventInit));
  el.dispatchEvent(new MouseEvent("mousedown", eventInit));
  el.dispatchEvent(new MouseEvent("pointerup", eventInit));
  el.dispatchEvent(new MouseEvent("mouseup", eventInit));
  if (typeof el.click === "function") {
    el.click();
  } else {
    el.dispatchEvent(new MouseEvent("click", eventInit));
  }
}

async function safelyClickNextWithCooldown(el, minCooldownMs = 1300) {
  if (!el) return false;
  const state = await chrome.storage.local.get(["globalLastNextActionTime"]);
  const now = Date.now();
  if (state.globalLastNextActionTime && now - state.globalLastNextActionTime < minCooldownMs) {
    return false;
  }
  await chrome.storage.local.set({ globalLastNextActionTime: now });
  triggerSingleClick(el);
  return true;
}

function getAccessibleDocuments(rootDoc = document) {
  const docs = [rootDoc];
  const frames = rootDoc.querySelectorAll("iframe, frame");
  for (const frame of frames) {
    try {
      const src = frame.getAttribute("src") || "";
      if (src && src.startsWith("http")) {
        const frameOrigin = new URL(src, location.href).origin;
        if (frameOrigin !== location.origin) {
          continue;
        }
      }
      const childDoc = frame.contentDocument;
      if (childDoc && childDoc.body) {
        docs.push(...getAccessibleDocuments(childDoc));
      }
    } catch (_) {}
  }
  return docs;
}

function removeInvisibleOverlays(docs) {
  for (const doc of docs) {
    const blocker = doc.querySelector(SELECTORS.invisBlocker);
    if (blocker) blocker.remove();
  }
}

function findButtonInDocs(docs, selectorList, textRegex = null, excludeTextRegex = null) {
  for (const doc of docs) {
    for (const sel of selectorList) {
      const candidates = Array.from(doc.querySelectorAll(sel));
      for (const el of candidates) {
        if (isElementVisible(el) && !isElementDisabled(el)) {
          return el;
        }
      }
    }
    if (textRegex) {
      const clickables = Array.from(
        doc.querySelectorAll("button, a, input[type='button'], input[type='submit'], [role='button'], .btn, .footnav, div, span")
      );
      let bestMatch = null;
      let smallestArea = Infinity;

      for (const el of clickables) {
        if (!isElementVisible(el) || isElementDisabled(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > 320 || rect.height > 260) continue;

        const label = ((el.innerText || el.value || el.getAttribute("title") || el.getAttribute("aria-label") || ""))
          .replace(/\s+/g, " ")
          .trim();
        if (!label) continue;
        if (excludeTextRegex && excludeTextRegex.test(label)) continue;
        if (textRegex.test(label)) {
          const area = rect.width * rect.height;
          if (area < smallestArea) {
            smallestArea = area;
            bestMatch = el;
          }
        }
      }
      if (bestMatch) return bestMatch;
    }
  }
  return null;
}

function findQuizStartElement(docs) {
  const bySelector = findButtonInDocs(docs, SELECTORS.startQuizButtons);
  if (bySelector) return bySelector;

  for (const doc of docs) {
    const allEls = Array.from(doc.querySelectorAll("div, button, a, span, p"));
    let targetEl = null;
    let smallestArea = Infinity;

    for (const el of allEls) {
      if (!isElementVisible(el) || isElementDisabled(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 14 || rect.width > 320 || rect.height > 320) continue;

      const txt = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (/^click\s+to\s+begin/i.test(txt) || /^(start|begin)\s+(assessment|quiz|exam|test)$/i.test(txt)) {
        const area = rect.width * rect.height;
        if (area < smallestArea) {
          smallestArea = area;
          targetEl = el;
        }
      }
    }

    if (targetEl) {
      return targetEl;
    }
  }
  return null;
}

function parseRgb(colorStr) {
  if (!colorStr) return null;
  const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] !== undefined ? Number(m[4]) : 1
  };
}

function isOrangeColor(rgb) {
  if (!rgb || rgb.a === 0) return false;
  return rgb.r > 170 && rgb.g > 70 && rgb.b < 90 && (rgb.r - rgb.b) > 90;
}

// Detects whether the current assessment title/header says "Test" (e.g. "Topic Test", "Unit Test" -> 25 questions) vs "Quiz" (10 questions)
function detectAssessmentExpectedTotal(doc) {
  // Inspect visible header elements in the top 260px of the assessment page
  const headerEls = Array.from(doc.querySelectorAll("h1, h2, h3, h4, div, span, p")).filter((el) => {
    if (!isElementVisible(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.top < 250 && rect.height < 90;
  });

  for (const el of headerEls) {
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (/\b(topic\s+test|unit\s+test|test)\b/i.test(text) && text.length < 80) {
      return 25;
    }
  }

  return 10;
}

// Inspects the numbered question boxes at the top of an Edgenuity Quiz (1..10) or Topic Test (1..25)
function getQuizNavProgress(doc) {
  const expectedMinTotal = detectAssessmentExpectedTotal(doc);

  // 1. Find currently visible numbered boxes in the top bar (e.g. 1..10 or 21..25)
  const visibleCandidates = Array.from(doc.querySelectorAll("a, li, button, div, span")).filter((el) => {
    if (!isElementVisible(el)) return false;
    const t = (el.innerText || "").trim();
    if (!/^\d{1,2}$/.test(t)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 16 && rect.width <= 65 && rect.height >= 16 && rect.height <= 65 && rect.top < 340;
  });

  const visibleByNum = new Map();
  for (const el of visibleCandidates) {
    const num = Number(el.innerText.trim());
    if (num >= 1 && num <= 60 && !visibleByNum.has(num)) {
      visibleByNum.set(num, el);
    }
  }

  if (visibleByNum.size === 0) return null;

  // 2. Also check the nav bar container for any hidden/paged question boxes (e.g. 11..25 when viewing 1..10)
  let maxDomBoxNum = 0;
  const sampleBox = visibleCandidates[0];
  const navBarContainer = sampleBox.closest("ul, ol, nav, .question-nav, .pagination") || sampleBox.parentElement?.parentElement;
  if (navBarContainer) {
    const allNavChildren = Array.from(navBarContainer.querySelectorAll("a, li, button, span, div"));
    for (const node of allNavChildren) {
      const t = (node.innerText || node.textContent || "").trim();
      if (/^\d{1,2}$/.test(t)) {
        const n = Number(t);
        if (n >= 1 && n <= 60 && n > maxDomBoxNum) {
          maxDomBoxNum = n;
        }
      }
    }
  }

  const visibleNums = Array.from(visibleByNum.keys()).sort((a, b) => a - b);
  const highestVisibleNum = visibleNums[visibleNums.length - 1];

  // If title says "Test" (Topic Test), totalQuestions is 25 (or higher if DOM has more); otherwise max of visible/DOM/10
  const totalQuestions = Math.max(expectedMinTotal, maxDomBoxNum, highestVisibleNum);

  let currentQuestion = null;
  let unansweredVisibleBoxNumbers = [];

  const win = doc.defaultView || window;
  for (const num of visibleNums) {
    const el = visibleByNum.get(num);
    const parent = el.parentElement;
    const child = el.firstElementChild;
    const nodesToCheck = [el, parent, child].filter(Boolean);

    let isActive = false;
    let isAnsweredBorder = false;

    for (const node of nodesToCheck) {
      const cls = (node.className || "").toLowerCase();
      const style = win.getComputedStyle(node);
      const bg = parseRgb(style.backgroundColor);
      const border = parseRgb(style.borderTopColor || style.borderColor);

      if (
        cls.includes("active") ||
        cls.includes("current") ||
        cls.includes("selected") ||
        isOrangeColor(bg)
      ) {
        isActive = true;
      }

      if (
        cls.includes("answered") ||
        cls.includes("complete") ||
        cls.includes("visited") ||
        isOrangeColor(border) ||
        isOrangeColor(bg)
      ) {
        isAnsweredBorder = true;
      }
    }

    if (isActive) {
      currentQuestion = num;
    }
    if (!isAnsweredBorder && !isActive) {
      unansweredVisibleBoxNumbers.push(num);
    }
  }

  return {
    currentQuestion,
    totalQuestions,
    isTest: expectedMinTotal >= 25,
    isLastQuestion: currentQuestion !== null && currentQuestion >= totalQuestions,
    allVisibleBoxesAnswered: unansweredVisibleBoxNumbers.length === 0 && currentQuestion !== null && currentQuestion >= totalQuestions,
    unansweredBoxNumbers: unansweredVisibleBoxNumbers,
    boxMap: visibleByNum
  };
}

function extractQuestionFromDoc(doc) {
  let activeContainer = null;
  for (const sel of SELECTORS.questionContainers) {
    const matching = Array.from(doc.querySelectorAll(sel)).filter(isElementVisible);
    if (matching.length > 0) {
      activeContainer = matching[0];
      break;
    }
  }

  const searchScope = activeContainer || doc;

  const allRadios = Array.from(searchScope.querySelectorAll("input[type='radio'], input[type='checkbox']"));
  const visibleRadios = allRadios.filter((r) => {
    if (isElementVisible(r)) return true;
    const row = r.closest("li, tr, label, .answer-choice, .answer-choice-wrapper") || r.parentElement;
    return isElementVisible(row);
  });

  let options = [];
  let alreadyAnswered = false;

  if (visibleRadios.length >= 2) {
    options = visibleRadios.map((r, index) => {
      if (r.checked) alreadyAnswered = true;

      const labelEl =
        (r.id && doc.querySelector(`label[for='${CSS.escape(r.id)}']`)) ||
        r.closest("label");
      const rowEl =
        r.closest("li, tr, .answer-choice, .answer-choice-wrapper") ||
        labelEl ||
        r.parentElement;

      let rawText = "";
      if (labelEl && (labelEl.innerText || "").trim().length > 0) {
        rawText = labelEl.innerText.trim();
      }
      if (rowEl && (rowEl.innerText || "").trim().length > rawText.length) {
        rawText = rowEl.innerText.trim();
      }

      let cleanText = rawText.replace(/\s+/g, " ").trim();
      if (cleanText.length > 2) {
        cleanText = cleanText.replace(/^[A-D][.)\s]+/i, "").trim();
      }

      return {
        index,
        text: cleanText || `Option ${index + 1}`,
        input: r,
        label: labelEl,
        element: rowEl || r,
        doc
      };
    });
  } else {
    const containerSelectors = [
      "ul.answer-choice-list > li",
      ".answer-choice-wrapper",
      ".answer-choice",
      "[data-tid^='answer-option']",
      "[data-tid*='answer-choice']",
      "[role='radiogroup'] [role='radio']",
      ".choice-item"
    ];
    for (const sel of containerSelectors) {
      const found = Array.from(searchScope.querySelectorAll(sel)).filter((el) => {
        return isElementVisible(el) && (el.innerText || "").trim().length > 0;
      });
      if (found.length >= 2) {
        options = found.map((el, index) => {
          const r = el.querySelector("input[type='radio'], input[type='checkbox']");
          if (
            (r && r.checked) ||
            el.classList.contains("selected") ||
            el.classList.contains("checked") ||
            el.getAttribute("aria-checked") === "true"
          ) {
            alreadyAnswered = true;
          }
          let cleanText = (el.innerText || "").replace(/\s+/g, " ").trim();
          if (cleanText.length > 2) {
            cleanText = cleanText.replace(/^[A-D][.)\s]+/i, "").trim();
          }
          return {
            index,
            text: cleanText || `Option ${index + 1}`,
            input: r,
            label: el.querySelector("label"),
            element: el,
            doc
          };
        });
        break;
      }
    }
  }

  if (options.length < 2) return null;

  let questionText = "";
  const cardAncestor =
    activeContainer ||
    options[0].element.closest(".Assessment_Main_Body_Content_Question, .Question_Contents, form, .content, main") ||
    options[0].element.parentElement?.parentElement;

  if (cardAncestor) {
    const clone = cardAncestor.cloneNode(true);
    clone
      .querySelectorAll(
        "ul.answer-choice-list, .answer-choice, label, input, button, a.btn, select, script, style, #edg-ai-hud"
      )
      .forEach((n) => n.remove());
    questionText = (clone.innerText || "")
      .replace(/Please select the best answer from the choices provided\.?/gi, "")
      .replace(/Mark this and return|Save and Exit|Previous Question|Next|Submit/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (!questionText || questionText.length < 3) {
    questionText = (doc.body.innerText || "").slice(0, 500).replace(/\s+/g, " ").trim();
  }

  const navProgress = getQuizNavProgress(doc);

  return {
    question: questionText,
    options,
    alreadyAnswered,
    navProgress,
    doc
  };
}

function findActiveMcq(docs) {
  for (const doc of docs) {
    const mcq = extractQuestionFromDoc(doc);
    if (mcq) return mcq;
  }
  return null;
}

function selectOptionElement(optionObj) {
  const el = optionObj.element;
  const input = optionObj.input || el.querySelector("input[type='radio'], input[type='checkbox']");
  const label = optionObj.label;
  const doc = optionObj.doc || document;
  const win = doc.defaultView || window;

  if (el && el.style) {
    el.style.outline = "2px solid #22c55e";
    el.style.borderRadius = "4px";
  }

  if (input) {
    input.checked = true;
    triggerSingleClick(input);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
  }

  if (label && label !== input) {
    triggerSingleClick(label);
  }

  const choiceBtn = el?.querySelector?.(".answer-choice-button, [role='radio'], a, button");
  if (choiceBtn && choiceBtn !== input && choiceBtn !== label) {
    triggerSingleClick(choiceBtn);
  }

  if (el && el !== input && el !== label) {
    triggerSingleClick(el);
  }
}

function isOptionSelected(optionObj) {
  const input = optionObj.input || optionObj.element?.querySelector?.("input[type='radio'], input[type='checkbox']");
  if (input && input.checked) return true;
  const el = optionObj.element;
  if (
    el?.classList?.contains("selected") ||
    el?.classList?.contains("checked") ||
    el?.getAttribute?.("aria-checked") === "true" ||
    el?.querySelector?.(".selected, .checked, [aria-checked='true']")
  ) {
    return true;
  }
  return false;
}

// Clicks Submit on the quiz/test ONLY when on the final question (Q10/10 for Quiz, Q25/25 for Topic Test)
async function submitCompletedQuiz(docs) {
  const submitQuizBtn = findButtonInDocs(
    docs,
    SELECTORS.submitQuizButtons,
    /^submit(\s+assessment|\s+exam|\s+quiz)?$/i,
    /save|exit|next/i
  );
  if (submitQuizBtn) {
    updateHud("🎯 Final question complete! Submitting...", "#22c55e");
    await safelyClickNextWithCooldown(submitQuizBtn, 2000);
    await sleep(900);

    const confirmBtn = findButtonInDocs(
      docs,
      SELECTORS.confirmSubmitModalButtons,
      /^(yes|submit|confirm|ok)$/i,
      /no|cancel|save/i
    );
    if (confirmBtn) {
      triggerSingleClick(confirmBtn);
      await sleep(1200);
    }

    await chrome.storage.local.set({ readyForNextActivityAt: Date.now() });
    return true;
  }
  return false;
}

async function advanceAfterSlideComplete(docs) {
  const nextFrameBtn = findButtonInDocs(docs, SELECTORS.nextFrameButtons);
  const now = Date.now();

  if (nextFrameBtn && now - lastFrameProgressClickAt > 4000) {
    lastFrameProgressClickAt = now;
    triggerSingleClick(nextFrameBtn);
    updateHud("⏭️ Video complete — advancing...", "#38bdf8");
    await sleep(1000);
  }

  await chrome.storage.local.set({ readyForNextActivityAt: Date.now() });
  const nextActivityBtn = findButtonInDocs(
    docs,
    SELECTORS.nextActivityButtons,
    /^next\s+activity$/i
  );
  if (nextActivityBtn) {
    updateHud("⏭️ Moving to next assignment / quiz...", "#22c55e");
    await safelyClickNextWithCooldown(nextActivityBtn, 3000);
    return true;
  }
  return false;
}

function inspectAndHandleMedia(docs, settings) {
  let hasActiveUnfinishedMedia = false;
  let newlyEndedMediaKey = null;

  for (const doc of docs) {
    const videos = Array.from(doc.querySelectorAll("video")).filter(isElementVisible);
    for (const video of videos) {
      const mediaKey = `${video.currentSrc || video.src || "video"}_${Math.round(video.duration || 0)}`;

      if (!hookedVideos.has(video)) {
        hookedVideos.add(video);
        video.addEventListener("ended", async () => {
          const endKey = `${video.currentSrc || video.src || "video"}_${Math.round(video.duration || 0)}`;
          handledEndedMediaKeys.add(endKey);
          await chrome.storage.local.set({ innerMediaPlayingUntil: 0 });
          updateHud("🎬 Video finished! Advancing to next part...", "#22c55e");
          await sleep(700);
          const latestSettings = await getSettings();
          if (latestSettings.enabled && latestSettings.autoAdvance) {
            await advanceAfterSlideComplete(getAccessibleDocuments(document));
          }
        });
      }

      const duration = video.duration;
      const currentTime = video.currentTime || 0;

      const isTrulyFinished =
        video.ended ||
        (Number.isFinite(duration) && duration > 2 && currentTime >= duration - 0.4);

      if (isTrulyFinished) {
        if (!handledEndedMediaKeys.has(mediaKey)) {
          handledEndedMediaKeys.add(mediaKey);
          newlyEndedMediaKey = mediaKey;
        }
      } else {
        hasActiveUnfinishedMedia = true;

        if (video.paused && settings.autoPlayVideos && video.readyState >= 1) {
          video.play().catch(() => {
            video.muted = true;
            video.play().catch(() => {});
          });
          const playBtn = findButtonInDocs([doc], SELECTORS.videoPlayButtons);
          if (playBtn) triggerSingleClick(playBtn);
        }

        if (Number.isFinite(duration) && duration > 0) {
          updateHud(
            `🎬 Video playing (${formatTime(currentTime)} / ${formatTime(duration)}) — waiting for end`,
            "#a855f7"
          );
        } else {
          updateHud("🎬 Video loading — waiting for playback...", "#a855f7");
        }
      }
    }
  }

  return { hasActiveUnfinishedMedia, newlyEndedMediaKey };
}

async function mainLoop() {
  if (isBusy) return;

  const settings = await getSettings();
  if (!settings.enabled) return;

  const docs = getAccessibleDocuments(document);
  removeInvisibleOverlays(docs);

  // 1. Check for playing/loading videos
  const mediaState = inspectAndHandleMedia(docs, settings);

  if (mediaState.hasActiveUnfinishedMedia) {
    await chrome.storage.local.set({
      innerMediaPlayingUntil: Date.now() + 3500,
      lastInnerActivityHeartbeat: Date.now()
    });
    return;
  }

  if (mediaState.newlyEndedMediaKey && settings.autoAdvance) {
    isBusy = true;
    try {
      await chrome.storage.local.set({ innerMediaPlayingUntil: 0 });
      await sleep(600);
      await advanceAfterSlideComplete(docs);
    } finally {
      await sleep(800);
      isBusy = false;
    }
    return;
  }

  // 2. Check for "Click to Begin" / Start Quiz or Test screen
  if (settings.autoStartQuiz) {
    const startEl = findQuizStartElement(docs);
    if (startEl) {
      const state = await chrome.storage.local.get(["globalLastStartActionTime"]);
      const now = Date.now();
      if (!state.globalLastStartActionTime || now - state.globalLastStartActionTime > 2500) {
        await chrome.storage.local.set({ globalLastStartActionTime: now });
        updateHud("🚀 Clicking 'Click to Begin' to start...", "#22c55e");
        triggerSingleClick(startEl);
        const childPlay = startEl.querySelector("button, a, span, div, i, svg");
        if (childPlay) triggerSingleClick(childPlay);
        if (startEl.parentElement && startEl.parentElement !== document.body) {
          triggerSingleClick(startEl.parentElement);
        }
        return;
      }
    }
  }

  // 3. Check for open submission confirmation modal ("Are you sure you want to submit?")
  if (settings.autoSubmitQuiz) {
    const confirmBtn = findButtonInDocs(
      docs,
      SELECTORS.confirmSubmitModalButtons,
      /^(yes|confirm)$/i,
      /no|cancel|save/i
    );
    if (confirmBtn) {
      updateHud("✅ Confirming submission...", "#22c55e");
      triggerSingleClick(confirmBtn);
      await chrome.storage.local.set({ readyForNextActivityAt: Date.now() });
      return;
    }
  }

  // 4. Check for active multiple-choice / True-False question
  const mcq = findActiveMcq(docs);

  if (mcq) {
    if (mcq.doc !== document) {
      return;
    }

    await chrome.storage.local.set({
      lastQuestionActiveAt: Date.now(),
      lastInnerActivityHeartbeat: Date.now()
    });

    const nav = mcq.navProgress;
    const qPrefix = nav && nav.currentQuestion ? `[Q${nav.currentQuestion}/${nav.totalQuestions}] ` : "";

    // Only treat as end of assessment when on the final question (Q10/10 for Quiz, Q25/25 for Topic Test)
    const isAtEndOfQuiz = nav ? nav.isLastQuestion : false;

    // If this specific question on screen already has a radio button checked:
    if (mcq.alreadyAnswered) {
      isBusy = true;
      try {
        if (isAtEndOfQuiz && settings.autoSubmitQuiz) {
          if (nav && nav.unansweredBoxNumbers.length > 0) {
            const firstUnansweredBox = nav.boxMap.get(nav.unansweredBoxNumbers[0]);
            if (firstUnansweredBox) {
              updateHud(`⏭️ Jumping to unanswered Q${nav.unansweredBoxNumbers[0]}...`, "#38bdf8");
              triggerSingleClick(firstUnansweredBox);
              return;
            }
          }
          await submitCompletedQuiz(docs);
        } else if (settings.autoAdvance) {
          const nextQBtn = findButtonInDocs(
            docs,
            SELECTORS.nextQuestionButtons,
            /^next(\s+question)?$/i,
            /activity|frame|save|submit/i
          );
          if (nextQBtn) {
            updateHud(`⏭️ ${qPrefix}Answered — advancing to next question...`, "#38bdf8");
            await safelyClickNextWithCooldown(nextQBtn, 1000);
          } else if (settings.autoSubmitQuiz) {
            await submitCompletedQuiz(docs);
          }
        }
      } finally {
        await sleep(800);
        isBusy = false;
      }
      return;
    }

    // Unanswered question — solve with fast parallel AI!
    isBusy = true;
    try {
      updateHud(`🤖 ${qPrefix}Solving: "${mcq.question.slice(0, 45)}..."`, "#38bdf8");

      const response = await chrome.runtime.sendMessage({
        type: "SOLVE_MCQ",
        payload: {
          question: mcq.question,
          options: mcq.options.map(({ index, text }) => ({ index, text }))
        }
      });

      if (response && response.ok && mcq.options[response.index]) {
        const chosen = mcq.options[response.index];
        selectOptionElement(chosen);

        await sleep(250);
        if (!isOptionSelected(chosen)) {
          selectOptionElement(chosen);
        }

        const hash = `${mcq.question.slice(0, 120)}::${mcq.options.map((o) => o.text).join("|")}`;
        solvedQuestionHashes.add(hash);

        const letter = chosen.text.length <= 5 ? chosen.text : String.fromCharCode(65 + response.index);
        updateHud(`✅ ${qPrefix}Picked ${letter}: ${chosen.text.slice(0, 45)}`, "#22c55e");

        await sleep(Math.max(450, settings.delayMs / 2));

        if (settings.autoSubmit) {
          const checkBtn = findButtonInDocs(docs, SELECTORS.checkAnswerButtons);
          if (checkBtn) {
            triggerSingleClick(checkBtn);
            await sleep(700);
          }
        }

        // Re-check nav progress after answering: ONLY submit if we just answered the final question (Q10/10 on Quiz, Q25/25 on Topic Test)
        const updatedNav = getQuizNavProgress(mcq.doc) || nav;
        const shouldSubmitNow = updatedNav
          ? updatedNav.isLastQuestion && updatedNav.unansweredBoxNumbers.length === 0
          : false;

        if (shouldSubmitNow && settings.autoSubmitQuiz) {
          const submitted = await submitCompletedQuiz(docs);
          if (submitted) return;
        }

        if (settings.autoAdvance) {
          const nextQBtn = findButtonInDocs(
            docs,
            SELECTORS.nextQuestionButtons,
            /^next(\s+question)?$/i,
            /activity|frame|save|submit/i
          );
          if (nextQBtn) {
            await safelyClickNextWithCooldown(nextQBtn, 1000);
          } else if (settings.autoSubmitQuiz) {
            const submitted = await submitCompletedQuiz(docs);
            if (!submitted) {
              await advanceAfterSlideComplete(docs);
            }
          } else {
            await advanceAfterSlideComplete(docs);
          }
        }
      } else {
        const errMsg = response?.error || "No response from AI";
        updateHud(`⚠️ AI Error: ${errMsg.slice(0, 80)}`, "#ef4444");
        console.warn("[Edgenuity AI] Solve error:", errMsg);
      }
    } catch (err) {
      updateHud(`⚠️ Error: ${err.message.slice(0, 75)}`, "#ef4444");
      console.warn("[Edgenuity AI] Exception:", err);
    } finally {
      await sleep(Math.max(550, settings.delayMs / 2));
      isBusy = false;
    }
    return;
  }

  // 5. Click "Next Activity |>" when signaled after video/quiz completion or when current page is idle
  if (settings.autoAdvance) {
    const state = await chrome.storage.local.get([
      "innerMediaPlayingUntil",
      "lastQuestionActiveAt",
      "readyForNextActivityAt"
    ]);
    const now = Date.now();

    if (state.innerMediaPlayingUntil && now < state.innerMediaPlayingUntil) return;
    if (state.lastQuestionActiveAt && now - state.lastQuestionActiveAt < 3500) return;

    const signaledReady =
      state.readyForNextActivityAt && now - state.readyForNextActivityAt < 15000;
    const idleLongEnough =
      !state.lastQuestionActiveAt || now - state.lastQuestionActiveAt > 4500;

    if (signaledReady || idleLongEnough) {
      const nextActivityBtn = findButtonInDocs(
        docs,
        SELECTORS.nextActivityButtons,
        /^next\s+activity/i
      );
      if (nextActivityBtn) {
        const clicked = await safelyClickNextWithCooldown(nextActivityBtn, 4000);
        if (clicked) {
          updateHud("⏭️ Advancing to Next Activity...", "#22c55e");
          await chrome.storage.local.set({ readyForNextActivityAt: 0 });
        }
      }
    }
  }
}

setInterval(mainLoop, 700);
