# BSGoofyExtension

Chrome extension for automating Edgenuity quiz/test navigation and multiple-choice answering with configurable AI providers.

## Features

- Detects and solves visible multiple-choice and true/false questions.
- Supports multiple providers:
  - Built-in keyless free provider race (LLM7, Kilo, OVHcloud)
  - Google Gemini
  - Groq
  - OpenRouter
  - Local Ollama
- Auto-clicks **Click to Begin** screens.
- Auto-checks answers and auto-advances to next question.
- Detects end of quiz/test and auto-submits.
- Auto-plays paused videos and advances when complete.
- Includes an on-page HUD for current automation status.

## Project Structure

- `/manifest.json` — extension manifest and permissions
- `/background.js` — AI provider logic, answer parsing, provider fallback
- `/content.js` — page automation loop and quiz/video/navigation handling
- `/popup.html` — settings UI
- `/popup.js` — settings load/save behavior

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder:
   `/home/runner/work/BSGoofyExtension/BSGoofyExtension`

## Configuration

Open the extension popup and configure:

- Enable/disable automation
- Auto-check, auto-advance, auto-submit, auto-start, auto-play video
- Provider selection (`free`, `gemini`, `groq`, `openrouter`, `ollama`)
- API key and model (when required)
- Ollama endpoint/model (for local mode)
- Action delay in milliseconds

## Usage

1. Open an Edgenuity activity/assessment page.
2. Ensure extension is enabled in popup settings.
3. Let the automation run:
   - Starts quizzes/tests
   - Solves supported questions
   - Progresses and submits when finished

## Notes

- This extension is Manifest V3 and uses a background service worker.
- Local settings are stored with `chrome.storage.local`.
