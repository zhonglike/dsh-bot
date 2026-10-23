window.__ModuleLoader__.load({
  id: 'dsh-bot',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const TITLE = '选择哪个区域需要什么模型';
    const ENTRY_LABEL = '重新配置区域模型';
    const API_PATH = '/zone-router/api';

    const BUILTIN_ORDER = ['main', 'text', 'code', 'image', 'video', 'tts', 'audio', '3d'];
    const KIND_LABEL = {
      main: '主调度',
      text: '文本',
      code: '代码',
      image: '图片',
      video: '视频',
      tts: 'TTS',
      audio: '音频',
      '3d': '3D',
      custom: '自定义',
    };

    const CSS = `
.dshz-root { --dshz-radius: 12px; }
.dshz-entry {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px;
  border: 1px solid transparent; border-radius: 7px; background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 1;
  cursor: pointer; white-space: nowrap; transition: background .15s ease, color .15s ease;
}
.dshz-entry:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dshz-entry-icon { display: inline-flex; width: 14px; height: 14px; color: var(--dsw-alias-brand-primary); }
.dshz-backdrop {
  position: fixed; inset: 0; z-index: 2147483000; display: flex;
  align-items: center; justify-content: center; padding: 20px;
  background: rgba(0, 0, 0, .52); box-sizing: border-box;
}
.dshz-modal {
  width: min(980px, 100%); max-height: 100%; min-height: 0; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px;
  box-shadow: 0 28px 90px rgba(0, 0, 0, .38); overflow: hidden;
}
.dshz-head { padding: 22px 24px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); display: flex; gap: 16px; align-items: flex-start; }
.dshz-head-main { flex: 1; min-width: 0; }
.dshz-eyebrow { color: var(--dsw-alias-brand-primary); font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; margin-bottom: 6px; }
.dshz-title { margin: 0; font-size: 21px; line-height: 1.3; font-weight: 650; letter-spacing: -.01em; }
.dshz-subtitle { margin: 8px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.6; max-width: 720px; }
.dshz-workspace { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 3px 8px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshz-close { flex: none; width: 32px; height: 32px; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 22px; line-height: 1; cursor: pointer; }
.dshz-close:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dshz-body { padding: 16px 24px 18px; overflow: auto; min-height: 0; flex: 1 1 auto; }
.dshz-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.dshz-counter { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dshz-toolbar-actions { display: flex; gap: 8px; align-items: center; }
.dshz-link { border: none; background: none; padding: 4px 6px; border-radius: 6px; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.dshz-link:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.dshz-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.dshz-row { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: var(--dshz-radius); padding: 12px 13px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dshz-row.is-off { opacity: .68; }
.dshz-row.is-main { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l1)); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, var(--dsw-alias-bg-layer-1)); }
.dshz-row-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshz-row-title { display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1; }
.dshz-name { min-width: 0; width: 100%; max-width: 210px; padding: 3px 6px; margin-left: -6px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; font-weight: 600; }
.dshz-name:hover, .dshz-name:focus { border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); outline: none; }
.dshz-badge { flex: none; padding: 1px 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 16px; }
.dshz-badge-main { color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); }
.dshz-remove { margin-left: auto; border: none; background: none; color: var(--dsw-alias-state-error-primary); font: inherit; font-size: 11px; cursor: pointer; padding: 2px 4px; border-radius: 5px; }
.dshz-remove:hover { background: var(--dsw-alias-bg-layer-2); }
.dshz-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.55; }
.dshz-media-hint { margin: 0; color: var(--dsw-alias-state-warn-primary); font-size: 10px; line-height: 1.5; }
.dshz-route { display: flex; flex-direction: column; gap: 5px; }
.dshz-label { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dshz-select { width: 100%; height: 34px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; outline: none; }
.dshz-select:focus { border-color: var(--dsw-alias-brand-primary); }
.dshz-select:disabled { cursor: not-allowed; opacity: .7; }
.dshz-switch { display: inline-flex; align-items: center; gap: 6px; flex: none; cursor: pointer; user-select: none; }
.dshz-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.dshz-track { position: relative; width: 28px; height: 16px; border-radius: 999px; background: var(--dsw-alias-state-idle-primary); transition: background .15s ease; }
.dshz-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--dsw-alias-bg-base); transition: transform .15s ease; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
.dshz-switch input:checked + .dshz-track { background: var(--dsw-alias-brand-primary); }
.dshz-switch input:checked + .dshz-track::after { transform: translateX(12px); }
.dshz-switch input:disabled + .dshz-track { opacity: .5; }
.dshz-switch-label { color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dshz-add { margin-top: 10px; width: 100%; height: 38px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.dshz-add:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); }
.dshz-alert { margin: 0 0 12px; padding: 9px 11px; border-radius: 8px; font-size: 12px; line-height: 1.55; border: 1px solid var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
.dshz-note { margin: 0 0 12px; padding: 9px 11px; border-radius: 8px; font-size: 12px; line-height: 1.55; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.dshz-empty { padding: 22px 16px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.7; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; }
.dshz-empty strong { color: var(--dsw-alias-label-primary); }
.dshz-foot { display: flex; align-items: center; gap: 14px; padding: 14px 24px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.dshz-foot-hint { flex: 1; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; }
.dshz-foot-actions { display: flex; gap: 8px; flex: none; }
.dshz-btn { height: 36px; padding: 0 16px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; }
.dshz-btn:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.dshz-btn.primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); font-weight: 600; }
.dshz-btn.primary:hover { filter: brightness(1.06); }
.dshz-btn:disabled { opacity: .55; cursor: not-allowed; }
.dshz-loading { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 6px 2px; }
.dshz-spinner { width: 14px; height: 14px; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); border-radius: 50%; animation: dshz-spin .8s linear infinite; }
@keyframes dshz-spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) {
  .dshz-backdrop { padding: 10px; }
  .dshz-grid { grid-template-columns: 1fr; }
  .dshz-head { padding: 18px 18px 14px; }
  .dshz-body { padding: 14px 18px; }
  .dshz-foot { padding: 12px 18px; flex-wrap: wrap; }
  .dshz-foot-hint { flex-basis: 100%; }
  .dshz-foot-actions { width: 100%; justify-content: flex-end; }
  .dshz-title { font-size: 18px; }
}
@media (max-width: 900px) {
  .dshz-entry-label { display: none; }
}
`;

    function cloneZones(zones) {
      return (Array.isArray(zones) ? zones : []).map((zone) => ({ ...zone }));
    }

    function routeValue(zone) {
      if (!zone || !zone.provider || !zone.model) return '';
      return `${zone.provider}\u001f${zone.model}`;
    }

    function parseRouteValue(value) {
      if (typeof value !== 'string' || !value) return { provider: null, model: null };
      const index = value.indexOf('\u001f');
      if (index < 0) return { provider: null, model: null };
      return { provider: value.slice(0, index), model: value.slice(index + 1) };
    }

    async function apiGet(query, signal) {
      let response;
      try {
        response = await fetch(`${API_PATH}?${query}`, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          signal,
        });
      } catch (error) {
        throw new Error(`无法连接区域配置服务：${error instanceof Error ? error.message : String(error)}`);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error(`区域配置服务返回了无法解析的响应（HTTP ${response.status}）`);
      }
      if (!response.ok || !body || body.ok !== true) {
        throw new Error(body?.error?.message || `区域配置请求失败（HTTP ${response.status}）`);
      }
      return body;
    }

    async function apiPost(op, payload) {
      let response;
      try {
        response = await fetch(`${API_PATH}?op=${encodeURIComponent(op)}`, {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        throw new Error(`无法连接区域配置服务：${error instanceof Error ? error.message : String(error)}`);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error(`区域配置服务返回了无法解析的响应（HTTP ${response.status}）`);
      }
      if (!response.ok || !body || body.ok !== true) {
        throw new Error(body?.error?.message || `保存失败（HTTP ${response.status}）`);
      }
      return body;
    }

    function validateDraft(zones) {
      const main = zones.find((zone) => zone.id === 'main');
      if (!main) return '缺少主调度区域。';
      if (!main.provider || !main.model) return '请先为主调度模型选择一个模型。';
      for (const zone of zones) {
        if (!zone.enabled) continue;
        if (!zone.name || !String(zone.name).trim()) return '区域的显示名称不能为空。';
        if (!zone.provider || !zone.model) return `区域「${zone.name}」已启用，但还没有选择模型。`;
      }
      const names = new Map();
      for (const zone of zones) {
        if (!zone.enabled) continue;
        const key = String(zone.name).trim().toLocaleLowerCase();
        if (names.has(key)) return `已启用区域的显示名称重复：${zone.name}`;
        names.set(key, zone.id);
      }
      return null;
    }

    const configOpenSignal = {
      listeners: new Set(),
      request() {
        for (const listener of [...this.listeners]) listener();
      },
      subscribe(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
      },
    };

    function ConfigEntryButton() {
      return h('button', {
        type: 'button',
        className: 'dshz-entry',
        title: ENTRY_LABEL,
        'aria-label': ENTRY_LABEL,
        onClick: () => configOpenSignal.request(),
      },
        h('span', { className: 'dshz-entry-icon', 'aria-hidden': 'true' }, '▦'),
        h('span', { className: 'dshz-entry-label' }, ENTRY_LABEL),
      );
    }

    function ZoneRouterDock(props) {
      const { sessionId, useSessions } = props;
      const cwd = useSessions((snapshot) => {
        if (!sessionId || !snapshot || !snapshot.byId) return undefined;
        return snapshot.byId[sessionId] && snapshot.byId[sessionId].cwd;
      });

      const [loading, setLoading] = useState(true);
      const [state, setState] = useState(null);
      const [draft, setDraft] = useState([]);
      const [catalog, setCatalog] = useState(null);
      const [catalogLoading, setCatalogLoading] = useState(false);
      const [catalogError, setCatalogError] = useState(null);
      const [open, setOpen] = useState(false);
      const [forced, setForced] = useState(false);
      const [error, setError] = useState(null);
      const [saving, setSaving] = useState(false);
      const [reloadToken, setReloadToken] = useState(0);
      const dialogRef = useRef(null);

      useEffect(() => {
        if (!cwd) {
          setLoading(false);
          return undefined;
        }
        let cancelled = false;
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        setState(null);
        setDraft([]);
        setOpen(false);
        setForced(false);
        Promise.all([
          apiGet(`op=state&workspace=${encodeURIComponent(cwd)}`, controller.signal),
          apiGet('op=catalog', controller.signal),
        ]).then(([stateBody, catalogBody]) => {
          if (cancelled) return;
          const nextState = stateBody.state;
          setState(nextState);
          setDraft(cloneZones(nextState.zones));
          setCatalog(catalogBody.catalog);
          setCatalogError(null);
          setLoading(false);
          if (!nextState.configured) {
            setForced(true);
            setOpen(true);
          }
        }).catch((loadError) => {
          if (cancelled) return;
          setLoading(false);
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setForced(true);
          setOpen(true);
        });
        return () => {
          cancelled = true;
          controller.abort();
        };
      }, [cwd, reloadToken]);

      useEffect(() => {
        if (!open || forced) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [open, forced]);

      useEffect(() => {
        if (!open) return;
        const timer = setTimeout(() => {
          const first = dialogRef.current && dialogRef.current.querySelector('select:not(:disabled)');
          if (first && typeof first.focus === 'function') first.focus();
        }, 40);
        return () => clearTimeout(timer);
      }, [open]);

      const refreshCatalog = useCallback(async () => {
        setCatalogLoading(true);
        setCatalogError(null);
        try {
          const body = await apiGet('op=catalog');
          setCatalog(body.catalog);
        } catch (refreshError) {
          setCatalogError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        } finally {
          setCatalogLoading(false);
        }
      }, []);

      const openConfig = useCallback(async () => {
        if (!cwd) return;
        setError(null);
        setOpen(true);
        setForced(false);
        try {
          const [stateBody, catalogBody] = await Promise.all([
            apiGet(`op=state&workspace=${encodeURIComponent(cwd)}`),
            apiGet('op=catalog'),
          ]);
          setState(stateBody.state);
          setDraft(cloneZones(stateBody.state.zones));
          setCatalog(catalogBody.catalog);
          setCatalogError(null);
          if (!stateBody.state.configured) setForced(true);
        } catch (openError) {
          setError(openError instanceof Error ? openError.message : String(openError));
          if (!catalog) void refreshCatalog();
        }
      }, [cwd, catalog, refreshCatalog]);

      useEffect(() => configOpenSignal.subscribe(() => {
        void openConfig();
      }), [openConfig]);

      const updateZone = useCallback((id, patch) => {
        setDraft((current) => current.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone)));
      }, []);

      const addCustomZone = useCallback(() => {
        setDraft((current) => {
          const count = current.filter((zone) => zone.kind === 'custom').length + 1;
          const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
          return [
            ...current,
            {
              id: `custom-${suffix}`,
              name: `自定义区域 ${count}`,
              kind: 'custom',
              enabled: true,
              description: '用户自定义的专业工作区域。',
              provider: null,
              model: null,
              reasoningEffort: null,
            },
          ];
        });
      }, []);

      const removeZone = useCallback((id) => {
        setDraft((current) => current.filter((zone) => !(zone.id === id && zone.kind === 'custom')));
      }, []);

      const save = useCallback(async () => {
        if (!cwd) return;
        const validation = validateDraft(draft);
        if (validation) {
          setError(validation);
          return;
        }
        setSaving(true);
        setError(null);
        try {
          const body = await apiPost('save', { workspace: cwd, zones: draft });
          setState(body.state);
          setDraft(cloneZones(body.state.zones));
          setOpen(false);
          setForced(false);
        } catch (saveError) {
          setError(saveError instanceof Error ? saveError.message : String(saveError));
        } finally {
          setSaving(false);
        }
      }, [cwd, draft]);

      const groups = catalog && Array.isArray(catalog.groups) ? catalog.groups : [];
      const hasAnyModel = groups.some((group) => Array.isArray(group.models) && group.models.length > 0);
      const enabledCount = draft.filter((zone) => zone.enabled).length;

      const catalogGroups = useMemo(() => {
        const built = groups.map((group) => ({
          id: group.id,
          name: group.name || group.id,
          models: Array.isArray(group.models) ? group.models : [],
          error: group.error,
        }));
        return built;
      }, [groups]);

      if (!cwd) return null;

      if (loading && !open) {
        return h('div', { className: 'dshz-root' },
          h('style', null, CSS),
          h('div', { className: 'dshz-loading' },
            h('span', { className: 'dshz-spinner' }),
            h('span', null, '正在读取当前项目的区域配置…'),
          ),
        );
      }

      const modal = open ? h('div', {
        className: 'dshz-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && !forced) setOpen(false);
        },
      },
        h('div', {
          className: 'dshz-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dshz-title',
          ref: dialogRef,
        },
          h('div', { className: 'dshz-head' },
            h('div', { className: 'dshz-head-main' },
              h('div', { className: 'dshz-eyebrow' }, '项目区域路由'),
              h('h2', { className: 'dshz-title', id: 'dshz-title' }, TITLE),
              h('p', { className: 'dshz-subtitle' }, '为当前项目选择每个区域使用的模型。配置按项目独立保存，新项目需要重新选择。'),
              h('div', { className: 'dshz-workspace', title: cwd }, cwd),
            ),
            forced ? null : h('button', {
              type: 'button',
              className: 'dshz-close',
              'aria-label': '关闭',
              onClick: () => setOpen(false),
            }, '×'),
          ),
          h('div', { className: 'dshz-body' },
            error ? h('p', { className: 'dshz-alert' },
              error,
              !state ? h('button', {
                type: 'button',
                className: 'dshz-link',
                style: { marginLeft: '8px', color: 'inherit', textDecoration: 'underline' },
                onClick: () => setReloadToken((value) => value + 1),
              }, '重试') : null,
            ) : null,
            catalogError ? h('p', { className: 'dshz-alert' },
              catalogError,
              h('button', {
                type: 'button',
                className: 'dshz-link',
                style: { marginLeft: '8px', color: 'inherit', textDecoration: 'underline' },
                onClick: () => { void refreshCatalog(); },
              }, '重试刷新'),
            ) : null,
            h('div', { className: 'dshz-toolbar' },
              h('div', { className: 'dshz-counter' }, `已启用 ${enabledCount} 个区域 · 主调度必选`),
              h('div', { className: 'dshz-toolbar-actions' },
                h('button', {
                  type: 'button',
                  className: 'dshz-link',
                  onClick: () => { void refreshCatalog(); },
                  disabled: catalogLoading,
                }, catalogLoading ? '正在刷新…' : '刷新可用模型'),
              ),
            ),
            !hasAnyModel ? h('div', { className: 'dshz-empty' },
              h('div', null, h('strong', null, '还没有检测到可用模型。')),
              h('div', null, '请先打开 设置 → 模型，添加提供商并填写 API Key；回到这里点击“刷新可用模型”。'),
            ) : null,
            h('div', { className: 'dshz-grid' },
              draft.map((zone) => {
                const value = routeValue(zone);
                const options = [];
                let known = false;
                for (const group of catalogGroups) {
                  const children = [];
                  for (const model of group.models) {
                    const optionValue = `${group.id}\u001f${model.id}`;
                    if (optionValue === value) known = true;
                    const label = model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id;
                    children.push(h('option', { key: optionValue, value: optionValue }, label));
                  }
                  if (children.length > 0) {
                    options.push(h('optgroup', { key: group.id, label: `${group.name} (${group.id})` }, children));
                  }
                }
                if (value && !known) {
                  options.push(h('optgroup', { key: '__missing', label: '不可用' },
                    h('option', { value }, `不可用 · ${zone.provider} / ${zone.model}`),
                  ));
                }
                return h('div', {
                  key: zone.id,
                  className: `dshz-row${zone.enabled ? '' : ' is-off'}${zone.kind === 'main' ? ' is-main' : ''}`,
                },
                  h('div', { className: 'dshz-row-head' },
                    h('label', { className: 'dshz-switch', title: zone.kind === 'main' ? '主调度区域必须启用' : '启用或停用这个区域' },
                      h('input', {
                        type: 'checkbox',
                        checked: Boolean(zone.enabled),
                        disabled: zone.kind === 'main',
                        onChange: (event) => updateZone(zone.id, { enabled: event.target.checked }),
                        'aria-label': `启用${zone.name}`,
                      }),
                      h('span', { className: 'dshz-track' }),
                      h('span', { className: 'dshz-switch-label' }, zone.enabled ? '启用' : '停用'),
                    ),
                    h('div', { className: 'dshz-row-title' },
                      h('input', {
                        className: 'dshz-name',
                        value: zone.name,
                        maxLength: 40,
                        'aria-label': '区域显示名称',
                        onChange: (event) => updateZone(zone.id, { name: event.target.value }),
                      }),
                      h('span', { className: `dshz-badge${zone.kind === 'main' ? ' dshz-badge-main' : ''}` }, zone.kind === 'main' ? '必选' : (KIND_LABEL[zone.kind] || '自定义')),
                    ),
                    zone.kind === 'custom' ? h('button', {
                      type: 'button',
                      className: 'dshz-remove',
                      onClick: () => removeZone(zone.id),
                    }, '删除') : null,
                  ),
                  h('p', { className: 'dshz-desc' }, zone.description),
                  zone.kind === 'image' || zone.kind === 'video' ? h('p', { className: 'dshz-media-hint' },
                    zone.kind === 'image'
                      ? '会实际生成图片文件；请选择 qwen-image 等图像生成模型。Token Plan 需要 sk-sp- 套餐 Key。'
                      : '会实际生成视频文件；请选择 wan3.0-video 等视频生成模型。Token Plan 需要 sk-sp- 套餐 Key。',
                  ) : null,
                  h('div', { className: 'dshz-route' },
                    h('label', { className: 'dshz-label' }, '使用模型'),
                    h('select', {
                      className: 'dshz-select',
                      value,
                      disabled: !zone.enabled,
                      'aria-label': `${zone.name} 使用的模型`,
                      onChange: (event) => updateZone(zone.id, parseRouteValue(event.target.value)),
                    },
                      h('option', { value: '' }, '请选择模型'),
                      options,
                    ),
                  ),
                );
              }),
            ),
            h('button', { type: 'button', className: 'dshz-add', onClick: addCustomZone }, '+ 添加自定义区域'),
          ),
          h('div', { className: 'dshz-foot' },
            h('div', { className: 'dshz-foot-hint' }, '主调度模型会接管本会话的请求；其余区域由主调度通过 zone_dispatch 按需调用。'),
            h('div', { className: 'dshz-foot-actions' },
              forced ? null : h('button', {
                type: 'button',
                className: 'dshz-btn',
                onClick: () => setOpen(false),
              }, '取消'),
              h('button', {
                type: 'button',
                className: 'dshz-btn primary',
                onClick: () => { void save(); },
                disabled: saving || !hasAnyModel,
              }, saving ? '保存中…' : (forced ? '保存并开始' : '保存配置')),
            ),
          ),
        ),
      ) : null;

      return h('div', { className: 'dshz-root' },
        h('style', null, CSS),
        modal,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-bot-zones',
          order: 40,
        }, ZoneRouterDock));
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'dsh-bot-config-entry',
          order: 20,
        }, ConfigEntryButton));
      },
    };
  },
});
