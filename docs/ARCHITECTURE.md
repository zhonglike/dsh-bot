# dsh-bot 设计说明

本文是实现级设计文档，对应仓库根目录的 `index.js`（Host）与 `client.js`（Web Client）。

---

## 1. 目标与非目标

### 目标

1. 每个项目第一次打开时，强制用户完成「区域 → 模型」配置。
2. 预设 `main / text / code / image / video / tts / audio / 3d`，支持自定义区域。
3. 每个区域可启停、改名、选模型。
4. 配置按项目隔离。
5. 复用 DSH 官方模型 Provider / API Key / 获取可用模型体系。
6. 主调度模型通过 Tool Calling 把任务派发给对应区域。
7. 使用标准 Cordis bundle，兼容官方桌面版与 Web 版。

### 非目标

- 不自己实现 Provider 探测、API Key 存储、`/models` 请求。
- 不把普通聊天模型伪装成图片/视频/音频生成器。
- 不把插件做成独立应用、iframe 页面或应用根节点替换器。

---

## 2. 目录与清单

```text
dsh-bot/
├─ package.json
├─ cordis.patch.yml
├─ index.js
├─ client.js
├─ locale/en.json
├─ locale/zh.json
├─ icon.svg
├─ README.md
├─ README.en.md
├─ docs/
│  ├─ ARCHITECTURE.md
│  └─ AI-INSTALL.md
└─ LICENSE
```

`package.json` 的关键字段：

```json
{
  "name": "dsh-bot",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
    }
  }
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-bot
      name: dsh-bot
```

安装由 DSH 的 `plugin_manager` `install_bundle` 完成，插件不手写 profile 的 `package.json` / `cordis.patch.yml`。

---

## 3. 配置页 UI

### 3.1 入口与强制逻辑

Client 半注册两个 Slot：

| Slot | 用途 |
|---|---|
| `conversation.input.left` | 常驻入口「重新配置区域模型」 |
| `conversation.composer.dock` | 强制配置页 / 重新配置页的 modal 容器 |

组件从 Slot 标准 props 取 `sessionId`，再用 `useSessions` 读取当前会话的 `cwd`：

```js
const cwd = useSessions((snapshot) =>
  sessionId ? snapshot.byId[sessionId]?.cwd : undefined
);
```

流程：

```text
cwd 变化
  → GET /zone-router/api?op=state&workspace=<cwd>
  → GET /zone-router/api?op=catalog
  → configured === false
       → forced = true, open = true（不可关闭）
  → configured === true
       → 关闭配置页，显示常驻入口
```

常驻入口通过模块级 `configOpenSignal` 通知 dock 组件打开同一个配置页；打开时会重新拉取 state 和 catalog，避免外部修改导致脏读。

### 3.2 文案

- 页面标题：**选择哪个区域需要什么模型**
- 副标题：为当前项目选择每个区域使用的模型。配置按项目独立保存，新项目需要重新选择。
- 主调度行：徽标「必选」，开关不可关闭。
- 区域开关：`启用` / `停用`
- 模型下拉：`请选择模型`
- 自定义区域按钮：`+ 添加自定义区域`
- 保存按钮：首次 `保存并开始`，之后 `保存配置`
- 常驻入口：`重新配置区域模型`
- 空模型提示：`还没有检测到可用模型。请先打开 设置 → 模型……`

### 3.3 校验

保存前在 Client 侧先校验一次，Host 侧再校验一次：

1. `main` 必须存在，且必须选择 provider + model。
2. 所有 `enabled === true` 的区域都必须选择模型。
3. 已启用区域显示名不能为空、不能重名。
4. 区域数量上限 64，自定义区域 id 必须匹配 `^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$`。

首次配置没有关闭按钮；重新配置时允许 `Esc`、点击遮罩或「取消」关闭。

### 3.4 主题与样式

- 只使用 `--dsw-alias-*` 主题 token。
- 不使用 `@deepseek-ai/dsh-client-ui-primitives` 等 Client 包。
- modal 使用 `position: fixed`，背景遮罩；样式标签随组件卸载自动移除。
- 主按钮文字使用 `--dsw-alias-bg-base`，避免深色主题下品牌色为白色时白字不可见。

---

## 4. 区域模型存储

### 4.1 位置

```text
$DSH_PROFILE_DIR/zone-router/state.json
```

解析顺序：

```js
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profileDir = process.env.DSH_PROFILE_DIR
  || path.join(home, 'profiles', process.env.DSH_PROFILE || 'desktop');
```

### 4.2 结构

```json
{
  "version": 1,
  "workspaces": {
    "<normalized-cwd>": {
      "workspace": "M:\\DSH-bot",
      "updatedAt": 1792787748765,
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

- key：绝对路径，反斜杠归一为正斜杠；Windows 下转小写。
- `WorkspaceStore` 提供：
  - `readAll()`
  - `readWorkspace(rawWorkspace)`
  - `peekWorkspaceSync(rawWorkspace)`（供同步的 prompt context 使用）
  - `saveWorkspace(rawWorkspace, zones)`
  - `deleteWorkspace(rawWorkspace)`
- 写入：临时文件 + `rename`，Windows 上 `EPERM`/`EEXIST` 时回退到 `copyFile + unlink`。
- 写入串行化：`this.queue = this.queue.then(run, run)`。

### 4.3 为什么按 cwd 而不是按 session

- 需求是“项目 / Workspace 隔离”。
- DSH 的 `SessionHeader.cwd` 是项目身份最稳定、Host 与 Client 都能拿到的字段。
- 新项目必然是新 cwd；同项目新会话复用同一配置。这正好对应“每次新开项目都要重新选一遍”。

---

## 5. Host HTTP API

因为 Client 半是普通 Cordis Client 插件，Host 半用 `ctx.webServer.register` 暴露一个最小同源 JSON API：

```text
GET  /zone-router/api?op=catalog
GET  /zone-router/api?op=state&workspace=<encoded cwd>
POST /zone-router/api?op=save     body: { workspace, zones }
POST /zone-router/api?op=reset    body: { workspace }
```

响应：

```json
{ "ok": true, "state": { "configured": true, "zones": [] } }
{ "ok": false, "error": { "code": "INVALID_REQUEST", "message": "……" } }
```

安全约束：

- 校验 `Origin` 与 `Host` 同源。
- POST 必须是 `application/json`，请求体上限 64 KiB。
- 只接受区域 id、显示名、Provider/Model id 等非敏感字段。
- 没有任意文件读写接口。

模型目录：

```js
const providers = ctx.llm.listProviders();
for (const provider of providers) {
  const models = await ctx.llm.listModels(provider.id);
  // → { id, name, models: [...] }
}
```

这与官方「设置 → 模型」使用同一套已注册 Provider，不额外请求上游 `/models`。

---

## 6. 运行时：工具与派发

### 6.1 工具注册

```js
ctx.effect(() => ctx.tools.register({
  name: 'zone_list',
  description: 'List the current project\'s configured model zones...',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    schema: { ... },
    render: (_args, value) => [{ type: 'text', text: format(value) }],
  },
  async execute(_args, exec) { ... },
}), 'dsh-bot: zone_list tool');

ctx.effect(() => ctx.tools.register({
  name: 'zone_dispatch',
  description: 'Delegate one self-contained task to the specialist model...',
  parameters: {
    type: 'object',
    properties: {
      zone: { type: 'string' },
      task: { type: 'string' },
      context: { type: 'string' },
    },
    required: ['zone', 'task'],
    additionalProperties: false,
  },
  timeoutMs: 330000,
  async execute(args, exec) { ... },
}), 'dsh-bot: zone_dispatch tool');
```

### 6.2 派发伪代码

```ts
async function dispatch(zoneId: string, task: string, context: string, exec) {
  const session = ctx.sessions.get(exec.agent.id);
  const cwd = session.header.cwd;
  const state = await store.readWorkspace(cwd);
  const zone = state.zones.find(z => z.id === zoneId);

  if (!zone) throw new Error('没有找到区域');
  if (!zone.enabled) throw new Error('区域已停用');
  if (zone.id === 'main') throw new Error('不能派发给主调度自己');
  if (!zone.provider || !zone.model) throw new Error('区域未选择模型');

  const system = [
    `You are the ${zone.name} specialist (zone id: ${zone.id}).`,
    zoneGuidance[zone.kind],
    `Project workspace: ${cwd}`,
    'Return the complete final deliverable. Do not ask questions.',
  ].join('\n');

  let text = '';
  for await (const chunk of ctx.llm.stream({
    provider: zone.provider,
    model: zone.model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: task + context }] }],
    sessionId: session.id,
    signal,
  })) {
    if (chunk.type === 'text-delta') text += chunk.text;
    if (chunk.type === 'finish' && chunk.reason.kind === 'error') throw ...;
  }
  return { zone: { id, name, kind }, provider, model, text };
}
```

限制与保护：

- `task` 上限 100,000 字符。
- 输出上限 200,000 字符，超出截断并中止流。
- 超时 300 秒，`timeoutMs` 330 秒。
- 透传 `exec.signal`，用户取消时中止上游请求。
- 区域模型不注册任何工具，不能读文件、跑命令或写代码到磁盘。

### 6.3 系统提示词

Host 注册：

```js
ctx.systemPrompt.section({
  name: 'dsh-bot.routing-policy',
  order: 420,
  text: routingPolicy,
});

ctx.systemPrompt.context({
  name: 'dsh-bot.zone-map',
  order: 421,
  text: (assemble) => renderZoneMap(assemble.scope),
});
```

`zone-map` 是动态的：按当前 agent 的 session cwd 读取配置，输出启用区域、模型路由、停用区域。这样主模型每次请求都能看到最新映射，无需重启。

### 6.4 主模型接管

```js
ctx.on('agent/request', async (payload, next) => {
  const base = await next();
  const session = ctx.sessions.get(payload.agent.id);
  if (!session || session.header.parentSession) return base;

  const state = await store.readWorkspace(session.header.cwd);
  const main = state.zones.find(z => z.id === 'main' && z.enabled && z.provider && z.model);
  if (!main) return base;

  const { reasoningEffort: _, ...rest } = base;
  return {
    ...rest,
    provider: main.provider,
    model: main.model,
    ...(main.reasoningEffort ? { reasoningEffort: main.reasoningEffort } : {}),
  };
});
```

- 只接管根会话；`parentSession` / `origin === 'subagent'` 跳过。
- 切换模型时丢弃旧 `reasoningEffort`，避免不兼容。
- 不修改消息内容、不绕过系统提示词、不改变工具权限。

---

## 7. Client 端数据流

```text
ZoneRouterDock
  ├─ sessionId → cwd
  ├─ GET state + catalog
  ├─ draft (zones[])
  ├─ 编辑：启停 / 改名 / 选模型 / 增删自定义区域
  ├─ 保存 → POST save
  └─ 关闭 modal

ConfigEntryButton (conversation.input.left)
  └─ configOpenSignal.request()
       └─ ZoneRouterDock.openConfig()
            ├─ 重新拉 state + catalog
            └─ 打开同一个“选择哪个区域需要什么模型”页面
```

`state.configured === false` 时，首次加载会自动打开 modal 且没有关闭按钮。  
保存成功后 Host 返回规范化后的完整 state，Client 直接用它更新 draft，避免本地校验与 Host 校验不一致。

---

## 8. 兼容性设计

- 纯 ESM，无构建步骤；Client 使用 `window.__ModuleLoader__.load` 标准加载方式。
- Host 只使用 Node 内置模块，无第三方依赖。
- `inject` 声明 `tools / systemPrompt / llm / sessions`；`webServer` 通过 `ctx.get` 可选获取，缺失时工具仍可工作，只是没有配置页 API。
- 不写 profile 配置文件，不修改其他插件，不替换应用根节点。
- 主题 token 只使用 `--dsw-alias-*`；不依赖 Client 内部包。
- 桌面版与 Web 版共用同一套 Web Client 半。

---

## 9. 已知限制

1. **媒体区域不是生成执行器**：区域模型是 DSH 暴露的聊天/多模态模型，插件不直接调用图片/视频/TTS API。要真正生成媒体，需要把这些能力作为工具或上游 Provider 提供。
2. **单轮无工具派发**：`zone_dispatch` 只传任务文本，区域模型不能使用文件、终端、搜索等工具。
3. **主模型接管是强制的**：根会话每次请求都会被切到 `main` 区域模型；如果用户想临时用别的模型，需要改主调度配置。
4. **模型目录依赖 Provider 可用性**：某个 Provider 的 `listModels` 失败时，该组会显示为空，配置页提示刷新。
5. **配置按 cwd 识别**：同一物理项目通过不同路径/符号链接打开时会被视为不同项目。

---

## 10. 验收清单

- [ ] `node --check index.js` / `client.js` 通过。
- [ ] `plugin_manager install_bundle` 返回 `application: applied`，`warnings: []`。
- [ ] `conversation.input.left` 中有 `dsh-bot-config-entry`。
- [ ] `conversation.composer.dock` 中有 `dsh-bot-zones`。
- [ ] 新项目首次打开强制出现「选择哪个区域需要什么模型」。
- [ ] 未选主调度模型时保存被拒绝。
- [ ] 启用但未选模型的区域保存被拒绝。
- [ ] 保存后同一项目新会话不再强制弹窗。
- [ ] 换项目后重新强制弹窗。
- [ ] 「重新配置区域模型」能打开同一个页面。
- [ ] `zone_list` 能看到当前项目映射。
- [ ] `zone_dispatch` 能把任务发给 code/text 等区域并返回文本。
- [ ] 配置文件路径为 `$DSH_PROFILE_DIR/zone-router/state.json`。
- [ ] 配置文件中没有 API Key。
