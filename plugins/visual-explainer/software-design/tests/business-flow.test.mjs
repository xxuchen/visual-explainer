import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDesign } from '../model.mjs';
import { scenarioDiagram } from '../business-flow.mjs';
import { exampleDesign } from './model-fixture.mjs';
const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
const run=(args,cwd)=>spawnSync(process.execPath,[cli,...args],{cwd,encoding:'utf8',shell:false});
const good=r=>{assert.equal(r.status,0,r.stderr+r.stdout);return JSON.parse(r.stdout);};
const minimal=()=>JSON.parse(readFileSync(new URL('../../templates/software-design-compact.json',import.meta.url),'utf8'));
function stateful(){
  const s=exampleDesign();
  s.data[0].lifecycleField='status';
  const path=(id,title,rule,tr,start,end,ac)=>({id,title,phase:'target',kind:'main',result:'success',actorId:'COMP-client',trigger:title,condition:'请求合法',steps:[{actorId:'COMP-client',action:title,ruleIds:[rule],apiIds:['API-submit'],transitionIds:[tr]}],outcome:'返回订单结果',requirementIds:['REQ-submit'],acceptanceIds:[ac],startStateIds:[start],endStateIds:[end]});
  s.businessFlow={version:1,intent:'target',scenarios:[
    path('SCN-submit','首次提交','BR-submit','TR-submit','STATE-draft','STATE-submitted','AC-submit'),
    path('SCN-repeat','重复提交','BR-repeat','TR-repeat','STATE-submitted','STATE-submitted','AC-repeat')
  ]};
  s.diagrams.find(d=>d.type==='state').phase='target';
  s.diagrams.push(scenarioDiagram(s,'SCN-submit'));
  return s;
}
function reject(change,code){
  const s=stateful();change(s);
  const r=validateDesign(s);
  assert.equal(r.ok,false);
  assert.ok(r.errors.some(e=>e.code===code),JSON.stringify(r.errors));
}
test('business paths walk independent state transitions and derive canonical flow',()=>{
  const s=stateful();
  assert.equal(validateDesign(s).ok,true,JSON.stringify(validateDesign(s).errors));
  assert.equal(validateDesign(minimal()).ok,true,JSON.stringify(validateDesign(minimal()).errors));
  reject(s=>{s.businessFlow.scenarios[0].startStateIds=['STATE-submitted'];},'logic-state-continuity');
  reject(s=>{s.businessFlow.scenarios[0].endStateIds=['STATE-draft'];},'logic-state-result');
  reject(s=>{s.businessFlow.scenarios[0].startStateIds.push('STATE-submitted');},'logic-state-snapshot');
  reject(s=>{delete s.data[0].lifecycleField;},'logic-state-owner');
  reject(s=>{s.businessFlow.scenarios.pop();},'logic-model-coverage');
});
test('business path rejects unrelated acceptance, current/target mixing, state-diagram phase and false flow edges',()=>{
  reject(s=>{s.businessFlow.scenarios[0].acceptanceIds=['AC-repeat'];},'logic-path-acceptance');
  reject(s=>{s.businessFlow.scenarios[0].phase='current';},'logic-current-decision');
  reject(s=>{s.diagrams.find(d=>d.type==='state').phase='current';},'logic-diagram-phase');
  reject(s=>{s.diagrams.find(d=>d.type==='flow').edges[0].to='result';},'logic-flow-mismatch');
  reject(s=>{s.businessFlow.scenarios[0].steps[0].transitionIds=['TR-repeat'];},'logic-step-rule');
  reject(s=>{s.businessFlow.scenarios[0].steps[0].ruleIds=['BR-repeat'];},'logic-model-coverage');
});
test('business flow sequence calls and state object boundary are checked',()=>{
  const s=stateful();
  s.diagrams.push({id:'DIAG-sequence',title:'提交时序',type:'sequence',purpose:'提交请求',scenarioId:'SCN-submit',nodes:[{id:'c',ref:'COMP-client'},{id:'s',ref:'COMP-order'}],edges:[{id:'call',from:'c',to:'s',apiId:'API-submit'}]});
  assert.equal(validateDesign(s).ok,true,JSON.stringify(validateDesign(s).errors));
  s.diagrams.at(-1).edges=[];
  assert.ok(validateDesign(s).errors.some(e=>e.code==='logic-sequence-mismatch'));
  const x=stateful();
  x.terms.push({id:'TERM-payment',name:'资金',definition:'独立资金对象'});
  x.data.push({id:'DATA-payment',title:'资金',termId:'TERM-payment',fields:[{name:'status',type:'enum',required:true,description:'资金状态'}],constraints:['独立状态'],lifecycleField:'status'});
  x.states.push({id:'STATE-held',dataId:'DATA-payment',name:'冻结',initial:true,terminal:false});
  x.diagrams.find(d=>d.type==='state').nodes.push({id:'pay',ref:'STATE-held'});
  assert.ok(validateDesign(x).errors.some(e=>e.code==='logic-state-diagram-owner'));
});
test('delivery gate requires enhanced canonical artifact and fresh model/report',t=>{
  const root=mkdtempSync(join(tmpdir(),'ve-logic-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const source=join(root,'model.json'),html=join(root,'review.html'),reportPath=html+'.checks.json';
  const s=minimal();writeFileSync(source,JSON.stringify(s));
  // Explicit missing browser exercises the supported skipped state, without
  // claiming any real Chromium execution in this unit test.
  const report=good(run(['render',source,'--out',html,'--browser','--browser-executable',join(root,'no-browser')],root));
  assert.equal(report.logic.status,'passed');
  assert.equal(report.browser.status,'skipped');
  assert.match(readFileSync(html,'utf8'),/data-sd-logic="1"/);
  assert.match(readFileSync(html,'utf8'),/业务主线与结果/);
  const args=['deliver',html,'--spec',source,'--view','compact'];
  good(run(args,root));
  const original=readFileSync(html,'utf8');
  writeFileSync(html,original.replace('展示匹配的授权任务','直接取消订单'));
  assert.equal(run(args,root).status,1);
  writeFileSync(html,original);
  s.summary+=' 修改';writeFileSync(source,JSON.stringify(s));
  assert.equal(run(args,root).status,1);
  writeFileSync(source,JSON.stringify(minimal()));
  writeFileSync(html,'<!doctype html><html lang="zh-CN"><body>Generic kit</body></html>');
  assert.equal(run(args,root).status,1);
  writeFileSync(html,original);rmSync(reportPath);
  assert.equal(run(args,root).status,1);
});
test('old models render but are not eligible for new checked handoff',t=>{
  const root=mkdtempSync(join(tmpdir(),'ve-legacy-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const source=join(root,'legacy.json'),html=join(root,'legacy.html');
  writeFileSync(source,JSON.stringify(exampleDesign()));
  const r=good(run(['render',source,'--out',html],root));
  assert.equal(r.logic.status,'not-run');
  assert.equal(run(['deliver',html,'--spec',source,'--view','full'],root).status,1);
});
test('malformed business path inputs return errors without throwing',()=>{
  for(const v of [null,1,[],{}, {version:1,intent:'target',scenarios:[null,{id:'SCN-x',steps:[null]}]}]){
    const s=minimal();s.businessFlow=v;
    assert.doesNotThrow(()=>validateDesign(s));assert.equal(validateDesign(s).ok,false);
  }
});
