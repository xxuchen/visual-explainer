// Native Windows multi-agent lifecycle. No agent settings, project files,
// package-manager registrations or shared browser caches are changed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const OWNER = 'visual-explainer/windows-manager/v1';
const MARKER = '.visual-explainer-managed.json';
const STATE = '.visual-explainer-manager';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eq = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const fresh = () => new Date().toISOString().replace(/[:.]/g,'-') + '-' + randomUUID().slice(0,8);
const entry = p => { try { return fs.lstatSync(p); } catch(e) { if(e.code==='ENOENT')return null; throw e; } };
const fail = msg => { throw new Error(msg); };
const plainObject = x => x && typeof x === 'object' && !Array.isArray(x);

export function catalog(root) {
  return [
    ['codex','Codex App / CLI','.agents'],
    ['cursor','Cursor','.cursor'],
    ['claude','Claude Code','.claude'],
    ['opencode','OpenCode','.config/opencode'],
    ['cline','Cline','.cline'],
    ['pi','Pi','.pi/agent'],
    ['copilot','GitHub Copilot','.copilot'],
    ['dsh','DeepSeek Harness','.dsh'],
    ['antigravity','Google Antigravity App / CLI','.gemini/config']
  ].map(([id,name,dir],i)=>({id,name,number:i+1,target:path.join(root,dir,'skills','visual-explainer')}));
}

function within(root,p) {
  const rel=path.relative(root,p);
  return rel!=='' && !path.isAbsolute(rel) && rel!=='..' && !rel.startsWith('..'+path.sep);
}
// Check every existing segment below the real profile root. Never follow a
// junction/symlink while writing, moving or deleting managed files.
function safePath(root,p,kind='any') {
  p=path.resolve(p);
  if(!within(root,p))fail('Path must stay inside the selected user profile: '+p);
  let at=root;
  const parts=path.relative(root,p).split(path.sep);
  for(let i=0;i<parts.length;i++){
    at=path.join(at,parts[i]);
    const e=entry(at);
    if(!e)return null;
    if(e.isSymbolicLink())fail('Refusing filesystem link: '+at);
    if(i<parts.length-1 && !e.isDirectory())fail('Not a directory: '+at);
    if(i===parts.length-1){
      if(kind==='dir'&&!e.isDirectory())fail('Not a directory: '+at);
      if(kind==='file'&&!e.isFile())fail('Not a regular file: '+at);
      return e;
    }
  }
}
function ensureDir(root,p) {
  safePath(root,p,'dir');
  fs.mkdirSync(p,{recursive:true});
  safePath(root,p,'dir');
}
function readJson(root,p) {
  if(!safePath(root,p,'file'))return null;
  return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
}
function atomicJson(root,p,obj) {
  safePath(root,p,'file');
  const temp=p+'.'+randomUUID()+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(obj,null,2)+'\n',{flag:'wx'});
  try { fs.renameSync(temp,p); }
  finally { if(entry(temp))fs.unlinkSync(temp); }
}
function plainTree(p) {
  const e=entry(p);
  if(!e)return;
  if(e.isSymbolicLink())fail('Refusing filesystem link inside a managed tree: '+p);
  if(e.isDirectory())for(const name of fs.readdirSync(p))plainTree(path.join(p,name));
  else if(!e.isFile())fail('Unexpected filesystem entry: '+p);
}
function removeTree(root,p) {
  if(!safePath(root,p))return;
  plainTree(p);
  fs.rmSync(p,{recursive:true,force:false});
}
function validRecord(record,agent) {
  return plainObject(record)&&record.id===agent.id&&typeof record.path==='string'&&
    eq(path.resolve(record.path),agent.target)&&record.owner===OWNER&&
    typeof record.installId==='string'&&/^[a-f0-9-]{36}$/i.test(record.installId);
}
function openState(root,agents) {
  const dir=path.join(root,STATE), ownerFile=path.join(dir,'owner.json'), registry=path.join(dir,'installations.json');
  ensureDir(root,dir);
  const owner=readJson(root,ownerFile);
  if(!owner){
    if(fs.readdirSync(dir).length)fail('Existing manager directory is not owned by this installer: '+dir);
    fs.writeFileSync(ownerFile,JSON.stringify({owner:OWNER,schemaVersion:1})+'\n',{flag:'wx'});
  } else if(owner.owner!==OWNER||owner.schemaVersion!==1)fail('Unknown manager directory format: '+dir);
  const lock=path.join(dir,'operation.lock');
  safePath(root,lock,'file');
  let fd;
  try{fd=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')fail('Another lifecycle operation is active, or a prior operation was interrupted. Check operation.lock before manually removing it: '+lock);throw e;}
  try{
    fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
    const data=readJson(root,registry);
    const records=new Map();
    if(data!==null){
      if(data.owner!==OWNER||data.schemaVersion!==1||!Array.isArray(data.installations))fail('Invalid installation registry; refusing changes.');
      for(const record of data.installations){
        const agent=agents.find(a=>a.id===record?.id);
        if(!agent||!validRecord(record,agent)||records.has(record.id))fail('Unrecognized or unsafe installation registry entry; refusing changes.');
        records.set(record.id,record);
      }
    }
    return {dir,registry,records,close(){fs.closeSync(fd);fs.unlinkSync(lock);}};
  }catch(e){fs.closeSync(fd);fs.unlinkSync(lock);throw e;}
}
function save(state,root,records) {
  atomicJson(root,state.registry,{owner:OWNER,schemaVersion:1,installations:[...records.values()]});
  state.records=records;
}
// Recognize the old default Codex installer, only with its successful
// install-result.json and the active enhanced skill. No blanket scan/delete.
function isLegacyCodex(root,agent) {
  if(agent.id!=='codex')return false;
  if(!safePath(root,path.join(agent.target,'SKILL.md'),'file')||
     !safePath(root,path.join(agent.target,'software-design','cli.mjs'),'file'))return false;
  if(!fs.readFileSync(path.join(agent.target,'SKILL.md'),'utf8').includes('## Software design profile (optional)'))return false;
  const dir=path.join(root,'.agents','visual-explainer-output');
  if(!safePath(root,dir,'dir'))return false;
  for(const name of fs.readdirSync(dir)){
    try{
      const result=readJson(root,path.join(dir,name,'install-result.json'));
      if(result?.installer==='visual-explainer/windows/v1'&&result.schemaVersion===1&&result.status==='passed'&&
         typeof result.targetPath==='string'&&eq(path.resolve(result.targetPath),agent.target))return true;
    }catch{} // ignore unreadable or unrelated old receipts
  }
  return false;
}
function discover(root,state,agents) {
  return agents.map(agent=>{
    const registered=state.records.get(agent.id);
    try{
      if(!safePath(root,agent.target,'dir'))return {...agent,status:registered?'missing':'available',registered};
      const marker=readJson(root,path.join(agent.target,MARKER));
      if(marker!==null){
        if(!validRecord(marker,agent))return {...agent,status:'conflict',registered,reason:'Invalid ownership marker'};
        // Recover a valid marked installation if the registry was removed or a
        // crash occurred between activation and the atomic registry write.
        return {...agent,status:'managed',registered,record:marker};
      }
      if(!registered&&isLegacyCodex(root,agent))return {...agent,status:'legacy'};
      return {...agent,status:'conflict',registered,reason:'Existing unregistered skill; move it aside manually.'};
    }catch(e){return {...agent,status:'conflict',registered,reason:e.message};}
  });
}
const managed = a => a.status==='managed'||a.status==='legacy'||!!a.registered;
const aliases={'claude-code':'claude','github-copilot':'copilot','deepseek-harness':'dsh','deepseek':'dsh','antigravity-cli':'antigravity'};
export function selectAgents(value,agents) {
  const tokens=String(value||'').trim().toLowerCase().split(/[\s,;]+/).filter(Boolean);
  if(tokens.length===1&&tokens[0]==='all')return [...agents];
  const ids=new Set();
  for(const raw of tokens){
    const id=aliases[raw]||raw;
    const agent=agents.find(a=>a.id===id||String(a.number)===id);
    if(!agent)fail('Unknown agent: '+raw);
    ids.add(agent.id);
  }
  return agents.filter(a=>ids.has(a.id));
}
function show(agents,log) {
  for(const a of agents)log('  '+a.number+'. '+a.name+' ['+a.id+'] - '+a.status+'  '+a.target+(a.reason?' ('+a.reason+')':''));
}
function checked(command,args,opts={}) {
  const r=spawnSync(command,args,{shell:false,windowsHide:true,...opts});
  if(r.error)throw r.error;
  if(r.status!==0)fail('Command failed: '+command+' (exit '+r.status+')'+(r.stderr?' '+String(r.stderr).trim():''));
  return r;
}
export function buildWithInstaller({repoRoot,runDir,root}) {
  if(process.platform!=='win32')fail('The batch installer requires native Windows.');
  const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const home=path.join(runDir,'build');
  checked(ps,['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',
    path.join(repoRoot,'scripts','install-windows.ps1'),'-NoPause','-NoOpen','-AgentHome',home],{stdio:'inherit'});
  const output=path.join(home,'visual-explainer-output');
  const results=fs.readdirSync(output).map(x=>path.join(output,x,'install-result.json')).filter(x=>entry(x));
  if(results.length!==1)fail('Expected one staged installer result.');
  const result=readJson(root,results[0]), source=path.join(home,'skills','visual-explainer');
  if(result?.status!=='passed'||!eq(path.resolve(result.targetPath),source))fail('Staged installer did not report success.');
  const report=readJson(root,result.checksPath);
  if(!report?.ok||report.design?.status!=='passed'||report.static?.status!=='passed'||report.browser?.status!=='passed')
    fail('Staged skill failed the real Chromium checks.');
  if(!safePath(root,result.demoPath,'file')||!safePath(root,path.join(result.outputDirectory,'demo.design.json'),'file'))
    fail('Staged installer demo is missing.');
  return {source,demoJson:path.join(result.outputDirectory,'demo.design.json')};
}
function verifyInstalled({target,demoJson}) {
  checked(process.execPath,[path.join(target,'software-design','cli.mjs'),'validate',demoJson],{encoding:'utf8'});
  checked(process.execPath,['-e','const {createRequire}=require("node:module");createRequire(process.argv[1]).resolve("playwright-core");',path.join(target,'software-design','cli.mjs')],{encoding:'utf8'});
}
function revision(repoRoot) {
  const r=spawnSync('git',['-C',repoRoot,'rev-parse','HEAD'],{encoding:'utf8',shell:false,windowsHide:true});
  return r.status===0&&/^[a-f0-9]{40}\s*$/i.test(r.stdout)?r.stdout.trim():null;
}
function activate({root,state,agent,build,runDir,runId,repoRoot,verify,log,version}) {
  const stage=path.join(runDir,'staged',agent.id);
  ensureDir(root,path.dirname(stage));
  if(!safePath(root,build.source,'dir'))fail('Staged skill is missing.');
  plainTree(build.source);
  fs.cpSync(build.source,stage,{recursive:true,force:false,errorOnExist:true});
  const record={owner:OWNER,id:agent.id,path:agent.target,installId:randomUUID(),installedAt:new Date().toISOString(),revision:version};
  atomicJson(root,path.join(stage,MARKER),record);
  ensureDir(root,path.dirname(agent.target));
  const backup=path.join(state.dir,agent.status==='legacy'?'legacy-backups':'backups',agent.id,runId);
  let moved=false,active=false;
  try{
    const current=discover(root,state,[agent])[0];
    if(current.status==='conflict')fail(current.reason);
    if(current.status!==agent.status ||
       (current.status==='managed'&&current.record.installId!==agent.record?.installId))fail('Installation changed during the operation; run again.');
    if(safePath(root,agent.target,'dir')){
      plainTree(agent.target);
      ensureDir(root,path.dirname(backup));
      fs.renameSync(agent.target,backup);
      moved=true;
    }
    fs.renameSync(stage,agent.target);
    active=true;
    verify({target:agent.target,demoJson:build.demoJson,repoRoot});
    const next=new Map(state.records);next.set(agent.id,record);save(state,root,next);
  }catch(e){
    try{
      if(active)fs.renameSync(agent.target,stage);
      if(moved)fs.renameSync(backup,agent.target);
    }catch(rollback){fail(e.message+'; rollback needs manual recovery: '+rollback.message+'; backup: '+backup);}
    throw e;
  }
  log('[OK] '+agent.name+' installed: '+agent.target);
  if(moved)log('     Backup: '+backup);
}
function uninstallOne({root,state,agent,runId,log}) {
  const current=discover(root,state,[agent])[0];
  if(current.status==='conflict')fail(current.reason);
  if(current.status!==agent.status||
     (current.status==='managed'&&current.record.installId!==agent.record?.installId))
    fail('Installation changed during the operation; run again.');
  let quarantined=null;
  if(safePath(root,agent.target,'dir')){
    plainTree(agent.target);
    quarantined=path.join(state.dir,'trash',runId+'-'+agent.id);
    ensureDir(root,path.dirname(quarantined));
    fs.renameSync(agent.target,quarantined);
  }
  try {
    const next=new Map(state.records);next.delete(agent.id);save(state,root,next);
  }catch(e){
    if(quarantined)fs.renameSync(quarantined,agent.target);
    throw e;
  }
  // Remove active files, node_modules and manager-owned prior versions.
  // Older single-agent backup directories and manually installed copies are
  // outside our ownership; preserve those, along with all project outputs.
  if(quarantined)removeTree(root,quarantined);
  removeTree(root,path.join(state.dir,'backups',agent.id));
  log('[OK] '+agent.name+' uninstalled.');
}
async function question(text) {
  if(!process.stdin.isTTY)fail('Interactive terminal required. Use -Agents or -All for install, and -Yes for uninstall.');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try{return await rl.question(text);}finally{rl.close();}
}
export async function manage(opts,{build=buildWithInstaller,verify=verifyInstalled,log=console.log,ask=question}={}) {
  const root=fs.realpathSync(opts.profileRoot);
  if(!fs.statSync(root).isDirectory())fail('User profile must be a directory.');
  const repoRoot=path.resolve(opts.repoRoot||REPO);
  if(eq(root,repoRoot)||within(repoRoot,root))fail('Profile root must be outside the source repository.');
  const agents=catalog(root), state=openState(root,agents);
  let runDir=null;
  const errors=[];
  try{
    const inventory=discover(root,state,agents);
    // Persist valid marker recoveries even when the installation record is absent.
    const recovered=new Map(state.records);
    for(const a of inventory)if(a.status==='managed')recovered.set(a.id,a.record);
    if(JSON.stringify([...recovered.values()])!==JSON.stringify([...state.records.values()]))save(state,root,recovered);
    log('Visual Explainer - '+opts.action);
    show(inventory,log);
    log("Note: some agents also discover shared .agents/skills or other agents' folders.");
    if(opts.list)return {ok:true,installed:inventory.filter(managed).map(a=>a.id),errors};
    let chosen;
    if(opts.action==='install'){
      const value=opts.all?'all':opts.agents??await ask('Select agent numbers or IDs (comma separated; all; blank cancels): ');
      chosen=selectAgents(value,inventory);
    }else chosen=inventory.filter(managed);
    if(!chosen.length){log('No selected or managed installations.');return {ok:true,installed:inventory.filter(managed).map(a=>a.id),errors};}
    log('Selected: '+chosen.map(a=>a.name).join(', '));
    if(opts.action==='uninstall'&&!opts.yes){
      if((await ask('Remove all listed managed active skills and managed backups? Type YES: ')).trim().toUpperCase()!=='YES'){
        log('Cancelled.');return {ok:true,installed:inventory.filter(managed).map(a=>a.id),errors};
      }
    }
    const runId=fresh();
    if(opts.action==='uninstall'){
      for(const a of chosen){
        try{uninstallOne({root,state,agent:a,runId,log});}catch(e){errors.push({id:a.id,error:e.message});log('[ERROR] '+a.name+': '+e.message);}
      }
      if(!state.records.size&&!discover(root,state,agents).some(managed)){
        for(const dir of ['runs','trash','backups']){
          try{removeTree(root,path.join(state.dir,dir));}catch(e){errors.push({id:'cleanup',error:e.message});log('[ERROR] '+e.message);}
        }
      }
    }else {
      const ready=chosen.filter(a=>{
        if(a.status!=='conflict')return true;
        errors.push({id:a.id,error:a.reason});log('[ERROR] '+a.name+': '+a.reason);return false;
      });
      if(ready.length){
        runDir=path.join(state.dir,'runs',runId);
        ensureDir(root,runDir);
        const built=build({repoRoot,runDir,root});
        if(!built||!within(runDir,path.resolve(built.source))||!safePath(root,built.source,'dir')||
          !within(runDir,path.resolve(built.demoJson))||!safePath(root,built.demoJson,'file'))
          fail('Invalid staged build result.');
        const version=revision(repoRoot);
        for(const a of ready){
          try{activate({root,state,agent:a,build:built,runDir,runId,repoRoot,verify,log,version});}
          catch(e){errors.push({id:a.id,error:e.message});log('[ERROR] '+a.name+': '+e.message);}
        }
        log('Build and verification logs: '+runDir);
      }
    }
    const after=discover(root,state,agents);
    log('Managed installations: '+after.filter(managed).map(a=>a.id).join(', '));
    log('Registry: '+state.registry);
    if(opts.action!=='uninstall')log('Restart the selected agents and ask them to use the visual-explainer skill.');
    else log('Restart agents to refresh discovery. Other skills, project files, shared Chromium and legacy backups were preserved.');
    return {ok:errors.length===0,installed:after.filter(managed).map(a=>a.id),errors};
  }finally{state.close();}
}
export function parseArgs(argv) {
  const [action,...args]=argv;
  if(!['install','reinstall','uninstall'].includes(action))fail('Expected install, reinstall or uninstall.');
  const opts={action,profileRoot:process.env.USERPROFILE||process.env.HOME};
  for(let i=0;i<args.length;i++){
    const arg=args[i].toLowerCase();
    if(['-nopause','-noopen'].includes(arg))continue;
    if(['-help','--help','/?'].includes(arg)){opts.help=true;continue;}
    if(arg==='-agents'||arg==='-profileroot'){
      const value=args[++i];if(!value||value.startsWith('-'))fail('Missing value for '+arg);
      opts[arg==='-agents'?'agents':'profileRoot']=value;
    }else if(arg==='-all')opts.all=true;
    else if(arg==='-yes')opts.yes=true;
    else if(arg==='-list')opts.list=true;
    else fail('Unknown option: '+args[i]);
  }
  if((opts.agents!==undefined||opts.all)&&action!=='install')fail('-Agents and -All apply only to install.');
  if(opts.agents!==undefined&&opts.all)fail('Use -Agents or -All, not both.');
  if(!opts.profileRoot)fail('USERPROFILE is not set.');
  return opts;
}
const usage='install.bat [-Agents "codex,dsh"] [-All] [-List] [-NoPause]\nreinstall.bat [-List] [-NoPause]\nuninstall.bat [-Yes] [-List] [-NoPause]\n-ProfileRoot PATH: advanced isolated user profile; use the same path on every operation.';
const direct=process.argv[1]&&eq(path.resolve(process.argv[1]),fileURLToPath(import.meta.url));
if(direct){
  try{
    const opts=parseArgs(process.argv.slice(2));
    if(opts.help)console.log(usage);
    else {
      if(process.platform!=='win32')fail('This batch lifecycle requires native Windows.');
      const result=await manage(opts);process.exitCode=result.ok?0:1;
    }
  }catch(e){console.error('[ERROR] '+e.message);process.exitCode=1;}
}
