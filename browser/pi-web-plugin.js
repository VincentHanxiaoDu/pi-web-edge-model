/** Machine-scoped mobile page. Technical controls stay behind one model's Manage button. */
import { title, variant, engine, context as ctxWords, rank } from './presentation.js';
export default {
  apiVersion: 2, name: '本机模型',
  activate({ html, svg, ui, callOperation }) {
    let data = null, failure = null, notice = null, reading = false, busy = false;
    let host, machineKey, epoch = 0, disposed = false, lastShown = 0, managing = null, downloading = false, settings = false, experiments = false;
    const fields = { repo: '', file: '', quantize: false, backend: 'npu', contextWindow: 8192 };
    const contexts = {};
    const redraw = () => { if (!disposed) host?.requestRender(); };
    async function refresh() {
      if (reading || !callOperation) return;
      const scope = epoch; reading = true;
      try {
        const answer = await callOperation('status', {});
        if (!disposed && scope === epoch) { data = answer; failure = null; }
      } catch (err) { if (scope === epoch) failure = String(err.message ?? err); }
      finally { if (scope === epoch) { reading = false; redraw(); } }
    }
    async function act(operation, input = {}) {
      if (busy || data?.control) return;
      const scope = epoch; busy = true; notice = null; redraw();
      try {
        const answer = await callOperation(operation, input);
        if (answer?.ok === false) throw new Error(answer.message);
        if (scope === epoch) notice = answer?.pending ? '正在处理，可稍后查看状态。' : '已保存';
      } catch (err) { if (scope === epoch) notice = String(err.message ?? err); }
      finally { if (scope === epoch) { busy = false; await refresh(); redraw(); } }
    }
    async function remove(model) {
      if (!ui.confirm) return;
      const yes = await ui.confirm({ title: `删除 ${title(model)}？`, message: `将永久删除手机上的 ${model.sizeLabel} 模型文件，并从 Pi 移除。此操作无法撤销。`, confirmLabel: '删除模型', tone: 'danger' });
      if (yes) { managing = null; await act('model.delete', { id: model.id, confirmation: model.name }); }
    }
    const timer = setInterval(() => { if (Date.now() - lastShown < 15000) void refresh(); }, 5000);
    function modelCard(m, disabled) {
      const toggle = () => { managing = managing === m.id ? null : m.id; redraw(); };
      const list = ui.renderList({ read: 'ready', words: { empty: '', reading: '', failed: '', stale: '' }, groups: [{ id: m.id,
        rows: [{ id: m.id, title: title(m), status: { label: m.resident ? '已加载' : variant(m), tone: m.resident ? 'good' : variant(m) === '去审查版' ? 'attention' : 'neutral' },
          detail: `${engine(m)} · ${m.sizeLabel} · ${ctxWords(m.contextWindow)}` }],
        actions: [{ id: 'use', label: m.resident ? '卸载' : '使用', primary: !m.resident, disabled, run: () => void act(m.resident ? 'model.unload' : 'model.load', { id: m.id }) },
          { id: 'manage', label: managing === m.id ? '收起' : '管理', disabled, run: toggle }],
      }] });
      return html`<div class="em-card">${list}${managing === m.id ? html`
        <section class="em-manager" aria-label=${`${title(m)}管理`}>
          <p class="em-file">${m.name}</p>
          ${m.note ? html`<p class="em-warning">此 LiteRT 实验模型的长提示测试失败，不建议接入 Pi。</p>` : ''}
          ${m.benchmark ? html`<p>最近测速：输入 ${m.benchmark.prefill.toFixed(0)} · 生成 ${m.benchmark.decode.toFixed(1)} tok/s</p>` : ''}
          <label class="em-context">上下文 <input aria-label=${`${m.name} context tokens`} type="number" min="256" max="32768" .value=${String(contexts[m.id] ?? m.contextWindow)} @input=${(e) => { contexts[m.id] = e.target.value; }} /><button ?disabled=${disabled} @click=${() => act('model.update', { id: m.id, contextWindow: Number(contexts[m.id] ?? m.contextWindow) })}>保存</button></label>
          <div class="em-tools"><button ?disabled=${disabled} @click=${() => act('model.update', { id: m.id, inPi: !m.inPi })}>${m.inPi ? '从 Pi 隐藏' : '加入 Pi 列表'}</button>
            <button ?disabled=${disabled} @click=${() => act('bench.start', { id: m.id })}>测速</button>
            <button class="em-danger" ?disabled=${disabled || !ui.confirm} @click=${() => remove(m)}>删除</button></div>
        </section>` : ''}</div>`;
    }
    function downloadForm(disabled) {
      const set = (key) => (e) => { fields[key] = key === 'quantize' ? e.target.checked : e.target.value; };
      return html`<form class="em-form" @submit=${(e) => { e.preventDefault(); void act('download.start', { ...fields, contextWindow: Number(fields.contextWindow) }); }}>
        <label>HuggingFace 仓库<input required .value=${fields.repo} @input=${set('repo')} placeholder="owner/model-name" /></label>
        <label>模型文件名<input required .value=${fields.file} @input=${set('file')} placeholder="model-Q4_0.gguf" /></label>
        <div class="em-form-pair"><label>上下文 token<input type="number" min="256" max="32768" .value=${String(fields.contextWindow)} @input=${set('contextWindow')} /></label>
          <label>LiteRT 后端<select .value=${fields.backend} @change=${set('backend')}><option value="npu">NPU</option><option value="gpu">GPU</option></select></label></div>
        <label class="em-check"><input type="checkbox" .checked=${fields.quantize} @change=${set('quantize')} />将 GGUF 转为 Q4_0</label>
        <p class="em-muted">只支持公开文件，不需要密钥。GGUF 默认使用 Hexagon；LiteRT 的 NPU 文件必须与芯片匹配。转换有精度损失，并需要临时存储空间。</p>
        <button class="em-primary" type="submit" ?disabled=${disabled || !data}>开始下载</button>
      </form>`;
    }
    function render(ctx) {
      lastShown = Date.now(); host = ctx.host;
      if (machineKey !== ctx.machine.id) {
        machineKey = ctx.machine.id; epoch++; data = null; failure = null; reading = false; managing = null;
        queueMicrotask(refresh);
      }
      if (!callOperation || !ui?.renderList) return html`<p>请更新 PI WEB 后使用本机模型管理。</p>`;
      const disabled = busy || Boolean(data?.control) || Boolean(failure);
      const normal = (data?.models ?? []).filter((m) => !m.note).sort((a, b) => rank(a) - rank(b));
      const experimental = (data?.models ?? []).filter((m) => m.note);
      const alert = failure || data?.lastError || notice;
      return html`<style>
        .em-page{font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;width:100%;max-width:760px;box-sizing:border-box;margin:auto;padding:16px;--em-line:color-mix(in srgb,currentColor 14%,transparent);--em-soft:color-mix(in srgb,currentColor 4%,transparent)}
        .em-page *{box-sizing:border-box}.em-page button,.em-page input,.em-page select{font:inherit;color:inherit;border:1px solid var(--em-line);border-radius:10px;background:transparent;min-height:44px;padding:8px 12px;max-width:100%}
        .em-page button{cursor:pointer;font-weight:550}.em-page button:disabled{opacity:.45;cursor:default}.em-page button:focus-visible,.em-page input:focus-visible,.em-page select:focus-visible{outline:2px solid #738aeb;outline-offset:2px}
        .em-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.em-head h2{font:700 23px/1.25 system-ui;margin:0}.em-head p{margin:5px 0 0;opacity:.65;font-size:12px}.em-toolbar{display:flex;gap:8px;flex-shrink:0}
        .em-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}.em-stat{padding:12px 10px;border-radius:12px;background:var(--em-soft);min-width:0}.em-stat span{display:block;font-size:11px;opacity:.65}.em-stat strong{font-weight:650;font-size:14px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}
        .em-section-title{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:20px 0 10px}.em-section-title h3{font:600 15px/1.4 system-ui;margin:0}.em-count{opacity:.6;font-size:12px}.em-card{overflow:hidden;margin:0 0 12px}
        .em-card pi-web-plugin-list{padding:0;font:14px/1.5 system-ui;--pi-font-ui:system-ui;--pi-text-sm:14px;--pi-text-xs:12px;--pi-control-height-comfort:44px;--pi-control-height-touch:44px;--pi-radius-lg:14px;--pi-radius-md:9px;--pi-border:var(--em-line);--pi-border-muted:var(--em-line);--pi-surface:var(--em-soft);--pi-surface-raised:transparent;--pi-accent:#6878d8;--pi-accent-border:#8c98df}
        .em-manager{padding:14px 16px!important;border-top:1px solid var(--em-line);font-size:13px}.em-file{font:11px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;opacity:.65;margin:0 0 12px}.em-context{display:flex;align-items:center;gap:8px}.em-context input{width:100px;min-width:0;flex:1}.em-tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.em-tools button{flex:1;white-space:nowrap;font-size:12px}.em-danger{color:#ba4c49!important}
        .em-alert{padding:12px;border-radius:10px;border:1px solid var(--em-line);margin:12px 0;overflow-wrap:anywhere;font-size:12px}.em-muted{font-size:12px;opacity:.65}.em-warning{color:#a77933;font-size:12px}.em-busy{padding:10px 0;font-size:12px;opacity:.7}.em-empty{padding:30px;text-align:center;opacity:.65}
        .em-form{display:grid;gap:12px;margin:12px 0 20px;padding:16px;border:1px solid var(--em-line);border-radius:14px}.em-form label{display:grid;gap:6px;font-size:12px}.em-form input,.em-form select{width:100%}.em-form-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.em-form .em-check{display:flex;align-items:center;gap:8px;min-height:44px}.em-check input{width:22px;height:22px;min-height:22px}.em-form p{margin:0}.em-primary{background:var(--em-soft)!important}
        .em-settings{padding:14px;border:1px solid var(--em-line);border-radius:12px;margin-top:10px}.em-settings p{font-size:12px;opacity:.7;overflow-wrap:anywhere}.em-settings .em-tools button{white-space:normal}.em-jobs .group{margin:0!important}.em-footer{margin:20px 0 0;text-align:center;font-size:11px;opacity:.5}
        @media(min-width:650px){.em-cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}.em-card{margin:0;align-self:start}.em-stats{gap:14px}.em-stat{padding:14px}}
      </style><div class="em-page">
        <header class="em-head"><div><h2>本机模型</h2><p>手机本地推理 · 不经过云端</p></div><div class="em-toolbar"><button aria-label="刷新状态" ?disabled=${reading} @click=${refresh}>刷新</button><button aria-expanded=${downloading} @click=${() => { downloading = !downloading; redraw(); }}>＋ 下载</button></div></header>
        ${downloading ? downloadForm(disabled) : ''}
        <div class="em-stats"><div class="em-stat"><span>ADB 连接</span><strong>${failure ? '暂不可用' : data ? '已连接' : '读取中'}</strong></div><div class="em-stat"><span>可用内存</span><strong>${data?.device.memory.availableLabel ?? '—'}</strong></div><div class="em-stat"><span>剩余存储</span><strong>${data?.device.space.freeLabel ?? '—'}</strong></div></div>
        ${alert ? html`<div class="em-alert" role="status">${alert}</div>` : ''}
        ${data?.control || data?.gateway.activity ? html`<div class="em-busy" role="status">${data.control ?? data.gateway.activity}</div>` : ''}
        <div class="em-section-title"><h3>已安装</h3><span class="em-count">${normal.length} 个模型</span></div>
        <div class="em-cards">${normal.map((m) => modelCard(m, disabled))}</div>
        ${!data ? html`<div class="em-empty">${failure ? '无法读取手机，点击刷新重试。' : '正在读取模型…'}</div>` : ''}
        ${experimental.length ? html`<div class="em-section-title"><button aria-expanded=${experiments} @click=${() => { experiments = !experiments; redraw(); }}>实验模型 (${experimental.length}) ${experiments ? '收起' : '展开'}</button></div>${experiments ? html`<p class="em-warning">这些模型的长提示在此手机上测试失败，默认不加入 Pi。</p><div class="em-cards">${experimental.map((m) => modelCard(m, disabled))}</div>` : ''}` : ''}
        ${data?.jobs.length ? html`<div class="em-section-title"><h3>任务</h3></div><div class="em-jobs">${ui.renderList({ read: 'ready', words: { empty: '', reading: '', failed: '', stale: '' }, groups: [{ id: 'jobs', rows: data.jobs.map((j) => ({ id: j.id, title: j.file,
          status: { label: ({ queued:'排队中',downloading:'下载中',pushing:'传输中',quantizing:'转换中',running:'测速中',done:'完成',failed:'失败',cancelled:'已取消' })[j.state] ?? j.state, tone: j.state === 'failed' ? 'problem' : j.state === 'done' ? 'good' : 'neutral' },
          detail: j.error || j.registrationError || (j.result ? `输入 ${j.result.prefill.toFixed(0)} · 生成 ${j.result.decode.toFixed(1)} tok/s` : j.total ? `${(j.bytes / 1048576).toFixed(0)} / ${(j.total / 1048576).toFixed(0)} MiB` : j.step) })),
          actions: data.jobs.filter(j=>j.state==='downloading').map(j=>({id:j.id,label:'取消下载',disabled,run:()=>act('download.cancel',{id:j.id})})) }] })}</div>` : ''}
        <div class="em-section-title"><button aria-expanded=${settings} @click=${() => { settings = !settings; redraw(); }}>服务设置 ${settings ? '收起' : '展开'}</button></div>
        ${settings ? html`<section class="em-settings"><p>网关 127.0.0.1:${data?.gateway.port ?? 9390} · provider: litert</p><p>按请求加载模型，同一时间只保留一个引擎。手机调试连接重启时会自动恢复。</p><div class="em-tools"><button ?disabled=${disabled} @click=${()=>act('provider.sync')}>同步 Pi 列表</button><button ?disabled=${disabled} @click=${()=>act('model.unload')}>卸载全部</button><button ?disabled=${disabled} @click=${()=>act('script.install')}>安装启动脚本</button></div></section>` : ''}
        <p class="em-footer">Edge Model · llama.cpp / LiteRT</p>
      </div>`;
    }
    return { contributions: { globalPanels: [{ id: 'global.models', title: '本机模型', order: 60,
      icon: svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>`, render }] },
      dispose() { disposed = true; clearInterval(timer); epoch++; host = null; } };
  },
};
