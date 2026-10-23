/**
 * dsh-bot — Multi-Zone Model Router (Host half).
 *
 * Responsibilities:
 *  1. Persist per-workspace zone → provider/model selections.
 *  2. Expose a tiny same-origin JSON API used by the Client configuration page.
 *  3. Register `zone_list` / `zone_dispatch` tools for the main orchestrator.
 *  4. Force the root Session's model request onto the configured `main` zone.
 *  5. Add a short routing policy + live zone map to the system prompt.
 */

import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const name = 'dsh-bot';
export const inject = ['tools', 'systemPrompt', 'llm', 'sessions'];

const API_PATH = '/zone-router/api';
const STATE_VERSION = 1;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ZONES = 64;
const MAX_TASK_CHARS = 100_000;
const MAX_RESULT_CHARS = 200_000;
const DISPATCH_TIMEOUT_MS = 300_000;
const MEDIA_DISPATCH_TIMEOUT_MS = 840_000;
const CATALOG_TTL_MS = 5_000;
const MEDIA_DIR = '.dsh-bot/generated';
const MAX_MEDIA_BYTES = 300 * 1024 * 1024;

const BUILTIN_ZONES = [
  { id: 'main', name: '主调度模型', kind: 'main', enabled: true, description: '理解用户意图、拆解任务、选择区域并下发；同时接管本会话的对话模型。' },
  { id: 'text', name: '文本区', kind: 'text', enabled: true, description: '写作、总结、翻译、信息抽取、结构化整理。' },
  { id: 'code', name: '代码区', kind: 'code', enabled: true, description: '编码、调试、代码审查、重构、测试与工程方案。' },
  { id: 'image', name: '图片区', kind: 'image', enabled: false, description: '实际生成图片并保存到项目；请选择 qwen-image / wan2.7-image 等图像生成模型。' },
  { id: 'video', name: '视频区', kind: 'video', enabled: false, description: '实际生成视频并保存到项目；请选择 wan3.0-video / happyhorse 等视频生成模型。' },
  { id: 'tts', name: 'TTS区', kind: 'tts', enabled: false, description: '配音文案、语气、停顿与韵律标记。' },
  { id: 'audio', name: '音频区', kind: 'audio', enabled: false, description: '音频分析、转写整理、混音与声音设计建议。' },
  { id: '3d', name: '3D区', kind: '3d', enabled: false, description: '3D 场景、建模步骤、材质灯光与引擎实现。' },
];

const BUILTIN_BY_ID = new Map(BUILTIN_ZONES.map((zone) => [zone.id, zone]));
const ZONE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/;

const ZONE_GUIDANCE = {
  text: 'You are the text specialist. Produce publication-ready prose, summaries, translations, or structured data. Be concise unless the task asks for length.',
  code: 'You are the code specialist. Produce correct, runnable, minimal code with exact file paths and no placeholders. Call out assumptions and verification steps.',
  image: 'You are the image generation specialist. Turn the task into a production-ready image generation request. The host will generate actual image files.',
  video: 'You are the video generation specialist. Turn the task into a production-ready video generation request. The host will generate an actual video file.',
  tts: 'You are the TTS specialist. Produce speakable scripts with pronunciation, emotion, pace, pauses, and SSML-like prosody notes where useful.',
  audio: 'You are the audio specialist. Produce analysis, editing plans, mixing notes, loudness targets, and sound-design instructions.',
  '3d': 'You are the 3D specialist. Produce scene graphs, modeling steps, topology guidance, materials, lighting, and engine-specific implementation details.',
  custom: 'You are a specialist model for this custom work area. Follow the area name and the task as the source of truth.',
};

const DEFAULT_NAME = new Map(BUILTIN_ZONES.map((zone) => [zone.id, zone.name]));

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampText(value, max) {
  if (typeof value !== 'string') return '';
  return value.length > max ? value.slice(0, max) : value;
}

function defaultZones() {
  return BUILTIN_ZONES.map((zone) => ({
    id: zone.id,
    name: zone.name,
    kind: zone.kind,
    enabled: zone.id === 'main' || zone.enabled,
    description: zone.description,
    provider: null,
    model: null,
    reasoningEffort: null,
  }));
}

function workspaceKey(raw) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim().replace(/\\/g, '/');
  value = value.replace(/\/+$/, '');
  if (!value) return '';
  if (process.platform === 'win32') value = value.toLowerCase();
  return value;
}

function profileStateFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const profileDir = process.env.DSH_PROFILE_DIR
    || path.join(home, 'profiles', process.env.DSH_PROFILE || 'desktop');
  return path.join(profileDir, 'zone-router', 'state.json');
}

function emptyState() {
  return { version: STATE_VERSION, workspaces: {} };
}

function validateStateShape(value) {
  if (!isRecord(value)) return emptyState();
  if (!isRecord(value.workspaces)) return emptyState();
  return value;
}

function sanitizeRoutePart(value, max = 200) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function sanitizeZone(raw, previous) {
  const source = isRecord(raw) ? raw : {};
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  if (!ZONE_ID_RE.test(id)) throw new Error(`非法区域 ID: ${id || '(empty)'}`);

  const builtin = BUILTIN_BY_ID.get(id);
  const kind = builtin ? builtin.kind : 'custom';
  const prev = isRecord(previous) ? previous : {};
  const fallbackName = builtin ? builtin.name : (typeof prev.name === 'string' && prev.name.trim() ? prev.name.trim() : '自定义区域');
  const name = clampText(
    typeof source.name === 'string' && source.name.trim() ? source.name.trim() : fallbackName,
    40,
  ) || fallbackName;

  const enabled = builtin && id === 'main' ? true : Boolean(source.enabled);
  const provider = sanitizeRoutePart(source.provider);
  const model = sanitizeRoutePart(source.model);
  const reasoningEffort = sanitizeRoutePart(source.reasoningEffort, 80);

  const description = builtin
    ? builtin.description
    : clampText(
      typeof source.description === 'string' && source.description.trim()
        ? source.description.trim()
        : '用户自定义的专业工作区域。',
      160,
    );

  return {
    id,
    name,
    kind,
    enabled,
    description,
    provider: enabled || provider ? provider : null,
    model: enabled || model ? model : null,
    reasoningEffort: reasoningEffort || null,
  };
}

function normalizeZones(input, previousZones = []) {
  if (!Array.isArray(input)) throw new Error('zones 必须是数组');
  if (input.length > MAX_ZONES) throw new Error(`区域数量不能超过 ${MAX_ZONES}`);

  const previousById = new Map(
    Array.isArray(previousZones)
      ? previousZones.filter((zone) => isRecord(zone) && typeof zone.id === 'string').map((zone) => [zone.id, zone])
      : [],
  );

  const incoming = new Map();
  for (const raw of input) {
    if (!isRecord(raw)) throw new Error('每个区域必须是对象');
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id) throw new Error('区域缺少 id');
    if (incoming.has(id)) throw new Error(`区域 ID 重复: ${id}`);
    if (!BUILTIN_BY_ID.has(id) && incoming.size >= MAX_ZONES) throw new Error(`区域数量不能超过 ${MAX_ZONES}`);
    incoming.set(id, sanitizeZone(raw, previousById.get(id)));
  }

  const result = [];
  for (const builtin of BUILTIN_ZONES) {
    const zone = incoming.get(builtin.id) || sanitizeZone({ id: builtin.id, enabled: builtin.id === 'main' }, previousById.get(builtin.id));
    result.push(zone);
    incoming.delete(builtin.id);
  }
  for (const zone of incoming.values()) result.push(zone);

  const main = result.find((zone) => zone.id === 'main');
  if (!main || !main.provider || !main.model) {
    throw new Error('必须先为主调度模型选择模型');
  }

  for (const zone of result) {
    if (!zone.enabled) continue;
    if (!zone.provider || !zone.model) {
      throw new Error(`区域「${zone.name}」已启用，但还没有选择模型`);
    }
  }

  const enabledNames = new Map();
  for (const zone of result) {
    if (!zone.enabled) continue;
    const key = zone.name.toLocaleLowerCase();
    if (enabledNames.has(key)) throw new Error(`已启用区域的显示名称重复: ${zone.name}`);
    enabledNames.set(key, zone.id);
  }

  return result;
}

class WorkspaceStore {
  constructor(file) {
    this.file = file;
    this.cache = null;
    this.cacheSignature = null;
    this.queue = Promise.resolve();
  }

  async readAll() {
    let stat;
    try {
      stat = await fsp.stat(this.file);
    } catch (error) {
      if (error && error.code === 'ENOENT') return emptyState();
      throw error;
    }
    const signature = `${stat.mtimeMs}:${stat.size}`;
    if (this.cache && this.cacheSignature === signature) return this.cache;
    let raw;
    try {
      raw = await fsp.readFile(this.file, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return emptyState();
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`区域配置文件不是合法 JSON: ${this.file}`);
    }
    const data = validateStateShape(parsed);
    this.cache = data;
    this.cacheSignature = signature;
    return data;
  }

  peekAllSync() {
    try {
      const stat = fs.statSync(this.file);
      const signature = `${stat.mtimeMs}:${stat.size}`;
      if (this.cache && this.cacheSignature === signature) return this.cache;
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const data = validateStateShape(parsed);
      this.cache = data;
      this.cacheSignature = signature;
      return data;
    } catch {
      return this.cache || emptyState();
    }
  }

  async readWorkspace(rawWorkspace) {
    const key = workspaceKey(rawWorkspace);
    if (!key) throw new Error('缺少项目工作目录');
    const data = await this.readAll();
    const entry = data.workspaces[key];
    if (!isRecord(entry)) {
      return { workspace: rawWorkspace, key, configured: false, dismissed: false, updatedAt: null, zones: defaultZones() };
    }
    const zones = Array.isArray(entry.zones) ? entry.zones : defaultZones();
    const main = zones.find((zone) => zone.id === 'main' && zone.enabled && zone.provider && zone.model);
    return {
      workspace: typeof entry.workspace === 'string' ? entry.workspace : rawWorkspace,
      key,
      configured: Boolean(main),
      dismissed: Boolean(entry.dismissed),
      updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : null,
      zones,
    };
  }

  peekWorkspaceSync(rawWorkspace) {
    const key = workspaceKey(rawWorkspace);
    if (!key) return null;
    const data = this.peekAllSync();
    const entry = data.workspaces[key];
    if (!isRecord(entry) || !Array.isArray(entry.zones)) return null;
    return entry;
  }

  async saveWorkspace(rawWorkspace, zones) {
    const key = workspaceKey(rawWorkspace);
    if (!key) throw new Error('缺少项目工作目录');
    const run = async () => {
      const data = await this.readAll();
      const previous = isRecord(data.workspaces[key]) ? data.workspaces[key] : undefined;
      const normalized = normalizeZones(zones, previous && Array.isArray(previous.zones) ? previous.zones : []);
      const next = {
        ...data,
        version: STATE_VERSION,
        workspaces: {
          ...data.workspaces,
          [key]: {
            workspace: rawWorkspace,
            updatedAt: Date.now(),
            dismissed: false,
            zones: normalized,
          },
        },
      };
      await this.writeAll(next);
      const stat = await fsp.stat(this.file);
      this.cache = next;
      this.cacheSignature = `${stat.mtimeMs}:${stat.size}`;
      return {
        workspace: rawWorkspace,
        key,
        configured: true,
        dismissed: false,
        updatedAt: next.workspaces[key].updatedAt,
        zones: normalized,
      };
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async dismissWorkspace(rawWorkspace) {
    const key = workspaceKey(rawWorkspace);
    if (!key) throw new Error('缺少项目工作目录');
    const run = async () => {
      const data = await this.readAll();
      const previous = isRecord(data.workspaces[key]) ? data.workspaces[key] : undefined;
      const zones = previous && Array.isArray(previous.zones) && previous.zones.length > 0
        ? previous.zones
        : defaultZones();
      const next = {
        ...data,
        version: STATE_VERSION,
        workspaces: {
          ...data.workspaces,
          [key]: {
            workspace: rawWorkspace,
            updatedAt: Date.now(),
            dismissed: true,
            zones,
          },
        },
      };
      await this.writeAll(next);
      const stat = await fsp.stat(this.file);
      this.cache = next;
      this.cacheSignature = `${stat.mtimeMs}:${stat.size}`;
      const main = zones.find((zone) => zone.id === 'main' && zone.enabled && zone.provider && zone.model);
      return {
        workspace: rawWorkspace,
        key,
        configured: Boolean(main),
        dismissed: true,
        updatedAt: next.workspaces[key].updatedAt,
        zones,
      };
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async deleteWorkspace(rawWorkspace) {
    const key = workspaceKey(rawWorkspace);
    if (!key) throw new Error('缺少项目工作目录');
    const run = async () => {
      const data = await this.readAll();
      if (!isRecord(data.workspaces[key])) {
        return { workspace: rawWorkspace, key, configured: false, dismissed: false, updatedAt: null, zones: defaultZones() };
      }
      const workspaces = { ...data.workspaces };
      delete workspaces[key];
      const next = { ...data, version: STATE_VERSION, workspaces };
      await this.writeAll(next);
      const stat = await fsp.stat(this.file);
      this.cache = next;
      this.cacheSignature = `${stat.mtimeMs}:${stat.size}`;
      return { workspace: rawWorkspace, key, configured: false, dismissed: false, updatedAt: null, zones: defaultZones() };
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async writeAll(data) {
    const dir = path.dirname(this.file);
    await fsp.mkdir(dir, { recursive: true });
    const temp = path.join(dir, `.state.${process.pid}.${Date.now()}.tmp`);
    await fsp.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    try {
      await fsp.rename(temp, this.file);
    } catch (error) {
      if (error && (error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'EACCES')) {
        await fsp.copyFile(temp, this.file);
        await fsp.unlink(temp);
      } else {
        try { await fsp.unlink(temp); } catch { /* best effort */ }
        throw error;
      }
    }
  }
}

function createHttpApi(ctx, store, resolveMediaEndpoint) {
  let catalogCache = null;
  let catalogAt = 0;

  const readCatalog = async () => {
    if (catalogCache && Date.now() - catalogAt < CATALOG_TTL_MS) return catalogCache;
    const providers = ctx.llm.listProviders();
    const groups = [];
    for (const provider of providers) {
      const group = {
        id: provider.id,
        name: provider.name || provider.id,
        models: [],
      };
      try {
        const models = await ctx.llm.listModels(provider.id);
        group.models = models.map((model) => ({
          id: model.id,
          name: model.name || model.id,
          description: typeof model.description === 'string' ? model.description : '',
          inputModalities: Array.isArray(model.inputModalities) ? model.inputModalities : undefined,
        }));
      } catch (error) {
        group.error = error instanceof Error ? error.message : String(error);
      }
      groups.push(group);
    }
    let defaultSelection;
    try {
      const service = ctx.get('agentDefaultModel');
      if (service && typeof service.currentSelection === 'function') defaultSelection = service.currentSelection();
    } catch { /* optional */ }
    catalogCache = { groups, default: defaultSelection, fetchedAt: Date.now() };
    catalogAt = Date.now();
    return catalogCache;
  };

  const json = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });

  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  };

  return async (req, res) => {
    try {
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, error: { code: 'ORIGIN_REJECTED', message: '拒绝跨站请求' } });
        return;
      }
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== API_PATH) {
        json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
        return;
      }
      const op = url.searchParams.get('op') || '';

      if (req.method === 'GET' && op === 'catalog') {
        const catalog = await readCatalog();
        json(res, 200, { ok: true, catalog });
        return;
      }

      if (req.method === 'GET' && op === 'media-info') {
        const provider = url.searchParams.get('provider') || '';
        if (!provider) {
          json(res, 400, { ok: false, error: { code: 'PROVIDER_REQUIRED', message: '缺少 provider 参数' } });
          return;
        }
        try {
          const info = await resolveMediaEndpoint(provider);
          json(res, 200, {
            ok: true,
            media: {
              provider,
              baseURL: info.baseURL,
              credentialRef: info.credentialRef || null,
              keyLooksTokenPlan: info.keyLooksTokenPlan,
              keyLength: info.apiKey.length,
              tokenPlan: /^qwen-token-plan(?:-|$)/i.test(provider) || /token-plan\.[^/]+\.aliyuncs\.com/i.test(info.baseURL),
              hint: info.keyLooksTokenPlan
                ? null
                : 'Token Plan 媒体接口要求以 sk-sp- 开头的套餐 Key；当前 Key 前缀不匹配，如遇 401 请在 设置 → 模型 更新。',
            },
          });
        } catch (error) {
          json(res, 400, { ok: false, error: { code: 'MEDIA_INFO_FAILED', message: error instanceof Error ? error.message : String(error) } });
        }
        return;
      }

      if (req.method === 'GET' && op === 'state') {
        const workspace = url.searchParams.get('workspace') || '';
        if (!workspace) {
          json(res, 400, { ok: false, error: { code: 'WORKSPACE_REQUIRED', message: '缺少 workspace 参数' } });
          return;
        }
        try {
          const state = await store.readWorkspace(workspace);
          json(res, 200, { ok: true, state });
        } catch (error) {
          json(res, 500, { ok: false, error: { code: 'STORE_ERROR', message: error instanceof Error ? error.message : String(error) } });
        }
        return;
      }

      if (req.method === 'POST') {
        if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          json(res, 415, { ok: false, error: { code: 'JSON_REQUIRED', message: 'Content-Type 必须是 application/json' } });
          return;
        }
        let body;
        try {
          body = await readBody(req);
        } catch (error) {
          json(res, error.statusCode || 400, { ok: false, error: { code: 'BAD_BODY', message: error instanceof Error ? error.message : String(error) } });
          return;
        }
        const workspace = typeof body.workspace === 'string' ? body.workspace : '';
        if (!workspace) {
          json(res, 400, { ok: false, error: { code: 'WORKSPACE_REQUIRED', message: '缺少 workspace' } });
          return;
        }
        try {
          if (op === 'save') {
            const state = await store.saveWorkspace(workspace, body.zones);
            json(res, 200, { ok: true, state });
            return;
          }
          if (op === 'dismiss') {
            const state = await store.dismissWorkspace(workspace);
            json(res, 200, { ok: true, state });
            return;
          }
          if (op === 'reset') {
            const state = await store.deleteWorkspace(workspace);
            json(res, 200, { ok: true, state });
            return;
          }
          json(res, 404, { ok: false, error: { code: 'UNKNOWN_OP', message: `未知操作: ${op}` } });
        } catch (error) {
          json(res, 400, { ok: false, error: { code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error) } });
        }
        return;
      }

      json(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    } catch (error) {
      try {
        json(res, 500, { ok: false, error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } });
      } catch { /* response already gone */ }
    }
  };
}

function contentText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return [{ type: 'text', text }];
}

function zoneSummary(zones) {
  const enabled = zones.filter((zone) => zone.enabled);
  return enabled.map((zone) => `${zone.name}(${zone.id})=${zone.provider || '?'}/${zone.model || '?'}`).join('; ');
}

function renderZoneList(value) {
  if (!value || typeof value !== 'object') return contentText(value);
  const lines = [];
  lines.push(`项目: ${value.workspace || '(unknown)'}`);
  lines.push(value.configured ? '状态: 已配置' : '状态: 尚未配置');
  lines.push('');
  if (!Array.isArray(value.zones) || value.zones.length === 0) {
    lines.push('没有区域。');
  } else {
    for (const zone of value.zones) {
      const route = zone.provider && zone.model ? `${zone.provider} / ${zone.model}` : '未选择模型';
      const state = zone.enabled ? '启用' : '停用';
      lines.push(`- [${state}] ${zone.name} (id: ${zone.id}) — ${route}`);
      if (zone.description) lines.push(`  ${zone.description}`);
    }
  }
  if (Array.isArray(value.available) && value.available.length > 0) {
    lines.push('');
    lines.push(`可委派区域: ${value.available.join(', ')}`);
  }
  return [{ type: 'text', text: lines.join('\n') }];
}

function renderDispatch(value) {
  if (!value || typeof value !== 'object') return contentText(value);
  const lines = [];
  lines.push(`区域: ${value.zone?.name || value.zone?.id || '?'} (${value.zone?.id || '?'})`);
  lines.push(`模型: ${value.provider} / ${value.model}`);
  lines.push('');
  lines.push(value.text || '(区域模型没有返回内容)');
  const blocks = [{ type: 'text', text: lines.join('\n') }];
  for (const item of Array.isArray(value.media) ? value.media : []) {
    if (item && item.attachment) blocks.push({ type: 'image', attachment: item.attachment });
    else if (item && item.fileAttachment) blocks.push({ type: 'file', attachment: item.fileAttachment });
  }
  return blocks;
}

export function apply(ctx) {
  const store = new WorkspaceStore(profileStateFile());

  const resolveSession = (agent) => {
    if (!agent || typeof agent.id !== 'string') return undefined;
    return ctx.sessions.get(agent.id);
  };

  const workspaceOfSession = (session) => {
    if (!session) return '';
    const direct = typeof session.header?.cwd === 'string' ? session.header.cwd : '';
    if (direct) return direct;
    try {
      const service = ctx.get('workingDirectory');
      if (service && typeof service.get === 'function') return service.get(session);
    } catch { /* optional */ }
    return '';
  };

  const readWorkspaceForAgent = async (agent) => {
    const session = resolveSession(agent);
    const workspace = workspaceOfSession(session);
    if (!workspace) throw new Error('当前会话没有项目工作目录，无法读取区域配置');
    return { session, workspace, state: await store.readWorkspace(workspace) };
  };

  // ---------------------------------------------------------------------
  // Media generation (image / video) through the configured Provider
  // ---------------------------------------------------------------------
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : new Error('已取消'));
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(signal.reason instanceof Error ? signal.reason : new Error('已取消'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  const errorText = (data, fallback) => {
    if (isRecord(data)) {
      if (typeof data.message === 'string' && data.message.trim()) return data.message;
      if (typeof data.code === 'string' && data.code.trim()) return `${data.code}${data.message ? `: ${data.message}` : ''}`;
      if (isRecord(data.error)) {
        if (typeof data.error.message === 'string') return data.error.message;
        if (typeof data.error.code === 'string') return data.error.code;
      }
      if (isRecord(data.output) && typeof data.output.message === 'string') return data.output.message;
    }
    return fallback;
  };

  const readJsonResponse = async (response, label) => {
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = undefined;
    }
    if (!response.ok) {
      throw new Error(`${label}失败（HTTP ${response.status}）: ${errorText(data, text.slice(0, 600) || response.statusText)}`);
    }
    if (data === undefined) throw new Error(`${label}返回了非 JSON 响应: ${text.slice(0, 300)}`);
    return data;
  };

  const requestJson = async (url, init, label, signal) => {
    const response = await fetch(url, { ...init, signal });
    return readJsonResponse(response, label);
  };

  const resolveMediaEndpoint = async (providerId) => {
    let providerInfo;
    try {
      providerInfo = ctx.llm.listConfigurableProviders().find((entry) => entry.provider === providerId);
    } catch { /* optional */ }

    let settingsProvider;
    const settings = ctx.get('settings');
    if (settings && typeof settings.describe === 'function') {
      try {
        for (const document of settings.describe({ redactSecrets: true })) {
          const providers = document?.value?.providers;
          if (isRecord(providers) && isRecord(providers[providerId])) {
            settingsProvider = providers[providerId];
            break;
          }
        }
      } catch { /* optional */ }
    }

    const configuredBase = settingsProvider && typeof settingsProvider.baseURL === 'string'
      ? settingsProvider.baseURL.trim()
      : '';
    const baseURL = configuredBase || providerInfo?.defaultBaseURL || '';
    if (!baseURL) {
      throw new Error(`无法确定 Provider "${providerId}" 的 Base URL。请在设置 → 模型中为它填写 Base URL。`);
    }
    try {
      new URL(baseURL);
    } catch {
      throw new Error(`Provider "${providerId}" 的 Base URL 不是合法 URL: ${baseURL}`);
    }

    const candidates = [
      settingsProvider && typeof settingsProvider.apiKeyEnv === 'string' ? settingsProvider.apiKeyEnv : '',
      ...(Array.isArray(providerInfo?.nativeAuth?.env) ? providerInfo.nativeAuth.env : []),
      `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`,
    ].filter((value, index, array) => typeof value === 'string' && value && array.indexOf(value) === index);

    const credentials = ctx.get('credentials');
    let apiKey;
    let credentialRef;
    for (const candidate of candidates) {
      if (credentials && typeof credentials.resolve === 'function') {
        try {
          const resolved = await credentials.resolve(candidate);
          if (resolved && typeof resolved.value === 'string' && resolved.value) {
            apiKey = resolved.value;
            credentialRef = candidate;
            break;
          }
        } catch { /* try the next source */ }
      }
      if (!apiKey && process.env[candidate]) {
        apiKey = process.env[candidate];
        credentialRef = candidate;
        break;
      }
    }
    if (!apiKey) {
      throw new Error(`没有找到 Provider "${providerId}" 的 API Key。请在设置 → 模型中填写 API Key（候选凭据: ${candidates.join(', ') || '无'}）。`);
    }
    return {
      baseURL,
      apiKey,
      credentialRef,
      keyLooksTokenPlan: apiKey.startsWith('sk-sp-'),
      providerInfo,
      settingsProvider,
    };
  };

  const authHint = (error, endpoint) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!/\b401\b/.test(message)) return error;
    const keyHint = endpoint.keyLooksTokenPlan
      ? 'Key 前缀符合 Token Plan（sk-sp-）'
      : 'Key 前缀不符合 Token Plan（应以 sk-sp- 开头）';
    return new Error(`${message}\nToken Plan 媒体接口鉴权失败。当前凭据: ${endpoint.credentialRef || '(unknown)'}；${keyHint}。请在 设置 → 模型 中把 qwen-token-plan 的 API Key 更新为 Token Plan 套餐 Key，或改用支持该模型的 Provider。`);
  };

  const isTokenPlan = (providerId, baseURL) => /^qwen-token-plan(?:-|$)/i.test(providerId)
    || /token-plan\.[^/]+\.aliyuncs\.com/i.test(baseURL);

  const normalizeImageMediaType = (mediaType, url) => {
    const type = String(mediaType || '').split(';')[0].trim().toLowerCase();
    if (type === 'image/jpeg' || type === 'image/jpg') return 'image/jpeg';
    if (type === 'image/webp') return 'image/webp';
    if (type === 'image/gif') return 'image/gif';
    if (type === 'image/png') return 'image/png';
    if (/\.jpe?g(?:$|\?)/i.test(url)) return 'image/jpeg';
    if (/\.webp(?:$|\?)/i.test(url)) return 'image/webp';
    if (/\.gif(?:$|\?)/i.test(url)) return 'image/gif';
    return 'image/png';
  };

  const normalizeVideoMediaType = (mediaType, url) => {
    const type = String(mediaType || '').split(';')[0].trim().toLowerCase();
    if (type === 'video/mp4') return 'video/mp4';
    if (type === 'video/webm') return 'video/webm';
    if (type === 'video/quicktime') return 'video/quicktime';
    if (/\.webm(?:$|\?)/i.test(url)) return 'video/webm';
    if (/\.mov(?:$|\?)/i.test(url)) return 'video/quicktime';
    return 'video/mp4';
  };

  const mediaExtension = (mediaType, kind) => {
    if (kind === 'image') {
      if (mediaType === 'image/jpeg') return 'jpg';
      if (mediaType === 'image/webp') return 'webp';
      if (mediaType === 'image/gif') return 'gif';
      return 'png';
    }
    if (mediaType === 'video/webm') return 'webm';
    if (mediaType === 'video/quicktime') return 'mov';
    return 'mp4';
  };

  const downloadMedia = async (sourceUrl, apiKey, signal) => {
    if (typeof sourceUrl !== 'string' || !sourceUrl) throw new Error('生成结果缺少媒体 URL');
    if (sourceUrl.startsWith('data:')) {
      const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(sourceUrl);
      if (!match) throw new Error('无法解析 Base64 媒体结果');
      const declared = match[1] || '';
      const payload = match[2] || '';
      const bytes = match[0].includes(';base64,') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
      if (bytes.length > MAX_MEDIA_BYTES) throw new Error('生成媒体超过大小上限');
      return { bytes, mediaType: declared };
    }

    const attempt = async (withAuth) => fetch(sourceUrl, {
      signal,
      headers: withAuth && apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    });
    let response = await attempt(false);
    if (response.status === 401 || response.status === 403) {
      response = await attempt(true);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500);
      throw new Error(`下载生成媒体失败（HTTP ${response.status}）${detail ? `: ${detail}` : ''}`);
    }
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_MEDIA_BYTES) throw new Error('生成媒体超过大小上限');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_MEDIA_BYTES) throw new Error('生成媒体超过大小上限');
    return { bytes, mediaType: response.headers.get('content-type') || '' };
  };

  const persistMedia = async (workspace, zone, kind, downloaded, sourceUrl) => {
    const mediaType = kind === 'image'
      ? normalizeImageMediaType(downloaded.mediaType, sourceUrl)
      : normalizeVideoMediaType(downloaded.mediaType, sourceUrl);
    const dir = path.join(workspace, MEDIA_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
    const filename = `${stamp}-${zone.id}-${randomUUID().replace(/-/g, '').slice(0, 8)}.${mediaExtension(mediaType, kind)}`;
    const filePath = path.join(dir, filename);
    await fsp.writeFile(filePath, downloaded.bytes, { mode: 0o600 });

    const item = {
      kind,
      path: filePath,
      relativePath: path.relative(workspace, filePath).split(path.sep).join('/'),
      mediaType,
      bytes: downloaded.bytes.length,
      sourceUrl,
    };

    const attachments = ctx.get('attachments');
    if (attachments) {
      try {
        if (kind === 'image' && typeof attachments.saveImage === 'function') {
          item.attachment = await attachments.saveImage({
            data: downloaded.bytes,
            mediaType,
            name: filename,
          });
        } else if (kind === 'video' && typeof attachments.saveFile === 'function') {
          item.fileAttachment = await attachments.saveFile({
            data: downloaded.bytes,
            name: filename,
          });
        }
      } catch {
        // The workspace file remains the source of truth when the attachment policy refuses it.
      }
    }
    return item;
  };

  const uniqueMediaUrls = (data) => {
    const found = [];
    const push = (value) => {
      if (typeof value !== 'string' || !value) return;
      if (value.startsWith('data:') || /^https?:\/\//i.test(value)) found.push(value);
    };
    const walk = (node, depth) => {
      if (depth > 8 || node === null || node === undefined) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      if (!isRecord(node)) return;
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string' && ['image', 'image_url', 'url'].includes(key)) push(value);
        else if (typeof value === 'string' && key === 'b64_json') push(`data:image/png;base64,${value}`);
        else walk(value, depth + 1);
      }
    };
    walk(data, 0);
    return [...new Set(found)].slice(0, 4);
  };

  const imagePrompt = (task, extraContext) => {
    const prompt = [task, extraContext].filter(Boolean).join('\n\n补充约束:\n');
    return prompt.slice(0, 6000);
  };

  const mediaOptions = (raw) => {
    const input = isRecord(raw) ? raw : {};
    const count = Number.isFinite(Number(input.count)) ? Math.max(1, Math.min(4, Math.trunc(Number(input.count)))) : 1;
    const duration = Number.isFinite(Number(input.duration)) ? Math.max(1, Math.min(30, Number(input.duration))) : 5;
    return {
      size: typeof input.size === 'string' && input.size.trim() ? input.size.trim().replace(/[x×]/gi, '*') : '1024*1024',
      ratio: typeof input.ratio === 'string' && input.ratio.trim() ? input.ratio.trim() : '16:9',
      resolution: typeof input.resolution === 'string' && input.resolution.trim() ? input.resolution.trim() : '720P',
      duration,
      count,
      negativePrompt: typeof input.negativePrompt === 'string' ? input.negativePrompt.trim() : '',
      seed: Number.isFinite(Number(input.seed)) ? Math.trunc(Number(input.seed)) : undefined,
    };
  };

  const generateImageTokenPlan = async ({ baseURL, apiKey, model, prompt, options, workspace, zone, signal }) => {
    const origin = new URL(baseURL).origin;
    const parameters = {
      size: options.size,
      n: options.count,
      prompt_extend: true,
      watermark: false,
    };
    if (options.negativePrompt) parameters.negative_prompt = options.negativePrompt;
    if (options.seed !== undefined) parameters.seed = options.seed;
    const data = await requestJson(
      `${origin}/api/v1/services/aigc/multimodal-generation/generation`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
          parameters,
        }),
      },
      '图片生成',
      signal,
    );
    const urls = uniqueMediaUrls(data);
    if (urls.length === 0) {
      throw new Error(`图片生成响应中没有图片结果: ${JSON.stringify(data).slice(0, 800)}`);
    }
    const media = [];
    for (const sourceUrl of urls.slice(0, options.count)) {
      const downloaded = await downloadMedia(sourceUrl, apiKey, signal);
      media.push(await persistMedia(workspace, zone, 'image', downloaded, sourceUrl));
    }
    return media;
  };

  const generateImageGeneric = async ({ baseURL, apiKey, model, prompt, options, workspace, zone, signal }) => {
    const data = await requestJson(
      `${baseURL.replace(/\/+$/, '')}/images/generations`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          n: options.count,
          size: options.size.replace(/\*/g, 'x'),
          response_format: 'b64_json',
        }),
      },
      '图片生成',
      signal,
    );
    const urls = uniqueMediaUrls(data);
    if (urls.length === 0) {
      throw new Error(`图片生成响应中没有图片结果: ${JSON.stringify(data).slice(0, 800)}`);
    }
    const media = [];
    for (const sourceUrl of urls.slice(0, options.count)) {
      const downloaded = await downloadMedia(sourceUrl, apiKey, signal);
      media.push(await persistMedia(workspace, zone, 'image', downloaded, sourceUrl));
    }
    return media;
  };

  const generateVideoTokenPlan = async ({ baseURL, apiKey, model, prompt, options, workspace, zone, signal }) => {
    const origin = new URL(baseURL).origin;
    const submitted = await requestJson(
      `${origin}/api/v1/services/aigc/video-generation/video-synthesis`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model,
          input: { prompt },
          parameters: {
            resolution: options.resolution,
            ratio: options.ratio,
            duration: options.duration,
          },
        }),
      },
      '视频任务提交',
      signal,
    );
    const taskId = submitted?.output?.task_id || submitted?.task_id;
    if (!taskId) {
      throw new Error(`视频任务提交后没有返回 task_id: ${JSON.stringify(submitted).slice(0, 800)}`);
    }

    const deadline = Date.now() + MEDIA_DISPATCH_TIMEOUT_MS;
    let lastStatus = 'PENDING';
    while (Date.now() < deadline) {
      await sleep(5000, signal);
      const statusData = await requestJson(
        `${origin}/api/v1/tasks/${encodeURIComponent(taskId)}`,
        {
          headers: { authorization: `Bearer ${apiKey}` },
        },
        '视频任务查询',
        signal,
      );
      const status = statusData?.output?.task_status || statusData?.task_status;
      lastStatus = typeof status === 'string' ? status : lastStatus;
      if (lastStatus === 'SUCCEEDED') {
        const videoUrl = statusData?.output?.video_url
          || statusData?.output?.results?.[0]?.video_url
          || statusData?.output?.video_urls?.[0]
          || statusData?.video_url;
        if (!videoUrl) {
          throw new Error(`视频任务成功但没有返回 video_url: ${JSON.stringify(statusData).slice(0, 800)}`);
        }
        const downloaded = await downloadMedia(videoUrl, apiKey, signal);
        return [await persistMedia(workspace, zone, 'video', downloaded, videoUrl)];
      }
      if (lastStatus === 'FAILED' || lastStatus === 'CANCELED' || lastStatus === 'CANCELLED' || lastStatus === 'UNKNOWN') {
        throw new Error(`视频生成失败（${lastStatus}）: ${errorText(statusData, '上游没有返回原因')}`);
      }
    }
    throw new Error(`视频生成超时（最后状态: ${lastStatus}）`);
  };

  const generateZoneMedia = async ({ zone, task, extraContext, options, workspace, signal }) => {
    const endpoint = await resolveMediaEndpoint(zone.provider);
    const prompt = imagePrompt(task, extraContext);
    const opts = mediaOptions(options);
    try {
      if (zone.kind === 'video') {
        if (!isTokenPlan(zone.provider, endpoint.baseURL)) {
          throw new Error(`视频区当前只支持 Token Plan 兼容接口（qwen-token-plan）。当前 Provider 是 ${zone.provider}；请切换到 qwen-token-plan 并选择 wan3.0-video 等视频模型。`);
        }
        return await generateVideoTokenPlan({
          baseURL: endpoint.baseURL,
          apiKey: endpoint.apiKey,
          model: zone.model,
          prompt,
          options: opts,
          workspace,
          zone,
          signal,
        });
      }
      if (zone.kind === 'image') {
        if (isTokenPlan(zone.provider, endpoint.baseURL)) {
          return await generateImageTokenPlan({
            baseURL: endpoint.baseURL,
            apiKey: endpoint.apiKey,
            model: zone.model,
            prompt,
            options: opts,
            workspace,
            zone,
            signal,
          });
        }
        return await generateImageGeneric({
          baseURL: endpoint.baseURL,
          apiKey: endpoint.apiKey,
          model: zone.model,
          prompt,
          options: opts,
          workspace,
          zone,
          signal,
        });
      }
    } catch (error) {
      throw authHint(error, endpoint);
    }
    throw new Error(`区域「${zone.name}」不是媒体生成区域。`);
  };

  // ---------------------------------------------------------------------
  // HTTP API for the Client half
  // ---------------------------------------------------------------------
  const webServer = ctx.get('webServer');
  if (webServer && typeof webServer.register === 'function') {
    ctx.effect(
      () => webServer.register({
        kind: 'exact',
        path: API_PATH,
        handler: createHttpApi(ctx, store, resolveMediaEndpoint),
      }),
      'dsh-bot: zone-router http api',
    );
  }

  // ---------------------------------------------------------------------
  // Model-facing tools
  // ---------------------------------------------------------------------
  const zoneListTool = {
    name: 'zone_list',
    description: 'List the current project\'s configured model zones (main, text, code, image, video, tts, audio, 3d, and custom zones). Use this when you need the exact zone ids or when a dispatch failed.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          workspace: { type: 'string' },
          configured: { type: 'boolean' },
          zones: { type: 'array', items: { type: 'object', additionalProperties: true } },
          available: { type: 'array', items: { type: 'string' } },
        },
        required: ['workspace', 'configured', 'zones'],
      },
      render: (_args, value) => renderZoneList(value),
    },
    async execute(_args, exec) {
      let session;
      let workspace;
      try {
        const resolved = await readWorkspaceForAgent(exec.agent);
        session = resolved.session;
        workspace = resolved.workspace;
        const state = resolved.state;
        const main = state.zones.find((zone) => zone.id === 'main');
        return {
          workspace,
          configured: state.configured && Boolean(main?.provider && main?.model),
          zones: state.zones,
          available: state.zones.filter((zone) => zone.enabled && zone.id !== 'main' && zone.provider && zone.model).map((zone) => zone.id),
          sessionId: session?.id,
        };
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
      }
    },
  };

  const zoneDispatchTool = {
    name: 'zone_dispatch',
    description: 'Delegate one self-contained task to a zone. Text, code, TTS, audio, 3D and custom zones run as a direct specialist model call and return text. Image and video zones actually generate image/video files with the configured media model and save them under the project .dsh-bot/generated directory; pass options for size/ratio/duration. The main zone is the orchestrator itself and cannot be dispatched to.',
    parameters: {
      type: 'object',
      properties: {
        zone: {
          type: 'string',
          description: 'Zone id from the "Multi-zone model routing" system context, for example "code", "image", or a custom id.',
        },
        task: {
          type: 'string',
          description: 'A complete, self-contained instruction. For image/video zones this is the generation prompt. Include all decisions the zone needs; it cannot see this conversation.',
        },
        context: {
          type: 'string',
          description: 'Optional supporting material (code, excerpts, constraints, style guide). Keep it focused.',
        },
        options: {
          type: 'object',
          description: 'Media generation options. Ignored by text-like zones.',
          properties: {
            size: { type: 'string', description: 'Image size such as 1024*1024 or 1024x1024. Default 1024*1024.' },
            ratio: { type: 'string', description: 'Video aspect ratio such as 16:9, 9:16, 1:1. Default 16:9.' },
            resolution: { type: 'string', description: 'Video resolution such as 720P or 1080P. Default 720P.' },
            duration: { type: 'number', description: 'Video duration in seconds, 1-30. Default 5.' },
            count: { type: 'number', description: 'Image count, 1-4. Default 1.' },
            negativePrompt: { type: 'string', description: 'Optional image negative prompt.' },
            seed: { type: 'number', description: 'Optional generation seed.' },
          },
          additionalProperties: false,
        },
      },
      required: ['zone', 'task'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          zone: { type: 'object', additionalProperties: true },
          provider: { type: 'string' },
          model: { type: 'string' },
          kind: { type: 'string' },
          text: { type: 'string' },
          media: { type: 'array', items: { type: 'object', additionalProperties: true } },
          finish: { type: 'object', additionalProperties: true },
          usage: { type: 'object', additionalProperties: true },
          truncated: { type: 'boolean' },
        },
        required: ['zone', 'provider', 'model', 'text'],
      },
      render: (_args, value) => renderDispatch(value),
    },
    timeoutMs: MEDIA_DISPATCH_TIMEOUT_MS + 60_000,
    async execute(args, exec) {
      const input = isRecord(args) ? args : {};
      const zoneId = typeof input.zone === 'string' ? input.zone.trim() : '';
      const task = typeof input.task === 'string' ? input.task.trim() : '';
      const extraContext = typeof input.context === 'string' ? input.context.trim() : '';
      if (!zoneId) throw new Error('缺少 zone 参数');
      if (!task) throw new Error('缺少 task 参数');
      if (task.length > MAX_TASK_CHARS) throw new Error(`task 太长（上限 ${MAX_TASK_CHARS} 字符）`);

      const { session, workspace, state } = await readWorkspaceForAgent(exec.agent);
      const zone = state.zones.find((item) => item.id === zoneId);
      if (!zone) {
        const available = state.zones.filter((item) => item.enabled && item.id !== 'main').map((item) => item.id);
        throw new Error(`没有找到区域 "${zoneId}"。可用区域: ${available.join(', ') || '(none)'}`);
      }
      if (!zone.enabled) throw new Error(`区域「${zone.name}」已停用。请让用户在“选择哪个区域需要什么模型”页面启用它。`);
      if (zone.id === 'main') throw new Error('main 是主调度模型，不能把任务派发给自己。请直接处理，或派发给专业区域。');
      if (!zone.provider || !zone.model) throw new Error(`区域「${zone.name}」还没有选择模型。`);

      if (zone.kind === 'image' || zone.kind === 'video') {
        const controller = new AbortController();
        const onAbort = () => controller.abort(exec.signal?.reason);
        if (exec.signal) {
          if (exec.signal.aborted) controller.abort(exec.signal.reason);
          else exec.signal.addEventListener('abort', onAbort, { once: true });
        }
        const timeout = setTimeout(
          () => controller.abort(new Error('媒体生成超时')),
          MEDIA_DISPATCH_TIMEOUT_MS + 30_000,
        );
        try {
          const media = await generateZoneMedia({
            zone,
            task,
            extraContext,
            options: input.options,
            workspace,
            signal: controller.signal,
          });
          if (!Array.isArray(media) || media.length === 0) {
            throw new Error('媒体生成没有返回文件');
          }
          const text = [
            `已生成 ${media.length} 个${zone.kind === 'image' ? '图片' : '视频'}文件，保存在项目 ${MEDIA_DIR}/：`,
            ...media.map((item) => `- ${item.kind === 'image' ? '图片' : '视频'}: ${item.relativePath}（${item.mediaType}, ${item.bytes} bytes）`),
            '',
            '主调度可以把上面的相对路径作为 Markdown 链接/图片展示给用户；文件已经真实写入磁盘。',
          ].join('\n');
          return {
            zone: { id: zone.id, name: zone.name, kind: zone.kind },
            provider: zone.provider,
            model: zone.model,
            kind: zone.kind,
            text,
            media,
            finish: { kind: 'stop' },
            truncated: false,
          };
        } finally {
          clearTimeout(timeout);
          if (exec.signal) exec.signal.removeEventListener('abort', onAbort);
        }
      }

      const guidance = ZONE_GUIDANCE[zone.kind] || ZONE_GUIDANCE.custom;
      const system = [
        `You are the ${zone.name} specialist (zone id: ${zone.id}) in a multi-zone model routing setup.`,
        guidance,
        `Project workspace: ${workspace}`,
        'The main orchestrator delegates one self-contained task to you. It cannot see your intermediate work; return the complete final deliverable.',
        'Do not ask clarifying questions. State assumptions briefly and proceed. Do not invent tool results or claim files were written.',
        'Reply in the language used by the task unless the task requests another language.',
      ].join('\n');

      const prompt = extraContext
        ? `${task}\n\n--- Additional context from the orchestrator ---\n${extraContext}`
        : task;

      const controller = new AbortController();
      const onAbort = () => controller.abort(exec.signal?.reason);
      if (exec.signal) {
        if (exec.signal.aborted) controller.abort(exec.signal.reason);
        else exec.signal.addEventListener('abort', onAbort, { once: true });
      }
      const timeout = setTimeout(() => controller.abort(new Error('区域模型调用超时')), DISPATCH_TIMEOUT_MS);

      let text = '';
      let finish;
      let usage;
      try {
        const stream = ctx.llm.stream({
          provider: zone.provider,
          model: zone.model,
          system,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          sessionId: session?.id,
          signal: controller.signal,
        });
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta') {
            text += chunk.text;
            if (text.length > MAX_RESULT_CHARS) {
              text = text.slice(0, MAX_RESULT_CHARS);
              controller.abort(new Error('区域模型输出超过上限'));
              break;
            }
          } else if (chunk.type === 'finish') {
            finish = chunk.reason;
          } else if (chunk.type === 'usage') {
            usage = chunk.usage;
          }
        }
      } finally {
        clearTimeout(timeout);
        if (exec.signal) exec.signal.removeEventListener('abort', onAbort);
      }

      if (finish && finish.kind === 'error') {
        throw new Error(`区域模型调用失败 (${finish.failure?.code || 'error'}): ${finish.failure?.message || 'unknown error'}`);
      }
      if (finish && finish.kind === 'aborted' && !text) {
        throw new Error(`区域模型调用被中止: ${finish.failure?.message || 'aborted'}`);
      }
      if (!text.trim()) {
        throw new Error('区域模型没有返回任何文本。请检查该模型是否可用，或换一个模型。');
      }

      return {
        zone: { id: zone.id, name: zone.name, kind: zone.kind },
        provider: zone.provider,
        model: zone.model,
        text,
        finish: finish ? { kind: finish.kind, ...(finish.failure ? { failure: finish.failure } : {}) } : undefined,
        usage,
        truncated: text.length >= MAX_RESULT_CHARS,
      };
    },
  };

  ctx.effect(() => ctx.tools.register(zoneListTool), 'dsh-bot: zone_list tool');
  ctx.effect(() => ctx.tools.register(zoneDispatchTool), 'dsh-bot: zone_dispatch tool');

  // ---------------------------------------------------------------------
  // Prompt contributions
  // ---------------------------------------------------------------------
  const policyText = [
    '## 多区域模型路由',
    '本会话启用了“多区域专业模型路由”。你是主调度模型：先理解用户意图，再把任务拆成可独立执行的子任务。',
    '- 当任务明显属于某个已启用的专业区域时，优先调用 `zone_dispatch`，把自包含的 `task` 交给该区域模型；必要时在 `context` 里补充代码、素材或约束。',
    '- 区域模型看不到本会话历史，所以 `task` 必须写清目标、输入、输出格式和验收标准。',
    '- 典型路由：代码/调试/审查 → code；写作/翻译/总结 → text；生成图片 → image；生成视频 → video；配音文案 → tts；音频分析/混音 → audio；3D 场景/建模 → 3d；自定义区域按名称判断。',
    '- 图片区和视频区会实际生成媒体文件并保存到项目的 .dsh-bot/generated/ 目录。调用时把完整提示词放进 `task`，需要尺寸/画幅/时长时放进 `options`（size、ratio、resolution、duration、count）。',
    '- 媒体生成完成后，把返回的 relativePath 用 Markdown 图片或文件链接展示给用户；不要只说“已生成”而不给路径。',
    '- 不要虚构区域结果。`zone_dispatch` 返回失败时，向用户说明哪个区域失败以及原因。',
    '- 简单问题可以直接回答；只要任务需要专业区域的模型能力，就应当委派。',
    '- 用户在聊天界面随时可以通过“重新配置区域模型”修改映射。',
  ].join('\n');

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'dsh-bot.routing-policy',
    order: 420,
    text: policyText,
  }), 'dsh-bot: routing policy section');

  ctx.effect(() => ctx.systemPrompt.context({
    name: 'dsh-bot.zone-map',
    order: 421,
    text: (assemble) => {
      const agent = assemble?.scope;
      const session = resolveSession(agent);
      const workspace = workspaceOfSession(session);
      if (!workspace) return '当前会话没有项目工作目录，区域配置不可用。';
      let entry;
      try {
        entry = store.peekWorkspaceSync(workspace);
      } catch {
        entry = null;
      }
      if (!entry || !Array.isArray(entry.zones)) {
        return `当前项目（${workspace}）尚未保存区域模型配置。用户需要先完成“选择哪个区域需要什么模型”页面；在此之前不要调用 zone_dispatch。`;
      }
      const zones = entry.zones;
      const main = zones.find((zone) => zone.id === 'main' && zone.enabled && zone.provider && zone.model);
      if (!main) {
        return `当前项目（${workspace}）尚未保存可用的主调度模型配置。用户可以从输入框左侧“重新配置区域模型”打开配置页；在此之前不要调用 zone_dispatch。`;
      }
      const enabled = zones.filter((zone) => zone.enabled);
      const lines = [
        `## 当前项目的区域模型（${workspace}）`,
        `主调度模型: ${main.provider} / ${main.model}`,
        '调用 `zone_dispatch` 时，`zone` 参数使用下列 ID：',
      ];
      for (const zone of enabled) {
        if (zone.id === 'main') continue;
        const route = zone.provider && zone.model ? `${zone.provider} / ${zone.model}` : '未选择模型';
        lines.push(`- ${zone.id} — ${zone.name} → ${route}`);
      }
      const disabled = zones.filter((zone) => !zone.enabled).map((zone) => zone.id);
      if (disabled.length > 0) lines.push(`已停用区域: ${disabled.join(', ')}（不可派发）`);
      return lines.join('\n');
    },
  }), 'dsh-bot: zone map context');

  // ---------------------------------------------------------------------
  // Main-model takeover for root Sessions
  // ---------------------------------------------------------------------
  ctx.effect(() => ctx.on('agent/request', async (payload, next) => {
    const base = await next();
    const session = resolveSession(payload.agent);
    if (!session || session.header?.parentSession || session.header?.origin === 'subagent') return base;
    const workspace = workspaceOfSession(session);
    if (!workspace) return base;
    let state;
    try {
      state = await store.readWorkspace(workspace);
    } catch {
      return base;
    }
    const main = state.zones.find((zone) => zone.id === 'main' && zone.enabled && zone.provider && zone.model);
    if (!main) return base;
    if (base.provider === main.provider && base.model === main.model) return base;
    const { reasoningEffort: _ignored, ...rest } = base || {};
    const replacement = { ...rest, provider: main.provider, model: main.model };
    if (main.reasoningEffort) replacement.reasoningEffort = main.reasoningEffort;
    return replacement;
  }), 'dsh-bot: main zone model takeover');

  // Warm the cache as early as possible so the first prompt has the zone map.
  void store.readAll().catch(() => {});
}
