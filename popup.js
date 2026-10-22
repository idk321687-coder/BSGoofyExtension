// popup.js - Loads and saves extension settings

const FIELDS = [
  "enabled",
  "autoSubmit",
  "autoAdvance",
  "autoPlayVideos",
  "provider",
  "apiKey",
  "model",
  "ollamaUrl",
  "ollamaModel",
  "delayMs"
];

function toggleProviderFields() {
  const provider = document.getElementById("provider").value;
  const freeHint = document.getElementById("freeHint");
  const apiKeyGroup = document.getElementById("apiKeyGroup");
  const ollamaGroup = document.getElementById("ollamaGroup");
  const modelInput = document.getElementById("model");

  if (provider === "free") {
    freeHint.style.display = "block";
    apiKeyGroup.style.display = "none";
    ollamaGroup.style.display = "none";
  } else if (provider === "ollama") {
    freeHint.style.display = "none";
    apiKeyGroup.style.display = "none";
    ollamaGroup.style.display = "block";
  } else {
    freeHint.style.display = "none";
    apiKeyGroup.style.display = "block";
    ollamaGroup.style.display = "none";
    if (provider === "gemini" && !modelInput.value) {
      modelInput.value = "gemini-2.5-flash";
    } else if (provider === "groq" && (modelInput.value === "gemini-2.5-flash" || !modelInput.value)) {
      modelInput.value = "openai/gpt-oss-120b";
    } else if (provider === "openrouter" && (modelInput.value === "gemini-2.5-flash" || !modelInput.value)) {
      modelInput.value = "openrouter/free";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(FIELDS, (data) => {
    document.getElementById("enabled").checked = data.enabled !== false;
    document.getElementById("autoSubmit").checked = data.autoSubmit !== false;
    document.getElementById("autoAdvance").checked = data.autoAdvance !== false;
    document.getElementById("autoPlayVideos").checked = data.autoPlayVideos !== false;
    document.getElementById("provider").value = data.provider || "free";
    document.getElementById("apiKey").value = data.apiKey || "";
    document.getElementById("model").value = data.model || "gemini-2.5-flash";
    document.getElementById("ollamaUrl").value = data.ollamaUrl || "http://localhost:11434/api/generate";
    document.getElementById("ollamaModel").value = data.ollamaModel || "llama3.2";
    document.getElementById("delayMs").value = data.delayMs || 2500;
    toggleProviderFields();
  });

  document.getElementById("provider").addEventListener("change", toggleProviderFields);

  document.getElementById("saveBtn").addEventListener("click", () => {
    const updated = {
      enabled: document.getElementById("enabled").checked,
      autoSubmit: document.getElementById("autoSubmit").checked,
      autoAdvance: document.getElementById("autoAdvance").checked,
      autoPlayVideos: document.getElementById("autoPlayVideos").checked,
      provider: document.getElementById("provider").value,
      apiKey: document.getElementById("apiKey").value.trim(),
      model: document.getElementById("model").value.trim(),
      ollamaUrl: document.getElementById("ollamaUrl").value.trim(),
      ollamaModel: document.getElementById("ollamaModel").value.trim(),
      delayMs: Number(document.getElementById("delayMs").value) || 2500
    };

    chrome.storage.local.set(updated, () => {
      const status = document.getElementById("status");
      status.textContent = "Settings saved!";
      setTimeout(() => { status.textContent = ""; }, 2000);
    });
  });
});
