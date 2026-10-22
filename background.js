// background.js - Multi-provider Keyless Free AI Waterfall (Kilo, LLM7, OVHcloud) + Gemini, Groq, OpenRouter, Ollama

const DEFAULT_SETTINGS = {
  enabled: true,
  autoAdvance: true,
  autoSubmit: true,
  autoPlayVideos: true,
  provider: "free", // "free" (no key needed) | "gemini" | "groq" | "openrouter" | "ollama"
  apiKey: "",
  model: "gemini-2.5-flash",
  ollamaUrl: "http://localhost:11434/api/generate",
  ollamaModel: "llama3.2",
  delayMs: 2500
};

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
    return true; // keep channel open for async response
  }
});

async function solveMultipleChoice({ question, options }) {
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
    "You are an accurate academic multiple-choice solver. " +
    "Read the question and numbered options carefully. " +
    "Reply ONLY with a valid JSON object in the exact format: " +
    '{"index": 0} ' +
    "where index is the 0-based integer index (0, 1, 2, ...) of the single correct option. Do not include any extra text.";

  const userPrompt = `Question:\n${question}\n\nOptions:\n${numberedOptions}`;

  let rawText = "";

  if (provider === "free") {
    rawText = await callKeylessFreeAIWaterfall(systemPrompt, userPrompt);
  } else if (provider === "gemini") {
    const model = settings.model || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errBody}`);
    }
    const data = await res.json();
    rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } else if (provider === "groq") {
    const model =
      settings.model && !settings.model.startsWith("gemini")
        ? settings.model
        : "openai/gpt-oss-120b";
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
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
    rawText = data?.choices?.[0]?.message?.content || "";
  } else if (provider === "openrouter") {
    const model =
      settings.model && !settings.model.startsWith("gemini")
        ? settings.model
        : "openrouter/free";
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
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
    rawText = data?.choices?.[0]?.message?.content || "";
  } else if (provider === "ollama") {
    const url = settings.ollamaUrl || "http://localhost:11434/api/generate";
    const model = settings.ollamaModel || "llama3.2";
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
      throw new Error(`Local Ollama error (${res.status}). Ensure Ollama is running with OLLAMA_ORIGINS=*`);
    }
    const data = await res.json();
    rawText = data?.response || "";
  }

  return parseAnswerIndex(rawText, options);
}

async function callKeylessFreeAIWaterfall(systemPrompt, userPrompt) {
  const candidates = [
    {
      name: "LLM7 (gpt-oss:20b)",
      url: "https://api.llm7.io/v1/chat/completions",
      model: "gpt-oss:20b"
    },
    {
      name: "LLM7 (Mistral-Nemo)",
      url: "https://api.llm7.io/v1/chat/completions",
      model: "mistral-Nemo-Instruct-2407"
    },
    {
      name: "Kilo Free Router (v1)",
      url: "https://api.kilo.ai/api/gateway/v1/chat/completions",
      model: "kilo-auto/free"
    },
    {
      name: "Kilo Free Router",
      url: "https://api.kilo.ai/api/gateway/chat/completions",
      model: "kilo-auto/free"
    },
    {
      name: "Kilo Liquid LFM",
      url: "https://api.kilo.ai/api/gateway/v1/chat/completions",
      model: "liquid/lfm-2.5-2.6b:free"
    },
    {
      name: "OVHcloud (Llama-3.3-70B)",
      url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
      model: "Meta-Llama-3_3-70B-Instruct"
    },
    {
      name: "OVHcloud (Qwen3-32B)",
      url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
      model: "Qwen3-32B"
    },
    {
      name: "OVHcloud (Mistral-Nemo)",
      url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
      model: "Mistral-Nemo-Instruct-2407"
    },
    {
      name: "OVHcloud (gpt-oss-120b)",
      url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
      model: "gpt-oss-120b"
    }
  ];

  const errors = [];

  for (const endpoint of candidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: endpoint.model,
          temperature: 0.1,
          max_tokens: 150,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        errors.push(`${endpoint.name}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const content =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.text ||
        data?.response ||
        "";

      if (content && content.trim().length > 0) {
        return content;
      }
      errors.push(`${endpoint.name}: empty content`);
    } catch (err) {
      errors.push(`${endpoint.name}: ${err.message}`);
    }
  }

  throw new Error(
    `All keyless gateways busy (${errors.slice(0, 3).join("; ")}). Paste a free Gemini or Groq API key in the extension popup for dedicated quota.`
  );
}

function parseAnswerIndex(rawText, options) {
  const optionCount = options.length;
  const cleaned = (rawText || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json|```/gi, "")
    .trim();

  try {
    const obj = JSON.parse(cleaned);
    const idx = Number(obj.index ?? obj.answer ?? obj.choice);
    if (Number.isInteger(idx) && idx >= 0 && idx < optionCount) {
      return { index: idx, reason: obj.reason || "" };
    }
  } catch (_) {}

  const jsonMatch = cleaned.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      const idx = Number(obj.index ?? obj.answer ?? obj.choice);
      if (Number.isInteger(idx) && idx >= 0 && idx < optionCount) {
        return { index: idx, reason: obj.reason || "" };
      }
    } catch (_) {}
  }

  const idxMatch = cleaned.match(/"?(?:index|answer|option|choice)"?\s*[:=]\s*(\d+)/i);
  if (idxMatch) {
    const idx = Number(idxMatch[1]);
    if (idx >= 0 && idx < optionCount) {
      return { index: idx, reason: "Matched index field" };
    }
  }

  const letterMatch = cleaned.match(/\b([A-D])\b/);
  if (letterMatch) {
    const letterIdx = letterMatch[1].charCodeAt(0) - 65;
    if (letterIdx >= 0 && letterIdx < optionCount) {
      return { index: letterIdx, reason: `Matched letter ${letterMatch[1]}` };
    }
  }

  const digitMatch = cleaned.match(/\b(\d+)\b/);
  if (digitMatch) {
    const idx = Number(digitMatch[1]);
    if (idx >= 0 && idx < optionCount) {
      return { index: idx, reason: "Matched numeric index" };
    }
  }

  const lowerCleaned = cleaned.toLowerCase();
  for (let i = 0; i < options.length; i++) {
    const optText = options[i].text.toLowerCase();
    if (optText.length > 2 && lowerCleaned.includes(optText)) {
      return { index: i, reason: "Matched option text" };
    }
  }

  throw new Error(`Could not parse valid option index from AI output: ${cleaned.slice(0, 120)}`);
}
