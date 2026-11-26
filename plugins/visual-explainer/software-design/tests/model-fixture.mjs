/** Small, complete proposal for validation and rendering tests. Business tests have not run. */
export function exampleDesign() {
  return {
    schemaVersion: 1, id: "DESIGN-order-submit", title: "订单提交与重复请求处理方案", language: "zh-CN",
    summary: "通过幂等键和订单状态约束，保证重复提交返回同一订单结果。",
    scope: { goals: ["一次业务提交只生成一个订单结果"], in: ["订单提交接口、状态变化与重试"], out: ["支付与库存扣减"], assumptions: ["同一幂等键的有效期为 24 小时，待业务确认"] },
    terms: [
      { id: "TERM-order", name: "订单", definition: "一次购买意图的业务记录" },
      { id: "TERM-idempotency", name: "幂等键", definition: "调用方为一次提交生成并在重试时复用的标识" }
    ],
    components: [
      { id: "COMP-client", title: "客户端", responsibility: "提交订单并复用幂等键重试", kind: "actor" },
      { id: "COMP-order", title: "订单服务", responsibility: "校验状态并保存唯一提交结果", kind: "service" }
    ],
    requirements: [{ id: "REQ-submit", title: "可靠提交订单", text: "用户提交或重试后取得同一有效订单结果。", priority: "must", ruleIds: ["BR-submit", "BR-repeat"], acceptanceIds: ["AC-submit", "AC-repeat"] }],
    rules: [
      { id: "BR-submit", title: "首次提交", text: "草稿订单在一次事务内写入提交结果并进入已提交状态。", refs: ["DATA-order", "API-submit", "TR-submit"], basis: "decision", source: "本方案 DEC-transaction" },
      { id: "BR-repeat", title: "重复提交", text: "相同幂等键及相同请求内容返回原订单结果；内容不同返回冲突。", refs: ["TERM-idempotency", "DATA-order", "API-submit", "TR-repeat"], basis: "assumption", source: "待业务负责人确认重复提交及冲突语义" }
    ],
    data: [{ id: "DATA-order", title: "订单记录", termId: "TERM-order", fields: [
      { name: "id", type: "string", required: true, description: "订单唯一标识" },
      { name: "idempotencyKey", type: "string", required: true, description: "业务提交的幂等键" },
      { name: "status", type: "enum", required: true, description: "引用本方案订单状态定义" }
    ], constraints: ["id 唯一", "幂等键和用户标识联合唯一"] }],
    states: [
      { id: "STATE-draft", dataId: "DATA-order", name: "草稿", initial: true, terminal: false },
      { id: "STATE-submitted", dataId: "DATA-order", name: "已提交", initial: false, terminal: false }
    ],
    transitions: [
      { id: "TR-submit", title: "接受首次提交", from: "STATE-draft", to: "STATE-submitted", event: "首次提交", guard: "请求合法且幂等键未被占用", action: "保存订单及提交结果", ruleIds: ["BR-submit"] },
      { id: "TR-repeat", title: "返回既有结果", from: "STATE-submitted", to: "STATE-submitted", event: "重复提交", guard: "幂等键及请求内容一致", action: "读取并返回原提交结果", ruleIds: ["BR-repeat"] }
    ],
    apis: [{ id: "API-submit", title: "提交订单", method: "POST", path: "/orders/{id}/submit", owner: "COMP-order", ruleIds: ["BR-submit", "BR-repeat"], dataIds: ["DATA-order"], transitionIds: ["TR-submit", "TR-repeat"], request: "订单 ID、用户身份、幂等键与订单内容", response: "订单 ID、规范状态及原始提交结果", errors: [{ code: "409", condition: "同键不同请求内容", handling: "拒绝并提示重新确认订单" }] }],
    diagrams: [
      { id: "DIAG-context", title: "提交边界", type: "context", purpose: "客户端通过订单服务完成幂等提交。", nodes: [{ id: "client", ref: "COMP-client" }, { id: "service", ref: "COMP-order" }], edges: [{ id: "submit", from: "client", to: "service", apiId: "API-submit" }] },
      { id: "DIAG-state", title: "订单提交状态", type: "state", purpose: "重复提交保持已提交状态并返回既有结果。", nodes: [{ id: "draft", ref: "STATE-draft" }, { id: "submitted", ref: "STATE-submitted" }], edges: [{ id: "first", from: "draft", to: "submitted", transitionId: "TR-submit" }, { id: "repeat", from: "submitted", to: "submitted", transitionId: "TR-repeat" }] }
    ],
    acceptance: [
      { id: "AC-submit", title: "首次提交完成", given: "合法草稿订单且幂等键未使用", when: "提交订单", then: "产生一个提交结果且订单状态为已提交", requirementIds: ["REQ-submit"], refs: ["BR-submit", "API-submit", "TR-submit", "STATE-submitted"], verification: { status: "not-run" } },
      { id: "AC-repeat", title: "重复提交复用结果", given: "同一订单已提交", when: "并发使用相同幂等键及请求内容重试", then: "所有成功响应返回同一订单结果且不重复写入", requirementIds: ["REQ-submit"], refs: ["BR-repeat", "API-submit", "TR-repeat", "STATE-submitted"], verification: { status: "not-run" } }
    ],
    decisions: [{ id: "DEC-transaction", title: "事务内保存结果", options: ["事务写入订单和幂等结果", "异步写入幂等结果"], choice: "事务写入订单和幂等结果", rationale: "避免进程异常导致结果缺失和重复创建。", refs: ["BR-submit", "DATA-order"] }],
    risks: [{ id: "RISK-contention", title: "热点幂等键争用", impact: "重复请求可能等待数据库锁", mitigation: "设置超时并监控冲突率", owner: "订单研发负责人", refs: ["API-submit"] }],
    quality: [{ id: "NFR-unique", title: "并发一致性", target: "100 个相同提交只产生一个订单结果", measurement: "并发重试测试后统计订单与提交结果记录数", acceptanceIds: ["AC-repeat"] }],
    delivery: { implementation: ["先定义唯一约束，再实现事务提交和原结果查询"], migration: ["为既有记录补齐幂等结果后启用唯一约束"], rollback: ["关闭新提交入口并保留已生成结果，以旧读路径服务查询"], monitoring: ["监控提交成功率、冲突率、锁等待和重复写入数量"] }
  };
}
