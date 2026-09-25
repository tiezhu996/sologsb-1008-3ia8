import { uid } from "./utils";
import type { SignItem, SignProject, TermBinding, TermCheckReport, TermEntry, TermIssue } from "./types";

export const TARGET_LANGUAGES = ["English", "日本語", "Français", "Deutsch", "한국어", "Español"];

const normalizeForCompare = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

/** 按中文词查找术语库条目。 */
export function findTermEntry(project: Pick<SignProject, "termEntries">, source: string) {
  const keyword = source.trim();
  return project.termEntries.find((entry) => entry.source.trim() === keyword);
}

/**
 * 术语在某语言下的固定译法。
 * 术语库未登记该语言译法时，回退到标识绑定上保存的快照译法。
 */
export function effectiveTermTarget(
  entry: TermEntry | undefined,
  language: string,
  fallback = "",
) {
  const fixed = entry?.targets[language]?.trim();
  return fixed || fallback;
}

/** 判断标识绑定的译法快照是否与术语库固定译法不一致（固定译法缺失不算不一致）。 */
export function isBindingStale(binding: TermBinding, entry: TermEntry | undefined, language: string) {
  const fixed = entry?.targets[language]?.trim();
  if (!fixed) return false;
  return fixed.trim() !== binding.target.trim();
}

/** 全项目术语核对：列出译法对不上、必选译法缺失的标识。 */
export function buildTermReport(project: Pick<SignProject, "termEntries" | "signs">): TermCheckReport {
  const mismatchIssues: TermIssue[] = [];
  const missingIssues: TermIssue[] = [];
  for (const sign of project.signs) {
    for (const binding of sign.terms) {
      const entry = project.termEntries.find((item) => item.id === binding.termId);
      if (!entry) continue;
      const fixed = entry.targets[sign.targetLanguage]?.trim();
      const expected = fixed || binding.target.trim();

      if (fixed && isBindingStale(binding, entry, sign.targetLanguage)) {
        mismatchIssues.push({
          kind: "mismatch",
          signId: sign.id,
          signCode: sign.code,
          language: sign.targetLanguage,
          termId: entry.id,
          bindingId: binding.id,
          source: entry.source,
          expected: fixed,
          actual: binding.target,
        });
      }

      if (binding.required && expected && !normalizeForCompare(sign.targetText).includes(normalizeForCompare(expected))) {
        missingIssues.push({
          kind: "missing",
          signId: sign.id,
          signCode: sign.code,
          language: sign.targetLanguage,
          termId: entry.id,
          bindingId: binding.id,
          source: entry.source,
          expected,
          actual: binding.target,
        });
      }
    }
  }
  return { checkedAt: new Date().toISOString(), mismatchIssues, missingIssues };
}

export function issueMapBySign(report: TermCheckReport) {
  const map = new Map<string, { mismatch: TermIssue[]; missing: TermIssue[] }>();
  const add = (issues: TermIssue[], key: "mismatch" | "missing") => {
    for (const issue of issues) {
      const bucket = map.get(issue.signId) ?? { mismatch: [], missing: [] };
      bucket[key].push(issue);
      map.set(issue.signId, bucket);
    }
  };
  add(report.mismatchIssues, "mismatch");
  add(report.missingIssues, "missing");
  return map;
}

interface LegacyProject {
  id?: unknown;
  title?: unknown;
  location?: unknown;
  activeSignId?: unknown;
  updatedAt?: unknown;
  signs?: Array<{
    id?: unknown;
    terms?: Array<Record<string, unknown>>;
    versions?: Array<{ terms?: Array<Record<string, unknown>> }>;
  }>;
}

/**
 * 迁移旧版本（schema 1）数据：把散落在各标识上的自由文本术语汇总成项目术语库，
 * 绑定改为引用术语库条目。同一中文词在不同标识里译法不一致时，
 * 先登记的译法作为固定译法，其余引用自然出现在核对报告的“不一致”列表里。
 */
export function migrateProject(stored: { schema?: number; project?: unknown }): SignProject {
  const legacy = (stored.project ?? {}) as LegacyProject;
  const entries: TermEntry[] = [];
  const now = new Date().toISOString();

  const getEntry = (source: string, target: string, language: string) => {
    let entry = entries.find((item) => item.source === source);
    if (!entry) {
      entry = { id: uid("termentry"), source, targets: {}, required: true, updatedAt: now };
      entries.push(entry);
    }
    if (!entry.targets[language]) entry.targets[language] = target;
    return entry;
  };

  const migrateBindings = (bindings: Array<Record<string, unknown>> | undefined, language: string): TermBinding[] =>
    (bindings ?? [])
      .map((raw) => {
        const source = String(raw.source ?? "").trim();
        const target = String(raw.target ?? "").trim();
        if (!source || !target) return undefined;
        const entry = getEntry(source, target, language);
        return {
          id: String(raw.id ?? uid("term")),
          termId: entry.id,
          source,
          target,
          required: raw.required !== false,
          confirmed: Boolean(raw.confirmed),
        } satisfies TermBinding;
      })
      .filter((binding): binding is TermBinding => Boolean(binding));

  const signs = (legacy.signs ?? []).map((rawSign, signIndex) => {
    const sign = rawSign as Record<string, unknown>;
    const language = String(sign.targetLanguage ?? "English");
    return {
      id: String(sign.id ?? `sign-${signIndex + 1}`),
      code: String(sign.code ?? `S-${signIndex + 1}`),
      sourceText: String(sign.sourceText ?? ""),
      targetLanguage: language,
      targetText: String(sign.targetText ?? ""),
      scenario: String(sign.scenario ?? ""),
      regulation: String(sign.regulation ?? ""),
      status: (sign.status as SignItem["status"]) ?? "draft",
      terms: migrateBindings(rawSign.terms, language),
      comments: Array.isArray(sign.comments) ? (sign.comments as SignItem["comments"]) : [],
      versions: Array.isArray(sign.versions)
        ? (sign.versions.map((version) => ({ ...version, terms: migrateBindings(version.terms, language) })) as SignItem["versions"])
        : [],
      emergencyRevision: Boolean(sign.emergencyRevision),
      updatedAt: String(sign.updatedAt ?? now),
    } satisfies SignItem;
  });

  const project: SignProject = {
    id: String(legacy.id ?? "public-sign-review"),
    title: String(legacy.title ?? "公共标识多语言校对"),
    location: String(legacy.location ?? ""),
    activeSignId: String(legacy.activeSignId ?? signs[0]?.id ?? ""),
    signs,
    termEntries: entries,
    termReport: { checkedAt: now, mismatchIssues: [], missingIssues: [] },
    updatedAt: String(legacy.updatedAt ?? now),
  };
  project.termReport = buildTermReport(project);
  return project;
}
