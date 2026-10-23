# dsh-bot

> **多区域专业模型路由**：为每个项目选择「主调度 / 文本 / 代码 / 图片 / 视频 / TTS / 音频 / 3D / 自定义区域」分别使用哪个模型，让主调度模型通过 Tool Calling 把专业任务派发给对应区域的模型。

这是一个标准 **Cordis 插件包**，同时提供 Host 半和 Web Client 半，可安装在 DeepSeek Harness 官方桌面版与 Web 版中。

- 仓库：<https://github.com/zhonglike/dsh-bot>
- 发行版：<https://github.com/zhonglike/dsh-bot/releases>
- 许可证：MIT

---

## 1. 它解决什么问题

DSH 官方「设置 → 模型」已经能添加 Provider、Base URL、API Key，并通过「获取可用模型」拉取上游模型。  
本插件**不重复实现**这些能力，只做三件事：

1. **按项目**把已配置的模型分配到不同工作区域。
2. 新项目第一次打开时**弹出配置页**；可以关闭，关闭后本项目不再自动弹出，随时可从输入框左侧入口重新打开。
3. 主调度模型通过 `zone_dispatch` 工具，把代码、写作等任务交给对应区域的模型；**图片区和视频区会实际生成图片/视频文件并保存到项目目录**。

配置页标题固定为：

> **选择哪个区域需要什么模型**

---

## 2. 功能

- 预设 8 个区域：
  - `main` 主调度模型
  - `text` 文本区
  - `code` 代码区
  - `image` 图片区
  - `video` 视频区
  - `tts` TTS区
  - `audio` 音频区
  - `3d` 3D区
- 每个区域独立：
  - 启用 / 停用
  - 修改显示名称
  - 从当前所有已配置 Provider 模型中选择一个
- 支持添加、删除**自定义区域**（自定义区域同样可改名称、启停、选模型）。
- 配置按 **项目工作目录（Workspace / cwd）** 隔离，保存在本机 DSH profile 中。
- 已配置项目内，聊天输入框左侧常驻 **「重新配置区域模型」** 入口。
- 主调度模型会接管当前根会话的模型请求；子代理不受影响。
- **图片区 / 视频区是真正的媒体生成区域**：
  - 图片区调用图像生成模型，保存 PNG/JPEG/WebP 到项目；
  - 视频区调用视频生成模型，保存 MP4/WebM 到项目；
  - 文件默认写入 `<项目>/.dsh-bot/generated/`；
  - 支持 Token Plan 的图片/视频接口，图片也兼容通用 OpenAI `/images/generations`。
- 提供两个模型工具：
  - `zone_list`：查看当前项目的区域映射。
  - `zone_dispatch`：把一个自包含任务派发给指定区域；图片/视频区返回真实文件路径。

---

## 3. 安装

### 3.1 让另一个 AI 直接安装（推荐）

把下面整段提示词复制给 DSH 里的 AI：

```text
请帮我把 dsh-bot 这个 Cordis 插件安装到当前 DSH profile：
仓库：https://github.com/zhonglike/dsh-bot
步骤：
1. 克隆仓库到本机任意目录（例如 M:\DSH-bot）。
2. 调用 plugin_manager，action=install_bundle，target=该仓库的绝对路径。
3. 确认返回 application=applied，且 warnings 为空。
4. 如果页面没有自动更新，刷新 DSH Web 页面；桌面版重启窗口即可。
5. 安装完成后，新开一个项目/会话，应弹出标题为“选择哪个区域需要什么模型”的配置页。
不要修改 package.json 或 cordis.patch.yml 的包名；不要自己实现模型探测。
```

更完整的 AI 安装/验收清单见 [docs/AI-INSTALL.md](docs/AI-INSTALL.md)。

### 3.2 手动安装（推荐 Release）

```text
plugin_manager install_bundle target="https://github.com/zhonglike/dsh-bot/releases/download/v0.2.1/dsh-bot-0.2.1.tgz"
```

Release 包不依赖本地目录链接，重启/重装 profile 后更不容易丢。

### 3.3 本地开发安装

```powershell
git clone https://github.com/zhonglike/dsh-bot.git M:\DSH-bot
```

然后在 DSH 中让 AI 执行：

```text
plugin_manager install_bundle target="M:\DSH-bot"
```

本地 link 适合开发；如果之后重装 profile、运行 QQ bridge setup 或切换 profile，可能把 `dsh-bot` 依赖/ bundle 行移除，重启后就会 404。遇到这种情况重新从 Release 安装即可。

`install_bundle` 会完成依赖链接、bundle 选择与生效；不要手动改 profile 的 `package.json` 或 `cordis.patch.yml`。

---

## 4. 首次使用

1. 打开 **设置 → 模型**，确认至少有一个可用 Provider 和模型。
   - 自定义 API 用官方的「添加模型提供商 / 自定义模型 API」填写 Base URL 和 API Key。
   - 用「获取可用模型」拉取模型列表。
2. 新开一个项目 / 会话。
3. 插件会弹出 **「选择哪个区域需要什么模型」**（可关闭）。
4. 至少为主调度模型选择一个模型；需要使用的区域勾选「启用」并选择模型。
5. 点击 **「保存并开始」**。
6. 之后在输入框左侧点击 **「重新配置区域模型」** 可以随时修改。
7. 首次弹窗直接关闭也不会阻塞聊天；该项目会记住“已关闭”，下次不再自动弹出。

> 同一项目的新会话沿用该项目配置；换一个新项目会重新要求配置。

---

## 5. 运行时如何路由

连接链路：

```text
用户在根会话提问
      ↓
main 区域模型（接管 agent/request）
      ↓ 理解 + 拆解
zone_dispatch(zone="code", task="……", context="……")
      ↓
code 区域配置的 Provider / Model
      ↓
返回该模型的最终文本
      ↓
main 汇总并回复用户
```

主调度模型看到的系统上下文里会有一张实时区域表，例如：

```text
## 当前项目的区域模型（M:\DSH-bot）
主调度模型: deepseek-account / deepseek-flash
调用 zone_dispatch 时，zone 参数使用下列 ID：
- text — 文本区 → openrouter / …
- code — 代码区 → moonshot / kimi-k2
已停用区域: image, video, tts, audio, 3d（不可派发）
```

工具接口：

```ts
zone_list(): {
  workspace: string
  configured: boolean
  zones: Array<{ id, name, kind, enabled, provider, model }>
  available: string[]
}

zone_dispatch(input: {
  zone: string        // 区域 id，例如 code / image / video / custom-xxx
  task: string        // 自包含任务；图片/视频区这里是生成提示词
  context?: string    // 可选补充材料
  options?: {         // 图片/视频生成参数
    size?: string       // 如 1024*1024
    ratio?: string      // 如 16:9
    resolution?: string // 如 720P
    duration?: number   // 视频秒数 1-30
    count?: number      // 图片张数 1-4
    negativePrompt?: string
    seed?: number
  }
}): {
  zone: { id, name, kind }
  provider: string
  model: string
  kind?: 'image' | 'video' | ...
  text: string
  media?: Array<{
    kind: 'image' | 'video'
    path: string          // 绝对路径
    relativePath: string  // 相对项目，如 .dsh-bot/generated/xxx.png
    mediaType: string
    bytes: number
    attachment?: object
    fileAttachment?: object
  }>
  finish?: object
  usage?: object
  truncated?: boolean
}
```

图片/视频生成结果会写入：

```text
<项目>/.dsh-bot/generated/
```

Host 会同时尝试把图片登记为 DSH 图片附件、把视频登记为文件附件；即使附件策略拒绝，工作区文件仍然保留。

---

## 6. 配置存储

Host 半把配置写入当前 DSH profile：

```text
$DSH_PROFILE_DIR/zone-router/state.json
```

Windows 桌面版默认类似：

```text
C:\Users\<你>\.dsh\profiles\desktop\zone-router\state.json
```

结构：

```json
{
  "version": 1,
  "workspaces": {
    "m:/dsh-bot": {
      "workspace": "M:\\DSH-bot",
      "updatedAt": 1792787748765,
      "dismissed": false,
      "zones": [
        {
          "id": "main",
          "name": "主调度模型",
          "kind": "main",
          "enabled": true,
          "description": "理解用户意图、拆解任务、选择区域并下发；同时接管本会话的对话模型。",
          "provider": "deepseek-account",
          "model": "deepseek-flash",
          "reasoningEffort": null
        }
      ]
    }
  }
}
```

- key 是规范化后的绝对项目路径（Windows 下不区分大小写）。
- 配置写入使用临时文件 + rename，避免半写入。
- **不保存任何 API Key**；密钥仍然由 DSH 官方凭据体系管理。
- 项目级隔离意味着：换项目必须重新选；同一项目内新会话复用。

---

## 7. 目录结构

```text
dsh-bot/
├─ package.json          # Cordis bundle + Web Client 清单
├─ cordis.patch.yml      # 插入 dsh-bot 插件行
├─ index.js              # Host：配置存储、HTTP API、工具、路由、提示词
├─ client.js             # Web Client：配置页、常驻入口、调用 Host API
├─ locale/
│  ├─ zh.json            # 插件管理器显示名/描述
│  └─ en.json
├─ icon.svg
├─ README.md
├─ README.en.md
├─ docs/
│  ├─ ARCHITECTURE.md    # 完整设计说明
│  └─ AI-INSTALL.md      # 给其他 AI 的安装/验收提示词
└─ LICENSE
```

---

## 8. 兼容性与边界

兼容：

- DeepSeek Harness 官方桌面版（Web GUI 渲染）
- DeepSeek Harness Web 版
- 标准 Cordis bundle，不依赖私有构建
- 只使用官方已配置的 Provider 模型，不自行探测、不保存密钥

当前边界（重要）：

- **图片区和视频区会真实调用生成接口并落盘**：
  - 图片区支持 Token Plan 图片接口，以及通用 OpenAI 兼容 `POST /images/generations`；
  - 视频区目前支持 Token Plan 视频异步接口（提交 → 轮询 → 下载）；
  - Token Plan 需要**套餐 API Key（以 `sk-sp-` 开头）**。普通 DashScope Key 会返回 401，请在 设置 → 模型 中更新 `qwen-token-plan` 的 Key。
  - 如果聊天用的 Key 与媒体套餐 Key 不是同一个，可以新建一个只用于媒体的 Provider（相同 Base URL + `sk-sp-` Key），然后在图片/视频区选择它。
  - 图片/视频模型必须在 Provider 的模型列表中存在；可先在设置里「获取可用模型」。
- TTS / 音频 / 3D 区目前仍是文本/规格/方案路由，不做媒体文件生成。
- 文本/代码/TTS/音频/3D/自定义区域的 `zone_dispatch` 是**单轮、无工具**的模型调用；区域模型看不到主会话历史，也不能调用文件/终端工具。
- 主调度模型会接管根会话的模型请求；如果你在官方模型选择器里选了别的模型，下一次请求仍会切回 `main` 区域配置的模型。
- 子代理、压缩等内部请求不强制切换。
- 区域下拉框来自当前已注册 Provider 的模型目录；如果某个 Provider 目录拉取失败，该 Provider 会显示为空组，配置页会提示刷新。
- **重启后 404**：说明当前 profile 中 `dsh-bot` 已丢失（常见于本地 link 安装后被 profile 重装/QQ bridge setup 覆盖）。检查 `plugin_manager` 是否有 `include:dsh-bot`，然后从 Release `.tgz` 重新安装。详见 [docs/AI-INSTALL.md](docs/AI-INSTALL.md#重启后-404--配置服务未加载)。
- 配置文件损坏时 Host 会返回明确错误，不会静默清空；需要手动修复或删除该项目的条目。

---

## 9. 安全

- 不保存 API Key。生成媒体时按需从 DSH 官方凭据体系读取，只发送给对应 Provider，不写入插件配置或日志。
- Host 只暴露同源 JSON API：`/zone-router/api`。
  - 校验 `Origin` 与请求 Host 一致；
  - POST 必须是 `application/json`，请求体上限 64 KiB；
  - 只保存区域 id、显示名、Provider id、Model id 等非敏感字段；
  - 不提供任意文件读写接口。
- 插件不注入 iframe，不替换应用根节点，不读取其他插件的 DOM。

---

## 10. 开发与验证

```powershell
# 语法检查
node --check index.js
node --check client.js

# 安装到当前 profile（在 DSH 中调用）
# plugin_manager install_bundle target="M:\DSH-bot"
```

安装后：

- Host 半注册 `zone_list` / `zone_dispatch` 工具；
- Client 半注册：
  - `conversation.input.left` → 常驻入口「重新配置区域模型」
  - `conversation.composer.dock` → 首次配置页 / 重新配置页
- 可用 `cordis_inspect_query` 验证 Slot 占用与工具是否可见。

完整设计、接口定义与伪代码见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 11. 许可证

MIT © 2026 zhonglike
