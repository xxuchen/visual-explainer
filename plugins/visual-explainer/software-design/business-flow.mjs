// Business-path contract v1. Deterministic checks of declared paths and state
// effects; no claim of semantic correctness or execution of application code.
const arr=x=>Array.isArray(x)?x:[];
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const txt=x=>typeof x==='string'&&x.trim().length>0;
const records=x=>arr(x).filter(obj);
const uniq=x=>[...new Set(x)];
const intersection=(a,b)=>a.some(x=>b.includes(x));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels=spec=>new Map(['components','data','states'].flatMap(key=>records(spec?.[key]).map(x=>[x.id,x])));
const label=(index,id)=>{const x=index.get(id);return x?.name??x?.title??String(id??'');};
const phaseLabel={current:'现状',target:'目标'};
const resultLabel={success:'完成',rejected:'拒绝',pending:'待处理',failed:'失败'};

export function businessRows(spec,{compact=true}={}) {
  const index=labels(spec);
  return records(spec?.businessFlow?.scenarios).filter(s=>!compact||s.kind==='main'||s.highlight===true).map(s=>{
    const steps=records(s.steps).map(x=>label(index,x.actorId)+'：'+String(x.action??''));
    const before=records(spec?.states).filter(x=>arr(s.startStateIds).includes(x.id));
    const after=records(spec?.states).filter(x=>arr(s.endStateIds).includes(x.id));
    const states=before.map(x=>label(index,x.dataId)+'：'+label(index,x.id)+' → '+label(index,after.find(y=>y.dataId===x.dataId)?.id));
    return {id:s.id,phase:phaseLabel[s.phase]??'',title:String(s.title??''),entry:label(index,s.actorId)+'：'+String(s.trigger??'')+'（'+String(s.condition??'')+'）',steps:steps.join(' → '),outcome:(resultLabel[s.result]??'')+'：'+String(s.outcome??''),states:states.join('；')};
  });
}
export function businessReviewText(spec){
  return businessRows(spec).flatMap(r=>[r.phase+' · '+r.title,r.entry,r.steps,r.outcome,r.states]);
}
export function renderBusinessRows(spec,{compact=true}={}){
  if(!obj(spec?.businessFlow))return '';
  const mark=compact?' data-sd-review-text':'';
  const rows=businessRows(spec,{compact}).map(r=>'<article class="sd-business-row" data-sd-scenario="'+escape(r.id)+'"><h3'+mark+'>'+escape(r.phase+' · '+r.title)+'</h3><p'+mark+'>'+escape(r.entry)+'</p><p'+mark+'>'+escape(r.steps)+'</p><p'+mark+'><strong>'+escape(r.outcome)+'</strong></p>'+(r.states?'<p'+mark+'>'+escape(r.states)+'</p>':'')+'</article>').join('');
  return '<section class="sd-business"><h2>业务主线与结果</h2>'+rows+'</section>';
}

// A flow is a projection of ONE explicit path; no hand-authored arrows or labels.
// Multiple branches use separate paths, with their entry conditions preserved.
export function scenarioDiagram(spec,scenarioId,id='DIAG-'+String(scenarioId).replace(/^SCN-/,'')+'-flow'){
  const s=records(spec?.businessFlow?.scenarios).find(x=>x.id===scenarioId);
  if(!s)throw Error('Unknown business scenario: '+scenarioId);
  const index=labels(spec);
  const steps=records(s.steps);
  if(steps.length>10)throw Error('Split the path before drawing it (10 steps maximum).');
  const nodes=[{id:'entry',label:label(index,s.actorId)+'：'+s.trigger},...steps.map((x,i)=>({id:'step'+(i+1),label:label(index,x.actorId)+'：'+x.action})),{id:'result',label:s.outcome}];
  const edges=nodes.slice(1).map((n,i)=>({id:'edge'+(i+1),from:nodes[i].id,to:n.id,label:i===0?s.condition:(i===steps.length?'结果':'继续'),refs:i<steps.length?uniq([...arr(steps[i].ruleIds),...arr(steps[i].apiIds),...arr(steps[i].transitionIds)]):[]}));
  return {id,title:s.title,type:'flow',purpose:'展示该场景的处理顺序与结果。',scenarioId:s.id,nodes,edges};
}

export function validateBusinessFlow(spec,index){
  const issues=[],error=(code,path,message)=>issues.push({code,path,message});
  const model=spec.businessFlow;
  if(!obj(model))return [{code:'logic-shape',path:'$.businessFlow',message:'业务场景模型必须为对象。'}];
  if(model.version!==1)error('logic-version','$.businessFlow.version','业务场景模型 version 必须为 1。');
  if(!['current','target'].includes(model.intent))error('logic-intent','$.businessFlow.intent','明确现状分析 current 或目标设计 target。');
  const cases=new Map();
  const byId=new Map(), usedRules=new Set(),usedApis=new Set(),usedTransitions=new Set(),coveredReqs=new Set(),transitionPhases=new Map(),drawnPhases=new Set();
  const ref=(id,prefix,path)=>{
    if(typeof id!=='string'||!id.startsWith(prefix+'-')||!index.has(id)){error('logic-ref',path,'未知或类型不符的引用：'+String(id));return null;}
    return index.get(id);
  };
  const refs=(values,prefix,path,required=false)=>{
    if(!Array.isArray(values)||(required&&!values.length)){error('logic-array',path,'必须是'+(required?'非空':'')+'引用数组。');return [];}
    if(new Set(values).size!==values.length)error('logic-ref',path,'引用不可重复。');
    return values.filter((id,i)=>ref(id,prefix,path+'['+i+']'));
  };
  const requiredText=(o,keys,path)=>keys.forEach(k=>{if(!txt(o[k]))error('logic-text',path+'.'+k,'必须明确填写 '+k+'。');});
  const scenarios=records(model.scenarios);
  if(!Array.isArray(model.scenarios)||!scenarios.length||scenarios.length!==model.scenarios.length)
    error('logic-scenarios','$.businessFlow.scenarios','必须提供非空业务场景对象数组。');
  if(!scenarios.some(s=>s.phase===model.intent&&s.kind==='main'))error('logic-main','$.businessFlow.scenarios','至少包含一条与本次现状/目标意图一致的主路径。');
  for(const [i,s] of scenarios.entries()){
    const at='$.businessFlow.scenarios['+i+']';
    if(typeof s.id!=='string'||!/^SCN-[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s.id)||byId.has(s.id))error('logic-id',at+'.id','场景 ID 必须唯一且以 SCN- 开头。');
    else byId.set(s.id,s);
    requiredText(s,['title','trigger','condition','outcome'],at);
    if(!['current','target'].includes(s.phase)||(model.intent==='current'&&s.phase!=='current'))error('logic-phase',at+'.phase','现状分析不得混入目标场景；目标设计须标明现状与目标。');
    if(!['main','exception'].includes(s.kind))error('logic-kind',at+'.kind','kind 必须为 main 或 exception。');
    if(!['success','rejected','pending','failed'].includes(s.result))error('logic-result',at+'.result','必须声明完成、拒绝、待处理或失败结果。');
    if(s.highlight!==undefined&&typeof s.highlight!=='boolean')error('logic-highlight',at+'.highlight','highlight 必须为布尔值。');
    const actor=ref(s.actorId,'COMP',at+'.actorId');
    if(actor&&!['actor','service','external'].includes(actor.kind))error('logic-actor',at+'.actorId','存储组件不能作为业务触发者。');
    const reqs=refs(s.requirementIds,'REQ',at+'.requirementIds',true);
    const acs=refs(s.acceptanceIds,'AC',at+'.acceptanceIds',true);
    const requirements=reqs.map(id=>index.get(id));
    const accepts=acs.map(id=>index.get(id));
    const allowedRules=uniq(requirements.flatMap(r=>arr(r.ruleIds)));
    for(const a of accepts)if(!intersection(arr(a.requirementIds),reqs))error('logic-acceptance',at+'.acceptanceIds',a.id+' 不属于本场景需求。');
    const pathRules=new Set();
    const snapshot=(values,key)=>{
      const result=new Map();
      for(const id of refs(values,'STATE',at+'.'+key)){
        const entity=index.get(id).dataId;
        if(result.has(entity))error('logic-state-snapshot',at+'.'+key,'同一状态对象不能同时处于两个状态：'+entity);
        result.set(entity,id);
      }
      return result;
    };
    const state=snapshot(s.startStateIds,'startStateIds'),expected=snapshot(s.endStateIds,'endStateIds');
    const norm=v=>typeof v==='string'?v.normalize('NFKC').replace(/\s/gu,''):'';
    const caseKey=JSON.stringify([s.phase,s.actorId,norm(s.trigger),norm(s.condition),[...state].sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
    if(cases.has(caseKey))error('logic-ambiguous-branch',at+'.condition','与 '+cases.get(caseKey)+' 的入口、条件和起始状态相同；请合并路径或明确区分分支条件。');
    else cases.set(caseKey,s.id);
    const steps=records(s.steps);
    if(!Array.isArray(s.steps)||!steps.length||steps.length!==s.steps.length)error('logic-steps',at+'.steps','至少有一个可追踪业务步骤。');
    for(const [j,step] of steps.entries()){
      const sp=at+'.steps['+j+']';
      requiredText(step,['action'],sp);
      const performer=ref(step.actorId,'COMP',sp+'.actorId');
      if(performer&&performer.kind==='store'&&arr(step.apiIds).length)error('logic-actor',sp+'.actorId','存储不能作为业务接口发起者。');
      const rules=refs(step.ruleIds,'BR',sp+'.ruleIds',true),apis=refs(step.apiIds,'API',sp+'.apiIds'),trans=refs(step.transitionIds,'TR',sp+'.transitionIds');
      for(const id of rules){
        const r=index.get(id);
        pathRules.add(id);usedRules.add(id);
        if(!allowedRules.includes(id))error('logic-rule-scope',sp+'.ruleIds',id+' 不属于本场景需求。');
        if(s.phase==='current'&&r.basis==='decision')error('logic-current-decision',sp+'.ruleIds','现状不能以拟议设计作为事实：'+id);
      }
      const cover=(id,related)=>{
        const active=arr(related).filter(r=>rules.includes(r));
        if(!active.length)error('logic-step-rule',sp,id+' 与该步骤没有共同业务规则。');
        for(const rule of active)for(const req of requirements.filter(r=>arr(r.ruleIds).includes(rule))){
          if(!accepts.some(a=>arr(a.requirementIds).includes(req.id)&&arr(a.refs).includes(rule)&&arr(a.refs).includes(id)))error('logic-path-acceptance',sp,req.id+' 的本场景验收须同时引用 '+rule+' 和 '+id+'。');
        }
      };
      for(const id of apis){usedApis.add(id);cover(id,index.get(id).ruleIds);}
      for(const id of trans){
        usedTransitions.add(id);
        const t=index.get(id),a=index.get(t.from),b=index.get(t.to);
        cover(id,t.ruleIds);
        if(!transitionPhases.has(id))transitionPhases.set(id,new Set());
        transitionPhases.get(id).add(s.phase);
        if(!a||!b)continue;
        if(state.get(a.dataId)!==t.from)error('logic-state-continuity',sp+'.transitionIds',id+' 的起点与当前 '+a.dataId+' 状态不一致（应为 '+String(state.get(a.dataId)??'未声明')+'）。');
        else state.set(a.dataId,t.to);
      }
      // API transitions are alternatives, not all mandatory on one call. But
      // when a step explicitly models both API and transition, they must agree.
      if(apis.length&&trans.length)for(const id of trans)
        if(!apis.some(a=>arr(index.get(a).transitionIds).includes(id)))error('logic-api-transition',sp+'.transitionIds',id+' 未绑定该步骤的任何 API；独立内部迁移请拆成下一步。');
    }
    for(const req of requirements){
      const relevant=arr(req.ruleIds).filter(id=>pathRules.has(id));
      if(!relevant.length)error('logic-requirement',at+'.requirementIds',req.id+' 没有实际步骤。');
      if(s.phase===model.intent&&relevant.length)coveredReqs.add(req.id);
      for(const id of relevant)if(!accepts.some(a=>arr(a.requirementIds).includes(req.id)&&arr(a.refs).includes(id)))error('logic-path-acceptance',at+'.acceptanceIds',req.id+' 的本场景验收缺少规则 '+id+'。');
    }
    if(state.size!==expected.size||[...state].some(([k,v])=>expected.get(k)!==v))error('logic-state-result',at+'.endStateIds','声明的最终状态与逐步执行迁移所得状态不一致。');
  }
  for(const r of records(spec.requirements))if(!coveredReqs.has(r.id))error('logic-requirement-coverage','$.businessFlow.scenarios','本次意图的业务路径未覆盖 '+r.id);
  for(const [key,used] of [['rules',usedRules],['apis',usedApis],['transitions',usedTransitions]])for(const r of records(spec[key]))if(!used.has(r.id))error('logic-model-coverage','$.businessFlow.scenarios','没有业务路径使用 '+r.id);
  const stateEntities=uniq(records(spec.states).map(s=>s.dataId));
  for(const id of stateEntities){
    const d=index.get(id);
    if(d&&(!txt(d.lifecycleField)||!records(d.fields).some(f=>f.name===d.lifecycleField)))error('logic-state-owner','$.data.'+id,'状态对象须声明实际 lifecycleField，并与字段定义对应；不同状态对象分别建模。');
  }
  for(const d of records(spec.diagrams)){
    const at='$.diagrams.'+d.id;
    if(d.type==='state'){
      const entities=uniq(records(d.nodes).map(n=>index.get(n.ref)?.dataId).filter(Boolean));
      if(entities.length!==1)error('logic-state-diagram-owner',at,'每张状态图只能描述一个业务状态对象。');
      if(!['current','target'].includes(d.phase))error('logic-diagram-phase',at+'.phase','状态图须标记 current 或 target。');
      for(const e of records(d.edges)){
        if(!transitionPhases.get(e.transitionId)?.has(d.phase))error('logic-diagram-phase',at,'状态图迁移 '+e.transitionId+' 与场景阶段不一致。');
        else drawnPhases.add(JSON.stringify([e.transitionId,d.phase]));
      }
    }
    if(d.type==='flow'||d.type==='sequence'){
      const s=byId.get(d.scenarioId);
      if(!s){error('logic-diagram-scenario',at+'.scenarioId','流程/时序图必须绑定业务场景。');continue;}
      if(d.type==='flow'){
        try{
          const canonical=scenarioDiagram(spec,s.id,d.id);
          const ns=records(d.nodes).map(n=>[n.id,n.label,n.ref]);
          const es=records(d.edges).map(e=>[e.id,e.from,e.to,e.label,e.refs,e.apiId,e.transitionId]);
          if(!same(ns,canonical.nodes.map(n=>[n.id,n.label,n.ref]))||!same(es,canonical.edges.map(e=>[e.id,e.from,e.to,e.label,e.refs,e.apiId,e.transitionId])))error('logic-flow-mismatch',at,'流程图与规范业务路径不一致；请重新执行 flow 命令生成。');
        }catch(e){error('logic-flow-mismatch',at,e.message);}
      }else{
        const nodes=new Map(records(d.nodes).map(n=>[n.id,n.ref]));
        const calls=records(d.edges).filter(e=>e.apiId).map(e=>[e.apiId,nodes.get(e.from)]);
        const expectedCalls=records(s.steps).flatMap(step=>arr(step.apiIds).map(id=>[id,step.actorId]));
        if(!same(calls,expectedCalls))error('logic-sequence-mismatch',at,'时序图的 API 调用顺序和调用者须与场景步骤一致。');
        const pathRefs=uniq(records(s.steps).flatMap(step=>[...arr(step.ruleIds),...arr(step.transitionIds),...arr(step.apiIds)]));
        for(const e of records(d.edges).filter(e=>!e.apiId))if(!arr(e.refs).some(r=>pathRefs.includes(r)))error('logic-sequence-ref',at,'非 API 消息须引用本场景规则、接口或迁移。');
      }
    }
  }
  for(const [id,phases] of transitionPhases)for(const phase of phases)
    if(!drawnPhases.has(JSON.stringify([id,phase])))error('logic-state-diagram-coverage','$.diagrams',id+' 缺少 '+phase+' 阶段的规范状态图。');
  return issues;
}
