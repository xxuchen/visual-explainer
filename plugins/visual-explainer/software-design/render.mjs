// Opt-in Chinese design report. Every display is derived from one JSON source.
import { indexDesign, labelFor } from './model.mjs';
import { renderDiagram } from './diagrams.mjs';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Only source HTTP(S) URLs become links; all surrounding source text remains escaped.
const sourceLinks = (value) => {
  const parts = String(value ?? '').split(/(https?:\/\/[^\s<>"'，。；）]+)/g);
  return parts.map((part) => {
    if (!/^https?:\/\//i.test(part)) return esc(part);
    try { const url = new URL(part); if (!url.hostname) return esc(part); }
    catch { return esc(part); }
    return `<a href="${esc(part)}" target="_blank" rel="noopener noreferrer">${esc(part)}</a>`;
  }).join('');
};

const list = (values, empty = '无；已明确不适用。') => values?.length ? `<ul>${values.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : `<p class="sd-muted">${esc(empty)}</p>`;
const statusNames = { passed: '已通过', failed: '未通过', skipped: '已跳过', 'not-run': '尚未执行' };
const badge = (status) => `<span class="sd-status sd-status-${esc(status ?? 'not-run')}">${esc(statusNames[status] ?? status ?? '尚未执行')}</span>`;
const table = (headers, rows, label) => `<div class="sd-table-wrap" tabindex="0" role="region" aria-label="${esc(label)}"><table><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const row = (cells, id = '') => `<tr${id ? ` id="${esc(id)}"` : ''}>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
const title = (id, text, note = '') => `<div class="sd-section-head"><h2 id="${id}">${esc(text)}</h2>${note ? `<p class="sd-muted">${esc(note)}</p>` : ''}</div>`;
const code = (value) => `<code>${esc(value)}</code>`;
const empty = (text) => `<p class="sd-muted">${esc(text)}</p>`;

const css = `
:root { color-scheme:light; --bg:#f3f6f7;--surface:#fff;--text:#193344;--text-dim:#536b7b;--border:#d5e0e5;--accent:#176b78;--accent-dim:#e6f2f3;--font-body:'Noto Sans CJK SC','Microsoft YaHei','PingFang SC','Segoe UI',sans-serif;--font-display:var(--font-body);--font-mono:'Cascadia Code','SFMono-Regular',Consolas,monospace; }
html { font-size:16px;scroll-behavior:smooth; }
body.sd-document { margin:0;background:#f3f6f7;color:#193344;font-family:var(--font-body);line-height:1.75; }
.sd-main { max-width:1280px;margin:auto;padding:48px 40px 100px;display:block; }
.sd-main > * + * { margin-top:40px; }
.sd-main h1 { max-width:none;font-size:clamp(1.7rem,3.7vw,2.8rem);line-height:1.35;letter-spacing:0;font-weight:700;text-wrap:wrap;margin:12px 0 18px; }
.sd-main h2 { font-size:1.5rem;line-height:1.4;letter-spacing:0;font-weight:650;margin:0;text-wrap:wrap; }
.sd-main h3 { font-size:1.07rem;font-weight:650;line-height:1.5;margin:0 0 10px; }
.sd-main p { max-width:none;margin:0;overflow-wrap:anywhere; }
.sd-main ul,.sd-main ol { margin:0;padding-left:1.4em;display:block;max-width:none; }
.sd-main li + li { margin-top:7px; }
.sd-main a { color:#116571;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere; }
.sd-main code { font-family:var(--font-mono);font-size:.87rem;overflow-wrap:anywhere;white-space:normal; }
.sd-main [id] { scroll-margin-top:20px; }
.sd-kicker { font-size:.8rem;letter-spacing:.08em;color:#426374;font-weight:650; }
.sd-lead { font-size:1.1rem;max-width:72ch!important; }
.sd-muted { color:#536b7b;font-size:.9rem; }
.sd-main .sd-muted + * { margin-top:10px; }
.sd-stats { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-top:28px; }
.sd-stat { background:#fff;border:1px solid #d5e0e5;border-radius:10px;padding:18px; }
.sd-stat strong { display:block;font-size:.95rem;margin-bottom:10px; }
.sd-stat p { margin-top:8px;font-size:.84rem;color:#536b7b; }
.sd-status { display:inline-block;max-width:100%;border:1px solid #b8cbd4;border-radius:4px;padding:2px 9px;font-size:.83rem;line-height:1.7;color:#435e6f;background:#f4f8fa;white-space:normal; }
.sd-status-passed { color:#17613f;border-color:#8fc3ac;background:#eef8f2; }
.sd-status-failed { color:#922d26;border-color:#d7a39f;background:#fff2f1; }
.sd-status-skipped { color:#7c5e16;border-color:#d5c294;background:#fff9e9; }
.sd-nav { display:flex;flex-wrap:wrap;gap:10px 22px;border-top:1px solid #cbd9e0;border-bottom:1px solid #cbd9e0;padding:16px 0;margin-top:28px; }
.sd-nav a { font-size:.92rem; }
.sd-section { border-top:1px solid #cbd9e0;padding-top:28px; }
.sd-section-head { display:flex;gap:14px 24px;justify-content:space-between;align-items:baseline;flex-wrap:wrap;margin-bottom:20px; }
.sd-section-head p { max-width:66ch!important; }
.sd-section > * + * { margin-top:20px; }
.sd-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px; }
.sd-panel { background:#fff;border:1px solid #d5e0e5;border-radius:10px;padding:22px;min-width:0; }
.sd-panel > * + * { margin-top:14px; }
.sd-panel h3 { margin:0; }
.sd-id { color:#536b7b;font-family:var(--font-mono);font-size:.8rem;display:block;margin-bottom:7px;overflow-wrap:anywhere; }
.sd-table-wrap { overflow:auto;max-width:100%;background:#fff;border:1px solid #d5e0e5;border-radius:8px; }
.sd-table-wrap table { width:100%;min-width:600px;border-collapse:collapse;font-size:.9rem;text-align:left; }
.sd-table-wrap th { color:#3c596b;font-size:.84rem;font-weight:650;background:#edf3f6; }
.sd-table-wrap th,.sd-table-wrap td { padding:14px 16px;border-bottom:1px solid #dce5ea;vertical-align:top;min-width:110px;overflow-wrap:anywhere; }
.sd-table-wrap tr:last-child td { border-bottom:0; }
.sd-table-wrap td:first-child { min-width:145px; }
.sd-table-wrap td p + p { margin-top:8px; }
.sd-refs { display:flex;flex-wrap:wrap;gap:5px 10px; }
.sd-ref { font-family:var(--font-mono);font-size:.8rem; }
.sd-diagram { background:#fff;border:1px solid #cfdee6;border-radius:10px;margin:0;padding:20px; }
.sd-diagram + .sd-diagram { margin-top:24px; }
.sd-diagram figcaption { margin:0 0 16px;line-height:1.65;display:block;font-family:var(--font-body);font-size:1rem;color:#193344;max-width:none; }
.sd-diagram figcaption strong { display:block;font-size:1.08rem; }
.sd-diagram figcaption p { margin-top:6px; }
.sd-diagram-scroll { width:100%;overflow:auto;border:1px solid #e1e9ed;border-radius:6px; }
.sd-svg { display:block;max-width:none;height:auto; }
.sd-svg text { font-family:'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif; }
.sd-facts { display:grid;grid-template-columns:90px minmax(0,1fr);gap:12px 16px;margin:0; }
.sd-facts dt { font-size:.84rem;font-weight:650;color:#536b7b; }
.sd-facts dd { margin:0;overflow-wrap:anywhere;min-width:0; }
.sd-pre { white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;background:#f2f6f8;border:1px solid #d7e3e9;border-radius:6px;padding:14px;font-size:.85rem;line-height:1.65;margin:0; }
.sd-callout { padding:18px 20px;border:1px solid #d5c294;border-radius:8px;background:#fffbef; }
.sd-error { border-color:#d7a39f;background:#fff4f2; }
.sd-detail summary { cursor:pointer;color:#116571;font-weight:650; }
.sd-detail[open] > * + * { margin-top:14px; }
.sd-toolbar { display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px; }
.sd-toolbar input { min-width:0;max-width:100%;width:360px;border:1px solid #a8bdc8;border-radius:6px;padding:10px 12px;background:#fff;color:#193344;font:inherit;font-size:.9rem; }
.sd-main .sd-section:first-of-type { margin-top:32px; }
.sd-footer { color:#536b7b;font-size:.84rem;border-top:1px solid #cbd9e0;padding-top:22px; }
@media(max-width:720px) { .sd-main { padding:28px 18px 70px; } .sd-stats { grid-template-columns:repeat(2,minmax(0,1fr));gap:10px; } .sd-grid { grid-template-columns:1fr; } .sd-panel { padding:17px; } .sd-diagram { padding:14px; } .sd-section-head { display:block; } .sd-section-head p { margin-top:8px; } .sd-facts { grid-template-columns:1fr;gap:5px; } .sd-facts dd + dt { margin-top:10px; } }
@media print { body.sd-document { background:#fff; } .sd-main { max-width:none;padding:0; } .sd-main > * + * { margin-top:24px; } .sd-nav,.sd-toolbar { display:none; } .sd-panel,.sd-diagram { break-inside:avoid; } .sd-diagram-scroll { overflow:visible; } .sd-svg { min-width:0!important;max-width:100%;height:auto; } .sd-table-wrap { overflow:visible; } .sd-table-wrap table { min-width:0; } }
`;

export function renderDesignSource(spec, validation) {
  const index = indexDesign(spec);
  const refs = (ids) => ids?.length ? `<span class="sd-refs">${ids.map((id) => index.has(id) ? `<a class="sd-ref" href="#${esc(id)}" title="${esc(labelFor(index.get(id)))}">${esc(id)}</a>` : code(id)).join('')}</span>` : '<span class="sd-muted">—</span>';
  const refName = (id) => index.has(id) ? `<a href="#${esc(id)}">${esc(labelFor(index.get(id)))} <span class="sd-ref">${esc(id)}</span></a>` : code(id);
  const identity = (item) => `<span class="sd-id">${esc(item.id)}</span><strong>${esc(labelFor(item))}</strong>`;
  const phase = validation?.phase ?? 'design';
  const staticCheck = validation?.pageChecks?.static ?? { status: 'not-run' };
  const browserCheck = validation?.pageChecks?.browser ?? { status: 'not-run' };
  const briefReason = (reason, fallback) => {
    const first = String(reason ?? '').split(/\r?\n/).find((line) => line.trim())?.trim();
    if (!first) return fallback;
    const chars = Array.from(first);
    return chars.length > 150 ? chars.slice(0, 150).join('') + '…（完整记录见下方）' : first;
  };
  const pageCheckRecords = [
    ['HTML 静态检查', staticCheck], ['浏览器页面检查', browserCheck],
  ].filter(([, check]) => check.reason || check.errors?.length);
  const pageCheckDetails = pageCheckRecords.length ? `<details class="sd-panel sd-detail" id="sd-page-checks"><summary>页面检查记录（完整输出）</summary>${pageCheckRecords.map(([name, check]) => `<div><h3>${name} ${badge(check.status)}</h3>${check.reason ? `<pre class="sd-pre">${esc(check.reason)}</pre>` : ''}${check.errors?.length ? list(check.errors.map((error) => typeof error === 'string' ? error : [error.code, error.message].filter(Boolean).join(': '))) : ''}</div>`).join('')}</details>` : '';
  const evidenceFor = (id) => validation?.evidence instanceof Map ? validation.evidence.get(id) : validation?.evidence?.[id];
  const acceptance = spec.acceptance ?? [];
  const passed = acceptance.filter((ac) => ac.verification?.status === 'passed' && evidenceFor(ac.id)?.ok).length;
  const failed = acceptance.filter((ac) => ac.verification?.status === 'failed').length;
  const businessStatus = failed ? 'failed' : acceptance.length && passed === acceptance.length ? 'passed' : 'not-run';
  const nav = [['sd-scope','目标与边界'],['sd-model','术语与系统'],['sd-requirements','需求与规则'],['sd-diagrams','设计图'],['sd-interfaces','接口与数据'],['sd-states','状态模型'],['sd-decisions','决策与风险'],['sd-quality','质量目标'],['sd-delivery','实施与回滚'],['sd-acceptance','验收与证据'],['sd-traceability','追踪矩阵']];

  const findings = (validation?.errors ?? []).concat(validation?.warnings ?? []);
  const findingBlock = findings.length ? `<div class="sd-callout${validation?.ok ? '' : ' sd-error'}"><h3>结构检查记录</h3>${table(['位置','检查项','结果'],findings.map((f) => row([code(f.path ?? ''),code(f.code),esc(f.message)])),'结构检查记录')}</div>` : '';

  const scope = `<section class="sd-section">${title('sd-scope','目标、范围与假设')}<div class="sd-grid"><article class="sd-panel"><h3>交付目标</h3>${list(spec.scope?.goals)}</article><article class="sd-panel"><h3>本次范围</h3>${list(spec.scope?.in)}</article><article class="sd-panel"><h3>范围之外</h3>${list(spec.scope?.out,'无额外范围排除。')}</article><article class="sd-panel"><h3>待确认假设</h3>${list(spec.scope?.assumptions,'当前未声明待确认假设；仍需业务与架构评审。')}</article></div></section>`;

  const model = `<section class="sd-section">${title('sd-model','术语与系统职责','表格、接口、图与验收复用同一组标识与名称。')}<h3>统一术语</h3>${table(['标识 / 术语','定义'],(spec.terms ?? []).map((item) => row([identity(item),esc(item.definition)],item.id)),'统一术语')}<h3>参与者与组件</h3>${table(['标识 / 组件','类型','职责'],(spec.components ?? []).map((item) => row([identity(item),esc({actor:'参与者',service:'服务',external:'外部系统',store:'存储'}[item.kind] ?? item.kind),esc(item.responsibility)],item.id)),'参与者与组件')}</section>`;

  const requirements = `<section class="sd-section">${title('sd-requirements','需求、业务规则与依据')}<h3>需求</h3>${table(['需求 / 优先级','要求','业务规则','验收'],(spec.requirements ?? []).map((item) => row([`${identity(item)}<p>${code(item.priority)}</p>`,esc(item.text),refs(item.ruleIds),refs(item.acceptanceIds)],item.id)),'需求')}<h3>业务规则</h3>${table(['规则','内容与依据','关联对象'],(spec.rules ?? []).map((item) => row([identity(item),`<p>${esc(item.text)}</p><p class="sd-muted">${esc({fact:'事实依据',assumption:'待确认假设',decision:'设计决策'}[item.basis] ?? item.basis)}：${sourceLinks(item.source)}</p>`,refs(item.refs)],item.id)),'业务规则')}</section>`;

  const diagrams = `<section class="sd-section">${title('sd-diagrams','从边界、流程到状态的设计图','图中编号对应完整箭头说明；窄屏可在图框内横向滚动。')}${(spec.diagrams ?? []).map((item) => `<figure class="sd-diagram" id="${esc(item.id)}" data-sd-diagram="${esc(item.type)}"><figcaption><span class="sd-id">${esc(item.id)} · ${esc({context:'系统上下文',flow:'业务流程',state:'状态迁移',sequence:'交互时序',er:'数据关系'}[item.type] ?? item.type)}</span><strong>${esc(item.title)}</strong><p>${esc(item.purpose)}</p></figcaption><div class="sd-diagram-scroll" tabindex="0" role="region" aria-label="${esc(item.title)}，可横向滚动">${renderDiagram(item,index)}</div></figure>`).join('')}</section>`;

  const interfaces = `<section class="sd-section">${title('sd-interfaces','接口契约与数据约束')}<h3>接口</h3>${(spec.apis ?? []).length ? (spec.apis ?? []).map((item) => `<article class="sd-panel" id="${esc(item.id)}"><h3>${identity(item)}</h3><p>${code(`${item.method} ${item.path}`)}</p><dl class="sd-facts"><dt>所属组件</dt><dd>${refName(item.owner)}</dd><dt>业务规则</dt><dd>${refs(item.ruleIds)}</dd><dt>数据 / 迁移</dt><dd>${refs([...(item.dataIds ?? []),...(item.transitionIds ?? [])])}</dd><dt>请求</dt><dd><pre class="sd-pre">${esc(item.request)}</pre></dd><dt>响应</dt><dd><pre class="sd-pre">${esc(item.response)}</pre></dd></dl>${item.errors?.length ? table(['异常代码','触发条件','处理方式'],item.errors.map((e) => row([code(e.code),esc(e.condition),esc(e.handling)])),`${item.title}异常`) : empty('此接口未声明异常；评审时确认是否适用。')}</article>`).join('') : empty('本方案无新增接口。')}<h3>数据对象</h3>${(spec.data ?? []).length ? (spec.data ?? []).map((item) => `<article class="sd-panel" id="${esc(item.id)}"><h3>${identity(item)}</h3><p>统一术语：${refName(item.termId)}</p>${table(['字段','类型','必填','含义'],(item.fields ?? []).map((field) => row([code(field.name),code(field.type),field.required ? '是' : '否',esc(field.description)])),`${item.title}字段`)}<h3>约束</h3>${list(item.constraints)}</article>`).join('') : empty('本方案无新增数据对象。')}</section>`;

  const states = `<section class="sd-section">${title('sd-states','状态及迁移规则','状态图直接引用以下定义；迁移与接口及验收按 ID 关联。')}${(spec.states ?? []).length ? `${table(['状态','所属对象','起止属性'],(spec.states ?? []).map((item) => row([identity(item),refName(item.dataId),[item.initial?'初始状态':'',item.terminal?'终态':''].filter(Boolean).join(' · ') || '中间状态'],item.id)),'状态定义')}${table(['迁移','起点 → 终点','事件 / 条件 / 动作','业务规则'],(spec.transitions ?? []).map((item) => row([identity(item),`${refName(item.from)}<br>→ ${refName(item.to)}`,`<p>事件：${esc(item.event)}</p><p>条件：${esc(item.guard)}</p><p>动作：${esc(item.action)}</p>`,refs(item.ruleIds)],item.id)),'状态迁移')}` : empty('本方案不包含有生命周期的状态对象。')}</section>`;

  const decisions = `<section class="sd-section">${title('sd-decisions','决策、备选方案与风险')}<h3>设计决策</h3><div class="sd-grid">${(spec.decisions ?? []).map((item) => `<article class="sd-panel" id="${esc(item.id)}"><h3>${identity(item)}</h3><dl class="sd-facts"><dt>候选方案</dt><dd>${list(item.options)}</dd><dt>选择</dt><dd>${esc(item.choice)}</dd><dt>理由</dt><dd>${esc(item.rationale)}</dd><dt>关联</dt><dd>${refs(item.refs)}</dd></dl></article>`).join('')}</div><h3>风险与责任</h3>${table(['风险','影响','应对措施','责任 / 关联'],(spec.risks ?? []).map((item) => row([identity(item),esc(item.impact),esc(item.mitigation),`<p>${esc(item.owner)}</p>${refs(item.refs)}`],item.id)),'风险')}</section>`;

  const quality = `<section class="sd-section">${title('sd-quality','可度量的质量目标')}${table(['质量项','目标','测量方法','验收'],(spec.quality ?? []).map((item) => row([identity(item),esc(item.target),esc(item.measurement),refs(item.acceptanceIds)],item.id)),'质量目标')}</section>`;

  const delivery = `<section class="sd-section">${title('sd-delivery','实施、迁移、回滚与观测')}<div class="sd-grid">${[['implementation','实施步骤'],['migration','数据 / 接口迁移'],['rollback','回滚条件与步骤'],['monitoring','上线观测']].map(([key,label]) => `<article class="sd-panel"><h3>${label}</h3>${list(spec.delivery?.[key])}</article>`).join('')}</div></section>`;

  const evidenceBlock = (item) => {
    const verification = item.verification ?? {status:'not-run'}, verified = evidenceFor(item.id);
    const receipt = verified?.receipt ?? verified;
    let out = `<p>${badge(verification.status)}${verification.reason ? ` ${esc(verification.reason)}` : ''}</p>`;
    if (verification.status === 'passed' || verification.status === 'failed') {
      out += `<p class="sd-muted">证据校验：${verified?.ok ? '已通过完整性与方案版本检查' : '尚未确认；执行状态仅为声明'}</p>`;
      if (verification.receipt) out += `<p>回执：${code(verification.receipt)}</p>`;
      if (receipt?.command) out += `<pre class="sd-pre">${esc(receipt.command.map((arg) => JSON.stringify(arg)).join(' '))}</pre>`;
      if (receipt && 'exitCode' in receipt) out += `<dl class="sd-facts"><dt>退出码</dt><dd>${code(receipt.exitCode ?? 'null')}${receipt.signal ? ` · ${code(receipt.signal)}` : ''}</dd><dt>工作目录</dt><dd>${code(receipt.cwd)}</dd><dt>开始 / 完成</dt><dd>${esc(receipt.startedAt)}<br>${esc(receipt.finishedAt)}</dd><dt>日志 / SHA256</dt><dd>${code(receipt.log)}<br>${code(receipt.logSha256)}</dd><dt>方案摘要</dt><dd>${code(receipt.specDigest)}</dd></dl>`;
      if (verified?.errors?.length) out += list(verified.errors);
    }
    return out;
  };
  const acceptanceBlock = `<section class="sd-section">${title('sd-acceptance','验收场景与实际执行证据','方案结构检查、业务测试和页面检查分别记录。每个通过声明都需要与当前方案匹配的执行回执。')}${acceptance.map((item) => `<article class="sd-panel" id="${esc(item.id)}"><h3>${identity(item)}</h3><dl class="sd-facts"><dt>前提 Given</dt><dd>${esc(item.given)}</dd><dt>动作 When</dt><dd>${esc(item.when)}</dd><dt>预期 Then</dt><dd>${esc(item.then)}</dd><dt>需求</dt><dd>${refs(item.requirementIds)}</dd><dt>覆盖对象</dt><dd>${refs(item.refs)}</dd></dl>${evidenceBlock(item)}</article>`).join('')}</section>`;

  const traceRows = (validation?.traceability ?? []).map((item) => `<tr data-sd-trace>${[refs([item.requirementId]),refs(item.ruleIds),refs(item.diagramIds),refs(item.apiIds),refs(item.dataIds),refs(item.acceptanceIds)].map((cell) => `<td>${cell}</td>`).join('')}</tr>`);
  const traceability = `<section class="sd-section">${title('sd-traceability','需求到验收的追踪矩阵')}<div class="sd-toolbar"><label for="sd-trace-filter">按 ID 筛选</label><input id="sd-trace-filter" type="search" placeholder="如 REQ-submit、API-create" autocomplete="off"><span class="sd-muted" id="sd-trace-count" aria-live="polite">${traceRows.length} 条需求</span></div>${table(['需求','规则','设计图','接口','数据','验收'],traceRows,'需求追踪矩阵')}<p class="sd-muted">引用闭合与覆盖检查由脚本完成；业务正确性、风险接受及待确认假设需由相关责任人评审。</p></section>`;

  const embedded = JSON.stringify(spec).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return `<!doctype html>
<html lang="zh-CN" data-register="paper" data-sd-profile="1">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(spec.title)} · 软件方案</title><link rel="stylesheet" href="kit.css" data-ve-kit><style data-sd-style>${css}</style></head>
<body class="sd-document"><main class="sd-main"><header id="${esc(spec.id)}"><p class="sd-kicker">SOFTWARE DESIGN · 方案模型 V${esc(spec.schemaVersion)} · ${phase === 'delivery' ? '交付检查' : '设计评审'}</p><h1>${esc(spec.title)}</h1><p class="sd-lead">${esc(spec.summary)}</p><div class="sd-stats"><div class="sd-stat"><strong>方案结构与覆盖</strong>${badge(validation?.ok ? 'passed' : 'failed')}<p>${esc(spec.id)} · ${validation?.errors?.length ?? 0} 项错误</p></div><div class="sd-stat"><strong>业务验收执行</strong>${badge(businessStatus)}<p>${passed} / ${acceptance.length} 项通过且证据有效</p></div><div class="sd-stat"><strong>HTML 静态检查</strong>${badge(staticCheck.status)}<p>${esc(briefReason(staticCheck.reason, '资源、标识、锚点和图完整性'))}</p></div><div class="sd-stat"><strong>浏览器页面检查</strong>${badge(browserCheck.status)}<p>${esc(briefReason(browserCheck.reason, '独立检查窄屏、中文标签和脚本错误'))}</p></div></div>${pageCheckDetails}<nav class="sd-nav" aria-label="方案目录">${nav.map(([id,label]) => `<a href="#${id}">${label}</a>`).join('')}</nav></header>${findingBlock}${scope}${model}${requirements}${diagrams}${interfaces}${states}${decisions}${quality}${delivery}${acceptanceBlock}${traceability}<footer class="sd-footer"><p>Visual Explainer · 可选软件方案模式。文档从单一结构化模型生成，图、表和验收共享稳定 ID。页面可离线阅读；执行回执由源文件所在目录中的证据文件核验。</p></footer></main><script type="application/json" id="sd-source">${embedded}</script><script data-sd-script>
(() => {
  const input = document.getElementById('sd-trace-filter');
  const rows = [...document.querySelectorAll('[data-sd-trace]')];
  input?.addEventListener('input', () => {
    const query = input.value.trim().toLocaleLowerCase();
    let count = 0;
    for (const row of rows) { row.hidden = !row.textContent.toLocaleLowerCase().includes(query); if (!row.hidden) count++; }
    document.getElementById('sd-trace-count').textContent = count + ' 条需求';
  });
  document.documentElement.dataset.sdReady = 'ready';
})();
</script></body></html>`;
}
