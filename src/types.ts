export type ReviewStatus = "draft" | "pending" | "confirmed" | "changes";

export interface Reply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ReviewComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  resolved: boolean;
  replies: Reply[];
}

/**
 * 项目术语库中的一条术语：一个中文词对应若干目标语言的固定译法。
 */
export interface TermEntry {
  id: string;
  source: string;
  targets: Record<string, string>;
  required: boolean;
  note?: string;
  updatedAt: string;
}

/**
 * 标识对术语库条目的引用。target 是绑定时的固定译法快照，
 * 用于和术语库里最新的固定译法比对；调整固定译法后二者会出现不一致。
 */
export interface TermBinding {
  id: string;
  termId: string;
  source: string;
  target: string;
  required: boolean;
  confirmed: boolean;
}

export interface VersionSnapshot {
  id: string;
  label: string;
  createdAt: string;
  sourceText: string;
  targetText: string;
  status: ReviewStatus;
  terms: TermBinding[];
}

export interface SignItem {
  id: string;
  code: string;
  sourceText: string;
  targetLanguage: string;
  targetText: string;
  scenario: string;
  regulation: string;
  status: ReviewStatus;
  terms: TermBinding[];
  comments: ReviewComment[];
  versions: VersionSnapshot[];
  emergencyRevision: boolean;
  updatedAt: string;
}

export type TermIssueKind = "mismatch" | "missing";

/**
 * 术语核对结果条目：
 * - mismatch：标识绑定的译法和术语库里的固定译法对不上
 * - missing：必选术语的固定译法没有出现在译文中
 */
export interface TermIssue {
  kind: TermIssueKind;
  signId: string;
  signCode: string;
  language: string;
  termId: string;
  bindingId: string;
  source: string;
  expected: string;
  actual: string;
}

export interface TermCheckReport {
  checkedAt: string;
  mismatchIssues: TermIssue[];
  missingIssues: TermIssue[];
}

export interface SignProject {
  id: string;
  title: string;
  location: string;
  activeSignId: string;
  signs: SignItem[];
  termEntries: TermEntry[];
  termReport: TermCheckReport;
  updatedAt: string;
}

export interface PersistedProject {
  schema: 2;
  project: SignProject;
}

export interface DiffToken {
  type: "same" | "add" | "remove";
  value: string;
}
