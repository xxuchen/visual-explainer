/** Mechanical consistency checks for the opt-in software design profile. No execution or I/O. */
const COLLECTIONS = {
  terms: "TERM", components: "COMP", requirements: "REQ", rules: "BR", data: "DATA",
  states: "STATE", transitions: "TR", apis: "API", diagrams: "DIAG", acceptance: "AC",
  decisions: "DEC", risks: "RISK", quality: "NFR"
};
const REQUIRED_COLLECTIONS = new Set(["terms", "components", "requirements", "rules", "diagrams", "acceptance", "decisions", "risks", "quality"]);
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const list = (x) => Array.isArray(x) ? x : [];
const text = (x) => typeof x === "string" && x.trim().length > 0;
const has = (x, k) => Object.hasOwn(x, k);
const intersection = (a, b) => a.some((x) => b.has(x));
const unique = (xs) => [...new Set(xs)];

export function indexDesign(spec) {
  const index = new Map();
  if (!isObject(spec)) return index;
  if (text(spec.id)) index.set(spec.id, spec);
  for (const key of Object.keys(COLLECTIONS)) for (const item of list(spec[key])) {
    if (isObject(item) && text(item.id) && !index.has(item.id)) index.set(item.id, item);
  }
  return index;
}

export function labelFor(item) {
  return isObject(item) ? [item.name, item.title, item.id].find(text) ?? "" : "";
}

export function validateDesign(spec, { phase = "design", evidence = new Map() } = {}) {
  const errors = [], warnings = [], traceability = [];
  const error = (code, path, message) => errors.push({ code, path, message });
  const warn = (code, path, message) => warnings.push({ code, path, message });
  const result = () => ({ ok: errors.length === 0, errors, warnings, traceability });
  if (!isObject(spec)) { error("shape", "$", "方案必须是 JSON 对象。"); return result(); }
  if (!["design", "delivery"].includes(phase)) error("phase", "$", "phase 必须为 design 或 delivery。");
  const str = (value, path) => { if (!text(value)) error("required-text", path, "必须填写非空文本。"); };
  const strings = (value, path, nonempty = false) => {
    if (!Array.isArray(value)) { error("array", path, "必须是数组。"); return []; }
    if (nonempty && !value.length) error("required-items", path, "至少填写一项；不适用时写明原因。");
    value.forEach((v, i) => str(v, `${path}[${i}]`));
    return value.filter(text);
  };
  const enumValue = (value, values, path) => { if (!values.includes(value)) error("enum", path, `有效值：${values.join("、")}。`); };
  const boolean = (value, path) => { if (typeof value !== "boolean") error("boolean", path, "必须是布尔值。"); };
  const id = (value, prefix, path) => { if (typeof value !== "string" || !new RegExp(`^${prefix}-[A-Za-z0-9][A-Za-z0-9_-]*$`).test(value)) error("id", path, `ID 必须以 ${prefix}- 开头，使用字母、数字、下划线或连字符。`); };
  if (spec.schemaVersion !== 1) error("schema-version", "$.schemaVersion", "仅支持 schemaVersion: 1。");
  id(spec.id, "DESIGN", "$.id");
  str(spec.title, "$.title"); str(spec.summary, "$.summary");
  if (spec.language !== "zh-CN") error("language", "$.language", "此方案模式使用 language: zh-CN。");
  for (const [section, fields] of Object.entries({ scope: ["goals", "in", "out", "assumptions"], delivery: ["implementation", "migration", "rollback", "monitoring"] })) {
    if (!isObject(spec[section])) error("shape", `$.${section}`, "必须是对象。");
    else for (const field of fields) strings(spec[section][field], `$.${section}.${field}`, !["out", "assumptions"].includes(field));
  }
  const records = {}, paths = new Map(), types = new Map(), index = new Map();
  if (text(spec.id)) { index.set(spec.id, spec); paths.set(spec.id, "$"); types.set(spec.id, "DESIGN"); }
  for (const [key, prefix] of Object.entries(COLLECTIONS)) {
    records[key] = [];
    if (!Array.isArray(spec[key])) { error("array", `$.${key}`, "必须是数组；没有此概念时填写空数组。"); continue; }
    if (REQUIRED_COLLECTIONS.has(key) && !spec[key].length) error("required-items", `$.${key}`, "至少填写一项。");
    spec[key].forEach((item, i) => {
      const path = `$.${key}[${i}]`;
      if (!isObject(item)) { error("shape", path, "必须是对象。"); return; }
      records[key].push(item);
      id(item.id, prefix, `${path}.id`);
      str(item[key === "terms" || key === "states" ? "name" : "title"], `${path}.${key === "terms" || key === "states" ? "name" : "title"}`);
      if (text(item.id)) {
        if (index.has(item.id)) error("duplicate-id", `${path}.id`, `ID ${item.id} 已在 ${paths.get(item.id)} 使用。`);
        else { index.set(item.id, item); paths.set(item.id, path); types.set(item.id, prefix); }
      }
    });
  }
  const pathOf = (item) => paths.get(item.id) ?? "$";
  const ref = (value, path, prefix) => {
    if (!text(value) || !index.has(value)) { error("unknown-ref", path, `引用 ${String(value)} 不存在。`); return false; }
    if (prefix && types.get(value) !== prefix) { error("ref-type", path, `引用必须指向 ${prefix}-*。`); return false; }
    return true;
  };
  const refs = (value, path, prefix, nonempty = false) => {
    if (!Array.isArray(value)) { error("array", path, "引用必须是数组。"); return []; }
    if (nonempty && value.length === 0) error("required-ref", path, "至少关联一项。");
    const seen = new Set();
    value.forEach((v, i) => {
      ref(v, `${path}[${i}]`, prefix);
      if (seen.has(v)) error("duplicate-ref", `${path}[${i}]`, `重复引用 ${String(v)}。`);
      seen.add(v);
    });
    return value.filter((v) => typeof v === "string");
  };
  const requiredText = (item, fields) => fields.forEach((k) => str(item[k], `${pathOf(item)}.${k}`));
  const duplicates = (items, valueOf, code, field, description) => {
    const seen = new Set();
    for (const item of items) { const value = valueOf(item); if (!text(value)) continue; if (seen.has(value)) error(code, `${pathOf(item)}.${field}`, `${description}重复：${value}。`); seen.add(value); }
  };
  duplicates(records.terms, (t) => typeof t.name === "string" ? t.name.trim() : "", "duplicate-term", "name", "术语名称");
  for (const term of records.terms) requiredText(term, ["definition"]);
  for (const component of records.components) {
    requiredText(component, ["responsibility"]);
    enumValue(component.kind, ["actor", "service", "external", "store"], `${pathOf(component)}.kind`);
  }
  for (const req of records.requirements) {
    requiredText(req, ["text"]);
    enumValue(req.priority, ["must", "should", "could"], `${pathOf(req)}.priority`);
    refs(req.ruleIds, `${pathOf(req)}.ruleIds`, "BR", true);
    refs(req.acceptanceIds, `${pathOf(req)}.acceptanceIds`, "AC", true);
  }
  for (const rule of records.rules) {
    requiredText(rule, ["text", "source"]);
    enumValue(rule.basis, ["fact", "assumption", "decision"], `${pathOf(rule)}.basis`);
    refs(rule.refs, `${pathOf(rule)}.refs`);
    if (rule.basis === "assumption") warn("assumption", pathOf(rule), `${rule.id} 的业务依据仍待确认。`);
  }
  for (const data of records.data) {
    ref(data.termId, `${pathOf(data)}.termId`, "TERM");
    strings(data.constraints, `${pathOf(data)}.constraints`, true);
    if (!Array.isArray(data.fields) || !data.fields.length) { error("fields", `${pathOf(data)}.fields`, "至少定义一个数据字段。"); continue; }
    const seen = new Set();
    data.fields.forEach((field, i) => {
      const p = `${pathOf(data)}.fields[${i}]`;
      if (!isObject(field)) { error("shape", p, "字段必须是对象。"); return; }
      for (const key of ["name", "type", "description"]) str(field[key], `${p}.${key}`);
      boolean(field.required, `${p}.required`);
      if (text(field.name) && seen.has(field.name)) error("duplicate-field", `${p}.name`, `字段 ${field.name} 重复。`);
      seen.add(field.name);
    });
  }
  for (const state of records.states) {
    ref(state.dataId, `${pathOf(state)}.dataId`, "DATA");
    boolean(state.initial, `${pathOf(state)}.initial`); boolean(state.terminal, `${pathOf(state)}.terminal`);
  }
  duplicates(records.states, (s) => text(s.dataId) && text(s.name) ? `${s.dataId}/${s.name.trim()}` : "", "duplicate-state-name", "name", "同一实体的状态名称");
  for (const transition of records.transitions) {
    const p = pathOf(transition);
    requiredText(transition, ["event", "guard", "action"]);
    const fromOk = ref(transition.from, `${p}.from`, "STATE"), toOk = ref(transition.to, `${p}.to`, "STATE");
    refs(transition.ruleIds, `${p}.ruleIds`, "BR", true);
    if (fromOk && toOk && index.get(transition.from).dataId !== index.get(transition.to).dataId) error("cross-entity-transition", p, "状态迁移的两端必须属于同一个数据实体。");
    if (fromOk && index.get(transition.from).terminal === true) error("terminal-outgoing", p, "终态不能有出边；允许重试自循环的状态应设置 terminal: false。");
  }
  for (const api of records.apis) {
    const p = pathOf(api);
    requiredText(api, ["path", "request", "response"]);
    enumValue(api.method, ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], `${p}.method`);
    if (text(api.path) && (!api.path.startsWith("/") || /[\s?#]/.test(api.path))) error("api-path", `${p}.path`, "接口路径必须以 / 开头，查询参数在 request 中描述。");
    ref(api.owner, `${p}.owner`, "COMP");
    refs(api.ruleIds, `${p}.ruleIds`, "BR", true);
    refs(api.dataIds, `${p}.dataIds`, "DATA");
    refs(api.transitionIds, `${p}.transitionIds`, "TR");
    if (!Array.isArray(api.errors)) error("array", `${p}.errors`, "错误处理必须是数组。");
    else {
      const codes = new Set();
      api.errors.forEach((e, i) => {
        const ep = `${p}.errors[${i}]`;
        if (!isObject(e)) { error("shape", ep, "错误处理必须是对象。"); return; }
        for (const key of ["code", "condition", "handling"]) str(e[key], `${ep}.${key}`);
        if (text(e.code) && codes.has(e.code)) error("duplicate-error", `${ep}.code`, `错误码 ${e.code} 重复。`);
        codes.add(e.code);
      });
    }
    for (const tid of list(api.transitionIds)) {
      const t = index.get(tid);
      if (types.get(tid) === "TR") {
        if (!intersection(list(t.ruleIds), new Set(list(api.ruleIds)))) error("api-transition-rules", `${p}.transitionIds`, `${tid} 与接口没有共同业务规则。`);
        const dataId = index.get(t.from)?.dataId;
        if (text(dataId) && !list(api.dataIds).includes(dataId)) error("api-transition-data", `${p}.dataIds`, `${tid} 的数据实体 ${dataId} 未在接口中关联。`);
      }
    }
  }
  duplicates(records.apis, (a) => text(a.method) && text(a.path) ? `${a.method} ${a.path}` : "", "duplicate-api", "path", "接口方法和路径");
  const diagramRefs = new Map(), drawnTransitions = new Set();
  for (const diagram of records.diagrams) {
    const p = pathOf(diagram), nodeMap = new Map(), localIds = new Set(), drefs = new Set();
    diagramRefs.set(diagram.id, drefs);
    requiredText(diagram, ["purpose"]);
    enumValue(diagram.type, ["context", "flow", "state", "sequence", "er"], `${p}.type`);
    if (!Array.isArray(diagram.nodes) || !diagram.nodes.length) error("diagram-nodes", `${p}.nodes`, "图至少需要一个节点。");
    if (list(diagram.nodes).length > (diagram.type === "sequence" ? 5 : 12)) error("diagram-size", `${p}.nodes`, "拆分大图：时序图最多 5 个参与者，其他图最多 12 个节点。");
    const localId = (value, loc) => {
      if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) error("local-id", loc, "图内 ID 使用字母、数字、下划线或连字符。");
      if (localIds.has(value)) error("duplicate-local-id", loc, `图内 ID ${String(value)} 重复。`);
      localIds.add(value);
    };
    list(diagram.nodes).forEach((node, i) => {
      const np = `${p}.nodes[${i}]`;
      if (!isObject(node)) { error("shape", np, "图节点必须是对象。"); return; }
      localId(node.id, `${np}.id`);
      if (!nodeMap.has(node.id)) nodeMap.set(node.id, node);
      if (has(node, "ref") === has(node, "label")) error("canonical-label", np, "节点使用 ref 或 label 二选一，引用的规范名称不能覆盖。");
      if (has(node, "ref")) {
        const prefix = { state: "STATE", context: "COMP", sequence: "COMP", er: "DATA" }[diagram.type];
        ref(node.ref, `${np}.ref`, prefix); drefs.add(node.ref);
      } else {
        str(node.label, `${np}.label`);
        if (["state", "context", "sequence", "er"].includes(diagram.type)) error("diagram-node-type", np, "此类型图的节点必须引用共享模型实体。");
      }
    });
    if (!Array.isArray(diagram.edges)) error("array", `${p}.edges`, "图的 edges 必须是数组。");
    list(diagram.edges).forEach((edge, i) => {
      const ep = `${p}.edges[${i}]`;
      if (!isObject(edge)) { error("shape", ep, "图边必须是对象。"); return; }
      localId(edge.id, `${ep}.id`);
      for (const end of ["from", "to"]) if (!nodeMap.has(edge[end])) error("edge-endpoint", `${ep}.${end}`, `节点 ${String(edge[end])} 不存在。`);
      if (has(edge, "refs")) refs(edge.refs, `${ep}.refs`).forEach((v) => drefs.add(v));
      const canonical = Number(has(edge, "apiId")) + Number(has(edge, "transitionId"));
      if (canonical > 1 || (canonical && has(edge, "label"))) error("canonical-label", ep, "边的 apiId、transitionId、label 三选一，规范标签不能覆盖。");
      if (has(edge, "apiId")) {
        const apiOk = ref(edge.apiId, `${ep}.apiId`, "API"); drefs.add(edge.apiId);
        if (apiOk && ["context", "sequence"].includes(diagram.type) && nodeMap.get(edge.to)?.ref !== index.get(edge.apiId).owner) {
          error("api-edge-owner", ep, `${edge.apiId} 的调用边必须指向接口所属组件 ${index.get(edge.apiId).owner}；响应消息使用 label 和 refs。`);
        }
      }
      if (has(edge, "transitionId")) { ref(edge.transitionId, `${ep}.transitionId`, "TR"); drefs.add(edge.transitionId); }
      if (!canonical) str(edge.label, `${ep}.label`);
      if (diagram.type === "state") {
        if (!has(edge, "transitionId")) error("state-edge", ep, "状态图的每条边必须绑定 transitionId。");
        const t = index.get(edge.transitionId);
        if (types.get(edge.transitionId) === "TR") {
          if (nodeMap.get(edge.from)?.ref !== t.from || nodeMap.get(edge.to)?.ref !== t.to) error("state-edge-mismatch", ep, "状态图边的两端与规范迁移不一致。");
          else drawnTransitions.add(t.id);
        }
      }
    });
  }
  for (const ac of records.acceptance) {
    const p = pathOf(ac);
    requiredText(ac, ["given", "when", "then"]);
    refs(ac.requirementIds, `${p}.requirementIds`, "REQ", true);
    refs(ac.refs, `${p}.refs`, undefined, true);
    if (!isObject(ac.verification)) { error("verification", `${p}.verification`, "必须明确标记验证状态。"); continue; }
    const v = ac.verification;
    enumValue(v.status, ["not-run", "skipped", "passed", "failed"], `${p}.verification.status`);
    if (v.status === "skipped") str(v.reason, `${p}.verification.reason`);
    if (has(v, "receipt") && (!text(v.receipt) || /^(?:[A-Za-z]:|[\\/]|[a-z]+:)/i.test(v.receipt) || v.receipt.includes("\0"))) error("receipt-path", `${p}.verification.receipt`, "凭证必须使用相对于方案 JSON 所在目录的文件路径。");
    if (["passed", "failed"].includes(v.status)) {
      str(v.receipt, `${p}.verification.receipt`);
      const proof = evidence instanceof Map ? evidence.get(ac.id) : undefined;
      if (!proof?.ok || proof.status !== v.status) {
        const details = list(proof?.errors).filter(text).join("；");
        error("verification-evidence", `${p}.verification`, `${ac.id} 缺少有效且匹配的执行凭证${details ? `：${details}` : "。"}`);
      }
    } else if (has(v, "receipt")) warn("unused-receipt", `${p}.verification.receipt`, "未执行或跳过状态的凭证不计入通过结果。");
    if (v.status === "not-run" || v.status === "skipped") warn("verification-pending", `${p}.verification`, `${ac.id} 尚未通过业务验证（${v.status}）。`);
    if (v.status === "failed") warn("verification-failed", `${p}.verification`, `${ac.id} 的执行结果为失败。`);
  }
  for (const decision of records.decisions) {
    requiredText(decision, ["choice", "rationale"]);
    strings(decision.options, `${pathOf(decision)}.options`, true);
    refs(decision.refs, `${pathOf(decision)}.refs`);
    if (text(decision.choice) && !list(decision.options).includes(decision.choice)) error("decision-choice", `${pathOf(decision)}.choice`, "choice 必须与 options 中一个选项相同。");
  }
  for (const risk of records.risks) { requiredText(risk, ["impact", "mitigation", "owner"]); refs(risk.refs, `${pathOf(risk)}.refs`); }
  for (const quality of records.quality) { requiredText(quality, ["target", "measurement"]); refs(quality.acceptanceIds, `${pathOf(quality)}.acceptanceIds`, "AC", true); }

  // Bidirectional requirement coverage: a link cannot be claimed by only one side.
  for (const req of records.requirements) for (const aid of list(req.acceptanceIds)) {
    if (types.get(aid) === "AC" && !list(index.get(aid).requirementIds).includes(req.id)) error("acceptance-backlink", `${pathOf(req)}.acceptanceIds`, `${aid} 未反向关联 ${req.id}。`);
  }
  for (const ac of records.acceptance) for (const rid of list(ac.requirementIds)) {
    if (types.get(rid) === "REQ" && !list(index.get(rid).acceptanceIds).includes(ac.id)) error("requirement-backlink", `${pathOf(ac)}.requirementIds`, `${rid} 未反向关联 ${ac.id}。`);
  }
  for (const rule of records.rules) {
    const owners = records.requirements.filter((r) => list(r.ruleIds).includes(rule.id));
    if (!owners.length) error("orphan-rule", pathOf(rule), `${rule.id} 未关联任何需求。`);
    for (const owner of owners) {
      const covered = records.acceptance.some((a) => list(owner.acceptanceIds).includes(a.id) && list(a.requirementIds).includes(owner.id) && list(a.refs).includes(rule.id));
      if (!covered) error("rule-coverage", pathOf(rule), `${owner.id} 的验收场景未覆盖规则 ${rule.id}。`);
    }
  }
  // An unrelated requirement's acceptance cannot supply evidence for this rule/model chain.
  const modelCoverage = (item, code) => {
    if (!records.acceptance.some((a) => list(a.refs).includes(item.id))) {
      error(code, pathOf(item), `${item.id} 未被验收场景引用。`);
      return;
    }
    for (const ruleId of list(item.ruleIds)) {
      for (const owner of records.requirements.filter((r) => list(r.ruleIds).includes(ruleId))) {
        const covered = records.acceptance.some((a) => list(owner.acceptanceIds).includes(a.id)
          && list(a.requirementIds).includes(owner.id) && list(a.refs).includes(ruleId) && list(a.refs).includes(item.id));
        if (!covered) error(code, pathOf(item), `${owner.id} 的验收场景必须同时引用规则 ${ruleId} 和 ${item.id}。`);
      }
    }
  };
  for (const api of records.apis) modelCoverage(api, "api-coverage");
  for (const t of records.transitions) {
    if (!drawnTransitions.has(t.id)) error("transition-diagram", pathOf(t), `${t.id} 未在状态图中准确展示。`);
    modelCoverage(t, "transition-coverage");
  }
  // Check each state machine separately. A self-loop never makes another state reachable.
  const stateEntities = unique(records.states.map((s) => s.dataId));
  for (const entity of stateEntities) {
    const states = records.states.filter((s) => s.dataId === entity), initials = states.filter((s) => s.initial === true);
    if (initials.length !== 1) { error("initial-state", paths.get(entity) ?? "$.states", `${String(entity)} 必须有且只有一个初态，当前 ${initials.length} 个。`); continue; }
    const reached = new Set([initials[0].id]);
    let changed = true;
    while (changed) { changed = false; for (const t of records.transitions) if (reached.has(t.from) && !reached.has(t.to) && index.get(t.to)?.dataId === entity) { reached.add(t.to); changed = true; } }
    for (const state of states) if (!reached.has(state.id)) error("unreachable-state", pathOf(state), `${state.id} 无法从初态到达。`);
  }
  // Trace only domain implementation links; acceptance links cannot manufacture implementation coverage.
  for (const req of records.requirements) {
    const ruleIds = list(req.ruleIds).filter((v) => types.get(v) === "BR"), ruleSet = new Set(ruleIds), linked = new Set(ruleIds);
    for (const ruleId of ruleIds) for (const r of list(index.get(ruleId)?.refs)) if (["DIAG", "API", "DATA", "TR", "STATE", "BR", "TERM", "COMP"].includes(types.get(r))) linked.add(r);
    for (const api of records.apis) if (intersection(list(api.ruleIds), ruleSet)) linked.add(api.id);
    for (const t of records.transitions) if (intersection(list(t.ruleIds), ruleSet)) linked.add(t.id);
    for (const api of records.apis) if (linked.has(api.id)) { list(api.dataIds).forEach((r) => linked.add(r)); list(api.transitionIds).forEach((r) => linked.add(r)); }
    for (const t of records.transitions) if (linked.has(t.id)) { linked.add(t.from); linked.add(t.to); }
    for (const s of records.states) if (linked.has(s.id)) linked.add(s.dataId);
    const row = {
      requirementId: req.id, ruleIds,
      diagramIds: records.diagrams.filter((d) => linked.has(d.id) || intersection([...diagramRefs.get(d.id)], linked)).map((d) => d.id),
      apiIds: records.apis.filter((a) => linked.has(a.id)).map((a) => a.id),
      dataIds: records.data.filter((d) => linked.has(d.id)).map((d) => d.id),
      acceptanceIds: list(req.acceptanceIds).filter((v) => types.get(v) === "AC")
    };
    traceability.push(row);
    if (!row.diagramIds.length && !row.apiIds.length && !row.dataIds.length) error("implementation-coverage", pathOf(req), `${req.id} 的业务规则未关联图、接口或数据设计。`);
  }
  if (phase === "delivery") {
    const requiredAcceptance = new Set(records.requirements.filter((r) => r.priority === "must").flatMap((r) => list(r.acceptanceIds)));
    for (const q of records.quality) list(q.acceptanceIds).forEach((a) => requiredAcceptance.add(a));
    for (const aid of requiredAcceptance) {
      const ac = index.get(aid), proof = evidence instanceof Map ? evidence.get(aid) : undefined;
      if (types.get(aid) === "AC" && (ac.verification?.status !== "passed" || !proof?.ok || proof.status !== "passed")) error("delivery-gate", `${pathOf(ac)}.verification`, `${aid} 必须以有效凭证通过验证后才能标记为交付完成。`);
    }
  }
  return result();
}
