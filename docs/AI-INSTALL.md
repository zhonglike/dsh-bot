# 给其他 AI 的安装与验收说明

这份文档可以直接复制给 DeepSeek Harness 里的 AI。目标：让 AI 用最少步骤安装 `dsh-bot`，并验证它真的工作。

---

## 一段式安装提示词

```text
请把 dsh-bot 安装到当前 DSH profile，并完成验收。

仓库：https://github.com/zhonglike/dsh-bot
发行版：https://github.com/zhonglike/dsh-bot/releases

步骤：
1. 把仓库克隆到本机任意目录，例如 M:\DSH-bot。
2. 调用 plugin_manager：
   action = install_bundle
   target = 仓库绝对路径
3. 读取返回值，必须满足 application = applied 且 warnings 为空；
   如果返回 restart-required 或 failed，先诊断，不要假装成功。
4. 刷新 DSH Web 页面（桌面版可重启窗口）。
5. 用只读方式确认：
   - conversation.input.left 中存在 dsh-bot-config-entry
   - conversation.composer.dock 中存在 dsh-bot-zones
   - 当前 Agent 可见 zone_list 与 zone_dispatch 工具
6. 新开一个项目/会话，确认出现标题为
   “选择哪个区域需要什么模型”的配置页。
7. 不要修改 package.json 的包名；不要自己实现 Provider 探测；
   不要读写 API Key；不要手动改 profile 的 package.json 或 cordis.patch.yml。
```

---

## 安装后的验收清单

### A. 安装状态

- `plugin_manager` 返回 `application: applied`
- `warnings: []`
- 插件行 `dsh-bot` 已启用

### B. Client Slot

用 `cordis_inspect_query`：

```json
{
  "platform": "client",
  "provider": "Slots",
  "method": "listSubTree",
  "input": { "root": "conversation.input.left" }
}
```

预期 occupants 包含：

```json
{ "id": "dsh-bot-config-entry", "active": true }
```

再查：

```json
{
  "platform": "client",
  "provider": "Slots",
  "method": "listSubTree",
  "input": { "root": "conversation.composer.dock" }
}
```

预期 occupants 包含：

```json
{ "id": "dsh-bot-zones", "active": true }
```

### C. 工具

用 `cordis_inspect_query` Tool / listTools，确认：

- `zone_list`
- `zone_dispatch`

### D. 首次配置页（可关闭）

新开项目或新会话，应该看到：

- 标题：`选择哪个区域需要什么模型`
- 主调度模型一行，徽标「必选」
- 8 个预设区域各自的下拉框
- `+ 添加自定义区域`
- `保存并开始`
- 右上角 `×`、底部「取消」、Esc、点击遮罩都能关闭

未选择主调度模型时，保存按钮应提示必须先选主调度模型。

关闭后：

- 弹窗消失，聊天可以正常使用。
- 同一项目再次打开不再自动弹窗。
- 输入框左侧「重新配置区域模型」仍可打开。

### E. 持久化

保存或关闭后检查：

```text
$DSH_PROFILE_DIR/zone-router/state.json
```

应存在当前项目的 cwd key，且文件中**没有**任何 API Key。关闭未配置弹窗时，该条目应包含：

```json
{ "dismissed": true, "zones": [ ... ] }
```

### F. 项目隔离

- 同一项目新建会话：不应再次自动弹窗。
- 换一个新项目：首次打开会再次提示（可关闭）。

---

## 常见问题

### 配置页没出现

1. 确认当前会话有 `cwd`；没有工作目录的空会话不会渲染配置页。
2. 确认这两个 Slot 占用存在。
3. 确认 Host 的 `/zone-router/api` 可访问。
4. 刷新页面；Client 半更新后需要重新加载。

### 重启后 404 / 配置服务未加载

这是**安装丢失**，不是配置页本身的问题。表现通常是：

- 页面还能加载旧的上次缓存 Client 代码；
- 浏览器 Network 里 `/zone-router/api` 返回 404；
- `plugin_manager` list_plugins 中找不到 `include:dsh-bot`；
- `$DSH_PROFILE_DIR/package.json` 的 dependencies / `dsh.profile.bundles` 中没有 `dsh-bot`。

原因：

- 安装用的是本地 link，后续 profile 重装、QQ bridge setup、profile 切换或清理把依赖/ bundle 行重写了；
- 或者安装到了另一个 profile（例如 desktop 装过，但当前跑的是 web）。

排查：

```text
plugin_manager list_plugins，搜索 include:dsh-bot
检查 $DSH_PROFILE_DIR/package.json
检查 $DSH_PROFILE_DIR/cordis.patch.yml
```

修复：安装到**当前实际运行的 profile**，优先用 Release 的 `.tgz`，而不是本地 link。安装后重启一次，再确认：

```text
plugin_manager list_plugins → include:dsh-bot / active
GET /zone-router/api?op=state&workspace=<cwd> → 200
```

### 下拉框为空

说明当前没有可用模型。去 **设置 → 模型**：

- 添加 Provider；
- 填 Base URL 与 API Key；
- 点「获取可用模型」；
- 回到配置页点「刷新可用模型」。

### 保存后主模型没生效

`main` 区域只接管根会话请求；子代理不接管。  
如果仍不生效，检查 Host 日志中 `agent/request` 是否被其他插件覆盖，以及 state 文件中 `main` 是否 `enabled: true` 且有 provider/model。

### 区域派发失败

`zone_dispatch` 只支持已启用、已选模型的非 main 区域。  
错误信息会说明是区域不存在、已停用、未选模型，还是上游模型调用失败。

---

## 不要做的事

- 不要把 API Key 写进 `state.json` 或 README。
- 不要改包名为带作用域的临时名；Client 模块 id 必须与包名一致。
- 不要为配置页启动第二个 Web 服务。
- 不要用 iframe / 独立 HTML 替代 Slot 页面。
- 图片区/视频区会真实调用生成接口并写入 `<项目>/.dsh-bot/generated/`；媒体生成需要对应 Provider 的生成模型和有效凭据。
- Token Plan 媒体接口要求套餐 API Key（以 `sk-sp-` 开头）；普通 DashScope Key 会 401，需在 设置 → 模型 更新。
- TTS / 音频 / 3D 区当前仍只做文本/规格/方案路由，不声称已生成音频或 3D 文件。
