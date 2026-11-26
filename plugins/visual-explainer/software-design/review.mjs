// Review view: a bounded, explicit projection of the checked design model.
// These checks concern presentation and reference coverage, not business correctness.
import { businessReviewText } from './business-flow.mjs';
const array = (value) => Array.isArray(value) ? value : [];
const plain = (value) => typeof value === 'string' && value.trim().length > 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const REVIEW_LIMIT = 800;

export function reviewDiagrams(spec) {
  const byId = new Map(array(spec?.diagrams).filter(object).map((d) => [d.id, d]));
  return array(spec?.review?.diagramIds).map((id) => byId.get(id)).filter(Boolean);
}
export function reviewTextLength(spec) {
  const values = [spec?.title, spec?.summary, ...businessReviewText(spec),
    ...array(spec?.review?.points).filter(object).flatMap((p) => [p.title, p.text]),
    ...array(spec?.scope?.assumptions),
    ...reviewDiagrams(spec).flatMap((d) => [d.title, d.purpose])];
  return values.filter(plain).reduce((n, value) => n + [...value.replace(/\s/gu, '')].length, 0);
}
// A conservative text lint, not a semantic similarity test. Shared short labels,
// titles, identifiers and ordinary recurring terms remain valid. Evidence fields
// are intentionally excluded: model traceability may repeat information.
export function reviewRepetitionWarnings(spec) {
  const fields = [
    ['$.summary', spec?.summary],
    ...array(spec?.review?.points).flatMap((point, i) => object(point) ? [['$.review.points[' + i + '].text', point.text]] : []),
    ...array(spec?.scope?.assumptions).map((value, i) => ['$.scope.assumptions[' + i + ']', value]),
    ...reviewDiagrams(spec).map((d) => ['$.diagrams.' + d.id + '.purpose', d.purpose])
  ];
  const first = new Map(), warnings = [], reported = new Set();
  for (const [path, value] of fields) {
    if (!plain(value)) continue;
    for (const sentence of value.split(/[。！？；\r\n]+|[.!?;](?=\s|$)/u)) {
      const key = sentence.normalize('NFKC').replace(/\s/gu, '').replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
      if ([...key].length < 16) continue;
      if (!first.has(key)) { first.set(key, path); continue; }
      const dedupe = JSON.stringify([path,key]);
      if (reported.has(dedupe)) continue;
      reported.add(dedupe);
      warnings.push({code:'review-repeat',path,message:'与 ' + first.get(key) + ' 存在重复的长句；请合并结论或确认保留该语境确有必要。'});
    }
  }
  return warnings;
}

export function reviewIssues(spec, index) {
  const issues = [];
  const error = (code, path, message) => issues.push({code,path,message});
  const review = spec?.review;
  if (!object(review)) return [{code:'review-shape',path:'$.review',message:'精简方案须有 review 对象。'}];
  const points = review.points, diagrams = review.diagramIds;
  const refs = new Set();
  if (!Array.isArray(points) || points.length < 1 || points.length > 6)
    error('review-points','$.review.points','精简方案需要 1 至 6 个核心要点。');
  for (const [i, point] of array(points).entries()) {
    const p = '$.review.points[' + i + ']';
    if (!object(point)) { error('review-point',p,'要点必须是对象。'); continue; }
    if (!plain(point.title) || !plain(point.text)) error('review-text',p,'要点标题及正文须为非空文本。');
    if (!Array.isArray(point.refs) || !point.refs.length) error('review-ref',p,'每个要点须引用真实模型 ID。');
    const seen = new Set();
    for (const id of array(point.refs)) {
      if (typeof id !== 'string' || !index.has(id)) error('review-ref',p,'未知模型引用：' + String(id));
      if (seen.has(id)) error('review-ref',p,'重复引用：' + String(id));
      seen.add(id); refs.add(id);
    }
  }
  if (!Array.isArray(diagrams) || diagrams.length > 2)
    error('review-diagrams','$.review.diagramIds','正文最多展示两张核心图。');
  const available = new Set(array(spec?.diagrams).filter(object).map((d)=>d.id));
  if (new Set(array(diagrams)).size !== array(diagrams).length || array(diagrams).some((id)=>!available.has(id)))
    error('review-diagrams','$.review.diagramIds','图 ID 必须存在且不可重复。');
  for (const req of array(spec?.requirements).filter(object)) {
    if (!refs.has(req.id)) error('review-coverage','$.review.points','评审要点遗漏需求：' + req.id);
  }
  const pending = array(spec?.scope?.assumptions);
  if (pending.length > 5) error('review-pending','$.scope.assumptions','请合并相近待确认事项至最多五项，或使用完整技术方案。');
  for (const rule of array(spec?.rules).filter(object).filter((r)=>r.basis==='assumption')) {
    if (!refs.has(rule.id) || !pending.length) error('review-assumption','$.review.points','待确认规则须关联评审要点，并在 scope.assumptions 明确说明：' + rule.id);
  }
  const length = reviewTextLength(spec);
  if (length > REVIEW_LIMIT) error('review-length','$.review','评审正文 ' + length + ' 字符超过 ' + REVIEW_LIMIT + ' 上限；请合并重述，保留关键条件和待确认事项，或明确改用完整技术方案。');
  return issues;
}
