import type { ReviewStatus, SignItem, SignProject, TermBinding, TermEntry } from "./types";
import { buildTermReport } from "./terminology";
import { uid } from "./utils";

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "草稿",
  pending: "待确认",
  confirmed: "已确认",
  changes: "需修改",
};

const entry = (id: string, source: string, targets: Record<string, string>, required = true): TermEntry => ({
  id,
  source,
  targets,
  required,
  updatedAt: "2026-09-20T08:00:00.000Z",
});

const bind = (entryId: string, source: string, target: string, confirmed = false, required = true): TermBinding => ({
  id: uid("term"),
  termId: entryId,
  source,
  target,
  required,
  confirmed,
});

export const createSeedProject = (): SignProject => {
  const termEntries: TermEntry[] = [
    entry("te-waiting-area", "候车区", { English: "Waiting Area" }),
    entry("te-yellow-line", "黄线", { English: "yellow line" }),
    entry("te-emergency-exit", "紧急出口", { English: "EMERGENCY EXIT" }),
    entry("te-elevator", "电梯", { English: "elevator" }),
    entry("te-drinking-water", "直饮水", { "日本語": "飲料水" }),
    entry("te-sink", "水槽", { "日本語": "排水口" }),
    entry("te-no-smoking", "禁止吸烟", { "Français": "INTERDICTION DE FUMER" }),
    entry("te-e-cigarette", "电子烟", { "Français": "Cigarettes électroniques" }),
    entry("te-accessible-elevator", "无障碍电梯", { English: "accessible elevator" }),
  ];

  const signs: SignItem[] = [
    {
      id: "sign-platform",
      code: "TR-01",
      sourceText: "候车区。请在黄线内排队，照看好随身物品。",
      targetLanguage: "English",
      targetText: "Waiting Area\nPlease queue behind the yellow line and keep your belongings with you.",
      scenario: "轨道交通站台",
      regulation: "GB/T 10001.1-2023 公共信息图形符号",
      status: "pending",
      terms: [bind("te-waiting-area", "候车区", "Waiting Area"), bind("te-yellow-line", "黄线", "yellow line")],
      comments: [],
      versions: [],
      emergencyRevision: false,
      updatedAt: "2026-09-21T09:20:00.000Z",
    },
    {
      id: "sign-exit",
      code: "EM-02",
      sourceText: "紧急出口。发生紧急情况时，请按指示方向迅速撤离，不要乘坐电梯。",
      targetLanguage: "English",
      targetText: "EMERGENCY EXIT\nIn an emergency, leave quickly in the direction shown. Do not use the elevator.",
      scenario: "商场疏散通道",
      regulation: "GB 13495.1-2015 消防安全标志",
      status: "confirmed",
      terms: [bind("te-emergency-exit", "紧急出口", "EMERGENCY EXIT", true), bind("te-elevator", "电梯", "elevator", true)],
      comments: [],
      versions: [],
      emergencyRevision: false,
      updatedAt: "2026-09-18T06:10:00.000Z",
    },
    {
      id: "sign-water",
      code: "SV-03",
      sourceText: "直饮水。请勿将茶叶、果皮等杂物丢入水槽。",
      targetLanguage: "日本語",
      targetText: "飲料水\n茶殻や果物の皮などを流さないでください。",
      scenario: "公园服务亭",
      regulation: "城市公共设施双语标识译写规范",
      status: "changes",
      terms: [bind("te-drinking-water", "直饮水", "飲料水"), bind("te-sink", "水槽", "排水口")],
      comments: [],
      versions: [],
      emergencyRevision: false,
      updatedAt: "2026-09-23T02:40:00.000Z",
    },
    {
      id: "sign-smoking",
      code: "PR-07",
      sourceText: "禁止吸烟。包括电子烟。",
      targetLanguage: "Français",
      targetText: "INTERDICTION DE FUMER\nCigarettes électroniques incluses.",
      scenario: "医院入口",
      regulation: "公共场所卫生管理条例实施细则",
      status: "draft",
      terms: [bind("te-no-smoking", "禁止吸烟", "INTERDICTION DE FUMER"), bind("te-e-cigarette", "电子烟", "Cigarettes électroniques")],
      comments: [],
      versions: [],
      emergencyRevision: false,
      updatedAt: "2026-09-24T04:15:00.000Z",
    },
    {
      id: "sign-elevator",
      code: "PR-11",
      sourceText: "无障碍电梯。行动不便者可乘电梯直达站厅。",
      targetLanguage: "English",
      targetText: "Accessible Elevator\nPassengers with limited mobility may take the lift directly to the concourse.",
      scenario: "交通枢纽换乘大厅",
      regulation: "GB 50763-2012 无障碍设计规范",
      status: "pending",
      terms: [
        bind("te-accessible-elevator", "无障碍电梯", "accessible elevator"),
        // 绑定时的旧译法，与术语库中“电梯”的固定译法 elevator 不一致，用于演示核对报告。
        bind("te-elevator", "电梯", "lift", true),
      ],
      comments: [],
      versions: [],
      emergencyRevision: false,
      updatedAt: "2026-09-24T10:30:00.000Z",
    },
  ];

  const project: SignProject = {
    id: "public-sign-review-1008",
    title: "城市公共标识多语言校对",
    location: "滨海交通枢纽一期",
    activeSignId: signs[0].id,
    signs,
    termEntries,
    termReport: { checkedAt: new Date().toISOString(), mismatchIssues: [], missingIssues: [] },
    updatedAt: new Date().toISOString(),
  };
  project.termReport = buildTermReport(project);
  return project;
};
