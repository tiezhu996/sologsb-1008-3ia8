import { $, component$, useSignal, useVisibleTask$, type QRL } from "@builder.io/qwik";
import { type DocumentHead } from "@builder.io/qwik-city";
import { createSeedProject, LANGUAGES, STATUS_LABELS, uid } from "../data";
import type { ReviewStatus, SignItem, SignProject } from "../types";
import {
  analyzeSign,
  cloneTerms,
  diffText,
  effectiveTermTarget,
  glossaryChecks,
  normalizeProject,
  revertSignsForEntry,
} from "../utils";

const STORAGE_KEY = "sologsb-1008-project-v1";
const WIDTHS = [320, 480, 720, 960] as const;

export const head: DocumentHead = {
  title: "公共标识多语言校对台",
  meta: [
    { name: "description", content: "公共标识译文、术语库、版本和版面风险校对工作台" },
  ],
};

function statusClass(status: ReviewStatus) {
  if (status === "confirmed") return "badge-success";
  if (status === "changes") return "badge-error";
  if (status === "pending") return "badge-warning";
  return "badge-neutral";
}

export default component$(() => {
  const project = useSignal<SignProject>(createSeedProject());
  const past = useSignal<SignProject[]>([]);
  const future = useSignal<SignProject[]>([]);
  const hydrated = useSignal(false);
  const online = useSignal(true);
  const view = useSignal<"signs" | "glossary">("signs");
  const previewWidth = useSignal(480);
  const previewFont = useSignal(42);
  const selectedVersionId = useSignal("");
  const glossaryPick = useSignal("");
  const newTermSource = useSignal("");
  const newTermLang = useSignal(LANGUAGES[0]);
  const newTermTarget = useSignal("");
  const commentDraft = useSignal("");
  const replyDraft = useSignal("");
  const replyingTo = useSignal("");
  const toast = useSignal("");
  const previewId = useSignal("");
  const readOnly = useSignal(false);
  const active = () => project.value.signs.find((sign) => sign.id === (previewId.value || project.value.activeSignId)) ?? project.value.signs[0];

  const commit = $((label: string, update: (draft: SignProject) => void) => {
    past.value = [...past.value.slice(-49), structuredClone(project.value)];
    future.value = [];
    const draft = structuredClone(project.value);
    update(draft);
    draft.updatedAt = new Date().toISOString();
    project.value = draft;
  });

  const updateActive = $((label: string, update: (sign: SignItem, draft: SignProject) => void) => {
    commit(label, (draft) => {
      const sign = draft.signs.find((item) => item.id === draft.activeSignId);
      if (sign) update(sign, draft);
    });
  });

  const undo = $(() => {
    if (!past.value.length) return;
    const previous = past.value.at(-1)!;
    future.value = [structuredClone(project.value), ...future.value].slice(0, 50);
    past.value = past.value.slice(0, -1);
    project.value = previous;
    toast.value = "已撤销";
  });

  const redo = $(() => {
    if (!future.value.length) return;
    const next = future.value[0];
    past.value = [...past.value.slice(-49), structuredClone(project.value)];
    future.value = future.value.slice(1);
    project.value = next;
    toast.value = "已重做";
  });

  const navigateSign = $((direction: 1 | -1) => {
    if (readOnly.value || view.value === "glossary") return;
    const signs = project.value.signs;
    const index = Math.max(0, signs.findIndex((sign) => sign.id === project.value.activeSignId));
    const next = signs[(index + direction + signs.length) % signs.length];
    commit("切换标识", (draft) => { draft.activeSignId = next.id; });
    selectedVersionId.value = "";
  });

  const openSign = $((signId: string) => {
    commit("切换标识", (draft) => { draft.activeSignId = signId; });
    selectedVersionId.value = "";
    view.value = "signs";
  });

  const setStatus = $((status: ReviewStatus) => {
    commit("更新审校状态", (draft) => {
      const sign = draft.signs.find((item) => item.id === draft.activeSignId);
      if (!sign) return;
      if (sign.emergencyRevision && status === "confirmed") {
        sign.status = "pending";
      } else {
        sign.status = status;
      }
    });
  });

  const toggleEmergency = $(() => {
    commit("切换紧急修订", (draft) => {
      const sign = draft.signs.find((item) => item.id === draft.activeSignId);
      if (!sign) return;
      sign.emergencyRevision = !sign.emergencyRevision;
      if (sign.emergencyRevision) sign.status = "changes";
    });
  });

  const saveVersion = $(() => {
    const sign = project.value.signs.find((item) => item.id === project.value.activeSignId);
    if (!sign) return;
    const versionId = uid("version");
    commit("保存版本快照", (draft) => {
      const current = draft.signs.find((item) => item.id === draft.activeSignId);
      if (!current) return;
      current.versions.unshift({
        id: versionId,
        label: `版本 ${current.versions.length + 1}`,
        createdAt: new Date().toISOString(),
        sourceText: current.sourceText,
        targetText: current.targetText,
        status: current.status,
        terms: cloneTerms(current.terms),
      });
      current.versions = current.versions.slice(0, 12);
    });
    selectedVersionId.value = versionId;
    toast.value = "版本快照已保存";
  });

  const bindTerm = $(() => {
    const entryId = glossaryPick.value;
    if (!entryId) return;
    updateActive("绑定术语", (sign, draft) => {
      const entry = draft.glossary.find((item) => item.id === entryId);
      if (!entry || sign.terms.some((binding) => binding.glossaryId === entryId)) return;
      sign.terms.push({
        id: uid("term"),
        glossaryId: entry.id,
        source: entry.source,
        target: entry.translations[sign.targetLanguage]?.trim() ?? "",
        required: true,
        confirmed: false,
      });
      sign.status = "pending";
    });
    glossaryPick.value = "";
  });

  const addGlossaryEntry = $(() => {
    const source = newTermSource.value.trim();
    const language = newTermLang.value;
    const target = newTermTarget.value.trim();
    if (!source || !target || !language) return;
    let merged = false;
    let reverted = 0;
    commit("登记术语", (draft) => {
      const existing = draft.glossary.find((item) => item.source === source);
      if (existing) {
        merged = true;
        if (existing.translations[language]?.trim() !== target) {
          existing.translations[language] = target;
          reverted = revertSignsForEntry(draft, existing.id, language);
        }
        existing.updatedAt = new Date().toISOString();
      } else {
        draft.glossary.push({
          id: uid("gloss"),
          source,
          translations: { [language]: target },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    });
    toast.value = merged
      ? reverted
        ? `已合并译法，${reverted} 处标识退回待确认`
        : "已合并到已有术语条目"
      : "术语已登记入库";
    newTermSource.value = "";
    newTermTarget.value = "";
  });

  const updateGlossaryTranslation = $((entryId: string, language: string, value: string) => {
    let reverted = 0;
    commit("调整固定译法", (draft) => {
      const entry = draft.glossary.find((item) => item.id === entryId);
      if (!entry) return;
      const next = value.trim();
      if (next) entry.translations[language] = next;
      else delete entry.translations[language];
      entry.updatedAt = new Date().toISOString();
      reverted = revertSignsForEntry(draft, entryId, language);
    });
    toast.value = reverted ? `固定译法已更新，${reverted} 处标识退回待确认` : "固定译法已更新";
  });

  const removeGlossaryEntry = $((entryId: string) => {
    commit("删除术语条目", (draft) => {
      draft.glossary = draft.glossary.filter((item) => item.id !== entryId);
      for (const sign of draft.signs) {
        const before = sign.terms.length;
        sign.terms = sign.terms.filter((binding) => binding.glossaryId !== entryId);
        if (sign.terms.length !== before) sign.status = "pending";
      }
    });
    toast.value = "术语条目已删除，相关绑定已移除";
  });

  const syncBinding = $((signId: string, bindingId: string) => {
    commit("同步固定译法", (draft) => {
      const sign = draft.signs.find((item) => item.id === signId);
      const binding = sign?.terms.find((item) => item.id === bindingId);
      if (!sign || !binding) return;
      const entry = draft.glossary.find((item) => item.id === binding.glossaryId);
      const fixed = entry?.translations?.[sign.targetLanguage]?.trim();
      if (fixed) binding.target = fixed;
    });
    toast.value = "已同步术语库固定译法";
  });

  const addComment = $(() => {
    const body = commentDraft.value.trim();
    if (!body) return;
    updateActive("添加审校意见", (sign) => {
      sign.comments.unshift({
        id: uid("comment"),
        author: "当前审校员",
        body,
        createdAt: new Date().toISOString(),
        resolved: false,
        replies: [],
      });
      sign.status = sign.status === "confirmed" ? "changes" : sign.status;
    });
    commentDraft.value = "";
  });

  const addReply = $((commentId: string) => {
    const body = replyDraft.value.trim();
    if (!body) return;
    updateActive("回复审校意见", (sign) => {
      const comment = sign.comments.find((item) => item.id === commentId);
      comment?.replies.push({ id: uid("reply"), author: "当前审校员", body, createdAt: new Date().toISOString() });
    });
    replyDraft.value = "";
    replyingTo.value = "";
  });

  const sharePreview: QRL<() => void> = $(() => {
    const current = project.value.signs.find((item) => item.id === project.value.activeSignId);
    if (!current) return;
    const url = `${window.location.origin}${window.location.pathname}?preview=${encodeURIComponent(current.id)}`;
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    toast.value = "只读预览链接已复制";
  });

  const preview = () => analyzeSign(active(), previewWidth.value, previewFont.value, project.value.glossary);
  const selectedVersion = () => active().versions.find((version) => version.id === selectedVersionId.value) ?? active().versions[0];
  const comparison = () => {
    const version = selectedVersion();
    return version ? diffText(version.targetText, active().targetText) : [];
  };
  const bindableEntries = () =>
    project.value.glossary.filter((entry) => !active().terms.some((term) => term.glossaryId === entry.id));
  const checks = () => glossaryChecks(project.value);
  const issueTotals = () => {
    const all = checks();
    return {
      usages: all.reduce((sum, item) => sum + item.usages.length, 0),
      mismatch: all.reduce((sum, item) => sum + item.mismatches.length, 0),
      missing: all.reduce((sum, item) => sum + item.missing.length, 0),
    };
  };
  const mismatchList = () => checks().flatMap((check) => check.mismatches.map((usage) => ({ check, usage })));
  const missingList = () => checks().flatMap((check) => check.missing.map((usage) => ({ check, usage })));

  useVisibleTask$(({ track }) => {
    track(() => hydrated.value);
    if (!hydrated.value) {
      try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "") as { schema: number; project: SignProject };
        if (stored.schema === 1 && stored.project?.signs?.length) project.value = normalizeProject(stored.project);
        const requestedPreview = new URLSearchParams(window.location.search).get("preview") ?? "";
        previewId.value = requestedPreview;
        readOnly.value = Boolean(requestedPreview);
      } catch {
        // Keep bundled sample data when storage is unavailable or malformed.
      }
      hydrated.value = true;
    }
  });

  useVisibleTask$(({ track, cleanup }) => {
    track(() => hydrated.value);
    if (!hydrated.value) return;
    track(() => project.value);
    const timer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ schema: 1, project: project.value }));
    }, 450);
    cleanup(() => window.clearTimeout(timer));
  });

  useVisibleTask$(({ cleanup }) => {
    const updateOnline = () => { online.value = navigator.onLine; };
    updateOnline();
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? undo() : undo();
      } else if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        navigateSign(1);
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        navigateSign(-1);
      } else if (event.key === "[") {
        const index = WIDTHS.indexOf(previewWidth.value as (typeof WIDTHS)[number]);
        previewWidth.value = WIDTHS[Math.max(0, index - 1)];
      } else if (event.key === "]") {
        const index = WIDTHS.indexOf(previewWidth.value as (typeof WIDTHS)[number]);
        previewWidth.value = WIDTHS[Math.min(WIDTHS.length - 1, index + 1)];
      } else if (event.key === "-") {
        previewFont.value = Math.max(28, previewFont.value - 4);
      } else if (event.key === "=") {
        previewFont.value = Math.min(88, previewFont.value + 4);
      }
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    window.addEventListener("keydown", keydown);
    cleanup(() => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("keydown", keydown);
    });
  });

  if (readOnly.value) {
    const sign = active();
    const analysis = analyzeSign(sign, previewWidth.value, previewFont.value, project.value.glossary);
    return (
      <main data-theme="corporate" class="min-h-screen bg-slate-100 p-6">
        <div class="mx-auto max-w-5xl">
          <div class="mb-4 flex items-center justify-between">
            <div>
              <div class="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Read-only preview</div>
              <h1 class="text-2xl font-bold text-slate-800">{sign.code} · {sign.scenario}</h1>
            </div>
            <span class={`badge ${statusClass(sign.status)}`}>{STATUS_LABELS[sign.status]}</span>
          </div>
          <section class="rounded-3xl bg-white p-14 shadow-xl">
            <div class="mb-3 text-center text-xs text-slate-400">中文原文</div>
            <p class="mx-auto mb-10 max-w-2xl text-center text-lg text-slate-600">{sign.sourceText}</p>
            <div class="mx-auto border-y-4 border-slate-800 py-10 text-center">
              <p class="whitespace-pre-line font-black leading-tight tracking-wide text-slate-900" style={{ fontSize: `${previewFont.value}px` }}>{analysis.visible.join("\n")}</p>
            </div>
            <div class="mt-5 text-center text-sm text-slate-500">{sign.targetLanguage} · {sign.regulation}</div>
          </section>
          <p class="mt-4 text-center text-xs text-slate-400">此链接读取当前浏览器中的本地版本，仅用于演示只读预览。</p>
        </div>
      </main>
    );
  }

  return (
    <div data-theme="corporate" class="min-h-screen bg-slate-100 pb-9 text-slate-800">
      <header class="navbar sticky top-0 z-40 min-h-16 border-b border-slate-700 bg-[#17324d] px-5 text-white shadow-lg">
        <div class="navbar-start gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-white/10 font-black">译</div>
          <div>
            <div class="text-xs uppercase tracking-[0.2em] text-sky-200">Public Sign Review</div>
            <div class="font-bold">公共标识多语言校对台</div>
          </div>
        </div>
        <div class="navbar-center gap-3">
          <div class="join">
            <button class={`btn join-item btn-sm ${view.value === "signs" ? "border-white/20 bg-white text-[#17324d]" : "btn-ghost text-slate-200"}`} onClick$={() => view.value = "signs"}>标识校对</button>
            <button class={`btn join-item btn-sm gap-1 ${view.value === "glossary" ? "border-white/20 bg-white text-[#17324d]" : "btn-ghost text-slate-200"}`} onClick$={() => view.value = "glossary"}>
              术语库
              {issueTotals().mismatch + issueTotals().missing > 0 && (
                <span class="badge badge-error badge-sm">{issueTotals().mismatch + issueTotals().missing}</span>
              )}
            </button>
          </div>
          <input
            class="input input-sm hidden w-72 border-white/15 bg-white/10 text-white placeholder:text-slate-300 xl:block"
            value={project.value.title}
            onInput$={(_, element) => commit("修改项目名称", (draft) => { draft.title = element.value; })}
            aria-label="项目名称"
          />
        </div>
        <div class="navbar-end gap-2">
          <span class={`badge ${online.value ? "badge-success" : "badge-warning"} badge-outline`}>{online.value ? "在线" : "离线草稿"}</span>
          <button class="btn btn-ghost btn-sm" disabled={!past.value.length} onClick$={undo}>撤销</button>
          <button class="btn btn-ghost btn-sm" disabled={!future.value.length} onClick$={redo}>重做</button>
          {view.value === "signs" && (
            <>
              <button class="btn btn-sm border-white/20 bg-white/10 text-white hover:bg-white/20" onClick$={sharePreview}>复制只读链接</button>
              <button class={`btn btn-sm ${active().emergencyRevision ? "btn-error" : "btn-warning"}`} onClick$={toggleEmergency}>
                {active().emergencyRevision ? "退出紧急修订" : "紧急修订"}
              </button>
            </>
          )}
        </div>
      </header>

      {view.value === "signs" && active().emergencyRevision && (
        <div class="alert alert-error sticky top-16 z-30 rounded-none border-x-0 py-2 text-white">
          <span class="text-lg">!</span>
          <span><strong>紧急修订模式</strong>：确认操作已锁定，修改后必须重新审校并保存版本。</span>
        </div>
      )}

      {view.value === "glossary" ? (
        <div class="mx-auto max-w-6xl space-y-5 p-6">
          <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div class="rounded-xl bg-white p-4 text-center shadow-sm">
              <strong class="block text-2xl font-black">{project.value.glossary.length}</strong>
              <span class="text-xs text-slate-500">术语条目</span>
            </div>
            <div class="rounded-xl bg-white p-4 text-center shadow-sm">
              <strong class="block text-2xl font-black">{issueTotals().usages}</strong>
              <span class="text-xs text-slate-500">标识引用</span>
            </div>
            <div class="rounded-xl bg-white p-4 text-center shadow-sm">
              <strong class={`block text-2xl font-black ${issueTotals().mismatch ? "text-error" : "text-success"}`}>{issueTotals().mismatch}</strong>
              <span class="text-xs text-slate-500">译法不一致</span>
            </div>
            <div class="rounded-xl bg-white p-4 text-center shadow-sm">
              <strong class={`block text-2xl font-black ${issueTotals().missing ? "text-error" : "text-success"}`}>{issueTotals().missing}</strong>
              <span class="text-xs text-slate-500">必选术语缺失</span>
            </div>
          </div>

          <section class="card border border-slate-200 bg-white shadow-sm">
            <div class="card-body p-5">
              <div>
                <h2 class="font-bold">登记术语</h2>
                <p class="text-xs text-slate-500">同一中文词重复登记会合并到已有条目；调整固定译法后，引用过它的标识会自动退回待确认。</p>
              </div>
              <div class="mt-3 grid gap-2 md:grid-cols-[1fr_150px_1fr_auto]">
                <input class="input input-sm input-bordered" placeholder="中文词，如：紧急出口" value={newTermSource.value} onInput$={(_, element) => newTermSource.value = element.value} />
                <select class="select select-sm select-bordered" value={newTermLang.value} onChange$={(_, element) => newTermLang.value = element.value}>
                  {LANGUAGES.map((language) => <option key={language}>{language}</option>)}
                </select>
                <input class="input input-sm input-bordered" placeholder="该语言的固定译法" value={newTermTarget.value} onInput$={(_, element) => newTermTarget.value = element.value} />
                <button class="btn btn-sm btn-primary" onClick$={addGlossaryEntry}>登记入库</button>
              </div>
            </div>
          </section>

          <section class="card border border-slate-200 bg-white shadow-sm">
            <div class="card-body p-5">
              <h2 class="font-bold">核对结果</h2>
              <div class="mt-3 grid gap-4 md:grid-cols-2">
                <div>
                  <div class="mb-2 text-xs font-bold uppercase tracking-wide text-error">译法与固定译法对不上</div>
                  {mismatchList().length === 0 ? (
                    <div class="rounded-lg border border-dashed p-4 text-center text-xs text-slate-400">所有引用标识的译法都与固定译法一致。</div>
                  ) : (
                    <div class="space-y-2">
                      {mismatchList().map(({ check, usage }) => (
                        <div key={usage.bindingId} class="flex items-center justify-between gap-3 rounded-lg border border-error/30 bg-error/5 px-3 py-2">
                          <div class="min-w-0 text-xs">
                            <strong>{check.entry.source}</strong>
                            <span class="mx-1 font-mono text-slate-400">{usage.signCode}</span>
                            <span class="badge badge-ghost badge-xs">{usage.language}</span>
                            <div class="mt-1 text-slate-500">标识译法「{usage.boundTarget || "—"}」≠ 固定译法「{usage.fixedTarget}」</div>
                          </div>
                          <div class="flex shrink-0 gap-1">
                            <button class="btn btn-xs btn-outline" onClick$={() => syncBinding(usage.signId, usage.bindingId)}>同步固定译法</button>
                            <button class="btn btn-xs btn-ghost" onClick$={() => openSign(usage.signId)}>打开标识</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div class="mb-2 text-xs font-bold uppercase tracking-wide text-warning">必选术语未出现在译文中</div>
                  {missingList().length === 0 ? (
                    <div class="rounded-lg border border-dashed p-4 text-center text-xs text-slate-400">所有必选术语都已在译文中出现。</div>
                  ) : (
                    <div class="space-y-2">
                      {missingList().map(({ check, usage }) => (
                        <div key={usage.bindingId} class="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
                          <div class="min-w-0 text-xs">
                            <strong>{check.entry.source}</strong>
                            <span class="mx-1 font-mono text-slate-400">{usage.signCode}</span>
                            <span class="badge badge-ghost badge-xs">{usage.language}</span>
                            <div class="mt-1 text-slate-500">译文缺少固定译法「{usage.fixedTarget || usage.boundTarget}」</div>
                          </div>
                          <button class="btn btn-xs btn-ghost shrink-0" onClick$={() => openSign(usage.signId)}>打开标识</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {checks().map(({ entry, usages, mismatches, missing }) => (
            <section key={entry.id} class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-5">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <h3 class="text-lg font-bold">{entry.source}</h3>
                      {mismatches.length > 0 && <span class="badge badge-error badge-sm">{mismatches.length} 处译法不一致</span>}
                      {missing.length > 0 && <span class="badge badge-warning badge-sm">{missing.length} 处译文缺失</span>}
                      {usages.length > 0 && mismatches.length === 0 && missing.length === 0 && <span class="badge badge-success badge-sm">全部一致</span>}
                    </div>
                    <p class="mt-1 text-xs text-slate-400">更新于 {new Date(entry.updatedAt).toLocaleString()} · {usages.length} 处标识引用</p>
                  </div>
                  <button class="btn btn-xs btn-ghost text-error" onClick$={() => removeGlossaryEntry(entry.id)}>删除条目</button>
                </div>
                <div class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {LANGUAGES.map((language) => (
                    <label key={language} class="form-control">
                      <span class="label-text mb-1 text-[11px] font-bold text-slate-500">{language}</span>
                      <input
                        class="input input-sm input-bordered"
                        placeholder="未登记"
                        value={entry.translations[language] ?? ""}
                        onChange$={(_, element) => updateGlossaryTranslation(entry.id, language, element.value)}
                      />
                    </label>
                  ))}
                </div>
                <div class="mt-4">
                  <div class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">引用标识</div>
                  {usages.length === 0 ? (
                    <div class="rounded-lg border border-dashed p-4 text-center text-xs text-slate-400">还没有标识引用该术语。</div>
                  ) : (
                    <div class="space-y-2">
                      {usages.map((usage) => (
                        <div key={usage.bindingId} class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                          <div class="min-w-0 text-xs">
                            <span class="font-mono font-bold">{usage.signCode}</span>
                            <span class="badge badge-ghost badge-xs mx-1">{usage.language}</span>
                            <span class="text-slate-500">标识译法：{usage.boundTarget || "—"}</span>
                            {usage.mismatch && <span class="font-bold text-error">　固定译法：{usage.fixedTarget}</span>}
                          </div>
                          <div class="flex shrink-0 items-center gap-1">
                            {usage.mismatch && <span class="badge badge-error badge-xs">译法不一致</span>}
                            {usage.missing && <span class="badge badge-warning badge-xs">译文未出现</span>}
                            {!usage.mismatch && !usage.missing && <span class="badge badge-success badge-xs">一致</span>}
                            {usage.mismatch && <button class="btn btn-xs btn-outline" onClick$={() => syncBinding(usage.signId, usage.bindingId)}>同步</button>}
                            <button class="btn btn-xs btn-ghost" onClick$={() => openSign(usage.signId)}>打开</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>
      ) : (
      <div class="grid min-h-[calc(100vh-64px)] grid-cols-[270px_minmax(560px,1fr)_430px] gap-px bg-slate-300">
        <aside class="overflow-y-auto bg-slate-50 p-3">
          <div class="mb-3 rounded-xl bg-white p-4 shadow-sm">
            <div class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">标识清单</div>
            <div class="mt-1 text-lg font-bold text-slate-800">{project.value.signs.length} 处标识</div>
            <p class="mt-1 text-xs leading-5 text-slate-500">{project.value.location}</p>
          </div>
          <div class="space-y-2">
            {project.value.signs.map((sign, index) => {
              const risk = analyzeSign(sign, previewWidth.value, previewFont.value, project.value.glossary);
              return (
                <button
                  key={sign.id}
                  class={`w-full rounded-xl border p-3 text-left transition ${sign.id === project.value.activeSignId ? "border-blue-400 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  onClick$={() => {
                    commit("切换标识", (draft) => { draft.activeSignId = sign.id; });
                    selectedVersionId.value = "";
                  }}
                >
                  <div class="flex items-center justify-between">
                    <span class="font-mono text-xs font-bold text-slate-500">{sign.code}</span>
                    <span class={`badge badge-sm ${statusClass(sign.status)}`}>{STATUS_LABELS[sign.status]}</span>
                  </div>
                  <div class="mt-2 line-clamp-2 text-sm font-semibold text-slate-700">{sign.sourceText}</div>
                  <div class="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{sign.targetLanguage}</span>
                    <span class={risk.risk === "high" ? "font-bold text-error" : risk.risk === "medium" ? "font-bold text-warning" : "text-success"}>
                      {risk.risk === "high" ? "高风险" : risk.risk === "medium" ? "需留意" : "版面正常"}
                    </span>
                  </div>
                  <span class="sr-only">第 {index + 1} 条</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main class="min-w-0 bg-white">
          <div class="border-b border-slate-200 bg-slate-50 px-6 py-4">
            <div class="flex items-start justify-between gap-5">
              <div>
                <div class="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">{active().code} · {active().scenario}</div>
                <h1 class="mt-1 text-xl font-bold">中文原文与译文校对</h1>
              </div>
              <div class="join">
                {(["draft", "pending", "changes", "confirmed"] as ReviewStatus[]).map((status) => (
                  <button key={status} class={`btn join-item btn-sm ${active().status === status ? "btn-primary" : "btn-outline"}`} onClick$={() => setStatus(status)}>{STATUS_LABELS[status]}</button>
                ))}
              </div>
            </div>
          </div>

          <div class="space-y-5 p-6">
            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body gap-4 p-5">
                <div class="flex items-center justify-between">
                  <div><div class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Source</div><h2 class="font-bold">中文原文</h2></div>
                  <span class="badge badge-ghost">简体中文</span>
                </div>
                <textarea
                  class="textarea textarea-bordered min-h-24 w-full text-base leading-7"
                  value={active().sourceText}
                  onInput$={(_, element) => updateActive("修改中文原文", (sign) => { sign.sourceText = element.value; sign.status = "draft"; })}
                />
              </div>
            </section>

            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body gap-4 p-5">
                <div class="grid grid-cols-2 gap-4">
                  <label class="form-control">
                    <span class="label-text mb-1 text-xs font-bold text-slate-500">目标语言</span>
                    <select class="select select-bordered" value={active().targetLanguage} onChange$={(_, element) => updateActive("修改目标语言", (sign) => { sign.targetLanguage = element.value; sign.status = "pending"; })}>
                      {LANGUAGES.map((language) => <option key={language}>{language}</option>)}
                    </select>
                  </label>
                  <label class="form-control">
                    <span class="label-text mb-1 text-xs font-bold text-slate-500">适用场景</span>
                    <input class="input input-bordered" value={active().scenario} onInput$={(_, element) => updateActive("修改适用场景", (sign) => { sign.scenario = element.value; })} />
                  </label>
                </div>
                <label class="form-control">
                  <span class="label-text mb-1 text-xs font-bold text-slate-500">法规或规范提示</span>
                  <input class="input input-bordered" value={active().regulation} onInput$={(_, element) => updateActive("修改法规提示", (sign) => { sign.regulation = element.value; })} />
                </label>
                <div class="divider my-0"></div>
                <div class="flex items-center justify-between">
                  <div><div class="text-xs font-bold uppercase tracking-[0.16em] text-blue-500">Target</div><h2 class="font-bold">目标语言译文</h2></div>
                  <button class="btn btn-sm btn-outline" onClick$={saveVersion}>保存版本快照</button>
                </div>
                <textarea
                  class="textarea textarea-bordered min-h-36 w-full text-lg leading-8"
                  value={active().targetText}
                  onInput$={(_, element) => updateActive("修改译文", (sign) => { sign.targetText = element.value; sign.status = sign.emergencyRevision ? "changes" : "pending"; })}
                />
                <div class="flex flex-wrap gap-2">
                  {active().terms.map((term) => {
                    const expected = effectiveTermTarget(active(), term, project.value.glossary);
                    const matched = expected ? active().targetText.toLocaleLowerCase().includes(expected.toLocaleLowerCase()) : true;
                    return (
                      <button
                        key={term.id}
                        title="点击切换术语确认状态"
                        class={`badge badge-lg gap-1 ${matched && term.confirmed ? "badge-success" : matched ? "badge-warning" : "badge-error"}`}
                        onClick$={() => updateActive("确认术语", (sign) => {
                          const current = sign.terms.find((item) => item.id === term.id);
                          if (current) current.confirmed = !current.confirmed;
                        })}
                      >
                        {term.source} → {expected || term.target} {matched ? (term.confirmed ? "✓" : "!") : "×"}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-5">
                <div class="flex items-center justify-between">
                  <div><h2 class="font-bold">术语绑定</h2><p class="text-xs text-slate-500">从项目术语库挑选绑定；固定译法调整后，引用标识会退回待确认。</p></div>
                  <span class="badge badge-outline">{active().terms.length} 条</span>
                </div>
                <div class="mt-4 grid grid-cols-[1fr_auto_auto] gap-2">
                  <select class="select select-sm select-bordered" value={glossaryPick.value} onChange$={(_, element) => glossaryPick.value = element.value}>
                    <option value="">从术语库选择术语…</option>
                    {bindableEntries().map((entry) => {
                      const fixed = entry.translations[active().targetLanguage]?.trim();
                      return (
                        <option key={entry.id} value={entry.id} disabled={!fixed}>
                          {`${entry.source} → ${fixed || `未登记${active().targetLanguage}译法`}`}
                        </option>
                      );
                    })}
                  </select>
                  <button class="btn btn-sm btn-primary" disabled={!glossaryPick.value} onClick$={bindTerm}>绑定</button>
                  <button class="btn btn-sm btn-outline" onClick$={() => view.value = "glossary"}>管理术语库</button>
                </div>
                {bindableEntries().length === 0 && (
                  <p class="mt-2 text-xs text-slate-400">术语库中没有更多可绑定的条目，可先到术语库登记新词。</p>
                )}
                <div class="mt-3 grid gap-2 md:grid-cols-2">
                  {active().terms.map((term) => {
                    const entry = project.value.glossary.find((item) => item.id === term.glossaryId);
                    const fixed = entry?.translations?.[active().targetLanguage]?.trim() ?? "";
                    const mismatch = Boolean(fixed) && term.target.trim() !== fixed;
                    return (
                      <div key={term.id} class="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                        <div class="min-w-0">
                          <div class="truncate text-xs font-bold">{term.source}</div>
                          <div class="truncate text-xs text-slate-500">{term.target}</div>
                          {mismatch && <div class="truncate text-[11px] font-bold text-error">固定译法已调整为 {fixed}</div>}
                        </div>
                        <div class="flex gap-1">
                          {mismatch && <button class="btn btn-xs btn-outline" onClick$={() => syncBinding(active().id, term.id)}>同步</button>}
                          <button class={`btn btn-xs ${term.confirmed ? "btn-success" : "btn-ghost"}`} onClick$={() => updateActive("确认术语", (sign) => { const target = sign.terms.find((item) => item.id === term.id); if (target) target.confirmed = !target.confirmed; })}>确认</button>
                          <button class="btn btn-xs btn-ghost text-error" onClick$={() => updateActive("删除术语", (sign) => { sign.terms = sign.terms.filter((item) => item.id !== term.id); })}>删除</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-5">
                <h2 class="font-bold">审校意见与回复</h2>
                <div class="mt-3 flex gap-2">
                  <textarea class="textarea textarea-bordered min-h-20 flex-1" placeholder="记录措辞、文化适配或法规依据…" value={commentDraft.value} onInput$={(_, element) => commentDraft.value = element.value} />
                  <button class="btn btn-primary self-end" onClick$={addComment}>添加意见</button>
                </div>
                <div class="mt-4 space-y-3">
                  {active().comments.length === 0 && <div class="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">还没有审校意见。</div>}
                  {active().comments.map((comment) => (
                    <article key={comment.id} class={`rounded-xl border-l-4 bg-slate-50 p-3 ${comment.resolved ? "border-success opacity-60" : "border-warning"}`}>
                      <div class="flex items-center justify-between text-xs"><strong>{comment.author}</strong><span class="text-slate-400">{new Date(comment.createdAt).toLocaleString()}</span></div>
                      <p class="my-2 text-sm">{comment.body}</p>
                      {comment.replies.map((reply) => (
                        <div key={reply.id} class="ml-4 my-1 border-l-2 border-slate-200 pl-3 text-xs"><strong>{reply.author}</strong>：{reply.body}</div>
                      ))}
                      {replyingTo.value === comment.id ? (
                        <div class="mt-2 flex gap-2">
                          <input class="input input-xs input-bordered flex-1" value={replyDraft.value} onInput$={(_, element) => replyDraft.value = element.value} />
                          <button class="btn btn-xs btn-primary" onClick$={() => addReply(comment.id)}>发送</button>
                        </div>
                      ) : (
                        <div class="mt-2 flex gap-2">
                          <button class="btn btn-xs btn-ghost" onClick$={() => { replyingTo.value = comment.id; }}>回复</button>
                          <button class="btn btn-xs btn-ghost" onClick$={() => updateActive("更新意见状态", (sign) => { const item = sign.comments.find((entry) => entry.id === comment.id); if (item) item.resolved = !item.resolved; })}>{comment.resolved ? "重新打开" : "标记已解决"}</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </main>

        <aside class="overflow-y-auto bg-slate-50 p-4">
          <section class="sticky top-4 space-y-4">
            <div class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-4">
                <div class="flex items-center justify-between">
                  <div><div class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Live Preview</div><h2 class="font-bold">版面实时预览</h2></div>
                  <span class={`badge ${preview().risk === "high" ? "badge-error" : preview().risk === "medium" ? "badge-warning" : "badge-success"}`}>
                    {preview().risk === "high" ? "溢出风险" : preview().risk === "medium" ? "接近边界" : "版面安全"}
                  </span>
                </div>
                <div class="mt-3 flex gap-1">
                  {WIDTHS.map((width) => <button key={width} class={`btn btn-xs flex-1 ${previewWidth.value === width ? "btn-primary" : "btn-outline"}`} onClick$={() => previewWidth.value = width}>{width}px</button>)}
                </div>
                <div class="mt-2 flex items-center gap-3 text-xs">
                  <span class="w-20">字号 {previewFont.value}px</span>
                  <input type="range" min="28" max="88" step="2" class="range range-primary range-xs flex-1" value={previewFont.value} onInput$={(_, element) => previewFont.value = Number(element.value)} />
                </div>
                <div class="mt-4 overflow-hidden rounded-xl bg-slate-800 p-3">
                  <div class="mx-auto grid min-h-48 place-items-center overflow-hidden border-4 border-white bg-[#174f3d] p-3 text-center text-white" style={{ width: `${previewWidth.value}px`, maxWidth: "100%" }}>
                    <div>
                      <div style={{ fontSize: `${previewFont.value}px` }} class="font-black leading-[1.18] tracking-wide">{preview().visible.map((line, index) => <div key={index}>{line || " "}</div>)}</div>
                    </div>
                  </div>
                </div>
                <div class="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div class="rounded-lg bg-slate-100 p-2"><strong class="block text-lg">{preview().lines.length}</strong><span>预计行数</span></div>
                  <div class="rounded-lg bg-slate-100 p-2"><strong class="block text-lg">{active().targetText.length}</strong><span>字符数</span></div>
                  <div class="rounded-lg bg-slate-100 p-2"><strong class={`block text-lg ${preview().missingTerms.length ? "text-error" : "text-success"}`}>{preview().missingTerms.length}</strong><span>缺失术语</span></div>
                </div>
                {(preview().overflow || preview().tooLong) && <div class="alert alert-error mt-3 py-2 text-xs">{preview().overflow ? "当前字号下内容超过三行，可能截断。" : "译文接近标识建议字符上限。"}</div>}
              </div>
            </div>

            <div class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-4">
                <div class="flex items-center justify-between">
                  <div><h2 class="font-bold">版本比较</h2><p class="text-xs text-slate-500">旧版快照与当前译文逐词对比。</p></div>
                  <span class="badge badge-outline">{active().versions.length} 版</span>
                </div>
                {active().versions.length ? (
                  <>
                    <select class="select select-sm select-bordered mt-3 w-full" value={selectedVersionId.value || active().versions[0].id} onChange$={(_, element) => selectedVersionId.value = element.value}>
                      {active().versions.map((version) => <option key={version.id} value={version.id}>{`${version.label} · ${new Date(version.createdAt).toLocaleTimeString()}`}</option>)}
                    </select>
                    <div class="mt-3 rounded-lg bg-slate-900 p-3 text-sm leading-7 text-slate-100">
                      {comparison().map((token, index) => (
                        <span key={index} class={token.type === "add" ? "rounded bg-green-400/25 text-green-200" : token.type === "remove" ? "bg-red-400/25 text-red-200 line-through" : ""}>{token.value}</span>
                      ))}
                    </div>
                    <div class="mt-2 flex gap-3 text-[11px]"><span class="text-green-700">绿：新增</span><span class="text-red-700">红：删除</span></div>
                  </>
                ) : (
                  <div class="mt-3 rounded-xl border border-dashed p-5 text-center text-xs text-slate-400">保存当前译文后会在这里生成可比较版本。</div>
                )}
              </div>
            </div>

            <div class="rounded-xl bg-[#17324d] p-4 text-xs text-slate-200">
              <div class="mb-2 font-bold text-white">键盘操作</div>
              <div class="grid grid-cols-2 gap-y-1"><span><kbd class="kbd kbd-xs">J/K</kbd> 切换标识</span><span><kbd class="kbd kbd-xs">[ ]</kbd> 预览宽度</span><span><kbd class="kbd kbd-xs">- =</kbd> 字号</span><span><kbd class="kbd kbd-xs">Ctrl/⌘ Z</kbd> 撤销</span></div>
            </div>
          </section>
        </aside>
      </div>
      )}

      {toast.value && <div class="toast toast-end z-50"><div class="alert alert-success"><span>{toast.value}</span></div></div>}
    </div>
  );
});
