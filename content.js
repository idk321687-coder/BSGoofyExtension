// content.js - Solves MCQs strictly sequentially (1, 2, 3, 4, 5...) with cross-frame 3.5s debounce lock and single-click dispatch

let solvedQuestionHashes = new Set();
let handledEndedMediaKeys = new Set();
let isBusy = false;
let hudElement = null;
let hookedVideos = new WeakSet();

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
  optionContainers: [
    "ul.answer-choice-list > li",
    ".answer-choice-wrapper",
    ".answer-choice",
    "div.Practice_Question_Body label",
    "[data-tid^='answer-option']",
    "[data-tid*='answer-choice']",
    "[role='radiogroup'] [role='radio']",
    ".choice-item",
    "label.radio-label"
  ],
  // Per-question Check / Done button (in Instruction / Warm-Up / Practice frames)
  checkAnswerButtons: [
    "#btnCheck",
    "input[value='Done']",
    "input[value='Check']",
    "button.done-retry-btn",
    "[data-tid='check-button']",
    "[data-tid='submit-answer-button']"
  ],
  // Next Question button inside quizzes/assessments
  nextQuestionButtons: [
    "#nextQuestion",
    "#next_question",
    "#btnNext",
    "a.next-question",
    ".next-question",
    "[data-tid='next-button']",
    "button.next-btn",
    "input[type='button'][value*='Next' i]",
    "a[title*='Next Question' i]"
  ],
  // 1. In-lesson Next Video / Next Frame buttons (inside #stageFrame / TryStartActivity)
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
  // 2. Outer Next Activity / Assignment buttons (in top Activity page when all lesson parts are complete)
  nextActivityButtons: [
    "a.footnav.goRight:not(.disabled)",
    "li.footnav.goRight:not(.disabled) a",
    "#next-activity:not(.disabled)",
    "[data-tid='next-activity-button']",
    "button[aria-label*='Next Activity' i]"
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
      maxWidth: "360px",
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
      ["enabled", "autoAdvance", "autoSubmit", "autoPlayVideos", "delayMs"],
      (res) => resolve({
        enabled: res.enabled !== false,
        autoAdvance: res.autoAdvance !== false,
        autoSubmit: res.autoSubmit !== false,
        autoPlayVideos: res.autoPlayVideos !== false,
        delayMs: Math.max(1200, Number(res.delayMs) || 2500)
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
  const style = win.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
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
  const parentLi = el.closest("li, button, a");
  if (
    parentLi &&
    (parentLi.classList.contains("disabled") ||
      parentLi.classList.contains("inactive") ||
      parentLi.classList.contains("locked") ||
      parentLi.getAttribute("aria-disabled") === "true")
  ) {
    return true;
  }
  return false;
}

// Single clean click without duplicate event dispatching
function triggerSingleClick(el) {
  if (!el) return;
  if (typeof el.click === "function") {
    el.click();
  } else {
    const win = el.ownerDocument?.defaultView || window;
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: win }));
  }
}

// Global cross-frame cooldown: NEVER allows any Next button to be clicked more than once every 3.5 seconds across any frame
async function safelyClickNextWithCooldown(el, minCooldownMs = 3500) {
  if (!el) return false;
  const state = await chrome.storage.local.get(["globalLastNextActionTime"]);
  const now = Date.now();
  if (state.globalLastNextActionTime && now - state.globalLastNextActionTime < minCooldownMs) {
    return false; // Still in cooldown from previous question advance
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

function hasIncompleteLessonFrames(docs) {
  for (const doc of docs) {
    const frameTabs = Array.from(doc.querySelectorAll("li.FrameTab, ol.FramesList li, ul#frame_toolbar li.FrameTab"));
    if (frameTabs.length > 0) {
      for (const tab of frameTabs) {
        const cls = (tab.className || "").toLowerCase();
        if (cls.includes("incomplete") || cls.includes("unvisited")) {
          return true;
        }
      }
      const lastTab = frameTabs[frameTabs.length - 1];
      const lastCls = (lastTab.className || "").toLowerCase();
      if (!lastCls.includes("complete") && !lastCls.includes("current")) {
        return true;
      }
    }
  }
  return false;
}

// Scopes question & option extraction strictly to the single active visible container
function extractQuestionFromDoc(doc) {
  let activeContainer = null;
  for (const sel of SELECTORS.questionContainers) {
    const matchingContainers = Array.from(doc.querySelectorAll(sel)).filter(isElementVisible);
    if (matchingContainers.length > 0) {
      activeContainer = matchingContainers[0];
      break;
    }
  }

  const searchScope = activeContainer || doc;

  let optionGroups = [];
  for (const sel of SELECTORS.optionContainers) {
    const found = Array.from(searchScope.querySelectorAll(sel)).filter((el) => {
      if (!isElementVisible(el)) return false;
      const txt = (el.innerText || "").trim();
      return txt.length > 0;
    });
    if (found.length >= 2) {
      optionGroups = found;
      break;
    }
  }

  if (optionGroups.length < 2) {
    const radios = Array.from(searchScope.querySelectorAll("input[type='radio']"));
    const visibleContainers = [];
    for (const r of radios) {
      const container =
        (r.id && doc.querySelector(`label[for='${CSS.escape(r.id)}']`)) ||
        r.closest("li") ||
        r.closest("tr") ||
        r.closest("label") ||
        r.closest(".answer-choice") ||
        r.parentElement;
      if (container && isElementVisible(container) && !visibleContainers.includes(container)) {
        visibleContainers.push(container);
      }
    }
    if (visibleContainers.length >= 2) {
      optionGroups = visibleContainers;
    }
  }

  if (optionGroups.length < 2) {
    const choiceBtns = Array.from(searchScope.querySelectorAll(".answer-choice-button")).filter(isElementVisible);
    if (choiceBtns.length >= 2) {
      optionGroups = choiceBtns.map((btn) => btn.closest("li, tr, div") || btn);
    }
  }

  if (optionGroups.length < 2) {
    return null;
  }

  let questionText = "";
  if (activeContainer) {
    const clone = activeContainer.cloneNode(true);
    clone
      .querySelectorAll("ul.answer-choice-list, .answer-choice, label, input, button, select")
      .forEach((n) => n.remove());
    questionText = (clone.innerText || "").trim();
  }

  if (!questionText || questionText.length < 5) {
    const ancestor =
      optionGroups[0].closest("form, .Assessment_Main_Body_Content_Question, .content, main, body") ||
      doc.body;
    if (ancestor) {
      const clone = ancestor.cloneNode(true);
      clone
        .querySelectorAll(
          "ul.answer-choice-list, .answer-choice, label, input, button, script, style, nav, header, footer, #edg-ai-hud"
        )
        .forEach((n) => n.remove());
      questionText = (clone.innerText || "").replace(/\s+/g, " ").trim();
    }
  }

  if (!questionText || questionText.length < 4) {
    return null;
  }

  // Detect question number if available (e.g. "Question 3 of 10")
  let questionNumberLabel = "";
  const numEl = doc.querySelector(".current-question, .question-number, [data-tid*='question-number'], #question-number, .Assessment_Question_Number");
  if (numEl && isElementVisible(numEl)) {
    questionNumberLabel = (numEl.innerText || "").trim();
  }

  let alreadyAnswered = false;
  const options = optionGroups
    .map((el, index) => {
      const radio = el.querySelector("input[type='radio'], input[type='checkbox']");
      const btn = el.querySelector(".answer-choice-button, [role='radio']");
      if (
        (radio && radio.checked) ||
        el.classList.contains("selected") ||
        el.classList.contains("checked") ||
        el.getAttribute("aria-checked") === "true" ||
        btn?.classList.contains("selected")
      ) {
        alreadyAnswered = true;
      }
      const cleanText = (el.innerText || "")
        .replace(/^[A-D][.)\s]+/i, "")
        .replace(/\s+/g, " ")
        .trim();
      return {
        index,
        text: cleanText || `Option ${index + 1}`,
        element: el,
        doc
      };
    })
    .filter((o) => o.text.length > 0);

  if (options.length < 2) return null;

  return {
    question: questionText,
    questionNumberLabel,
    options,
    alreadyAnswered,
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
  const doc = optionObj.doc || document;
  const win = doc.defaultView || window;

  el.style.outline = "3px solid #22c55e";
  el.style.backgroundColor = "rgba(34, 197, 94, 0.14)";
  el.style.borderRadius = "6px";

  const input =
    el.querySelector("input[type='radio'], input[type='checkbox']") ||
    (el.tagName === "INPUT" ? el : null);

  if (input) {
    input.checked = true;
    triggerSingleClick(input);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.Event("change", { bubbles: true }));

    if (input.id) {
      const associatedLabel = doc.querySelector(`label[for='${CSS.escape(input.id)}']`);
      if (associatedLabel) {
        triggerSingleClick(associatedLabel);
      }
    }
  }

  const choiceBtn = el.querySelector(".answer-choice-button, [role='radio'], a, button, label");
  if (choiceBtn && choiceBtn !== input) {
    triggerSingleClick(choiceBtn);
  }

  triggerSingleClick(el);
}

function isOptionSelected(optionObj) {
  const el = optionObj.element;
  const input = el.querySelector("input[type='radio'], input[type='checkbox']");
  if (input && input.checked) return true;
  if (
    el.classList.contains("selected") ||
    el.classList.contains("checked") ||
    el.getAttribute("aria-checked") === "true" ||
    el.querySelector(".selected, .checked, [aria-checked='true']")
  ) {
    return true;
  }
  return false;
}

function findFirstVisibleInDocs(docs, selectorList) {
  for (const doc of docs) {
    for (const sel of selectorList) {
      const candidates = Array.from(doc.querySelectorAll(sel));
      for (const el of candidates) {
        if (isElementVisible(el) && !isElementDisabled(el)) {
          return el;
        }
      }
    }
  }
  return null;
}

async function advanceAfterSlideComplete(docs) {
  const nextFrameBtn = findFirstVisibleInDocs(docs, SELECTORS.nextFrameButtons);
  if (nextFrameBtn) {
    const clicked = await safelyClickNextWithCooldown(nextFrameBtn);
    if (clicked) {
      updateHud("⏭️ Slide complete — moving to next part...", "#38bdf8");
      return true;
    }
    return false;
  }
  await chrome.storage.local.set({ readyForNextActivityAt: Date.now() });
  const nextActivityBtn = findFirstVisibleInDocs(docs, SELECTORS.nextActivityButtons);
  if (nextActivityBtn) {
    await safelyClickNextWithCooldown(nextActivityBtn, 6000);
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
          updateHud("🎬 Video finished! Moving to next part...", "#22c55e");
          await sleep(1000);
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
        (Number.isFinite(duration) && duration > 2 && currentTime >= duration - 0.3);

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
          const playBtn = findFirstVisibleInDocs([doc], SELECTORS.videoPlayButtons);
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

  // 1. Check for playing/loading videos (locks navigation while video runs)
  const mediaState = inspectAndHandleMedia(docs, settings);

  if (mediaState.hasActiveUnfinishedMedia) {
    await chrome.storage.local.set({
      innerMediaPlayingUntil: Date.now() + 5000,
      lastInnerActivityHeartbeat: Date.now()
    });
    return;
  }

  if (mediaState.newlyEndedMediaKey && settings.autoAdvance) {
    isBusy = true;
    try {
      await chrome.storage.local.set({ innerMediaPlayingUntil: 0 });
      await sleep(1000);
      await advanceAfterSlideComplete(docs);
    } finally {
      await sleep(settings.delayMs);
      isBusy = false;
    }
    return;
  }

  // 2. Check for active multiple-choice question
  const mcq = findActiveMcq(docs);

  if (mcq) {
    // Only the frame containing the question DOM handles solving to prevent duplicate frame actions
    if (mcq.doc !== document) {
      return;
    }

    await chrome.storage.local.set({
      lastQuestionActiveAt: Date.now(),
      lastInnerActivityHeartbeat: Date.now()
    });

    const hash = `${mcq.question.slice(0, 120)}::${mcq.options.map((o) => o.text).join("|")}`;

    // Check shared cross-frame lock: if a Next action occurred within the last 3.5s, wait!
    const cooldownState = await chrome.storage.local.get(["globalLastNextActionTime", "globalLastSolvedHash"]);
    const now = Date.now();
    const timeSinceLastNext = now - (cooldownState.globalLastNextActionTime || 0);

    if (timeSinceLastNext < 3500 || cooldownState.globalLastSolvedHash === hash) {
      updateHud("⏳ Loading next question...", "#38bdf8");
      return;
    }

    // Solve this question if not yet answered
    if (!mcq.alreadyAnswered && !solvedQuestionHashes.has(hash)) {
      isBusy = true;
      try {
        const qNum = mcq.questionNumberLabel ? `[${mcq.questionNumberLabel}] ` : "";
        updateHud(`🤖 ${qNum}Solving: "${mcq.question.slice(0, 45)}..."`, "#38bdf8");

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

          await sleep(400);
          if (!isOptionSelected(chosen)) {
            selectOptionElement(chosen);
          }

          solvedQuestionHashes.add(hash);
          await chrome.storage.local.set({ globalLastSolvedHash: hash });

          const letter = String.fromCharCode(65 + response.index);
          updateHud(`✅ ${qNum}Picked ${letter}: ${chosen.text.slice(0, 45)}`, "#22c55e");

          await sleep(Math.max(800, settings.delayMs / 2));

          if (settings.autoSubmit) {
            const checkBtn = findFirstVisibleInDocs(docs, SELECTORS.checkAnswerButtons);
            if (checkBtn) {
              triggerSingleClick(checkBtn);
              await sleep(Math.max(1200, settings.delayMs / 2));
            }
          }

          if (settings.autoAdvance) {
            const nextQBtn = findFirstVisibleInDocs(docs, SELECTORS.nextQuestionButtons);
            if (nextQBtn) {
              await safelyClickNextWithCooldown(nextQBtn, 3500);
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
        await sleep(settings.delayMs);
        isBusy = false;
      }
      return;
    }

    // Notice: The old redundant "if (alreadyAnswered) click next" block is permanently removed!
    // Every question is advanced once and only once right inside the solve block above.
    return;
  }

  // 3. Keep heartbeat alive if incomplete lesson frames remain
  if (hasIncompleteLessonFrames(docs)) {
    await chrome.storage.local.set({ lastInnerActivityHeartbeat: Date.now() });
    return;
  }

  // 4. Outer Activity window: click Next Activity only when signaled or idle, throttled to 12s
  if (settings.autoAdvance && window === window.top) {
    const state = await chrome.storage.local.get([
      "innerMediaPlayingUntil",
      "lastQuestionActiveAt",
      "lastInnerActivityHeartbeat",
      "readyForNextActivityAt",
      "globalLastNextActionTime"
    ]);
    const now = Date.now();

    if (state.innerMediaPlayingUntil && now < state.innerMediaPlayingUntil) return;
    if (state.lastQuestionActiveAt && now - state.lastQuestionActiveAt < 5000) return;
    if (state.globalLastNextActionTime && now - state.globalLastNextActionTime < 4000) return;

    const signaledReady =
      state.readyForNextActivityAt && now - state.readyForNextActivityAt < 8000;
    const noInnerHeartbeatRecently =
      !state.lastInnerActivityHeartbeat || now - state.lastInnerActivityHeartbeat > 6000;

    if (signaledReady || noInnerHeartbeatRecently) {
      const nextActivityBtn = findFirstVisibleInDocs(docs, SELECTORS.nextActivityButtons);
      if (nextActivityBtn) {
        const clicked = await safelyClickNextWithCooldown(nextActivityBtn, 12000);
        if (clicked) {
          await chrome.storage.local.set({ readyForNextActivityAt: 0 });
        }
      }
    }
  }
}

setInterval(mainLoop, 1800);
