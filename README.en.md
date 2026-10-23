# dsh-bot

**Multi-zone professional model routing for DeepSeek Harness.**

Choose a model for each work area — main orchestrator, text, code, image, video, TTS, audio, 3D, and custom zones — per project. The main model dispatches specialist work to the matching zone through tool calling.

A standard Cordis bundle with a Host half and a Web Client half. Works in the official DSH Desktop and Web builds.

- Repository: <https://github.com/zhonglike/dsh-bot>
- Releases: <https://github.com/zhonglike/dsh-bot/releases>
- License: MIT

---

## Features

- Fixed configuration page title: **选择哪个区域需要什么模型**
- 8 presets plus unlimited custom zones
- Per-zone enable/disable, display name, and model selection
- Forced configuration on the first visit to a project
- Persistent **重新配置区域模型** entry in the composer
- Per-project storage (`Workspace / cwd`), no API keys stored
- `zone_list` and `zone_dispatch` tools for the orchestrator
- **Real image/video generation**: image and video zones call media APIs and write files to `<project>/.dsh-bot/generated/`
- Reuses the official DSH **Settings → Models** provider/model directory

---

## Install (AI-assisted)

Copy this to an AI inside DSH:

```text
Install the dsh-bot Cordis plugin into the current DSH profile.
Repository: https://github.com/zhonglike/dsh-bot
1. Clone the repository to a local directory.
2. Call plugin_manager with action=install_bundle and target=<absolute path>.
3. Confirm application=applied and warnings is empty.
4. Refresh the DSH Web page if needed.
5. Open a new project/session. A page titled
   "选择哪个区域需要什么模型" must appear.
Do not change the package name or implement model discovery yourself.
```

Detailed checklist: [docs/AI-INSTALL.md](docs/AI-INSTALL.md).

---

## First use

1. Open **Settings → Models** and make sure at least one provider/model is available.
   Add a custom API with the official Base URL + API Key form and pull models with **获取可用模型**.
2. Open a new project/session.
3. Configure the **main** zone (required), enable the zones you need, and pick models.
4. Click **保存并开始**.
5. Use **重新配置区域模型** at any time.

---

## Runtime

```text
User message
  → main zone model (takes over agent/request)
  → understands and splits the task
  → zone_dispatch(zone="code", task="…", context="…")
  → code zone provider/model
  → final text back to main
  → main replies to the user
```

`zone_dispatch` is a single-turn, tool-less specialist call for text-like zones. Image and video zones actually generate media: Token Plan image/video models are supported, and images also support a generic OpenAI-compatible `/images/generations` endpoint. Generated files are saved under `.dsh-bot/generated/`.

Token Plan media requires a Token Plan package API key starting with `sk-sp-`. A normal DashScope key returns HTTP 401; update the `qwen-token-plan` key under Settings → Models.

---

## Storage

```text
$DSH_PROFILE_DIR/zone-router/state.json
```

The file maps a normalized project cwd to its zone list. It contains no secrets. Same project = reused config; new project = new configuration.

---

## Limitations

- Image and video zones generate real files. TTS/audio/3D zones still route text, specs, and analysis.
- Token Plan video generation is asynchronous (submit → poll → download) and can take minutes.
- `zone_dispatch` for text-like zones is single-turn and has no tools.
- The main zone overrides the root session's model on every request.
- Subagents are not overridden.

---

## License

MIT © 2026 zhonglike
