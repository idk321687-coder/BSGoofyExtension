# BSGoofyExtension

A Manifest V3 browser extension for Edgenuity that provides configurable AI-assisted navigation and answer selection for quizzes, topic tests, and course activities.

> **Educational and responsible-use notice:** This extension can automatically select answers and submit assessments. Use it only where permitted by your school, instructor, course, and applicable policies. You are responsible for reviewing answers and complying with academic-integrity requirements.

## Features

- AI-assisted multiple-choice and true/false answer selection.
- Supports Edgenuity quizzes and topic tests.
- Detects the final question and can submit completed assessments.
- Automatically clicks **Click to Begin** when enabled.
- Automatically advances through questions and activities.
- Can auto-play paused course videos and advance after playback finishes.
- Displays an on-page status HUD for current activity and errors.
- Caches previously solved questions during the extension session.
- Supports multiple AI backends:
  - Built-in keyless free AI gateway race.
  - Google Gemini.
  - Groq.
  - OpenRouter.
  - Local Ollama.
- Configurable action delay and automation toggles.

## Project structure

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 configuration, permissions, content-script matches, and popup registration. |
| `background.js` | Service worker that sends questions to the selected AI provider and parses the returned answer index. |
| `content.js` | Detects questions, selects answers, advances activities, handles videos, and submits completed assessments. |
| `popup.html` | Extension settings interface. |
| `popup.js` | Loads and saves settings using `chrome.storage.local`. |

## Installation

This project is currently set up as an unpacked browser extension.

1. Download or clone this repository.
2. Open your Chromium-based browser's extensions page:
   - Chrome: `chrome://extensions`
   - Microsoft Edge: `edge://extensions`
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository directory containing `manifest.json`.
6. Open the extension popup and configure the desired provider and automation settings.

After changing the source files, return to the extensions page and click **Reload** for the extension.

## Configuration

Open the extension popup to configure:

- Enable or disable the auto-solver.
- Auto-check answers.
- Auto-advance between questions.
- Auto-submit quizzes and tests.
- Auto-click quiz or test start controls.
- Auto-play videos.
- AI provider and model.
- API key for providers that require one.
- Ollama endpoint and model.
- Delay between actions.

### Provider options

#### Built-in keyless free AI

The default provider sends requests to several configured free gateways in parallel and uses the first successful response. Availability, rate limits, response times, and terms of service may vary.

#### Google Gemini, Groq, or OpenRouter

Select the provider, enter an API key, and specify a compatible model. Keep API keys private and do not commit them to this repository.

#### Ollama

Run Ollama locally, select the Ollama provider, and configure the local endpoint and model. The default endpoint is:

```text
http://localhost:11434/api/generate
```

## Permissions and network access

The extension requests storage, active-tab, and scripting permissions. It also declares access to Edgenuity pages and the configured AI endpoints so it can process questions and automate page controls.

Review `manifest.json` before installation if you want to verify or restrict the requested permissions. Questions and answer choices may be sent to the selected remote AI provider. Do not use a remote provider if that conflicts with your privacy requirements or institutional policies.

## Development

The project uses plain JavaScript and HTML and does not currently require a package manager or build step.

Typical development workflow:

1. Edit the source files.
2. Reload the unpacked extension from the browser extensions page.
3. Test on a permitted Edgenuity practice activity.
4. Inspect the extension service worker and page console for diagnostics.

## Limitations

- Page selectors are designed around Edgenuity interfaces and may need updates when the site changes.
- Cross-origin frames may not be accessible to the content script.
- AI providers can return incorrect, incomplete, delayed, or rate-limited responses.
- Free gateways may become unavailable without notice.
- Automated submission can be irreversible; keep auto-submit disabled until you understand the behavior.
- The project does not guarantee correctness, availability, or compatibility with every Edgenuity activity.

## License

This project is released under the [Unlicense](LICENSE) into the public domain.

You are free to use, copy, modify, publish, distribute, sublicense, and sell this software without attribution, subject to the disclaimer in the `LICENSE` file.
