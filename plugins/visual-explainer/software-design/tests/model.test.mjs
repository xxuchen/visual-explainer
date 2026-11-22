import test from "node:test";
import assert from "node:assert/strict";
import { indexDesign, labelFor, validateDesign } from "../model.mjs";
import { exampleDesign } from "./model-fixture.mjs";

function reject(mutator, code, options) {
  const spec = exampleDesign(); mutator(spec);
  const result = validateDesign(spec, options);
  assert.equal(result.ok, false, `expected failure ${code}`);
  assert.ok(result.errors.some((e) => e.code === code), JSON.stringify(result.errors));
  return result;
}

test("complete design is consistent while business verification remains pending", () => {
  const spec = exampleDesign(), result = validateDesign(spec);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.warnings.filter((x) => x.code === "verification-pending").length, 2);
  assert.deepEqual(result.traceability, [{ requirementId: "REQ-submit", ruleIds: ["BR-submit", "BR-repeat"], diagramIds: ["DIAG-context", "DIAG-state"], apiIds: ["API-submit"], dataIds: ["DATA-order"], acceptanceIds: ["AC-submit", "AC-repeat"] }]);
  assert.equal(labelFor(indexDesign(spec).get("STATE-submitted")), "已提交");
  assert.equal(labelFor(indexDesign(spec).get("API-submit")), "提交订单");
});

test("stable IDs and case-sensitive typed references are checked", () => {
  reject((s) => { s.rules[1].id = s.rules[0].id; }, "duplicate-id");
  reject((s) => { s.rules[0].id = "业务规则"; }, "id");
  reject((s) => { s.requirements[0].ruleIds = ["br-submit"]; }, "unknown-ref");
  reject((s) => { s.requirements[0].ruleIds = ["API-submit"]; }, "ref-type");
  reject((s) => { s.rules[0].refs.push("DATA-missing"); }, "unknown-ref");
  reject((s) => { s.requirements[0].ruleIds.push("BR-submit"); }, "duplicate-ref");
});

test("missing scope, delivery, evidence sources and named fields do not pass", () => {
  reject((s) => { s.scope.goals = []; }, "required-items");
  reject((s) => { delete s.delivery.rollback; }, "array");
  reject((s) => { s.rules[0].basis = "fact"; s.rules[0].source = ""; }, "required-text");
  reject((s) => { s.data[0].fields.push({ ...s.data[0].fields[0] }); }, "duplicate-field");
  reject((s) => { s.terms[1].name = s.terms[0].name; }, "duplicate-term");
  reject((s) => { s.data[0].fields[0].required = "yes"; }, "boolean");
});

test("requirements, rules and acceptance must link in both directions", () => {
  reject((s) => { s.acceptance[0].requirementIds = []; }, "acceptance-backlink");
  reject((s) => { s.requirements[0].acceptanceIds = ["AC-repeat"]; }, "requirement-backlink");
  reject((s) => { s.requirements[0].ruleIds = ["BR-submit"]; }, "orphan-rule");
  reject((s) => { s.acceptance[1].refs = ["API-submit", "TR-repeat"]; }, "rule-coverage");
  reject((s) => { s.acceptance.forEach((a) => { a.refs = a.refs.filter((r) => r !== "API-submit"); }); }, "api-coverage");
});

test("a rule-only chain cannot manufacture implementation coverage through acceptance", () => {
  reject((s) => {
    s.requirements.push({ id: "REQ-unbound", title: "未设计的需求", text: "还没有实现设计", priority: "could", ruleIds: ["BR-unbound"], acceptanceIds: ["AC-unbound"] });
    s.rules.push({ id: "BR-unbound", title: "未设计的规则", text: "没有图或接口或数据设计", basis: "decision", source: "方案草稿", refs: ["AC-unbound"] });
    s.acceptance.push({ id: "AC-unbound", title: "待实现", given: "场景", when: "动作", then: "结果", requirementIds: ["REQ-unbound"], refs: ["BR-unbound"], verification: { status: "not-run" } });
  }, "implementation-coverage");
});

test("graph endpoints, canonical labels and local IDs cannot diverge", () => {
  reject((s) => { s.diagrams[0].nodes[0].label = "另一个名称"; }, "canonical-label");
  reject((s) => { s.diagrams[0].edges[0].to = "missing"; }, "edge-endpoint");
  reject((s) => { s.diagrams[0].nodes[1].id = "client"; }, "duplicate-local-id");
  reject((s) => { s.diagrams[0].edges[0].label = "与接口不一致"; }, "canonical-label");
  reject((s) => { s.diagrams[0].nodes[0] = { id: "client", label: "客户端" }; }, "diagram-node-type");
  reject((s) => { s.diagrams[0].edges[0].refs = ["BR-missing"]; }, "unknown-ref");
});

test("state diagrams preserve self-loops and enforce canonical transition endpoints", () => {
  assert.equal(validateDesign(exampleDesign()).ok, true);
  reject((s) => { s.diagrams[1].edges[1].to = "draft"; }, "state-edge-mismatch");
  reject((s) => { s.diagrams[1].edges.pop(); }, "transition-diagram");
  reject((s) => { delete s.diagrams[1].edges[0].transitionId; s.diagrams[1].edges[0].label = "首次提交"; }, "state-edge");
  reject((s) => { s.acceptance[1].refs = ["BR-repeat", "API-submit"]; }, "transition-coverage");
  reject((s) => { s.states[1].terminal = true; }, "terminal-outgoing");
  reject((s) => { s.states[0].initial = false; }, "initial-state");
  reject((s) => { s.states[1].initial = true; }, "initial-state");
  reject((s) => { s.states.push({ id: "STATE-orphan", dataId: "DATA-order", name: "无入口状态", initial: false, terminal: false }); }, "unreachable-state");
  reject((s) => { s.states[1].name = s.states[0].name; }, "duplicate-state-name");
  reject((s) => { s.data.push({ ...s.data[0], id: "DATA-other" }); s.states[1].dataId = "DATA-other"; }, "cross-entity-transition");
});

test("API paths, owners, transition rules and data are checked", () => {
  reject((s) => { s.apis[0].method = "post"; }, "enum");
  reject((s) => { s.apis[0].path = "https://example.test/orders"; }, "api-path");
  reject((s) => { s.apis[0].owner = "DATA-order"; }, "ref-type");
  reject((s) => { s.apis.push({ ...s.apis[0], id: "API-duplicate" }); }, "duplicate-api");
  reject((s) => { s.apis[0].ruleIds = ["BR-submit"]; }, "api-transition-rules");
  reject((s) => { s.apis[0].dataIds = []; }, "api-transition-data");
});

test("passed and failed labels require matching verified receipts", () => {
  reject((s) => { s.acceptance[0].verification = { status: "passed", receipt: "evidence/result.json" }; }, "verification-evidence");
  reject((s) => { s.acceptance[0].verification = { status: "failed", receipt: "evidence/result.json" }; }, "verification-evidence");
  reject((s) => { s.acceptance[0].verification = { status: "passed", receipt: "result.json" }; }, "verification-evidence", { evidence: new Map([["AC-submit", { ok: true, status: "failed", errors: [] }]]) });
  reject((s) => { s.acceptance[0].verification = { status: "passed", receipt: "result.json" }; }, "verification-evidence", { evidence: new Map([["AC-submit", { ok: false, status: "passed", errors: ["stale digest"] }]]) });
  const s = exampleDesign(); s.acceptance[0].verification = { status: "passed", receipt: "result.json" };
  assert.equal(validateDesign(s, { evidence: new Map([["AC-submit", { ok: true, status: "passed", errors: [] }]]) }).ok, true);
});

test("skipped needs an explicit reason and receipt paths must be relative", () => {
  reject((s) => { s.acceptance[0].verification = { status: "skipped" }; }, "required-text");
  for (const receipt of ["/tmp/result.json", "C:\\logs\\result.json", "https://example.test/receipt", "\\\\server\\share\\result.json"]) {
    reject((s) => { s.acceptance[0].verification = { status: "passed", receipt }; }, "receipt-path");
  }
  const s = exampleDesign(); s.acceptance[0].verification = { status: "skipped", reason: "等待测试环境" };
  assert.equal(validateDesign(s).ok, true);
});

test("delivery requires all must and quality acceptance to pass with proof", () => {
  assert.equal(validateDesign(exampleDesign(), { phase: "delivery" }).errors.filter((e) => e.code === "delivery-gate").length, 2);
  const s = exampleDesign(), evidence = new Map();
  for (const ac of s.acceptance) { ac.verification = { status: "passed", receipt: `${ac.id}.json` }; evidence.set(ac.id, { ok: true, status: "passed", errors: [] }); }
  assert.equal(validateDesign(s, { phase: "delivery", evidence }).ok, true);
  s.requirements[0].priority = "could";
  s.acceptance[0].verification = { status: "not-run" };
  assert.equal(validateDesign(s, { phase: "delivery", evidence }).ok, true);
  s.acceptance[1].verification = { status: "not-run" };
  assert.ok(validateDesign(s, { phase: "delivery", evidence }).errors.some((e) => e.code === "delivery-gate"));
});

test("malformed JSON values yield structured errors rather than exceptions", () => {
  for (const s of [null, [], 42, "bad", {}, { schemaVersion: 1, states: [null], diagrams: [false], apis: ["x"] }]) {
    const r = validateDesign(s); assert.equal(r.ok, false); assert.ok(r.errors.length);
  }
  for (const key of Object.keys(exampleDesign())) for (const value of [null, 0, "bad", {}, [null, 1, false]]) {
    const s = exampleDesign(); s[key] = value;
    assert.doesNotThrow(() => validateDesign(s), `${key}: ${JSON.stringify(value)}`);
  }
  for (const collection of ["terms", "components", "requirements", "rules", "data", "states", "transitions", "apis", "diagrams", "acceptance", "decisions", "risks", "quality"]) {
    for (const key of Object.keys(exampleDesign()[collection][0])) {
      const s = exampleDesign(); s[collection][0][key] = { invalid: true };
      assert.doesNotThrow(() => validateDesign(s), `${collection}.${key}`);
    }
  }
  assert.deepEqual([...indexDesign(null)], []); assert.equal(labelFor(null), "");
});

test("context and sequence API calls target the canonical owner; responses use labels and refs", () => {
  for (const type of ["context", "sequence"]) {
    const spec = exampleDesign(); spec.diagrams[0].type = type;
    spec.components.push({ id: "COMP-payment", title: "支付服务", responsibility: "处理支付", kind: "service" });
    spec.diagrams[0].nodes.push({ id: "payment", ref: "COMP-payment" });
    spec.diagrams[0].edges[0].to = "payment";
    assert.ok(validateDesign(spec).errors.some((e) => e.code === "api-edge-owner"), type);
    spec.diagrams[0].edges[0].to = "service";
    spec.diagrams[0].edges.push({ id: "response", from: "service", to: "client", label: "返回提交结果", refs: ["API-submit"] });
    assert.equal(validateDesign(spec).ok, true, type);
    spec.diagrams[0].edges[1] = { id: "response", from: "service", to: "client", apiId: "API-submit" };
    assert.ok(validateDesign(spec).errors.some((e) => e.code === "api-edge-owner"), `${type} reversed call`);
  }
});

test("cancellation API and transition cannot borrow submission acceptance coverage", () => {
  const spec = exampleDesign();
  spec.requirements.push({ id: "REQ-cancel", title: "取消订单", text: "履约前允许取消订单", priority: "must", ruleIds: ["BR-cancel"], acceptanceIds: ["AC-cancel"] });
  spec.rules.push({ id: "BR-cancel", title: "提交后取消", text: "已提交且未履约的订单可转为已取消", refs: ["DATA-order", "API-cancel", "TR-cancel"], basis: "decision", source: "取消方案" });
  spec.states.push({ id: "STATE-cancelled", dataId: "DATA-order", name: "已取消", initial: false, terminal: true });
  spec.transitions.push({ id: "TR-cancel", title: "取消订单", from: "STATE-submitted", to: "STATE-cancelled", event: "申请取消", guard: "订单尚未履约", action: "保存取消结果", ruleIds: ["BR-cancel"] });
  spec.apis.push({ ...spec.apis[0], id: "API-cancel", title: "取消订单", path: "/orders/{id}/cancel", ruleIds: ["BR-cancel"], transitionIds: ["TR-cancel"] });
  spec.diagrams[1].nodes.push({ id: "cancelled", ref: "STATE-cancelled" });
  spec.diagrams[1].edges.push({ id: "cancel", from: "submitted", to: "cancelled", transitionId: "TR-cancel" });
  spec.acceptance.push({ id: "AC-cancel", title: "取消成功", given: "已提交且未履约的订单", when: "申请取消", then: "进入已取消状态", requirementIds: ["REQ-cancel"], refs: ["BR-cancel", "API-cancel", "TR-cancel"], verification: { status: "not-run" } });
  assert.equal(validateDesign(spec).ok, true);
  spec.acceptance.at(-1).refs = ["BR-cancel"];
  spec.acceptance[0].refs.push("BR-cancel", "API-cancel", "TR-cancel");
  const result = validateDesign(spec);
  assert.ok(result.errors.some((e) => e.code === "api-coverage" && e.message.includes("REQ-cancel")));
  assert.ok(result.errors.some((e) => e.code === "transition-coverage" && e.message.includes("REQ-cancel")));
});

test("shared APIs require a complete acceptance chain for each rule and owning requirement", () => {
  const spec = exampleDesign();
  spec.requirements[0].ruleIds = ["BR-submit"];
  spec.requirements[0].acceptanceIds = ["AC-submit"];
  spec.requirements.push({ id: "REQ-repeat", title: "安全重试", text: "重复提交复用原结果", priority: "must", ruleIds: ["BR-repeat"], acceptanceIds: ["AC-repeat"] });
  spec.acceptance[1].requirementIds = ["REQ-repeat"];
  assert.equal(validateDesign(spec).ok, true, "shared API across two rule/requirement chains");
  spec.requirements.push({ id: "REQ-audit", title: "重试审计", text: "验证重试的结果可追溯", priority: "should", ruleIds: ["BR-repeat"], acceptanceIds: ["AC-audit"] });
  spec.acceptance.push({ ...spec.acceptance[1], id: "AC-audit", title: "审计重试结果", requirementIds: ["REQ-audit"], refs: ["BR-repeat", "API-submit", "TR-repeat"] });
  assert.equal(validateDesign(spec).ok, true, "one shared rule has two owning requirements");
  spec.acceptance.at(-1).refs = ["BR-repeat"];
  const result = validateDesign(spec);
  assert.ok(result.errors.some((e) => e.code === "api-coverage" && e.message.includes("REQ-audit")));
  assert.ok(result.errors.some((e) => e.code === "transition-coverage" && e.message.includes("REQ-audit")));
});
