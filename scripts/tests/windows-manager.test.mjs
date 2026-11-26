import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { catalog, manage, parseArgs, selectAgents } from '../manage-windows.mjs';

const silent=()=>{};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ve-lifecycle-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const profile=path.join(root,'profile with spaces');
  fs.mkdirSync(profile);
  const agents=catalog(fs.realpathSync(profile));
  const target=id=>agents.find(a=>a.id===id).target;
  const state=path.join(profile,'.visual-explainer-manager');
  let builds=0, version='v1';
  const build=({runDir})=>{
    builds++;
    const source=path.join(runDir,'fake-build');
    fs.mkdirSync(path.join(source,'software-design'),{recursive:true});
    fs.mkdirSync(path.join(source,'node_modules','playwright-core'),{recursive:true});
    fs.writeFileSync(path.join(source,'SKILL.md'),'## Software design profile (optional)\n'+version);
    fs.writeFileSync(path.join(source,'software-design','cli.mjs'),'// '+version);
    fs.writeFileSync(path.join(source,'node_modules','playwright-core','index.js'),'// '+version);
    const demoJson=path.join(runDir,'demo.json');fs.writeFileSync(demoJson,'{}');
    return {source,demoJson};
  };
  const run=(action,options={},hooks={})=>manage({action,profileRoot:profile,repoRoot:process.cwd(),...options},{build,verify:()=>{},log:silent,...hooks});
  const records=()=>JSON.parse(fs.readFileSync(path.join(state,'installations.json'),'utf8')).installations;
  return {root,profile,state,target,run,records,setVersion:v=>{version=v;},buildCount:()=>builds};
}
test('parse and select explicit agent IDs, numbers, aliases and all',()=>{
  const agents=catalog(path.resolve('example-profile'));
  assert.deepEqual(selectAgents('1,deepseek-harness,1',agents).map(a=>a.id),['codex','dsh']);
  assert.equal(selectAgents('all',agents).length,9);
  assert.throws(()=>selectAgents('unknown',agents));
  assert.equal(parseArgs(['install','-Agents','codex,dsh','-NoPause']).agents,'codex,dsh');
  assert.throws(()=>parseArgs(['reinstall','-Agents','codex']));
  assert.throws(()=>parseArgs(['install','-All','-Agents','codex']));
});
test('selective install, one build, automatic reinstall of registered/missing targets, complete uninstall',async t=>{
  const f=fixture(t);
  const other=path.join(f.profile,'.cursor','skills','other-skill');
  fs.mkdirSync(other,{recursive:true});fs.writeFileSync(path.join(other,'SKILL.md'),'unrelated');
  assert.equal((await f.run('install',{agents:'codex,dsh'})).ok,true);
  assert.equal(f.buildCount(),1);
  assert.deepEqual(f.records().map(r=>r.id),['codex','dsh']);
  assert.equal(fs.existsSync(f.target('cursor')),false);
  fs.writeFileSync(path.join(f.target('codex'),'local-note.txt'),'preserve in backup');
  fs.rmSync(f.target('dsh'),{recursive:true});
  f.setVersion('v2');
  assert.equal((await f.run('reinstall')).ok,true);
  assert.equal(f.buildCount(),2);
  for(const id of ['codex','dsh']){
    assert.match(fs.readFileSync(path.join(f.target(id),'SKILL.md'),'utf8'),/v2/);
    assert.equal(fs.existsSync(path.join(f.target(id),'node_modules','playwright-core','index.js')),true);
  }
  assert.equal(fs.existsSync(path.join(f.target('codex'),'local-note.txt')),false);
  const backups=path.join(f.state,'backups','codex');
  assert.equal(fs.readFileSync(path.join(backups,fs.readdirSync(backups)[0],'local-note.txt'),'utf8'),'preserve in backup');
  assert.equal((await f.run('uninstall',{yes:true})).ok,true);
  for(const id of ['codex','dsh'])assert.equal(fs.existsSync(f.target(id)),false);
  assert.equal(fs.readFileSync(path.join(other,'SKILL.md'),'utf8'),'unrelated');
  assert.deepEqual(f.records(),[]);
  assert.equal(fs.existsSync(path.join(f.state,'runs')),false);
  assert.equal(fs.existsSync(backups),false);
  assert.equal((await f.run('uninstall',{yes:true})).ok,true);
});
test('failed verification restores old copy, keeps registration and leaves other target unchanged',async t=>{
  const f=fixture(t);
  await f.run('install',{agents:'codex'});
  const old=f.records()[0];
  f.setVersion('v2');
  const result=await f.run('reinstall',{}, {verify:()=>{throw Error('probe failure');}});
  assert.equal(result.ok,false);
  assert.deepEqual(f.records()[0],old);
  assert.match(fs.readFileSync(path.join(f.target('codex'),'SKILL.md'),'utf8'),/v1/);
});
test('unmanaged skill conflict is preserved; marker recovery works without registry',async t=>{
  const f=fixture(t);
  fs.mkdirSync(f.target('cursor'),{recursive:true});
  fs.writeFileSync(path.join(f.target('cursor'),'SKILL.md'),'user owned');
  const r=await f.run('install',{agents:'codex,cursor'});
  assert.equal(r.ok,false);
  assert.equal(fs.readFileSync(path.join(f.target('cursor'),'SKILL.md'),'utf8'),'user owned');
  assert.deepEqual(f.records().map(x=>x.id),['codex']);
  fs.unlinkSync(path.join(f.state,'installations.json'));
  await f.run('reinstall');
  assert.deepEqual(f.records().map(x=>x.id),['codex']);
  await f.run('uninstall',{yes:true});
  assert.equal(fs.readFileSync(path.join(f.target('cursor'),'SKILL.md'),'utf8'),'user owned');
});
test('legacy Codex successful installer receipt is recognized and upgraded',async t=>{
  const f=fixture(t), target=f.target('codex');
  fs.mkdirSync(path.join(target,'software-design'),{recursive:true});
  fs.writeFileSync(path.join(target,'SKILL.md'),'## Software design profile (optional)\nlegacy');
  fs.writeFileSync(path.join(target,'software-design','cli.mjs'),'old');
  const dir=path.join(f.profile,'.agents','visual-explainer-output','old-run');
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'install-result.json'),JSON.stringify({installer:'visual-explainer/windows/v1',schemaVersion:1,status:'passed',targetPath:target}));
  assert.equal((await f.run('reinstall')).ok,true);
  assert.deepEqual(f.records().map(x=>x.id),['codex']);
  assert.equal((await f.run('uninstall',{yes:true})).ok,true);
  assert.equal(fs.existsSync(target),false);
  assert.equal(fs.existsSync(dir),true);
  assert.equal(fs.existsSync(path.join(f.state,'legacy-backups','codex')),true);
});
test('refuse changed ownership and junctions without deleting external files',async t=>{
  const f=fixture(t);
  await f.run('install',{agents:'codex'});
  const target=f.target('codex');
  const external=path.join(f.root,'external');
  fs.mkdirSync(external);fs.writeFileSync(path.join(external,'keep.txt'),'outside');
  fs.renameSync(target,path.join(f.root,'old'));
  fs.symlinkSync(external,target,process.platform==='win32'?'junction':'dir');
  const result=await f.run('uninstall',{yes:true});
  assert.equal(result.ok,false);
  assert.equal(fs.readFileSync(path.join(external,'keep.txt'),'utf8'),'outside');
  assert.equal(f.records().length,1);
  fs.unlinkSync(target);
});
test('uninstall cancellation and invalid registry are fail-safe',async t=>{
  const f=fixture(t);
  await f.run('install',{agents:'codex'});
  const result=await f.run('uninstall',{}, {ask:async()=> 'no'});
  assert.equal(result.ok,true);assert.equal(fs.existsSync(f.target('codex')),true);
  const r=f.records();r[0].path=f.target('cursor');
  fs.writeFileSync(path.join(f.state,'installations.json'),JSON.stringify({owner:'visual-explainer/windows-manager/v1',schemaVersion:1,installations:r}));
  await assert.rejects(()=>f.run('uninstall',{yes:true}),/unsafe installation registry/);
  assert.equal(fs.existsSync(f.target('codex')),true);
});
test('interactive selection accepts numbers and rejects unknown entries',async t=>{
  const f=fixture(t);
  await f.run('install',{}, {ask:async()=> '1,8'});
  assert.deepEqual(f.records().map(x=>x.id),['codex','dsh']);
});

test('active lifecycle lock is preserved and prevents another operation',async t=>{
  const f=fixture(t);
  await f.run('install',{agents:'codex'});
  const lock=path.join(f.state,'operation.lock');
  const data=JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()});
  fs.writeFileSync(lock,data);
  await assert.rejects(()=>f.run('reinstall'),/lifecycle operation/i);
  assert.equal(fs.readFileSync(lock,'utf8'),data);
  fs.unlinkSync(lock);
});
test('Windows automatically recovers a dead legacy lock but preserves invalid locks',{skip:process.platform!=='win32'},async t=>{
  const f=fixture(t);
  await f.run('install',{agents:'codex'});
  const lock=path.join(f.state,'operation.lock');
  // Windows PIDs are allocated by the OS; Int32.MaxValue cannot be an
  // allocated Windows PID (process IDs are multiples of four).
  fs.writeFileSync(lock,JSON.stringify({pid:2147483647,startedAt:'2020-01-01T00:00:00Z'}));
  f.setVersion('v2');
  const logs=[];
  const result=await f.run('reinstall',{}, {log:m=>logs.push(m)});
  assert.equal(result.ok,true);
  assert.ok(logs.some(m=>m.includes('[RECOVERED]')));
  assert.equal(fs.existsSync(lock),false);
  assert.match(fs.readFileSync(path.join(f.target('codex'),'SKILL.md'),'utf8'),/v2/);
  fs.writeFileSync(lock,'{');
  await assert.rejects(()=>f.run('reinstall'),/unreadable or incomplete lock/i);
  assert.equal(fs.readFileSync(lock,'utf8'),'{');
  fs.unlinkSync(lock);
});
test('a concurrent operation during interactive selection cannot take the lock',async t=>{
  const f=fixture(t);
  let entered, finish;
  const ready=new Promise(resolve=>{entered=resolve;});
  const answer=new Promise(resolve=>{finish=resolve;});
  const first=f.run('install',{}, {ask:async()=>{entered();return answer;}});
  await ready;
  try{await assert.rejects(()=>f.run('install',{agents:'dsh'}),/lifecycle operation/i);}
  finally{finish('codex');await first;}
  assert.deepEqual(f.records().map(r=>r.id),['codex']);
  assert.equal(fs.existsSync(path.join(f.state,'operation.lock')),false);
});
