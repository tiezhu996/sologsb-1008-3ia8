import { uid } from "./data";
import type { DiffToken, GlossaryEntry, SignItem, SignProject, TermBinding } from "./types";

export function estimatedLines(text: string, width: number, fontSize: number, lineHeight = 1.25) {
  if (!text.trim()) return [];
  const usable = Math.max(120, width - 48);
  const lines: string[] = [];
  for (const hardLine of text.split("\n")) {
    if (!hardLine) {
      lines.push("");
      continue;
    }
    let current = "";
    let currentWidth = 0;
    for (const char of hardLine) {
      const charWidth = /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(char)
        ? fontSize
        : char === " "
          ? fontSize * 0.34
          : fontSize * 0.58;
      if (current && currentWidth + charWidth > usable) {
        lines.push(current.trimEnd());
        current = char.trimStart();
        currentWidth = charWidth;
      } else {
        current += char;
        currentWidth += charWidth;
      }
    }
    if (current) lines.push(current.trimEnd());
  }
  return lines;
}

export function analyzeSign(sign: SignItem, width: number, fontSize: number, glossary: GlossaryEntry[] = []) {
  const lines = estimatedLines(sign.targetText, width, fontSize);
  const lineCapacity = Math.max(1, Math.floor((width * 0.62) / (fontSize * 1.25)));
  const visible = lines.slice(0, lineCapacity);
  const overflow = lines.length > lineCapacity;
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const estimatedCharacterLimit = Math.max(12, Math.floor((width - 48) / (fontSize * 0.55)) * lineCapacity);
  const tooLong = sign.targetText.replace(/\s/g, "").length > estimatedCharacterLimit;
  const missingTerms = sign.terms.filter((term) => {
    const target = effectiveTermTarget(sign, term, glossary);
    return term.required && target && !sign.targetText.toLocaleLowerCase().includes(target.toLocaleLowerCase());
  });
  return {
    lines,
    visible,
    overflow,
    tooLong,
    missingTerms,
    risk: overflow || tooLong || missingTerms.length ? "high" : lines.length >= lineCapacity - 1 ? "medium" : "low",
  };
}

/** 术语生效译法：优先取术语库中该标识目标语言的固定译法，否则回退到绑定时的译法。 */
export function effectiveTermTarget(sign: SignItem, term: TermBinding, glossary: GlossaryEntry[]) {
  const entry = glossary.find((item) => item.id === term.glossaryId);
  const fixed = entry?.translations?.[sign.targetLanguage]?.trim();
  return fixed || term.target.trim();
}

export interface GlossaryUsageCheck {
  signId: string;
  signCode: string;
  language: string;
  bindingId: string;
  boundTarget: string;
  fixedTarget: string;
  required: boolean;
  mismatch: boolean;
  missing: boolean;
}

export interface GlossaryEntryCheck {
  entry: GlossaryEntry;
  usages: GlossaryUsageCheck[];
  mismatches: GlossaryUsageCheck[];
  missing: GlossaryUsageCheck[];
}

/** 逐条核对术语库条目：哪些标识的译法和固定译法对不上、哪些必选术语在译文里没出现。 */
export function glossaryChecks(project: SignProject): GlossaryEntryCheck[] {
  return (project.glossary ?? []).map((entry) => {
    const usages: GlossaryUsageCheck[] = [];
    for (const sign of project.signs) {
      for (const binding of sign.terms) {
        if (binding.glossaryId !== entry.id) continue;
        const fixedTarget = entry.translations[sign.targetLanguage]?.trim() ?? "";
        const effective = fixedTarget || binding.target.trim();
        const mismatch = Boolean(fixedTarget) && binding.target.trim() !== fixedTarget;
        const missing =
          binding.required &&
          Boolean(effective) &&
          !sign.targetText.toLocaleLowerCase().includes(effective.toLocaleLowerCase());
        usages.push({
          signId: sign.id,
          signCode: sign.code,
          language: sign.targetLanguage,
          bindingId: binding.id,
          boundTarget: binding.target,
          fixedTarget,
          required: binding.required,
          mismatch,
          missing,
        });
      }
    }
    return {
      entry,
      usages,
      mismatches: usages.filter((usage) => usage.mismatch),
      missing: usages.filter((usage) => usage.missing),
    };
  });
}

/** 固定译法调整后，把引用过该条目的标识退回待确认，并取消对应绑定的确认状态。 */
export function revertSignsForEntry(draft: SignProject, entryId: string, language: string) {
  let reverted = 0;
  for (const sign of draft.signs) {
    if (sign.targetLanguage !== language) continue;
    let touched = false;
    for (const binding of sign.terms) {
      if (binding.glossaryId === entryId) {
        binding.confirmed = false;
        touched = true;
      }
    }
    if (touched) {
      sign.status = "pending";
      reverted += 1;
    }
  }
  return reverted;
}

/** 兼容旧版本地数据：补建术语库，并把既有绑定按中文词关联到条目。 */
export function normalizeProject(project: SignProject): SignProject {
  if (!Array.isArray(project.glossary)) project.glossary = [];
  const bySource = new Map(project.glossary.map((entry) => [entry.source, entry]));
  for (const sign of project.signs) {
    for (const binding of sign.terms) {
      if (binding.glossaryId && project.glossary.some((entry) => entry.id === binding.glossaryId)) continue;
      let entry = bySource.get(binding.source);
      if (!entry) {
        entry = {
          id: uid("gloss"),
          source: binding.source,
          translations: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        project.glossary.push(entry);
        bySource.set(entry.source, entry);
      }
      if (!entry.translations[sign.targetLanguage] && binding.target.trim()) {
        entry.translations[sign.targetLanguage] = binding.target.trim();
      }
      binding.glossaryId = entry.id;
    }
  }
  return project;
}

function tokenize(value: string) {
  return value.match(/[\u3400-\u9fff]|[A-Za-zÀ-ÿ0-9'’\-]+|\s+|./gu) ?? [];
}

function lcsTable(left: string[], right: string[]) {
  const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

export function diffText(oldText: string, newText: string): DiffToken[] {
  const left = tokenize(oldText);
  const right = tokenize(newText);
  if (left.length * right.length > 180000) {
    return [{ type: "remove", value: oldText }, { type: "add", value: newText }];
  }
  const table = lcsTable(left, right);
  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffToken["type"], value: string) => {
    const previous = tokens.at(-1);
    if (previous?.type === type) previous.value += value;
    else tokens.push({ type, value });
  };
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push("same", left[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push("remove", left[i]);
      i += 1;
    } else {
      push("add", right[j]);
      j += 1;
    }
  }
  while (i < left.length) push("remove", left[i++]);
  while (j < right.length) push("add", right[j++]);
  return tokens;
}

export function cloneTerms(terms: TermBinding[]) {
  return structuredClone(terms);
}
