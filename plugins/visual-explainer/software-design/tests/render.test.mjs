import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderDesignSource } from '../render.mjs';
import { renderDiagram, wrapLabel } from '../diagrams.mjs';
import { validateDesign, indexDesign } from '../model.mjs';
import { renderWithUpstream } from '../upstream.mjs';

const example = () => JSON.parse(readFileSync(new URL('../../templates/software-design.json', import.meta.url), 'utf8'));
const report = (spec, additional = {}) => renderDesignSource(spec, {...validateDesign(spec), ...additional});

test('complete example renders every model item and all diagram edges into navigable HTML', () => {
  const spec = example();
  const html = report(spec);
  for (const id of indexDesign(spec).keys()) assert.ok(html.includes(`id="${id}"`), `missing anchor ${id}`);
  for (const diagram of spec.diagrams) {
    assert.ok(html.includes(`data-sd-diagram="${diagram.type}"`));
    const svg = renderDiagram(diagram, indexDesign(spec));
    for (const node of diagram.nodes) assert.ok(svg.includes(`data-sd-node="${node.id}"`));
    for (const edge of diagram.edges) assert.ok(svg.includes(`data-sd-edge="${edge.id}"`));
  }
  for (const heading of ['目标、范围与假设','需求、业务规则与依据','接口契约与数据约束','状态及迁移规则','决策、备选方案与风险','可度量的质量目标','实施、迁移、回滚与观测','验收场景与实际执行证据','需求到验收的追踪矩阵']) assert.ok(html.includes(heading));
});

test('state loop and sequence labels resolve the current shared model', () => {
  const spec = example();
  const stateDiagram = spec.diagrams.find((d) => d.type === 'state');
  const loop = stateDiagram.edges.find((e) => e.from === e.to);
  assert.ok(loop, 'example must exercise a self loop');
  const transition = spec.transitions.find((t) => t.id === loop.transitionId);
  transition.event = '重复通知：保留同一业务状态';
  const stateSvg = renderDiagram(stateDiagram, indexDesign(spec));
  assert.ok(stateSvg.includes(`data-sd-edge="${loop.id}"`));
  assert.ok(stateSvg.includes('重复通知：保留同一业务状态'));
  const sequence = spec.diagrams.find((d) => d.type === 'sequence');
  const apiEdge = sequence.edges.find((e) => e.apiId);
  const api = spec.apis.find((a) => a.id === apiEdge.apiId);
  api.path = '/api/v2/orders';
  assert.ok(renderDiagram(sequence,indexDesign(spec)).includes('/api/v2/orders'));
});

test('untrusted text is escaped and embedded source round-trips without a script breakout', () => {
  const spec = example();
  spec.summary = '<script>globalThis.injected=true</script><img src="https://evil.test/x">';
  spec.terms[0].definition = '</script><script>alert("x")</script>&中文😀';
  const html = report(spec);
  assert.ok(html.includes('&lt;script&gt;globalThis.injected=true&lt;/script&gt;'));
  assert.ok(!html.includes('<script>globalThis.injected'));
  assert.ok(!html.includes('<img src="https://evil.test/x">'));
  const json = html.match(/<script type="application\/json" id="sd-source">([^]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(json),spec);
  assert.equal((html.match(/<script\b/g) ?? []).length,2);
});

test('design validation does not imply business or browser checks passed', () => {
  const spec = example();
  const html = report(spec,{ok:true});
  assert.match(html, /业务验收执行<\/strong><span[^>]*>尚未执行/);
  assert.match(html, /浏览器页面检查<\/strong><span[^>]*>尚未执行/);
  assert.match(html, /HTML 静态检查<\/strong><span[^>]*>尚未执行/);
});

test('passed claims without valid evidence remain visibly unconfirmed', () => {
  const spec=example();
  for (const ac of spec.acceptance) ac.verification={status:'passed',receipt:`evidence/${ac.id}.json`};
  const html=report(spec);
  assert.match(html,/业务验收执行<\/strong><span[^>]*>尚未执行/);
  assert.ok(html.includes('执行状态仅为声明'));
  assert.ok(html.includes(`0 / ${spec.acceptance.length} 项通过且证据有效`));
});

test('verified command evidence and separate page-check results are visible', () => {
  const spec=example();
  const evidence={};
  for (const ac of spec.acceptance) {
    ac.verification={status:'passed',receipt:`evidence/${ac.id}.json`};
    evidence[ac.id]={ok:true,receipt:{command:['node','--test','spec.test.mjs'],cwd:'/project',exitCode:0,signal:null,startedAt:'2026-01-01T00:00:00Z',finishedAt:'2026-01-01T00:00:01Z',log:'evidence/test.log',logSha256:'f'.repeat(64),specDigest:'a'.repeat(64)}};
  }
  const html=report(spec,{evidence,pageChecks:{static:{status:'passed'},browser:{status:'skipped',reason:'测试浏览器不可用'}}});
  assert.match(html,/业务验收执行<\/strong><span[^>]*>已通过/);
  assert.match(html,/浏览器页面检查<\/strong><span[^>]*>已跳过/);
  assert.ok(html.includes('测试浏览器不可用'));
  assert.ok(html.includes('&quot;--test&quot;'));
  assert.ok(html.includes('退出码'));
  assert.ok(html.includes('f'.repeat(64)));
});

test('CJK/emoji wrapping preserves complete labels and long unbroken identifiers', () => {
  for (const value of ['订单异步通知幂等性校验与数据一致性约束', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567890'.repeat(3), '收货地址😀需要完整显示🚚']) {
    const lines=wrapLabel(value,100,15);
    assert.ok(lines.length>1);
    assert.equal(lines.join(''),value);
    assert.ok(!lines.some((line)=>/[\uD800-\uDBFF]$/.test(line)));
  }
});

test('adapter integration keeps profile resources inline and Chinese locale intact', () => {
  const html=renderWithUpstream(report(example()));
  assert.ok(html.includes('lang="zh-CN"'));
  assert.ok(html.includes('data-ve-kit'));
  assert.ok(html.includes('sdReady'));
  assert.ok(!/<link[^>]+href=["']https?:/i.test(html));
  assert.ok(!/<script[^>]+src=/i.test(html));
});

test('long browser diagnostics stay complete in details without filling the status card', () => {
  const reason='Browser launch unavailable\n'+'socket failed <environment diagnostic>\n'.repeat(100);
  const html=report(example(),{pageChecks:{static:{status:'passed'},browser:{status:'skipped',reason,errors:['Browser process exited']}}});
  const headerCard=html.match(/<strong>浏览器页面检查<\/strong>([^]*?)<\/div>/)[1];
  assert.ok(headerCard.includes('Browser launch unavailable'));
  assert.ok(!headerCard.includes('socket failed'));
  const details=html.match(/<details[^>]*id="sd-page-checks"[^>]*>([^]*?)<\/details>/)[1];
  assert.equal((details.match(/socket failed/g)??[]).length,100);
  assert.ok(details.includes('&lt;environment diagnostic&gt;'));
  assert.ok(details.includes('Browser process exited'));
});

test('single-participant and final-participant sequence self messages retain positive label positions', () => {
  const spec=example(), index=indexDesign(spec);
  for(const nodes of [[{id:'a',ref:spec.components[0].id}], [{id:'a',ref:spec.components[0].id},{id:'b',ref:spec.components[1].id}]]) {
    const last=nodes.at(-1).id;
    const svg=renderDiagram({id:'DIAG-loop',type:'sequence',title:'内部重试',purpose:'重复执行的内部调用',nodes,edges:[{id:'retry',from:last,to:last,label:'内部重试与中文错误消息完整显示'}]},index);
    assert.ok(svg.includes('data-sd-edge="retry"'));
    for (const x of svg.matchAll(/<text[^>]* x="(-?[\d.]+)"/g)) assert.ok(Number(x[1])>=0);
  }
});

test('parallel forward events, reverse events and repeated self-loops have distinct visible routes and ports', () => {
  const diagram = {
    id:'DIAG-parallel',type:'flow',title:'重试与恢复',purpose:'所有事件保持独立可见',
    nodes:[{id:'ready',label:'等待处理'},{id:'active',label:'处理中'}],
    edges:[
      {id:'start',from:'ready',to:'active',label:'首次开始'},
      {id:'resume',from:'ready',to:'active',label:'恢复处理'},
      {id:'back',from:'active',to:'ready',label:'暂缓'},
      {id:'poll',from:'active',to:'active',label:'轮询状态'},
      {id:'retry',from:'active',to:'active',label:'重复通知'},
    ],
  };
  const svg = renderDiagram(diagram,new Map());
  const paths = [], labels = [], ports = new Map(diagram.nodes.map((node)=>[node.id,[]]));
  for (let i=0;i<diagram.edges.length;i++) {
    const edge = diagram.edges[i];
    const body = svg.split(`data-sd-edge="${edge.id}"`)[1].split('</g></g>')[0];
    assert.ok(body,`edge ${edge.id} is present`);
    const path = body.match(/<path d="([^"]+)"[^>]*marker-end=/)?.[1];
    const label = body.match(/<circle cx="([\d.]+)" cy="([\d.]+)"/);
    assert.ok(path,`edge ${edge.id} retains an arrowhead`);
    assert.ok(label,`edge ${edge.id} retains a visible numbered marker`);
    assert.ok(body.includes(`>${i+1}</tspan>`));
    paths.push(path); labels.push([Number(label[1]),Number(label[2])]);
    const coordinates=path.match(/^M([\d.]+) ([\d.]+)H[\d.]+V([\d.]+)H[\d.]+$/);
    assert.ok(coordinates,`edge ${edge.id} uses a separate route`);
    ports.get(edge.from).push(Number(coordinates[2]));
    ports.get(edge.to).push(Number(coordinates[3]));
  }
  assert.equal(new Set(paths).size,diagram.edges.length,'no two events share the complete path');
  for (const values of ports.values()) assert.equal(new Set(values).size,values.length,'all incident edges use distinct node ports');
  for (let i=0;i<labels.length;i++) for (let j=i+1;j<labels.length;j++) {
    assert.ok(Math.hypot(labels[i][0]-labels[j][0],labels[i][1]-labels[j][1])>=24,'24px number markers do not overlap');
  }
  assert.equal(renderDiagram(diagram,new Map()),svg,'layout is deterministic');
});
