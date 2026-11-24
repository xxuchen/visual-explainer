import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDesign } from '../model.mjs';
import { reviewTextLength } from '../review.mjs';
import { inspectHtml } from '../inspect.mjs';
import { exampleDesign } from './model-fixture.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const minimal = () => JSON.parse(readFileSync(new URL('../../templates/software-design-compact.json',import.meta.url),'utf8'));
const modelWithReview = () => {
  const spec = exampleDesign();
  spec.review = {points:[{title:'幂等提交',text:'首次在事务内提交；相同键和相同内容返回原结果，不同内容返回冲突。重复提交语义待确认。',refs:['REQ-submit','BR-submit','BR-repeat']}],diagramIds:['DIAG-state']};
  return spec;
};
function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(),'sd-compact-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return dir;
}
const run = (args,cwd)=>spawnSync(process.execPath,[cli,...args],{cwd,encoding:'utf8',shell:false});
const good = (result)=>{assert.equal(result.status,0,result.stderr+result.stdout);return JSON.parse(result.stdout);};
test('minimal compact model avoids filler and retains component trace and delivery gate',()=>{
  const spec=minimal();
  const validation=validateDesign(spec);
  assert.equal(validation.ok,true,JSON.stringify(validation.errors));
  assert.deepEqual(validation.traceability[0].componentIds,['COMP-list']);
  assert.equal(validateDesign(spec,{phase:'delivery'}).ok,false);
  delete spec.review;
  assert.equal(validateDesign(spec).ok,false);
});
test('compact review rejects over-budget text, unknown refs, missing coverage and excess diagrams',()=>{
  for(const [edit,code] of [
    [s=>s.review.points[0].text='长'.repeat(801),'review-length'],
    [s=>s.review.points[0].refs=['BR-submit','BR-repeat'],'review-coverage'],
    [s=>s.review.points[0].refs.push('UNKNOWN'),'review-ref'],
    [s=>s.review.diagramIds=['DIAG-state','DIAG-context','DIAG-state'],'review-diagrams'],
    [s=>s.scope.assumptions=[],'review-assumption'],
    [s=>s.review.points[0].refs=['REQ-submit','BR-submit'],'review-assumption']
  ]){
    const spec=modelWithReview();edit(spec);
    const result=validateDesign(spec);assert.equal(result.ok,false);
    assert.ok(result.errors.some(e=>e.code===code),JSON.stringify(result.errors));
  }
});
test('compact CLI keeps all traceability but renders only selected diagrams and no hidden appendix',t=>{
  const root=workspace(t),input=join(root,'model.json'),out=join(root,'review.html');
  const spec=modelWithReview();writeFileSync(input,JSON.stringify(spec));
  const report=good(run(['render',input,'--out',out],root));
  assert.equal(report.view,'compact');
  assert.equal(report.review.textChars,reviewTextLength(spec));
  assert.equal(report.traceability[0].diagramIds.length,2);
  assert.deepEqual(report.review.diagramIds,['DIAG-state']);
  assert.equal(report.business['AC-submit'],'not-run');
  const html=readFileSync(out,'utf8');
  assert.match(html,/data-sd-view="compact"/);
  assert.doesNotMatch(html,/id="sd-source"|id="sd-traceability"|<details\b|id="DIAG-context"/);
  assert.match(html,/id="DIAG-state"/);
  assert.match(html,/待确认事项/);
  assert.equal(inspectHtml(html,{spec}).ok,true);
  assert.equal(inspectHtml(html.replace('data-sd-review-item="0"','data-sd-missing="0"'),{spec}).ok,false);
  good(run(['inspect',out,'--spec',input],root));
  const full=good(run(['render',input,'--out',out,'--view','full'],root));
  assert.equal(full.view,'full');
  assert.match(readFileSync(out,'utf8'),/id="sd-traceability"/);
  assert.equal(readFileSync(input,'utf8'),JSON.stringify(spec));
});
test('compact init and explicit compact view without review fail safely',t=>{
  const root=workspace(t),input=join(root,'model.json'),out=join(root,'review.html');
  good(run(['init',input,'--view','compact'],root));
  good(run(['validate',input],root));
  writeFileSync(input,JSON.stringify(exampleDesign()));
  assert.equal(run(['render',input,'--out',out,'--view','compact'],root).status,1);
  assert.equal(existsSync(out),false);
});
test('invalid compact model cannot render by using full view',t=>{
  const root=workspace(t),input=join(root,'model.json'),out=join(root,'review.html');
  const spec=modelWithReview();spec.review.points[0].text='字'.repeat(801);writeFileSync(input,JSON.stringify(spec));
  assert.equal(run(['render',input,'--out',out,'--view','full'],root).status,1);
  assert.equal(existsSync(out),false);
});
