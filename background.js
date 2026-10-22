// background.js - v2.1: Fast Parallel Free AI Racing (no max_tokens truncation), parses reasoning/thinking fields, and auto-falls back across providers

const DEFAULT_SETTINGS = {
  enabled: true,
  autoAdvance: true,
  autoSubmit: true,
  autoSubmitQuiz: true,
  autoStartQuiz: true,
  autoPlayVideos: true,
  provider: "free", // "free" (no key needed) | "gemini" | "groq" | "openrouter" | "ollama"
  apiKey: "",
  model: "gemini-2.5-flash",
  ollamaUrl: "http://localhost:11434/api/generate",
  ollamaModel: "llama3.2",
  delayMs: 1400
};

const answerCache = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (stored) => {
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    if ((merged.provider === "gemini" || merged.provider === "groq" || merged.provider === "openrouter") && (!merged.apiKey || !merged.apiKey.trim())) {
      merged.provider = "free";
    }
    chrome.storage.local.set(merged);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SOLVE_MCQ") {
    solveMultipleChoice(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function solveMultipleChoice({ question, options }) {
  const cacheKey = `${question}::${options.map((o) => o.text).join("|")}`;
  if (answerCache.has(cacheKey)) {
    return answerCache.get(cacheKey);
  }

  const settings = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  let provider = settings.provider || "free";
  const apiKey = (settings.apiKey || "").trim();

  if ((provider === "gemini" || provider === "groq" || provider === "openrouter") && !apiKey) {
    provider = "free";
  }

  const numberedOptions = options
    .map((opt, idx) => `${idx}: ${opt.text}`)
    .join("\n");

  const systemPrompt =
    "You are a fast, accurate academic quiz solver. " +
    "Read the question and numbered options carefully. " +
    "Do not overthink. Output ONLY a JSON object: " +
    '{"index": 0} where index is the 0-based integer (0, 1, 2, ...) of the single correct option.';

  const userPrompt = `Question:\n${question}\n\nOptions:\n${numberedOptions}`;

  let result = null;

  try {
    if (provider === "free") {
      result = await callKeylessFreeAIParallel(systemPrompt, userPrompt, options);
    } else if (provider === "gemini") {
      result = await callGeminiAPI(apiKey, settings.model, systemPrompt, userPrompt, options);
    } else if (provider === "groq") {
      result = await callGroqAPI(apiKey, settings.model, systemPrompt, userPrompt, options);
    } else if (provider === "openrouter") {
      result = await callOpenRouterAPI(apiKey, settings.model, systemPrompt, userPrompt, options);
    } else if (provider === "ollama") {
      result = await callOllamaAPI(settings.ollamaUrl, settings.ollamaModel, systemPrompt, userPrompt, options);
    }
  } catch (primaryErr) {
    if (provider !== "free") {
      console.warn(`[Edgenuity AI] Primary provider (${provider}) failed (${primaryErr.message}), falling back to Keyless Free AI...`);
      result = await callKeylessFreeAIParallel(systemPrompt, userPrompt, options);
    } else {
      throw primaryErr;
    }
  }

  if (result && Number.isInteger(result.index)) {
    answerCache.set(cacheKey, result);
  }
  return result;
}

async function callGeminiAPI(apiKey, configuredModel, systemPrompt, userPrompt, options) {
  const model = configuredModel || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.0,
        responseMimeType: "application/json"
      }
    })
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errBody}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const nonThoughtText = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("\n");
  const allText = parts.map((p) => p.text || "").join("\n");
  return parseAnswerIndex(nonThoughtText || allText, options);
}

async function callGroqAPI(apiKey, configuredModel, systemPrompt, userPrompt, options) {
  const model =
    configuredModel && !configuredModel.startsWith("gemini")
      ? configuredModel
      : "llama-3.3-70b-versatile";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.0,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Groq API error (${res.status}): ${errBody}`);
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message || {};
  const rawText = [msg.content, msg.reasoning_content, msg.reasoning].filter(Boolean).join("\n");
  return parseAnswerIndex(rawText, options);
}

async function callOpenRouterAPI(apiKey, configuredModel, systemPrompt, userPrompt, options) {
  const model =
    configuredModel && !configuredModel.startsWith("gemini")
      ? configuredModel
      : "openrouter/free";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.0,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenRouter error (${res.status}): ${errBody}`);
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message || {};
  const rawText = [msg.content, msg.reasoning_content, msg.reasoning].filter(Boolean).join("\n");
  return parseAnswerIndex(rawText, options);
}

async function callOllamaAPI(ollamaUrl, ollamaModel, systemPrompt, userPrompt, options) {
  const url = ollamaUrl || "http://localhost:11434/api/generate";
  const model = ollamaModel || "llama3.2";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: `${systemPrompt}\n\n${userPrompt}`,
      format: "json",
      stream: false
    })
  });
  if (!res.ok) {
    throw new Error(`Local Ollama error (${res.status})`);
  }
  const data = await res.json();
  return parseAnswerIndex(data?.response || "", options);
}

async function callKeylessFreeAIParallel(systemPrompt, userPrompt, options) {
  const fastWave = [
    {
      name: "LLM7 (Mistral-Nemo)",
      url: "https://api.llm7.io/v1/chat/completions",
      model: "mistral-Nemo-Instruct-2407"
    },
    {
      name: "OVHcloud (Llama-3.3-70B)",
      url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
      model: "Meta-Llama-3_3-70B-Instruct"
    },
    {
      name: "OVHcloud (Mistral-Nemo)",
      url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
      model: "Mistral-Nemo-Instruct-2407"
    },
    {
      name: "OVHcloud (Qwen3-32B)",
      url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
      model: "Qwen3-32B"
    },
    {
      name: "Kilo Liquid LFM",
      url: "https://api.kilo.ai/api/gateway/v1/chat/completions",
      model: "liquid/lfm-2.5-2.6b:free"
    },
    {
      name: "Kilo Free Router",
      url: "https://api.kilo.ai/api/gateway/v1/chat/completions",
      model: "kilo-auto/free"
    },
    {
      name: "LLM7 (gpt-oss:20b)",
      url: "https://api.llm7.io/v1/chat/completions",
      model: "gpt-oss:20b"
    }
  ];

  const controllers = [];

  const queryEndpoint = async (endpoint) => {
    const controller = new AbortController();
    controllers.push(controller);
    const timeoutId = setTimeout(() => controller.abort(), 9500);

    try {
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: endpoint.model,
          temperature: 0.0,
          max_tokens: 800,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`${endpoint.name}: HTTP ${res.status}`);
      }

      const data = await res.json();
      const choice = data?.choices?.[0] || {};
      const msg = choice.message || {};

      const combinedText = [
        msg.content,
        choice.text,
        data?.response,
        msg.reasoning_content,
        msg.reasoning
      ]
        .filter((s) => typeof s === "string" && s.trim().length > 0)
        .join("\n");

      if (!combinedText) {
        throw new Error(`${endpoint.name}: empty response`);
      }

      return parseAnswerIndex(combinedText, options);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    const winner = await Promise.any(fastWave.map((ep) => queryEndpoint(ep)));
    controllers.forEach((c) => {
      try { c.abort(); } catch (_) {}
    });
    return winner;
  } catch (aggErr) {
    throw new Error(
      "All free AI gateways timed out or rate-limited. Paste a free Gemini or Groq key in the extension popup."
    );
  }
}

function parseAnswerIndex(rawText, options) {
  const optionCount = options.length;
  const fullText = String(rawText || "").trim();
  if (!fullText) {
    throw new Error("Empty AI output");
  }

  let cleaned = fullText
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/```json|```/gi, "")
    .trim();

  if (!cleaned) {
    cleaned = fullText.replace(/<\/?think>/gi, "").slice(-300).trim();
  }

  const candidatesToParse = [cleaned, fullText.slice(-300)];

  for (const text of candidatesToParse) {
    if (!text) continue;

    try {
      const obj = JSON.parse(text);
      const idx = Number(obj.index ?? obj.answer ?? obj.choice);
      if (Number.isInteger(idx) && idx >= 0 && idx < optionCount) {
        return { index: idx, reason: obj.reason || "" };
      }
    } catch (_) {}

    const jsonMatches = text.match(/\{[^{}]*\}/g);
    if (jsonMatches) {
      for (let i = jsonMatches.length - 1; i >= 0; i--) {
        try {
          const obj = JSON.parse(jsonMatches[i]);
          const idx = Number(obj.index ?? obj.answer ?? obj.choice);
          if (Number.isInteger(idx) && idx >= 0 && idx < optionCount) {
            return { index: idx, reason: obj.reason || "" };
          }
        } catch (_) {}
      }
    }

    const idxMatch = text.match(/"?(?:index|answer|option|choice)"?\s*[:=]\s*(\d+)/i);
    if (idxMatch) {
      const idx = Number(idxMatch[1]);
      if (idx >= 0 && idx < optionCount) {
        return { index: idx, reason: "Matched index field" };
      }
    }

    if (optionCount === 2) {
      const t0 = options[0].text.toLowerCase();
      const t1 = options[1].text.toLowerCase();
      if ((t0 === "t" || t0 === "true") && (t1 === "f" || t1 === "false")) {
        const lastTrue = text.toLowerCase().lastIndexOf("true");
        const lastFalse = text.toLowerCase().lastIndexOf("false");
        if (lastTrue !== -1 || lastFalse !== -1) {
          return { index: lastTrue > lastFalse ? 0 : 1, reason: "Matched True/False" };
        }
        if (/\bT\b/.test(text) && !/\bF\b/.test(text)) {
          return { index: 0, reason: "Matched T" };
        }
        if (/\bF\b/.test(text)) {
          return { index: 1, reason: "Matched F" };
        }
      }
    }

    const digitMatches = Array.from(text.matchAll(/\b(\d+)\b/g));
    for (let i = digitMatches.length - 1; i >= 0; i--) {
      const idx = Number(digitMatches[i][1]);
      if (idx >= 0 && idx < optionCount) {
        return { index: idx, reason: "Matched numeric index" };
      }
    }

    const letterMatch = text.match(/\b([A-D])\b/);
    if (letterMatch) {
      const letterIdx = letterMatch[1].charCodeAt(0) - 65;
      if (letterIdx >= 0 && letterIdx < optionCount) {
        return { index: letterIdx, reason: `Matched letter ${letterMatch[1]}` };
      }
    }

    const lowerText = text.toLowerCase();
    for (let i = 0; i < options.length; i++) {
      const optText = options[i].text.toLowerCase();
      if (optText.length >= 2 && lowerText.includes(optText)) {
        return { index: i, reason: "Matched option text" };
      }
    }
  }

  throw new Error(`Unparseable AI output: ${cleaned.slice(0, 80)}`);
}
