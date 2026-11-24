import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseDiagrams, generateChatPreview, markdownImage, previewEligibility } from '../chat-preview.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const diagram = (id, type, width, height) => `<figure id="${id}" data-sd-diagram="${type}" class="sd-diagram"><figcaption><strong>${id} 业务设计</strong><p>完整的图与说明。</p></figcaption><div class="sd-diagram-scroll"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#edf3f6"/><rect x="20" y="30" width="180" height="80" rx="8" fill="white" stroke="#426374"/><text x="35" y="65" font-size="16">提交订单</text><path d="M200 70H320" stroke="#426374"/><rect x="320" y="30" width="180" height="80" rx="8" fill="white" stroke="#426374"/><text x="335" y="65" font-size="16">生成站内通知</text></svg></div></figure>`;
const fixture = (summary = '订单提交后通知指定管理员。') => `<!doctype html><html lang="zh-CN" data-sd-profile="1"><head><meta charset="utf-8"><style>body{font:16px/1.65 'Noto Sans CJK SC','Microsoft YaHei',sans-serif;background:#f3f6f7;color:#193344;margin:0}.sd-main{max-width:1280px;margin:auto;padding:48px 40px 100px}.sd-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-top:28px}.sd-stat{background:white;padding:18px;border:1px solid #d5e0e5;border-radius:10px}.sd-diagram{background:white;border:1px solid #cfdee6;border-radius:10px;margin:24px 0;padding:20px}.sd-diagram-scroll{width:100%;overflow:auto;border:1px solid #e1e9ed;border-radius:6px}svg{display:block;max-width:none}figcaption{display:block;margin:0 0 16px}p{margin:0}</style></head><body><main class="sd-main"><header><h1>管理员通知方案</h1><p class="sd-lead">${summary}</p><div class="sd-stats">${['方案结构 已通过','业务验收 尚未执行','静态检查 已通过','浏览器检查 已通过'].map(x=>`<div class="sd-stat">${x}</div>`).join('')}</div><nav>此目录不应出现在预览里</nav></header><section>${diagram('DIAG-too-wide','flow',2000,300)}${diagram('DIAG-flow','flow',560,240)}${diagram('DIAG-context','context',700,300)}${diagram('DIAG-state','state',550,300)}</section></main><script>document.documentElement.dataset.sdReady='ready';</script></body></html>`;
const reportFor = (html) => ({ profile: 'software-design/v1', htmlSha256: sha(html), ok: true, design:{status:'passed'}, static:{status:'passed'}, browser:{status:'passed'} });

test('requires a matching successful HTML check report, while allowing business acceptance not-run', () => {
  const html = fixture();
  const report = { ...reportFor(html), business: { 'AC-example': 'not-run' } };
  assert.equal(previewEligibility(report, html), '');
  assert.match(previewEligibility(report, html + ' '), /does not match/);
  assert.match(previewEligibility({ ...report, browser: {status:'skipped'} }, html), /must pass/);
  assert.match(previewEligibility({ ...report, design: {status:'failed'} }, html), /must pass/);
  assert.match(previewEligibility(reportFor('not a design'), 'not a design'), /Invalid/);
});

test('orders readable diagrams by kind and rejects oversized or missing dimensions', () => {
  const items = [{type:'state',width:600,height:100}, {type:'flow',width:2000,height:100}, {type:'context',width:800,height:100}, {type:'flow',width:560,height:200}, {type:'er',width:0,height:100}, {type:'er',width:500,height:2000}, {type:'er',width:NaN,height:100}];
  assert.deepEqual(chooseDiagrams(items).map(x=>x.type), ['flow','context','state']);
  assert.equal(items[0].type,'state');
});

test('Windows Markdown image references use absolute drive paths, forward slashes and escaped delimiters', () => {
  assert.equal(markdownImage('D:\\work space\\docs\\plan(1)#.png','diagram'),'![关键设计图](D:/work%20space/docs/plan%281%29%23.png)');
  assert.equal(markdownImage('/tmp/preview.png','overview'),'![方案摘要](/tmp/preview.png)');
});

test('missing or stale check report skips without producing any image', async () => {
  const dir = await mkdtemp(join(tmpdir(), 've-preview-'));
  try {
    const file = join(dir, 'design.html');
    const html = fixture();
    await writeFile(file, html);
    assert.equal((await generateChatPreview(file)).status, 'skipped');
    await writeFile(file+'.checks.json', JSON.stringify(reportFor(html+' changed')));
    const result = await generateChatPreview(file);
    assert.equal(result.status, 'skipped');
    assert.equal(result.images.length, 0);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

// Optional real Chromium test. Set VE_CHAT_PREVIEW_BROWSER=1 to use installed
// Playwright Chromium, or set it to an executable path on a development machine.
const browser = process.env.VE_CHAT_PREVIEW_BROWSER;
test('real Chromium captures bounded overview and key figures without altering HTML or checks', {skip: !browser, timeout: 60000}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 've-preview-'));
  try {
    const file = join(dir, 'design.html');
    const html = fixture();
    const report = JSON.stringify(reportFor(html));
    await writeFile(file,html);
    await writeFile(file+'.checks.json',report);
    const options = browser === '1' ? {} : {executablePath: browser};
    const result = await generateChatPreview(file,options);
    assert.equal(result.status, 'generated', JSON.stringify(result));
    assert.equal(result.images.length,3);
    assert.deepEqual(result.images.filter(x=>x.kind==='diagram').map(x=>x.diagramId),['DIAG-flow','DIAG-context']);
    assert.equal(result.omittedDiagrams,2);
    for (const img of result.images) {
      const bytes = await readFile(img.path);
      assert.equal(sha(bytes),img.sha256);
      assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      assert.ok(img.width<=1400 && img.height<=1200);
    }
    assert.equal(await readFile(file,'utf8'),html);
    assert.equal(await readFile(file+'.checks.json','utf8'),report);
    const revised = fixture('订单提交后通知三个管理员，并记录投递状态。');
    await writeFile(file,revised);
    await writeFile(file+'.checks.json',JSON.stringify(reportFor(revised)));
    const next = await generateChatPreview(file,options);
    assert.equal(next.status,'generated',JSON.stringify(next));
    assert.notEqual(next.images[0].path,result.images[0].path);
    const unsafe = revised.replace('</body>', '<img src="https://example.invalid/blocked.png"></body>');
    await writeFile(file, unsafe);
    await writeFile(file+'.checks.json',JSON.stringify(reportFor(unsafe)));
    const blocked = await generateChatPreview(file,options);
    assert.equal(blocked.status,'failed',JSON.stringify(blocked));
    assert.equal(blocked.images.length,0);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
