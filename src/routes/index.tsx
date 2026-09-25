import { $, component$, useSignal, useVisibleTask$, type QRL } from "@builder.io/qwik";
import { type DocumentHead } from "@builder.io/qwik-city";
import { createSeedProject, STATUS_LABELS } from "../data";
import {
  TARGET_LANGUAGES,
  buildTermReport,
  effectiveTermTarget,
  findTermEntry,
  isBindingStale,
  issueMapBySign,
  migrateProject,
} from "../terminology";
import type { ReviewStatus, SignItem, SignProject } from "../types";
import { analyzeSign, cloneTerms, diffText, uid } from "../utils";

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
  const previewWidth = useSignal(480);
  const previewFont = useSignal(42);
  const selectedVersionId = useSignal("");
  const termSource = useSignal("");
  const termTarget = useSignal("");
  const bindTermId = useSignal("");
  const glossaryOpen = useSignal(false);
  const glossaryTab = useSignal<"report" | "entries">("report");
  const newTermSource = useSignal("");
  const newTermLang = useSignal(TARGET_LANGUAGES[0]);
  const newTermTarget = useSignal("");
  const newTermRequired = useSignal(true);
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
    draft.termReport = buildTermReport(draft);
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
    if (readOnly.value) return;
    const signs = project.value.signs;
    const index = Math.max(0, signs.findIndex((sign) => sign.id === project.value.activeSignId));
    const next = signs[(index + direction + signs.length) % signs.length];
    commit("切换标识", (draft) => { draft.activeSignId = next.id; });
    selectedVersionId.value = "";
  });

  const jumpToSign = $((signId: string) => {
    commit("定位标识", (draft) => { draft.activeSignId = signId; });
    glossaryOpen.value = false;
    selectedVersionId.value = "";
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

  const bindEntryToSign = $((entryId: string) => {
    const entry = project.value.termEntries.find((item) => item.id === entryId);
    if (!entry) return;
    updateActive("绑定术语库术语", (sign) => {
      if (sign.terms.some((term) => term.termId === entry.id)) return;
      sign.terms.push({
        id: uid("term"),
        termId: entry.id,
        source: entry.source,
        target: effectiveTermTarget(entry, sign.targetLanguage),
        required: entry.required,
        confirmed: false,
      });
      sign.status = "pending";
    });
  });

  const bindLibraryTerm = $(() => {
    if (!bindTermId.value) return;
    const entry = project.value.termEntries.find((item) => item.id === bindTermId.value);
    bindTermId.value = "";
    if (!entry) return;
    bindEntryToSign(entry.id);
    toast.value = `已绑定术语「${entry.source}」`;
  });

  const addTerm = $(() => {
    const source = termSource.value.trim();
    const target = termTarget.value.trim();
    if (!source || !target) return;
    const existing = findTermEntry(project.value, source);
    if (existing) {
      bindEntryToSign(existing.id);
      toast.value = `「${existing.source}」已在术语库中，已直接绑定`;
    } else {
      const language = project.value.signs.find((sign) => sign.id === project.value.activeSignId)?.targetLanguage ?? TARGET_LANGUAGES[0];
      const entryId = uid("termentry");
      commit("登记术语并绑定", (draft) => {
        draft.termEntries.push({
          id: entryId,
          source,
          targets: { [language]: target },
          required: true,
          updatedAt: new Date().toISOString(),
        });
        const sign = draft.signs.find((item) => item.id === draft.activeSignId);
        if (sign && !sign.terms.some((term) => term.termId === entryId)) {
          sign.terms.push({ id: uid("term"), termId: entryId, source, target, required: true, confirmed: false });
          sign.status = "pending";
        }
      });
      toast.value = `已登记术语「${source}」并绑定到当前标识`;
    }
    termSource.value = "";
    termTarget.value = "";
  });

  const addGlossaryEntry = $(() => {
    const source = newTermSource.value.trim();
    const target = newTermTarget.value.trim();
    const language = newTermLang.value;
    if (!source || !target) return;
    if (findTermEntry(project.value, source)) {
      toast.value = `术语库中已存在「${source}」，请直接编辑其固定译法`;
      return;
    }
    commit("术语库登记术语", (draft) => {
      draft.termEntries.push({
        id: uid("termentry"),
        source,
        targets: { [language]: target },
        required: newTermRequired.value,
        updatedAt: new Date().toISOString(),
      });
    });
    newTermSource.value = "";
    newTermTarget.value = "";
    toast.value = `术语「${source}」已登记到术语库`;
  });

  const updateFixedTarget = $((entryId: string, language: string, rawValue: string) => {
    const entry = project.value.termEntries.find((item) => item.id === entryId);
    if (!entry) return;
    const value = rawValue.trim();
    const before = (entry.targets[language] ?? "").trim();
    if (before === value) return;
    // 固定译法一经调整，所有引用该术语的标识一律退回待确认。
    const affected = project.value.signs.filter((sign) => sign.terms.some((term) => term.termId === entryId)).length;
    commit("调整固定译法", (draft) => {
      const current = draft.termEntries.find((item) => item.id === entryId);
      if (!current) return;
      if (value) current.targets[language] = value;
      else delete current.targets[language];
      current.updatedAt = new Date().toISOString();
      for (const sign of draft.signs) {
        if (sign.terms.some((term) => term.termId === entryId)) sign.status = "pending";
      }
    });
    toast.value = affected
      ? `固定译法已更新，${affected} 处引用标识已退回待确认`
      : "固定译法已更新";
  });

  const renameEntry = $((entryId: string, rawValue: string) => {
    const value = rawValue.trim();
    const entry = project.value.termEntries.find((item) => item.id === entryId);
    if (!entry || !value || entry.source === value) return;
    commit("重命名术语", (draft) => {
      const current = draft.termEntries.find((item) => item.id === entryId);
      if (!current) return;
      current.source = value;
      current.updatedAt = new Date().toISOString();
      for (const sign of draft.signs) {
        for (const term of sign.terms) {
          if (term.termId === entryId) term.source = value;
        }
      }
    });
  });

  const toggleEntryRequired = $((entryId: string) => {
    commit("切换术语必选", (draft) => {
      const entry = draft.termEntries.find((item) => item.id === entryId);
      if (!entry) return;
      entry.required = !entry.required;
      entry.updatedAt = new Date().toISOString();
      for (const sign of draft.signs) {
        for (const term of sign.terms) {
          if (term.termId === entryId) term.required = entry.required;
        }
      }
    });
  });

  const deleteEntry = $((entryId: string) => {
    const entry = project.value.termEntries.find((item) => item.id === entryId);
    if (!entry) return;
    const usages = project.value.signs.filter((sign) => sign.terms.some((term) => term.termId === entryId)).length;
    const message = usages
      ? `删除术语「${entry.source}」？${usages} 处标识的绑定会一并移除。`
      : `删除术语「${entry.source}」？`;
    if (!window.confirm(message)) return;
    commit("删除术语库条目", (draft) => {
      draft.termEntries = draft.termEntries.filter((item) => item.id !== entryId);
      for (const sign of draft.signs) {
        sign.terms = sign.terms.filter((term) => term.termId !== entryId);
      }
    });
    toast.value = `术语「${entry.source}」已删除`;
  });

  const syncBinding = $((signId: string, bindingId: string) => {
    commit("同步固定译法", (draft) => {
      const sign = draft.signs.find((item) => item.id === signId);
      const binding = sign?.terms.find((item) => item.id === bindingId);
      if (!sign || !binding) return;
      const entry = draft.termEntries.find((item) => item.id === binding.termId);
      const fixed = entry?.targets[sign.targetLanguage]?.trim();
      if (!fixed) return;
      binding.target = fixed;
      binding.confirmed = false;
      sign.status = "pending";
    });
    toast.value = "已按术语库固定译法同步，标识退回待确认";
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

  const preview = () => analyzeSign(active(), previewWidth.value, previewFont.value, project.value.termEntries);
  const selectedVersion = () => active().versions.find((version) => version.id === selectedVersionId.value) ?? active().versions[0];
  const comparison = () => {
    const version = selectedVersion();
    return version ? diffText(version.targetText, active().targetText) : [];
  };
  const entryFor = (termId: string) => project.value.termEntries.find((entry) => entry.id === termId);
  const availableEntries = () => {
    const sign = active();
    return project.value.termEntries.filter((entry) => !sign.terms.some((term) => term.termId === entry.id));
  };
  const entryUsages = (entryId: string) => project.value.signs.filter((sign) => sign.terms.some((term) => term.termId === entryId));
  const issueMap = () => issueMapBySign(project.value.termReport);
  const bindingIssue = (bindingId: string, kind: "mismatch" | "missing") => {
    const report = project.value.termReport;
    return (kind === "mismatch" ? report.mismatchIssues : report.missingIssues).find((issue) => issue.bindingId === bindingId);
  };
  const bindingIssueForEntry = (entryId: string, language: string) => {
    const report = project.value.termReport;
    return [...report.mismatchIssues, ...report.missingIssues].some(
      (issue) => issue.termId === entryId && issue.language === language,
    );
  };
  const issueTotal = () => project.value.termReport.mismatchIssues.length + project.value.termReport.missingIssues.length;

  useVisibleTask$(({ track }) => {
    track(() => hydrated.value);
    if (!hydrated.value) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const stored = JSON.parse(raw) as { schema?: number; project?: SignProject };
          if (stored.project?.signs?.length) {
            project.value = stored.schema === 2 ? stored.project : migrateProject(stored);
          }
        }
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ schema: 2, project: project.value }));
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
    const analysis = analyzeSign(sign, previewWidth.value, previewFont.value, project.value.termEntries);
    const report = project.value.termReport;
    const signIssues = [...report.mismatchIssues, ...report.missingIssues].filter((issue) => issue.signId === sign.id);
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
            {signIssues.length > 0 && (
              <div class="mx-auto mt-8 max-w-2xl rounded-2xl border border-warning/50 bg-warning/10 p-4 text-left">
                <div class="text-sm font-bold text-slate-700">术语核对（{new Date(report.checkedAt).toLocaleString()}）</div>
                <ul class="mt-2 space-y-1 text-xs text-slate-600">
                  {signIssues.map((issue) => (
                    <li key={`${issue.kind}-${issue.bindingId}`}>
                      {issue.kind === "mismatch"
                        ? `「${issue.source}」绑定译法 ${issue.actual || "（空）"} 与固定译法 ${issue.expected} 不一致`
                        : `必选术语「${issue.source}」的固定译法 ${issue.expected} 未出现在译文中`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <p class="mt-4 text-center text-xs text-slate-400">此链接读取当前浏览器中的本地版本，仅用于演示只读预览。</p>
        </div>
      </main>
    );
  }

  const termReport = project.value.termReport;

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
        <div class="navbar-center hidden xl:flex">
          <input
            class="input input-sm w-80 border-white/15 bg-white/10 text-white placeholder:text-slate-300"
            value={project.value.title}
            onInput$={(_, element) => commit("修改项目名称", (draft) => { draft.title = element.value; })}
            aria-label="项目名称"
          />
        </div>
        <div class="navbar-end gap-2">
          <span class={`badge ${online.value ? "badge-success" : "badge-warning"} badge-outline`}>{online.value ? "在线" : "离线草稿"}</span>
          <button class="btn btn-ghost btn-sm" disabled={!past.value.length} onClick$={undo}>撤销</button>
          <button class="btn btn-ghost btn-sm" disabled={!future.value.length} onClick$={redo}>重做</button>
          <button
            class={`btn btn-sm ${issueTotal() ? "btn-error" : "border-white/20 bg-white/10 text-white hover:bg-white/20"}`}
            onClick$={() => {
              const report = project.value.termReport;
              glossaryTab.value = report.mismatchIssues.length + report.missingIssues.length ? "report" : "entries";
              glossaryOpen.value = true;
            }}
          >
            术语库{issueTotal() ? ` · ${issueTotal()} 项待处理` : ""}
          </button>
          <button class="btn btn-sm border-white/20 bg-white/10 text-white hover:bg-white/20" onClick$={sharePreview}>复制只读链接</button>
          <button class={`btn btn-sm ${active().emergencyRevision ? "btn-error" : "btn-warning"}`} onClick$={toggleEmergency}>
            {active().emergencyRevision ? "退出紧急修订" : "紧急修订"}
          </button>
        </div>
      </header>

      {active().emergencyRevision && (
        <div class="alert alert-error sticky top-16 z-30 rounded-none border-x-0 py-2 text-white">
          <span class="text-lg">!</span>
          <span><strong>紧急修订模式</strong>：确认操作已锁定，修改后必须重新审校并保存版本。</span>
        </div>
      )}

      <div class="grid min-h-[calc(100vh-64px)] grid-cols-[270px_minmax(560px,1fr)_430px] gap-px bg-slate-300">
        <aside class="overflow-y-auto bg-slate-50 p-3">
          <div class="mb-3 rounded-xl bg-white p-4 shadow-sm">
            <div class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">标识清单</div>
            <div class="mt-1 text-lg font-bold text-slate-800">{project.value.signs.length} 处标识</div>
            <p class="mt-1 text-xs leading-5 text-slate-500">{project.value.location}</p>
          </div>
          <div class="space-y-2">
            {project.value.signs.map((sign, index) => {
              const risk = analyzeSign(sign, previewWidth.value, previewFont.value, project.value.termEntries);
              const termIssues = issueMap().get(sign.id);
              const termIssueCount = (termIssues?.mismatch.length ?? 0) + (termIssues?.missing.length ?? 0);
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
                    <span class="flex items-center gap-1">
                      {termIssueCount > 0 && <span class="badge badge-xs badge-error">术语 {termIssueCount}</span>}
                      <span class={risk.risk === "high" ? "font-bold text-error" : risk.risk === "medium" ? "font-bold text-warning" : "text-success"}>
                        {risk.risk === "high" ? "高风险" : risk.risk === "medium" ? "需留意" : "版面正常"}
                      </span>
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
                      {TARGET_LANGUAGES.map((language) => <option key={language}>{language}</option>)}
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
                    const entry = entryFor(term.termId);
                    const expected = effectiveTermTarget(entry, active().targetLanguage, term.target);
                    const matched = expected ? active().targetText.toLocaleLowerCase().includes(expected.toLocaleLowerCase()) : false;
                    const stale = isBindingStale(term, entry, active().targetLanguage);
                    return (
                      <button
                        key={term.id}
                        title={stale ? "绑定译法与术语库固定译法不一致，点击切换确认状态" : "点击切换术语确认状态"}
                        class={`badge badge-lg gap-1 ${stale ? "badge-error badge-outline" : matched && term.confirmed ? "badge-success" : matched ? "badge-warning" : "badge-error"}`}
                        onClick$={() => updateActive("确认术语", (sign) => {
                          const current = sign.terms.find((item) => item.id === term.id);
                          if (current) current.confirmed = !current.confirmed;
                        })}
                      >
                        {term.source} → {expected || term.target} {stale ? "≠库" : matched ? (term.confirmed ? "✓" : "!") : "×"}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-5">
                <div class="flex items-center justify-between">
                  <div><h2 class="font-bold">术语绑定</h2><p class="text-xs text-slate-500">从项目术语库挑选绑定；固定译法以术语库为准，调整固定译法会使引用标识退回待确认。</p></div>
                  <div class="flex items-center gap-2">
                    <span class="badge badge-outline">{active().terms.length} 条</span>
                    <button class="btn btn-xs btn-outline" onClick$={() => { glossaryTab.value = "entries"; glossaryOpen.value = true; }}>管理术语库</button>
                  </div>
                </div>
                <div class="mt-4 grid grid-cols-[1fr_auto] gap-2">
                  <select class="select select-sm select-bordered" value={bindTermId.value} onChange$={(_, element) => bindTermId.value = element.value}>
                    <option value="" disabled>从术语库选择要绑定的术语…</option>
                    {availableEntries().map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.targets[active().targetLanguage]
                          ? `${entry.source} → ${entry.targets[active().targetLanguage]}`
                          : `${entry.source}（未登记该语言译法）`}
                      </option>
                    ))}
                  </select>
                  <button class="btn btn-sm btn-primary" disabled={!bindTermId.value} onClick$={bindLibraryTerm}>绑定所选</button>
                </div>
                {availableEntries().length === 0 && <p class="mt-1 text-[11px] text-slate-400">术语库中的条目都已绑定到当前标识。</p>}
                <div class="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input class="input input-sm input-bordered" placeholder="新术语中文词" value={termSource.value} onInput$={(_, element) => termSource.value = element.value} />
                  <input class="input input-sm input-bordered" placeholder={`${active().targetLanguage} 固定译法`} value={termTarget.value} onInput$={(_, element) => termTarget.value = element.value} />
                  <button class="btn btn-sm btn-outline btn-primary" onClick$={addTerm}>登记并绑定</button>
                </div>
                <div class="mt-3 grid gap-2 md:grid-cols-2">
                  {active().terms.map((term) => {
                    const signId = project.value.activeSignId;
                    const entry = entryFor(term.termId);
                    const fixed = entry?.targets[active().targetLanguage]?.trim() ?? "";
                    const stale = isBindingStale(term, entry, active().targetLanguage);
                    const missing = Boolean(bindingIssue(term.id, "missing"));
                    return (
                      <div key={term.id} class={`rounded-lg border px-3 py-2 ${stale ? "border-error/60 bg-error/5" : "border-slate-200"}`}>
                        <div class="flex items-center justify-between gap-2">
                          <div class="min-w-0">
                            <div class="truncate text-xs font-bold">
                              {term.source}
                              <span class={`ml-1 badge badge-xs ${term.required ? "badge-warning" : "badge-ghost"}`}>{term.required ? "必选" : "可选"}</span>
                            </div>
                            <div class="mt-0.5 truncate text-[11px] text-slate-500">
                              固定译法：{fixed || <span class="text-warning">未登记 {active().targetLanguage} 译法</span>}
                            </div>
                            <div class={`truncate text-[11px] ${stale ? "font-bold text-error" : "text-slate-500"}`}>
                              标识绑定：{term.target || "（空）"}{stale ? "（与固定译法不一致）" : ""}
                            </div>
                            {missing && <div class="text-[11px] font-bold text-error">固定译法未出现在译文中</div>}
                          </div>
                          <div class="flex shrink-0 flex-col items-end gap-1">
                            <div class="flex gap-1">
                              <button class={`btn btn-xs ${term.confirmed ? "btn-success" : "btn-ghost"}`} onClick$={() => updateActive("确认术语", (sign) => { const target = sign.terms.find((item) => item.id === term.id); if (target) target.confirmed = !target.confirmed; })}>确认</button>
                              <button class="btn btn-xs btn-ghost text-error" onClick$={() => updateActive("删除术语", (sign) => { sign.terms = sign.terms.filter((item) => item.id !== term.id); })}>删除</button>
                            </div>
                            <div class="flex gap-1">
                              <button class="btn btn-xs btn-ghost" onClick$={() => updateActive("切换术语必选", (sign) => { const target = sign.terms.find((item) => item.id === term.id); if (target) target.required = !target.required; })}>{term.required ? "设为可选" : "设为必选"}</button>
                              {stale && <button class="btn btn-xs btn-outline btn-error" onClick$={() => syncBinding(signId, term.id)}>同步固定译法</button>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {active().terms.length === 0 && <div class="rounded-lg border border-dashed p-4 text-center text-xs text-slate-400 md:col-span-2">尚未绑定术语，从上方术语库选择或登记新术语。</div>}
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

      {glossaryOpen.value && (
        <div class="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick$={(event) => { if (event.target === event.currentTarget) glossaryOpen.value = false; }}>
          <div class="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div class="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <h2 class="text-lg font-bold">项目术语库</h2>
                <p class="text-xs text-slate-500">登记中文词与各目标语言的固定译法；标识绑定从这里挑选，核对结果随项目一起保存在本地。</p>
              </div>
              <button class="btn btn-sm btn-ghost" onClick$={() => glossaryOpen.value = false}>关闭</button>
            </div>
            <div class="flex items-center gap-2 border-b border-slate-200 px-5 py-2">
              <button class={`btn btn-xs ${glossaryTab.value === "report" ? "btn-primary" : "btn-ghost"}`} onClick$={() => glossaryTab.value = "report"}>
                核对结果{issueTotal() ? `（${issueTotal()}）` : ""}
              </button>
              <button class={`btn btn-xs ${glossaryTab.value === "entries" ? "btn-primary" : "btn-ghost"}`} onClick$={() => glossaryTab.value = "entries"}>
                术语登记（{project.value.termEntries.length}）
              </button>
              <span class="ml-auto text-[11px] text-slate-400">核对时间 {new Date(termReport.checkedAt).toLocaleString()}</span>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto p-5">
              {glossaryTab.value === "report" ? (
                <div class="space-y-5">
                  <div class="grid grid-cols-2 gap-3 text-center">
                    <div class={`rounded-xl border p-3 ${termReport.mismatchIssues.length ? "border-error/40 bg-error/5" : "border-slate-200"}`}>
                      <strong class={`block text-2xl ${termReport.mismatchIssues.length ? "text-error" : ""}`}>{termReport.mismatchIssues.length}</strong>
                      <span class="text-xs">译法与固定译法不一致</span>
                    </div>
                    <div class={`rounded-xl border p-3 ${termReport.missingIssues.length ? "border-warning/50 bg-warning/10" : "border-slate-200"}`}>
                      <strong class={`block text-2xl ${termReport.missingIssues.length ? "text-warning" : ""}`}>{termReport.missingIssues.length}</strong>
                      <span class="text-xs">必选术语未出现在译文</span>
                    </div>
                  </div>

                  <section>
                    <h3 class="mb-2 text-sm font-bold">译法不一致的标识</h3>
                    {termReport.mismatchIssues.length === 0 && <div class="rounded-xl border border-dashed p-4 text-center text-xs text-slate-400">所有绑定的译法都与术语库固定译法一致。</div>}
                    <div class="space-y-2">
                      {termReport.mismatchIssues.map((issue) => (
                        <div key={`mismatch-${issue.bindingId}`} class="flex items-center justify-between gap-3 rounded-xl border border-error/40 bg-error/5 px-3 py-2">
                          <div class="min-w-0">
                            <div class="flex items-center gap-2">
                              <button class="badge badge-sm badge-outline" onClick$={() => jumpToSign(issue.signId)}>{issue.signCode}</button>
                              <span class="text-sm font-bold">{issue.source}</span>
                              <span class="badge badge-xs">{issue.language}</span>
                            </div>
                            <div class="mt-1 text-xs text-slate-600">
                              固定译法 <strong>{issue.expected}</strong>，标识绑定 <strong class="text-error">{issue.actual || "（空）"}</strong>
                            </div>
                          </div>
                          <div class="flex shrink-0 gap-1">
                            <button class="btn btn-xs btn-outline btn-error" onClick$={() => syncBinding(issue.signId, issue.bindingId)}>同步固定译法</button>
                            <button class="btn btn-xs btn-ghost" onClick$={() => jumpToSign(issue.signId)}>查看标识</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h3 class="mb-2 text-sm font-bold">必选术语未出现在译文的标识</h3>
                    {termReport.missingIssues.length === 0 && <div class="rounded-xl border border-dashed p-4 text-center text-xs text-slate-400">所有必选术语的固定译法都已出现在译文中。</div>}
                    <div class="space-y-2">
                      {termReport.missingIssues.map((issue) => (
                        <div key={`missing-${issue.bindingId}`} class="flex items-center justify-between gap-3 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2">
                          <div class="min-w-0">
                            <div class="flex items-center gap-2">
                              <button class="badge badge-sm badge-outline" onClick$={() => jumpToSign(issue.signId)}>{issue.signCode}</button>
                              <span class="text-sm font-bold">{issue.source}</span>
                              <span class="badge badge-xs">{issue.language}</span>
                            </div>
                            <div class="mt-1 text-xs text-slate-600">固定译法 <strong>{issue.expected}</strong> 未出现在当前译文中</div>
                          </div>
                          <button class="btn btn-xs btn-ghost shrink-0" onClick$={() => jumpToSign(issue.signId)}>查看标识</button>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              ) : (
                <div class="space-y-4">
                  <details class="rounded-xl border border-slate-200 bg-slate-50 p-3" open={project.value.termEntries.length === 0}>
                    <summary class="cursor-pointer text-sm font-bold">登记新术语</summary>
                    <div class="mt-3 grid grid-cols-[1fr_150px_1fr_auto_auto] items-center gap-2">
                      <input class="input input-sm input-bordered" placeholder="中文词，如：无障碍电梯" value={newTermSource.value} onInput$={(_, element) => newTermSource.value = element.value} />
                      <select class="select select-sm select-bordered" value={newTermLang.value} onChange$={(_, element) => newTermLang.value = element.value}>
                        {TARGET_LANGUAGES.map((language) => <option key={language}>{language}</option>)}
                      </select>
                      <input class="input input-sm input-bordered" placeholder="固定译法" value={newTermTarget.value} onInput$={(_, element) => newTermTarget.value = element.value} />
                      <label class="flex cursor-pointer items-center gap-1 text-xs">
                        <input type="checkbox" class="checkbox checkbox-xs" checked={newTermRequired.value} onChange$={(_, element) => newTermRequired.value = element.checked} />
                        必选
                      </label>
                      <button class="btn btn-sm btn-primary" onClick$={addGlossaryEntry}>登记</button>
                    </div>
                  </details>

                  {project.value.termEntries.length === 0 && <div class="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">术语库还是空的，先登记一条术语。</div>}
                  {project.value.termEntries.map((entry) => {
                    const usages = entryUsages(entry.id);
                    return (
                      <article key={entry.id} class="rounded-xl border border-slate-200 p-4">
                        <div class="flex items-center justify-between gap-3">
                          <input
                            class="input input-sm input-bordered w-56 font-bold"
                            value={entry.source}
                            aria-label="术语中文词"
                            onChange$={(_, element) => renameEntry(entry.id, element.value)}
                          />
                          <div class="flex items-center gap-3 text-xs">
                            <label class="flex cursor-pointer items-center gap-1">
                              <input type="checkbox" class="checkbox checkbox-xs" checked={entry.required} onChange$={() => toggleEntryRequired(entry.id)} />
                              默认必选
                            </label>
                            <span class="text-slate-400">{usages.length} 处标识引用</span>
                            <button class="btn btn-xs btn-ghost text-error" onClick$={() => deleteEntry(entry.id)}>删除</button>
                          </div>
                        </div>
                        <div class="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
                          {TARGET_LANGUAGES.map((language) => (
                            <label key={language} class="form-control">
                              <span class="label-text mb-0.5 text-[11px] text-slate-400">{language}</span>
                              <input
                                class={`input input-sm input-bordered ${bindingIssueForEntry(entry.id, language) ? "border-error" : ""}`}
                                placeholder="未登记"
                                value={entry.targets[language] ?? ""}
                                onChange$={(_, element) => updateFixedTarget(entry.id, language, element.value)}
                              />
                            </label>
                          ))}
                        </div>
                        {usages.length > 0 && (
                          <div class="mt-3 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                            <span>引用标识：</span>
                            {usages.map((sign) => {
                              const issues = issueMap().get(sign.id);
                              const count = (issues?.mismatch ?? []).filter((issue) => issue.termId === entry.id).length
                                + (issues?.missing ?? []).filter((issue) => issue.termId === entry.id).length;
                              return (
                                <button key={sign.id} class={`badge badge-sm ${count ? "badge-error" : "badge-ghost"}`} onClick$={() => jumpToSign(sign.id)}>
                                  {sign.code}{count ? ` · ${count}` : ""}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {toast.value && <div class="toast toast-end z-50"><div class="alert alert-success"><span>{toast.value}</span></div></div>}
    </div>
  );
});
