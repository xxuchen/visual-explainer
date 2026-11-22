import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectHtml, inspectBrowser } from "../inspect.mjs";

const page = (body = "", head = "") => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${head}</head><body><main id="DESIGN-test">${body}</main></body></html>`;
const diagram = '<figure id="DIAG-state" data-sd-diagram="state"><svg viewBox="0 0 400 200" aria-labelledby="diagram-title"><title id="diagram-title">订单重复回调保持状态</title><g data-sd-node="paid"><rect width="100" height="80"/><text data-sd-label>已支付</text></g><g data-sd-edge="retry"><path d="M0 0 L1 1"/></g></svg></figure>';
const spec = { id: "DESIGN-test", terms: [{ id: "TERM-order" }], diagrams: [{ id: "DIAG-state", type: "state", nodes: [{ id: "paid", ref: "STATE-paid" }], edges: [{ id: "retry", from: "paid", to: "paid" }] }] };
const codes = (result) => result.errors.map((e) => e.code);

test("accepts self-contained Chinese HTML, source links and inline SVG", () => {
  const html = page(`${diagram}<p id="TERM-order">订单</p><a href="https://example.com/spec">需求来源</a><a href="#TERM-order">术语</a>`, '<style>.x{background:url("data:image/png;base64,YQ==")}</style>');
  assert.equal(inspectHtml(html, { spec }).ok, true);
});

test("does not parse comments, JS strings or JSON as markup", () => {
  const html = page('<!-- <div id="DESIGN-test"> --><script>const sample = \'<span id="DESIGN-test">\';</script><script type="application/json">{"sample":"<img src=\"remote.png\">"}</script>');
  assert.equal(inspectHtml(html).ok, true);
});

test("rejects duplicate IDs, broken fragments, absent source items and malformed SVG", () => {
  const result = inspectHtml(page('<div id="DESIGN-test"></div><a href="#missing">missing</a><svg viewBox="0 0 0 20"></svg>'), { spec });
  for (const code of ["DUPLICATE_ID", "MISSING_ANCHOR", "MISSING_SPEC_ITEM", "DIAGRAM_COUNT", "SVG_ACCESSIBILITY", "SVG_VIEWBOX"]) assert.ok(codes(result).includes(code), code);
});

test("checks every declared node and edge, including self loops", () => {
  const html = page(diagram.replace('data-sd-edge="retry"', 'data-omitted="retry"') + '<p id="TERM-order">订单</p>');
  assert.ok(inspectHtml(html, { spec }).errors.some((e) => e.code === "DIAGRAM_ITEM" && e.message.includes("retry")));
});

test("rejects wrong diagram type and extra or duplicate markers", () => {
  const html = page(diagram.replace('data-sd-diagram="state"', 'data-sd-diagram="flow"').replace('</svg>', '<g data-sd-node="paid"/><g data-sd-edge="extra"/></svg>') + '<p id="TERM-order">订单</p>');
  const result = inspectHtml(html, { spec });
  for (const code of ["DIAGRAM_TYPE", "DIAGRAM_ITEM_DUPLICATE", "DIAGRAM_ITEM_EXTRA"]) assert.ok(codes(result).includes(code), code);
});

test("rejects remote and local-file rendering dependencies", () => {
  const cases = [
    '<script src="https://cdn.example.com/x.js"></script>',
    '<img src="./diagram.png">',
    '<img srcset="./small.png 1x, ./large.png 2x">',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link href="kit.css" rel="stylesheet">',
    '<style>@import "https://cdn.example.com/font.css"; .x{background:url(./x.png)}</style>',
    '<style>.x{background:url(\\68 ttps://example.com/x)}</style>',
    '<svg viewBox="0 0 1 1" aria-label="x"><image href="https://example.com/x.svg"/></svg>',
    '<script>fetch("https://example.com/data")</script>',
    '<script type="module">import x from "https://example.com/module.mjs";</script>'
  ];
  for (const html of cases) assert.ok(codes(inspectHtml(page(html))).includes("EXTERNAL_RESOURCE"), html);
});

test("allows embedded resources but checks fragment resources and labeledby", () => {
  const html = page('<svg viewBox="0 0 300 200" aria-labelledby="missing-title"><path stroke="url(#missing-gradient)"/></svg>');
  assert.equal(inspectHtml(html).errors.filter((e) => e.code === "MISSING_ANCHOR").length, 2);
  assert.equal(inspectHtml(page('<img src="data:image/png;base64,YQ==">')).ok, true);
});

test("requires Chinese language, charset and viewport; rejects external subdocuments", () => {
  const result = inspectHtml('<html><head></head><body><iframe src="data:text/html,hello"></iframe><base href="https://example.com"></body></html>');
  for (const code of ["HTML_LANGUAGE", "HTML_CHARSET", "HTML_VIEWPORT", "EMBEDDED_DOCUMENT", "HTML_BASE"]) assert.ok(codes(result).includes(code), code);
});

test("browser absence is skipped or failed when required, never passed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ve-design-inspect-"));
  try {
    const path = join(dir, "page.html"), executablePath = join(dir, "missing-browser");
    await writeFile(path, page());
    const optional = await inspectBrowser(path, { executablePath });
    assert.equal(optional.status, "skipped");
    assert.match(optional.reason, /unavailable/);
    const required = await inspectBrowser(path, { executablePath, required: true });
    assert.equal(required.status, "failed");
    assert.ok(required.errors.length);
    const missing = await inspectBrowser(join(dir, "missing.html"));
    assert.equal(missing.status, "failed");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
