// Compact review HTML. The full model and traceability stay in the JSON and
// checks report. No collapsed appendix, duplicated source JSON or audit tables.
import { indexDesign } from './model.mjs';
import { renderDiagram } from './diagrams.mjs';
import { reviewDiagrams } from './review.mjs';
import { renderBusinessRows } from './business-flow.mjs';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const names = {passed:'通过',failed:'失败',skipped:'跳过','not-run':'未执行'};
const status = (value) => esc(names[value] || '未执行');
const css = `
:root{color-scheme:light;--bg:#f4f6f8;--surface:#fff;--text:#193344;--text-dim:#536b7b;--border:#d5e0e5;--accent:#176b78;--font-body:"Noto Sans CJK SC","Microsoft YaHei","PingFang SC","Segoe UI",sans-serif;--font-display:var(--font-body)}
html{font-size:16px}body.sd-document{background:var(--bg);color:var(--text);font-family:var(--font-body);line-height:1.6}
.sd-main{max-width:1040px;margin:auto;padding:28px 28px 40px;display:block}
.sd-main> *+*{margin-top:20px}
.sd-main header{display:block;padding:0}
.sd-main h1{font-size:clamp(1.45rem,3.5vw,2rem);font-family:var(--font-body);font-weight:700;max-width:none;line-height:1.35;letter-spacing:0;text-wrap:wrap;margin:0 0 10px}
.sd-main h2{font-size:1.05rem;font-family:var(--font-body);line-height:1.4;letter-spacing:0;text-wrap:wrap;margin:0 0 8px;font-weight:650}
.sd-main p{max-width:none;margin:0;overflow-wrap:anywhere}
.sd-kicker{font-size:.75rem;color:var(--text-dim);font-weight:600;margin-bottom:7px!important}
.sd-lead{font-size:1rem;color:#354d5c;margin-bottom:18px!important}
.sd-business{margin:0 0 16px;min-width:0}
.sd-business-row{border:1px solid var(--border);background:white;padding:10px 13px;border-radius:6px;margin-top:8px}
.sd-business-row h3{font-size:.95rem;margin:0 0 5px}
.sd-business-row p{font-size:.91rem;margin:3px 0}
.sd-review-points{display:grid;gap:0;background:#fff;border:1px solid var(--border);border-radius:7px;min-width:0}
.sd-review-point{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;padding:11px 14px;align-items:start;min-width:0}
.sd-review-point+ .sd-review-point{border-top:1px solid #e3e9ee}
.sd-review-point strong{font-size:.94rem;overflow-wrap:anywhere}
.sd-review-point p{font-size:.94rem}
.sd-review-pending{margin-top:16px;padding:12px 14px;background:#fff;border:1px solid #d5e0e5;border-left:3px solid #92701e;border-radius:6px;min-width:0}
.sd-review-pending h2{color:#73571a}
.sd-review-pending ul{margin:0;padding-left:1.2rem;display:block;max-width:none}
.sd-review-pending li{overflow-wrap:anywhere;font-size:.94rem}
.sd-review-pending li+li{margin-top:5px}
.sd-review-status{font-size:.78rem;color:var(--text-dim);margin-top:14px!important}
.sd-diagram{background:#fff;border:1px solid #d5e0e5;border-radius:7px;padding:14px;min-width:0;max-width:100%;margin:0}
.sd-diagram figcaption{margin:0 0 10px;font-size:.92rem;max-width:none;display:block;font-family:var(--font-body);color:var(--text)}
.sd-diagram figcaption strong{display:block;font-size:1rem}
.sd-diagram figcaption p{color:var(--text-dim);margin-top:4px}
.sd-diagram-scroll{overflow:auto;width:100%;border:1px solid #e1e9ed;border-radius:4px}
.sd-svg{display:block;max-width:none;height:auto}
.sd-svg text{font-family:"Noto Sans CJK SC","Microsoft YaHei","PingFang SC",sans-serif}
.sd-footer{border-top:1px solid var(--border);padding-top:10px;color:var(--text-dim);font-size:.78rem}
@media(max-width:600px){.sd-main{padding:18px 14px 30px}.sd-review-point{grid-template-columns:1fr;gap:4px;padding:10px 12px}.sd-diagram{padding:10px}}
@media print{body.sd-document{background:white}.sd-main{padding:0;max-width:none}.sd-diagram{break-inside:avoid}.sd-diagram-scroll{overflow:visible}.sd-svg{max-width:100%;min-width:0!important}}
`;

export function renderCompactSource(spec, validation) {
  const index = indexDesign(spec);
  const points = spec.review.points.map((p,i) => '<div class="sd-review-point" data-sd-review-item="' + i + '" data-sd-review-refs="' + esc(p.refs.join(' ')) + '"><strong data-sd-review-text>' + esc(p.title) + '</strong><p data-sd-review-text>' + esc(p.text) + '</p></div>').join('');
  const pending = spec.scope.assumptions.length ? '<div class="sd-review-pending"><h2>待确认事项</h2><ul>' + spec.scope.assumptions.map((p,i)=>'<li data-sd-review-pending="' + i + '" data-sd-review-text>' + esc(p) + '</li>').join('') + '</ul></div>' : '';
  const diagrams = reviewDiagrams(spec).map((d)=>'<figure class="sd-diagram" id="' + esc(d.id) + '" data-sd-diagram="' + esc(d.type) + '"><figcaption><strong data-sd-review-text>' + esc(d.title) + '</strong><p data-sd-review-text>' + esc(d.purpose) + '</p></figcaption><div class="sd-diagram-scroll" tabindex="0" role="region" aria-label="' + esc(d.title) + '">' + renderDiagram(d,index) + '</div></figure>').join('');
  const total = spec.acceptance.length, passed = spec.acceptance.filter((a)=>a.verification.status==='passed' && validation.evidence?.[a.id]?.ok).length;
  const business = spec.acceptance.some((a)=>a.verification.status==='failed')?'failed':passed===total&&total>0?'passed':spec.acceptance.every((a)=>a.verification.status==='not-run')?'not-run':'pending';
  const businessText = business==='pending'?'尚未全部通过':status(business);
  return '<!doctype html><html lang="zh-CN" data-register="paper" data-sd-profile="1" data-sd-view="compact"' + (spec.businessFlow?' data-sd-logic="1"':'') + '><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(spec.title) + '</title><link rel="stylesheet" href="kit.css" data-ve-kit><style data-sd-style>' + css + '</style></head><body class="sd-document"><main class="sd-main"><header id="' + esc(spec.id) + '"><p class="sd-kicker">软件方案 · ' + (validation.phase==='delivery'?'交付检查':'精简评审') + '</p><h1 data-sd-review-text>' + esc(spec.title) + '</h1><p class="sd-lead" data-sd-review-text>' + esc(spec.summary) + '</p>' + renderBusinessRows(spec) + '<h2>关键规则与约束</h2><div class="sd-review-points">' + points + '</div>' + pending + '<p class="sd-review-status">结构：' + status(validation.ok?'passed':'failed') + ' · 静态：' + status(validation.pageChecks?.static?.status) + ' · 浏览器：' + status(validation.pageChecks?.browser?.status) + ' · 业务验收：' + businessText + '（' + passed + '/' + total + '）</p></header>' + diagrams + '<footer class="sd-footer">详细模型、来源、接口、数据、验收及追踪关系见设计 JSON 与检查报告。本文仅展示评审要点。</footer></main><script data-sd-script>document.documentElement.dataset.sdReady = "ready";</script></body></html>';
}
