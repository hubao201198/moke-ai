"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import type { Lead } from "../types/lead";
import { AddContactView, BroadcastView, PrivateReplyView, SensitiveWordsView } from "./AutomationViews";

type View = "dashboard" | "search" | "leads" | "automation-add" | "automation-reply" | "automation-broadcast" | "review" | "knowledge" | "sensitive" | "finance" | "analytics" | "settings";
type Stats = { total: number; byStage: Record<string, number>; searchJobs: number };
type SearchJob = { id: string; query: string; status: string; resultCount: number; provider: string; createdAt: string };
type Integration = { configured: boolean; label: string; model?: string; note?: string; docsUrl?: string; consoleUrl?: string; accountConfigured?: boolean; protocolVerified?: boolean };
type Integrations = { openrouter?: Integration; search?: Integration; coze?: Integration; email?: Integration; jingyu?: Integration };
type EmailMessage = { id: string; leadId: string; direction: string; kind: string; parentMessageId: string; toEmail: string; subject: string; contentText: string; status: string; intent: string; riskLevel: string; providerMessageId?: string | null; errorMessage?: string | null; sentAt?: string | null; createdAt: string };
type EmailUsage = { dailyLimit: number; sentToday: number; remainingToday: number };
type Suppression = { id: string; email: string; reason: string; source: string; createdAt: string };
type FollowUpPlan = { id: string; leadId: string; rootMessageId: string; draftMessageId: string; stepNumber: number; delayDays: number; dueAt: string; status: string; createdAt: string };
type AutomationTask = { id: string; name: string; channel: string; taskType: "add_contact" | "private_reply" | "broadcast"; sourceType: string; status: string; nextRunAt?: string | null; lastRunAt?: string | null; createdAt: string; config: { kind?: string; content?: string; verify?: string; rules?: string; libraryIds?: string[]; sensitiveWords?: string[]; autoReplyNormal?: boolean; requireReview?: boolean; fixedContent?: string; contentMode?: string; lastError?: string; targets?: { leadId?: string; company: string; phone: string; wechat?: string; status: string }[] } };
type KnowledgeSource = { id: string; name: string; kind: string; libraryType: "knowledge" | "corpus" | "material" | "sensitive"; category: string; sourceUrl: string; fileName: string; contentType: string; fileSize: number; pageCount: number; contentText: string; summary: string; status: string; chunkCount: number; createdAt: string; updatedAt: string };
type ChannelReview = { id: string; leadId: string; channel: string; messageId: string; reason: string; content: string; metadataJson: string; status: string; createdAt: string; reviewedAt?: string | null };
type OrderRecord = { id: string; orderNo: string; leadId: string; company: string; currency: string; totalMinor: number; paidMinor: number; outstandingMinor: number; status: string; settlementStatus: string; orderDate: string; dueDate: string; overdue: boolean; notes: string; createdAt: string; updatedAt: string };
type PaymentRecord = { id: string; orderId: string; currency: string; amountMinor: number; paidAt: string; method: string; reference: string; notes: string; createdAt: string };
type CurrencyTotal = { orderMinor: number; paidMinor: number; receivableMinor: number; overdueMinor: number; overdueOrders: number };
type FinanceData = { orders: OrderRecord[]; payments: PaymentRecord[]; totalsByCurrency: Record<string, CurrencyTotal> };

const stages = ["新发现", "待触达", "沟通中", "有意向", "已成交"];
const owners = [{ id: "", name: "未分配" }, { id: "jack", name: "Jack Li" }, { id: "amy", name: "Amy Chen" }, { id: "leo", name: "Leo Wang" }];
const primaryNavigation: { id: View; label: string; icon: string }[] = [
  { id: "dashboard", label: "工作台", icon: "◈" }, { id: "search", label: "AI 搜客", icon: "⌕" },
  { id: "leads", label: "客户库", icon: "◎" },
];
const automationNavigation: { id: View; label: string; icon: string }[] = [
  { id: "automation-add", label: "加微任务", icon: "+" }, { id: "automation-reply", label: "私聊任务", icon: "↪" }, { id: "automation-broadcast", label: "群发任务", icon: "◌" },
];
const secondaryNavigation: { id: View; label: string; icon: string }[] = [
  { id: "review", label: "审核台", icon: "✓" }, { id: "knowledge", label: "知识/语料/素材", icon: "▤" }, { id: "sensitive", label: "敏感词库", icon: "敏" },
  { id: "finance", label: "订单回款", icon: "账" }, { id: "analytics", label: "数据分析", icon: "∿" }, { id: "settings", label: "团队与设置", icon: "⚙" },
];

const emptyFinance: FinanceData = { orders: [], payments: [], totalsByCurrency: {} };
function money(minor: number, currency: string) { try { return new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100); } catch { return `${currency} ${(minor / 100).toFixed(2)}`; } }

function ownerName(id?: string) { return owners.find(owner => owner.id === id)?.name ?? "未分配"; }
function leadIdentity(lead: Lead) {
  try {
    const value = /^https?:\/\//i.test(lead.website) ? lead.website : `https://${lead.website}`;
    const hostname = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    if (hostname) return `host:${hostname}`;
  } catch { /* Fall through to the company identity. */ }
  return `company:${lead.company.trim().toLowerCase()}|${lead.country.trim().toLowerCase()}`;
}
function uniqueLeads(leads: Lead[]) {
  const map = new Map<string, Lead>();
  leads.forEach(lead => map.set(leadIdentity(lead), lead));
  return [...map.values()];
}
function csvCell(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function exportCsv(leads: Lead[], filename: string) {
  const headers = ["公司名称", "国家", "城市", "官网", "产品", "联系人", "职位", "邮箱", "电话", "WhatsApp", "匹配分", "阶段", "负责人", "来源", "验证日期"];
  const rows = leads.map(lead => [lead.company, lead.country, lead.city, lead.website, lead.products.join("；"), lead.contact, lead.title, lead.email, lead.phone, lead.whatsapp, lead.score, lead.stage, ownerName(lead.ownerId), lead.source, lead.verifiedAt]);
  const blob = new Blob(["\ufeff", [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[index + 1] === "\n") index += 1; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
function csvToLeads(text: string): Lead[] {
  const rows = parseCsv(text.replace(/^\ufeff/, "")); if (rows.length < 2) return [];
  const keys = rows[0].map(item => item.toLowerCase().replaceAll(" ", ""));
  const find = (row: string[], names: string[]) => { const index = keys.findIndex(key => names.includes(key)); return index >= 0 ? row[index] ?? "" : ""; };
  return rows.slice(1).flatMap(row => {
    const company = find(row, ["公司名称", "公司", "company"]); if (!company) return [];
    const rawStage = find(row, ["阶段", "stage"]);
    return [{
      id: `import-${crypto.randomUUID()}`, company, country: find(row, ["国家", "country"]), city: find(row, ["城市", "city"]), website: find(row, ["官网", "网站", "website"]),
      description: find(row, ["企业简介", "简介", "description"]), products: find(row, ["产品", "采购品类", "products"]).split(/[；;、|]/).map(item => item.trim()).filter(Boolean),
      contact: find(row, ["联系人", "contact"]), title: find(row, ["职位", "title"]), email: find(row, ["邮箱", "email"]), phone: find(row, ["电话", "phone"]), whatsapp: find(row, ["whatsapp"]), socials: [], contactEvidence: [],
      score: Number(find(row, ["匹配分", "score"])) || 0, stage: stages.includes(rawStage) ? rawStage : "新发现", source: find(row, ["来源", "source"]) || "CSV 导入", verifiedAt: find(row, ["验证日期", "verifiedat"]) || new Date().toISOString().slice(0, 10), ownerId: "",
    }];
  });
}

function Sidebar({ view, onChange, leadCount, reviewCount }: { view: View; onChange: (view: View) => void; leadCount: number; reviewCount: number }) {
  const item = (entry: { id: View; label: string; icon: string }, child = false) => <button key={entry.id} className={`nav-item ${child ? "nav-child" : ""} ${view === entry.id ? "active" : ""}`} onClick={() => onChange(entry.id)}><span>{entry.icon}</span>{entry.label}{entry.id === "leads" && <b>{leadCount}</b>}{entry.id === "review" && reviewCount > 0 && <b className="danger">{reviewCount}</b>}</button>;
  return <aside className="sidebar"><button className="brand brand-button" onClick={() => onChange("dashboard")}><span className="brand-mark">贸</span><span>贸客 AI</span></button><nav className="nav-list" aria-label="主导航">{primaryNavigation.map(entry => item(entry))}<div className={`nav-group ${view.startsWith("automation-") ? "open" : ""}`}><div className="nav-group-title"><span>⇄</span><b>自动化</b><small>3</small></div>{automationNavigation.map(entry => item(entry, true))}</div>{secondaryNavigation.map(entry => item(entry))}</nav><div className="sidebar-bottom"><div className="usage-label"><span>本月 AI 额度</span><span>按量计费</span></div><div className="usage-track"><i /></div><div className="workspace-card"><span className="avatar">JL</span><span><strong>杰力外贸</strong><small>管理员 · 安全工作区</small></span><form action="/api/auth/logout" method="post"><button type="submit" title="退出登录" aria-label="退出登录">退出</button></form></div></div></aside>;
}

function Header({ title, subtitle, onSearch }: { title: string; subtitle: string; onSearch: () => void }) {
  return <header className="topbar"><div><p className="eyebrow">{subtitle}</p><h1>{title}</h1></div><div className="top-actions"><button className="icon-button" aria-label="通知">○<span /></button><button className="primary-button" onClick={onSearch}><span>+</span> 新建搜客任务</button></div></header>;
}

function LeadTable({ leads, onOpen, onSave, selected, onToggle }: { leads: Lead[]; onOpen: (lead: Lead) => void; onSave?: (lead: Lead) => void; selected?: Set<string>; onToggle?: (id: string) => void }) {
  if (!leads.length) return <div className="empty-state"><span>⌕</span><h3>还没有符合条件的客户</h3><p>可以先运行 AI 搜客，或导入已有客户名单。</p></div>;
  return <div className="lead-table"><div className="table-row table-head"><span>公司 / 市场</span><span>采购品类</span><span>联系人</span><span>AI 匹配</span><span>阶段</span><span /></div>{leads.map(lead => <div className="table-row lead-row" key={lead.id}><button type="button" className="row-open-overlay" aria-label={`查看 ${lead.company} 详情`} onClick={() => onOpen(lead)} /><span className="company">{onToggle && <input aria-label={`选择 ${lead.company}`} type="checkbox" checked={selected?.has(lead.id) ?? false} onChange={() => onToggle(lead.id)} />}<i>{lead.company[0]}</i><b>{lead.company}<small>{lead.country || "国家待补全"} · {lead.city || ownerName(lead.ownerId)}</small></b></span><span>{lead.products.slice(0, 2).join("、") || "待补全"}</span><span>{lead.contact || "待补全"}</span><span className="score"><i style={{ width: `${lead.score}%` }} />{lead.score}</span><span><em>{lead.stage}</em></span><button type="button" className="row-action" aria-label={onSave ? (lead.saved ? `${lead.company} 已保存` : `保存 ${lead.company}`) : `查看 ${lead.company} 详情`} title={onSave ? (lead.saved ? "已保存" : "保存客户") : "查看详情"} onClick={() => { if (onSave) onSave(lead); else onOpen(lead); }}>{onSave ? (lead.saved ? "✓" : "+") : "↗"}</button></div>)}</div>;
}

function Metrics({ stats }: { stats: Stats }) {
  return <section className="metrics"><article><span className="metric-icon blue">◎</span><div><p>客户总数</p><strong>{stats.total}</strong><small>真实客户库</small></div></article><article><span className="metric-icon violet">✦</span><div><p>新发现</p><strong>{stats.byStage["新发现"] ?? 0}</strong><small>等待处理</small></div></article><article><span className="metric-icon amber">✉</span><div><p>待触达</p><strong>{stats.byStage["待触达"] ?? 0}</strong><small className="warn">建议跟进</small></div></article><article><span className="metric-icon green">↗</span><div><p>明确意向</p><strong>{stats.byStage["有意向"] ?? 0}</strong><small className="up">持续推进</small></div></article></section>;
}

function Dashboard({ leads, stats, setView, openLead }: { leads: Lead[]; stats: Stats; setView: (view: View) => void; openLead: (lead: Lead) => void }) {
  return <><section className="hero"><div className="hero-copy"><span className="ai-pill">✦ AI 智能搜客</span><h2>今天想开发哪些客户？</h2><p>描述目标市场与产品，AI 将搜索公开商业信息、分析官网并补全联系方式。</p></div><button className="hero-search" onClick={() => setView("search")}><span>⌕</span><b>寻找欧洲进口摩托车配件的企业客户</b><i>开始搜索 →</i></button><div className="quick-filters"><span>推荐条件</span><button onClick={() => setView("search")}>欧洲</button><button onClick={() => setView("search")}>进口商</button><button onClick={() => setView("search")}>摩托车配件</button></div></section><Metrics stats={stats} /><section className="panel"><div className="panel-heading"><div><h3>最新保存客户</h3><p>来自真实客户库，按保存时间排序</p></div><button className="text-button" onClick={() => setView("leads")}>查看全部 →</button></div><LeadTable leads={leads.slice(0, 5)} onOpen={openLead} /></section></>;
}

function SearchView({ results, update, openLead, notify, onSaved, jobs, refreshJobs }: { results: Lead[]; update: (leads: Lead[]) => void; openLead: (lead: Lead) => void; notify: (text: string) => void; onSaved: (leads: Lead[]) => void; jobs: SearchJob[]; refreshJobs: () => void }) {
  const [query, setQuery] = useState("寻找欧洲进口摩托车配件的企业客户");
  const [running, setRunning] = useState(false); const [mode, setMode] = useState("等待开始真实搜索");
  const [searchError, setSearchError] = useState("");
  const [target, setTarget] = useState(20); const [minimum, setMinimum] = useState(60); const [progress, setProgress] = useState(0);
  const visible = results.filter(lead => lead.score >= minimum);
  async function run() {
    setRunning(true); setProgress(0); setSearchError(""); update([]);
    const totalBatches = Math.ceil(target / 20); const jobId = crypto.randomUUID(); let collected: Lead[] = [];
    try {
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
        setMode(`实时搜索 · 第 ${batchIndex + 1}/${totalBatches} 批`);
        const response = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, limit: Math.min(20, target - batchIndex * 20), jobId, batchIndex, totalBatches }) });
        const data = await response.json() as { results?: Lead[]; error?: string; mode?: string; provider?: string; quality?: { sourceVerified: number; rejected: number; duplicates: number; withEmail: number; withPhone: number } };
        if (!response.ok) throw new Error(data.error || "搜索服务暂时不可用");
        collected = uniqueLeads([...collected, ...(data.results ?? [])]); update(collected); setProgress(Math.round(((batchIndex + 1) / totalBatches) * 100));
        const quality = data.quality;
        setMode(data.mode === "live" ? `实时搜索 · ${data.provider}${quality ? ` · 来源已核验 ${quality.sourceVerified} 条 · 联系方式 ${quality.withEmail + quality.withPhone} 项` : ""}` : "演示模式");
      }
      notify(`搜索完成，去重后找到 ${collected.length} 家企业`);
    } catch (error) { const detail = error instanceof Error ? error.message : "搜索失败"; setSearchError(detail); setMode("搜索失败 · 请查看下方原因"); notify(`${detail}，已保留 ${collected.length} 条结果`); }
    finally { setRunning(false); refreshJobs(); }
  }
  async function save(lead: Lead) {
    if (lead.saved) return;
    const response = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lead) });
    if (!response.ok) return notify("保存失败，请稍后重试");
    const data = await response.json() as { leads?: Lead[] }; const saved = data.leads ?? [{ ...lead, saved: true }];
    update(results.map(item => item.id === lead.id ? { ...item, saved: true } : item)); onSaved(saved); notify(`已保存 ${lead.company}`);
  }
  async function saveAll() {
    const pending = visible.filter(lead => !lead.saved); if (!pending.length) return notify("当前结果已全部保存");
    const response = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leads: pending }) });
    if (!response.ok) return notify("批量保存失败，请稍后重试");
    const data = await response.json() as { leads?: Lead[] }; const saved = data.leads ?? pending.map(lead => ({ ...lead, saved: true }));
    const ids = new Set(saved.map(lead => lead.id)); update(results.map(lead => ids.has(lead.id) ? { ...lead, saved: true } : lead)); onSaved(saved); notify(`已保存 ${saved.length} 家客户`);
  }
  return <div className="view-stack"><section className="search-studio"><span className="section-kicker">✦ AI LEAD DISCOVERY</span><h2>从一句话开始找客户</h2><p>系统按欧洲区域分批搜索、去重、分析官网并补全公开联系方式。</p><div className="studio-input"><textarea value={query} onChange={event => setQuery(event.target.value)} /><button onClick={run} disabled={running || !query.trim()}>{running ? `搜索中 ${progress}%` : "开始搜索 →"}</button></div><div className="filter-grid"><label>目标地区<select disabled><option>欧洲</option></select></label><label>客户类型<select disabled><option>进口商 / 分销商</option></select></label><label>目标数量<select value={target} onChange={event => setTarget(Number(event.target.value))}><option value="20">20 家</option><option value="40">40 家</option><option value="60">60 家</option><option value="100">100 家</option></select></label><label>最低匹配<select value={minimum} onChange={event => setMinimum(Number(event.target.value))}><option value="0">不限</option><option value="60">60 分</option><option value="70">70 分</option><option value="80">80 分</option><option value="90">90 分</option></select></label></div>{running && <div className="batch-progress"><i style={{ width: `${progress}%` }} /></div>}</section><section className="panel"><div className="panel-heading"><div><h3>搜索结果 <span className="soft-count">{visible.length}</span></h3><p>{mode}</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => exportCsv(visible, "贸客AI-搜索结果.csv")} disabled={!visible.length}>导出 CSV</button><button className="primary-button" onClick={saveAll} disabled={!visible.length}>保存全部</button></div></div>{searchError ? <div className="search-error" role="alert"><strong>本次搜索没有完成</strong><p>{searchError}</p><button className="secondary-button" onClick={run} disabled={running}>重新搜索</button></div> : results.length > 0 && !visible.length ? <div className="search-filter-note" role="status">已找到 {results.length} 家企业，但都低于当前 {minimum} 分门槛。将“最低匹配”改为“不限”即可查看。</div> : running && !results.length ? <div className="search-progress"><span /><h3>正在分析公开商业数据</h3><p>官网分析 · 联系方式补全 · 企业去重</p></div> : <LeadTable leads={visible} onOpen={openLead} onSave={save} />}</section>{jobs.length > 0 && <section className="panel compact-panel"><div className="panel-heading"><div><h3>最近搜客任务</h3><p>数据库记录的真实执行历史</p></div></div><div className="job-list">{jobs.slice(0, 5).map(job => <div key={job.id}><span className={`job-status ${job.status}`}>{job.status === "completed" ? "已完成" : job.status === "failed" ? "失败" : "运行中"}</span><b>{job.query}</b><small>{job.resultCount} 条 · {job.provider}</small></div>)}</div></section>}</div>;
}

function LeadsView({ leads, stats, openLead, onImport, onBulkUpdate, notify }: { leads: Lead[]; stats: Stats; openLead: (lead: Lead) => void; onImport: (leads: Lead[]) => Promise<void>; onBulkUpdate: (ids: string[], changes: { stage?: string; ownerId?: string }) => Promise<void>; notify: (text: string) => void }) {
  const [filter, setFilter] = useState(""); const [stage, setStage] = useState("全部"); const [selected, setSelected] = useState<Set<string>>(new Set()); const [assignee, setAssignee] = useState("amy");
  const shown = leads.filter(lead => (stage === "全部" || lead.stage === stage) && `${lead.company}${lead.country}${lead.contact}${lead.products}`.toLowerCase().includes(filter.toLowerCase()));
  function toggle(id: string) { setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function importFile(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; const parsed = csvToLeads(await file.text()); if (!parsed.length) notify("没有识别到客户数据，请检查 CSV 表头"); else await onImport(parsed); event.target.value = ""; }
  async function assign() { if (!selected.size) return notify("请先勾选客户"); await onBulkUpdate([...selected], { ownerId: assignee }); setSelected(new Set()); }
  return <div className="view-stack"><section className="toolbar-card leads-toolbar"><div className="toolbar-search"><span>⌕</span><input placeholder="搜索公司、联系人、产品…" value={filter} onChange={event => setFilter(event.target.value)} /></div><select value={stage} onChange={event => setStage(event.target.value)}><option>全部</option>{stages.map(item => <option key={item}>{item}</option>)}</select><label className="secondary-button import-button">导入 CSV<input type="file" accept=".csv,text/csv" onChange={importFile} /></label><button className="secondary-button" onClick={() => exportCsv(shown, "贸客AI-客户库.csv")} disabled={!shown.length}>导出 CSV</button></section><section className="pipeline">{[["全部客户", stats.total], ["新发现", stats.byStage["新发现"] ?? 0], ["待触达", stats.byStage["待触达"] ?? 0], ["沟通中", stats.byStage["沟通中"] ?? 0], ["有意向", stats.byStage["有意向"] ?? 0], ["已成交", stats.byStage["已成交"] ?? 0]].map(item => <article key={String(item[0])}><span>{item[0]}</span><strong>{item[1]}</strong></article>)}</section><section className="panel"><div className="panel-heading"><div><h3>客户库 <span className="soft-count">{shown.length}</span></h3><p>数据来自线上数据库，可跨设备保存</p></div><div className="bulk-actions"><span>已选 {selected.size}</span><select value={assignee} onChange={event => setAssignee(event.target.value)}>{owners.filter(owner => owner.id).map(owner => <option value={owner.id} key={owner.id}>{owner.name}</option>)}</select><button className="secondary-button" onClick={assign} disabled={!selected.size}>分配选中</button></div></div><LeadTable leads={shown} onOpen={openLead} selected={selected} onToggle={toggle} /></section></div>;
}

function LegacyAutomationView({
  integrations,
  messages,
  usage,
  suppressions,
  plans,
  leads,
  refreshSuppressions,
  refreshMessages,
  refreshPlans,
  notify,
}: {
  integrations: Integrations;
  messages: EmailMessage[];
  usage: EmailUsage;
  suppressions: Suppression[];
  plans: FollowUpPlan[];
  leads: Lead[];
  refreshSuppressions: () => Promise<void>;
  refreshMessages: () => Promise<void>;
  refreshPlans: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const [blockEmail, setBlockEmail] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [runningPlans, setRunningPlans] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [preparingTest, setPreparingTest] = useState(false);
  const [wecomTasks, setWecomTasks] = useState<AutomationTask[]>([]);
  const [wecomVerify, setWecomVerify] = useState("您好，我们是摩托车配件供应商，希望与您建立联系。");
  const [wecomBusy, setWecomBusy] = useState("");
  const eligibleWecomLeads = leads.filter(lead => lead.phone.trim() || lead.whatsapp.trim());
  const statusLabel: Record<string, string> = {
    pending_review: "待审核",
    sent: "已发送",
    delivered: "已送达",
    bounced: "已退信",
    complained: "已投诉",
    failed: "失败",
    rejected: "已驳回",
    replied: "已回复",
    received: "客户回复",
    unmatched: "待人工关联",
    rate_limited: "频率受限",
  };
  const wecomStatus: Record<string, string> = { awaiting_review: "待执行", running: "执行中", blocked: "待接通", completed: "已完成", failed: "部分失败", cancelled: "已取消", recorded: "已记录" };
  async function refreshWecomTasks() {
    const response = await fetch("/api/automation/tasks");
    if (!response.ok) return;
    const data = await response.json() as { tasks?: AutomationTask[] };
    setWecomTasks(data.tasks ?? []);
  }
  useEffect(() => { const timer = window.setTimeout(() => { void refreshWecomTasks(); }, 0); return () => window.clearTimeout(timer); }, []);
  async function createWecomTask() {
    if (!eligibleWecomLeads.length || wecomBusy) return notify("请先为客户补全手机号或 WhatsApp");
    setWecomBusy("create");
    const response = await fetch("/api/automation/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_add_contact", leadIds: eligibleWecomLeads.slice(0, 20).map(lead => lead.id), verify: wecomVerify }) });
    const data = await response.json() as { error?: string; task?: AutomationTask };
    setWecomBusy("");
    if (!response.ok) return notify(data.error ?? "创建加微任务失败");
    await refreshWecomTasks();
    notify(`已生成 ${data.task?.config.targets?.length ?? 0} 个客户的待执行加微任务`);
  }
  async function actWecomTask(id: string, action: "execute" | "cancel") {
    if (wecomBusy) return;
    setWecomBusy(id);
    const response = await fetch("/api/automation/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
    const data = await response.json() as { error?: string; processed?: number; remaining?: number };
    setWecomBusy("");
    await refreshWecomTasks();
    if (!response.ok) return notify(data.error ?? "企微任务操作失败");
    notify(action === "cancel" ? "企微任务已取消" : `本批已处理 ${data.processed ?? 0} 个，剩余 ${data.remaining ?? 0} 个`);
  }
  const planStatus: Record<string, string> = {
    scheduled: "等待到期",
    awaiting_review: "待审核",
    sent: "已发送",
    cancelled: "已取消",
  };
  async function block() {
    if (!blockEmail.trim() || blocking) return;
    setBlocking(true);
    const response = await fetch("/api/email/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: blockEmail, reason: "运营手动加入黑名单" }),
    });
    const data = (await response.json()) as { error?: string };
    setBlocking(false);
    if (!response.ok) return notify(data.error ?? "加入黑名单失败");
    setBlockEmail("");
    await refreshSuppressions();
    notify("邮箱已加入黑名单");
  }
  async function unblock(email: string) {
    const response = await fetch(
      `/api/email/suppressions?email=${encodeURIComponent(email)}`,
      { method: "DELETE" },
    );
    if (!response.ok) return notify("移出黑名单失败");
    await refreshSuppressions();
    notify("邮箱已移出黑名单");
  }
  async function runDue() {
    setRunningPlans(true);
    const response = await fetch("/api/email/followups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run_due" }),
    });
    const data = (await response.json()) as {
      error?: string;
      created?: number;
      cancelled?: number;
    };
    setRunningPlans(false);
    if (!response.ok) return notify(data.error ?? "跟进任务执行失败");
    await Promise.all([refreshPlans(), refreshMessages()]);
    notify(
      `已生成 ${data.created ?? 0} 封待审核跟进，取消 ${data.cancelled ?? 0} 项`,
    );
  }
  async function cancelPlan(id: string) {
    const response = await fetch("/api/email/followups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", id }),
    });
    if (!response.ok) return notify("取消失败");
    await Promise.all([refreshPlans(), refreshMessages()]);
    notify("跟进计划已取消");
  }
  async function prepareEmailTest() {
    const email = testEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || preparingTest)
      return notify("请输入有效的测试收件邮箱");
    setPreparingTest(true);
    try {
      let lead = leads.find(
        (item) => item.email.trim().toLowerCase() === email,
      );
      if (!lead) {
        const candidate: Lead = {
          id: crypto.randomUUID(),
          company: "邮件线程测试客户",
          country: "测试",
          city: "",
          website: "",
          description:
            "用于验证 Resend 外发、送达、入站回复关联与 AI 待审核草稿。",
          products: ["摩托车制动系统配件"],
          contact: "测试收件人",
          title: "测试联系人",
          email,
          phone: "",
          whatsapp: "",
          socials: [],
          contactEvidence: [],
          score: 100,
          stage: "新发现",
          source: "邮件链路测试",
          verifiedAt: new Date().toISOString().slice(0, 10),
          ownerId: "jack",
          saved: true,
        };
        const leadResponse = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(candidate),
        });
        const leadData = (await leadResponse.json()) as {
          leads?: Lead[];
          error?: string;
        };
        if (!leadResponse.ok || !leadData.leads?.[0])
          return notify(leadData.error ?? "创建测试客户失败");
        lead = leadData.leads[0];
      }
      const marker = new Date().toLocaleString("zh-CN", { hour12: false });
      const draftResponse = await fetch("/api/email/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          to: email,
          subject: `贸客 AI 邮件线程关联测试 ${marker}`,
          content:
            "这是一封贸客 AI 正式邮件链路测试。\n\n请直接回复本邮件，并在正文中写：我对制动系统配件感兴趣，请发送产品目录和报价。\n\n系统会验证：回复是否自动关联到正确客户、停止未发送的后续跟进，并生成待人工审核的 AI 回复草稿。",
        }),
      });
      const draftData = (await draftResponse.json()) as { error?: string };
      if (!draftResponse.ok)
        return notify(draftData.error ?? "生成测试邮件失败");
      await refreshMessages();
      setTestEmail("");
      notify("测试邮件已进入审核台，请在审核台批准发送");
    } finally {
      setPreparingTest(false);
    }
  }
  function company(leadId: string) {
    return leads.find((lead) => lead.id === leadId)?.company ?? "客户待补全";
  }
  return (
    <div className="view-stack">
      <section className="integration-strip">
        <article>
          <div className="integration-logo wecom">企</div>
          <div>
            <span className="status-dot waiting">
              {integrations.jingyu?.configured ? "已连接" : "待开通"}
            </span>
            <h3>鲸域企微 Bot</h3>
            <p>自动加微、好友通过事件、欢迎语与私聊</p>
          </div>
          <button onClick={() => notify(integrations.jingyu?.note ?? "待配置鲸域供应商账户参数")}>
            {integrations.jingyu?.configured ? "已接通" : "待接通"}
          </button>
        </article>
        <article>
          <div className="integration-logo mail">✉</div>
          <div>
            <span
              className={`status-dot ${integrations.email?.configured ? "connected" : "demo"}`}
            >
              {integrations.email?.configured ? "已连接" : "待配置"}
            </span>
            <h3>外贸邮件自动化</h3>
            <p>人工审核、分阶段跟进、回复分类、退订与黑名单</p>
          </div>
          <button
            onClick={() =>
              notify(
                integrations.email?.configured
                  ? "Resend 已连接，可从审核台批准发送"
                  : "请配置 Resend、发件域名和 Webhook 密钥",
              )
            }
          >
            状态
          </button>
        </article>
      </section>
      <section className="panel wecom-workflow">
        <div className="panel-heading">
          <div>
            <h3>企微加微与私聊闭环</h3>
            <p>从客户库生成任务，每批最多执行 5 个；好友通过和私聊消息由 Webhook 生成欢迎语或 AI 回复任务。</p>
          </div>
          <span className={`wecom-ready ${integrations.jingyu?.configured ? "connected" : ""}`}>{integrations.jingyu?.configured ? "供应商协议已验证并连接" : integrations.jingyu?.accountConfigured ? "账户已填 · 原生协议待验证" : "官方入口已定位 · 等待租户 OpenAPI"}</span>
        </div>
        <div className="wecom-builder">
          <label>加微验证话术<textarea value={wecomVerify} maxLength={120} onChange={event => setWecomVerify(event.target.value)} /></label>
          <div><strong>{eligibleWecomLeads.length}</strong><span>个客户有可用号码</span><small>单任务取最新 20 个；新登录企微账号前 3 天建议不执行加微。</small><button className="primary-button" onClick={createWecomTask} disabled={Boolean(wecomBusy) || !eligibleWecomLeads.length}>{wecomBusy === "create" ? "生成中…" : "生成待执行任务"}</button></div>
        </div>
        {wecomTasks.length ? <div className="wecom-task-list">{wecomTasks.slice(0, 12).map(task => {
          const targets = task.config.targets ?? [];
          const done = targets.filter(target => ["request_sent", "already_contact"].includes(target.status)).length;
          const canRun = ["awaiting_review", "blocked", "failed"].includes(task.status);
          return <div key={task.id}><span className={`plan-state ${task.status}`}>{wecomStatus[task.status] ?? task.status}</span><b>{task.name}<small>{targets.length ? `成功 ${done}/${targets.length}` : task.config.kind === "reply" ? "AI 私聊回复，发送前需确认" : task.config.kind === "welcome" ? "好友通过后的欢迎语" : "企微回调记录"}{task.config.lastError ? ` · ${task.config.lastError}` : ""}</small></b><time>{new Date(task.createdAt).toLocaleString("zh-CN", { hour12: false })}</time><div>{canRun && <button onClick={() => actWecomTask(task.id, "execute")} disabled={Boolean(wecomBusy)}>{wecomBusy === task.id ? "处理中…" : integrations.jingyu?.configured ? "执行下一批" : "检查接通"}</button>}{!["completed", "cancelled", "recorded"].includes(task.status) && <button className="danger-link" onClick={() => actWecomTask(task.id, "cancel")} disabled={Boolean(wecomBusy)}>取消</button>}</div></div>;
        })}</div> : <div className="empty-mini">还没有企微任务，可以先从已有联系号码的客户生成待执行队列。</div>}
      </section>
      <section className="email-usage">
        <article>
          <span>今日已发送</span>
          <strong>{usage.sentToday}</strong>
          <small>真实外发记录</small>
        </article>
        <article>
          <span>今日剩余</span>
          <strong>{usage.remainingToday}</strong>
          <small>每日上限 {usage.dailyLimit} 封</small>
        </article>
        <article>
          <span>待人工审核</span>
          <strong>
            {messages.filter((item) => item.status === "pending_review").length}
          </strong>
          <small>首封、跟进与回复</small>
        </article>
        <article>
          <span>待执行跟进</span>
          <strong>
            {plans.filter((plan) => plan.status === "scheduled").length}
          </strong>
          <small>客户回复后自动取消</small>
        </article>
      </section>
      <section className="panel email-test-panel">
        <div className="email-test-copy">
          <span className="section-kicker">✦ END-TO-END TEST</span>
          <h3>验证邮件发送与客户回复关联</h3>
          <p>
            输入你自己的真实邮箱，系统只生成待审核草稿；在审核台批准后才会通过
            Resend 发送。
          </p>
        </div>
        <div className="email-test-form">
          <label htmlFor="email-thread-test">测试收件邮箱</label>
          <div>
            <input
              id="email-thread-test"
              type="email"
              placeholder="name@example.com"
              autoComplete="email"
              value={testEmail}
              onChange={(event) => setTestEmail(event.target.value)}
            />
            <button
              className="primary-button"
              onClick={prepareEmailTest}
              disabled={preparingTest || !testEmail.trim()}
            >
              {preparingTest ? "正在准备…" : "生成待审核测试邮件"}
            </button>
          </div>
          <small>不会立即外发；审核通过后，回复此邮件即可验证线程关联。</small>
        </div>
      </section>
      <section className="automation-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h3>最近邮件活动</h3>
              <p>状态由数据库和 Resend Webhook 记录</p>
            </div>
          </div>
          {messages.length ? (
            <div className="email-activity">
              {messages.slice(0, 8).map((message) => (
                <div key={message.id}>
                  <span className={`mail-state ${message.status}`}>
                    {statusLabel[message.status] ?? message.status}
                  </span>
                  <b>{message.subject}</b>
                  <small>{message.toEmail}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-mini">
              生成开发信并提交审核后，将在这里显示真实邮件记录
            </div>
          )}
        </article>
        <aside className="panel task-panel">
          <div className="panel-heading">
            <div>
              <h3>服务准备状态</h3>
              <p>真实运行环境</p>
            </div>
          </div>
          <div className="task-list">
            <div>
              <span>AI</span>
              <b>
                OpenRouter
                <small>
                  {integrations.openrouter?.configured
                    ? integrations.openrouter.model
                    : "未配置"}
                </small>
              </b>
              <em>{integrations.openrouter?.configured ? "可用" : "待配置"}</em>
            </div>
            <div>
              <span>⌕</span>
              <b>
                Tavily Search<small>公开商业数据搜索</small>
              </b>
              <em>{integrations.search?.configured ? "可用" : "待配置"}</em>
            </div>
            <div>
              <span>✉</span>
              <b>
                Resend<small>发送、送达、退信、客户回复</small>
              </b>
              <em>{integrations.email?.configured ? "可用" : "待配置"}</em>
            </div>
            <div>
              <span>企</span>
              <b>
                鲸域企微<small>{integrations.jingyu?.protocolVerified ? "接口协议已验证" : "等待租户专属 OpenAPI"}</small>
              </b>
              <em>暂停</em>
            </div>
          </div>
        </aside>
      </section>
      <section className="panel followup-panel">
        <div className="panel-heading">
          <div>
            <h3>分阶段跟进计划</h3>
            <p>
              首封发送后自动安排第 3、7、14 天；到期先生成草稿，再由人工审核
            </p>
          </div>
          <button
            className="primary-button"
            onClick={runDue}
            disabled={runningPlans}
          >
            {runningPlans ? "执行中…" : "执行到期任务"}
          </button>
        </div>
        {plans.length ? (
          <div className="followup-list">
            {plans.slice(0, 30).map((plan) => (
              <div key={plan.id}>
                <span className={`plan-state ${plan.status}`}>
                  {planStatus[plan.status] ?? plan.status}
                </span>
                <b>
                  {company(plan.leadId)}
                  <small>
                    第 {plan.stepNumber} 次跟进 · 间隔 {plan.delayDays} 天
                  </small>
                </b>
                <time>
                  {new Date(plan.dueAt).toLocaleString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                {["scheduled", "awaiting_review"].includes(plan.status) ? (
                  <button onClick={() => cancelPlan(plan.id)}>取消</button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-mini">
            首封邮件发送后，系统会自动创建三次跟进计划
          </div>
        )}
      </section>
      <section className="panel suppression-panel">
        <div className="panel-heading">
          <div>
            <h3>邮件黑名单</h3>
            <p>硬退信、投诉与退订会自动加入，也可手动添加</p>
          </div>
          <div className="suppression-form">
            <input
              type="email"
              placeholder="customer@example.com"
              value={blockEmail}
              onChange={(event) => setBlockEmail(event.target.value)}
            />
            <button
              className="secondary-button"
              onClick={block}
              disabled={blocking || !blockEmail.trim()}
            >
              {blocking ? "添加中…" : "加入黑名单"}
            </button>
          </div>
        </div>
        {suppressions.length ? (
          <div className="suppression-list">
            {suppressions.slice(0, 30).map((item) => (
              <div key={item.id}>
                <b>{item.email}</b>
                <span>{item.reason}</span>
                <small>{item.source}</small>
                <button onClick={() => unblock(item.email)}>移出</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-mini">当前没有禁发邮箱</div>
        )}
      </section>
    </div>
  );
}

void LegacyAutomationView;

function AutomationView({ leads, messages, usage, knowledgeSources, notify }: {
  integrations: Integrations; messages: EmailMessage[]; usage: EmailUsage; suppressions: Suppression[]; plans: FollowUpPlan[];
  leads: Lead[]; knowledgeSources: KnowledgeSource[]; refreshSuppressions: () => Promise<void>; refreshMessages: () => Promise<void>;
  refreshPlans: () => Promise<void>; refreshReviews: () => Promise<void>; notify: (text: string) => void;
}) {
  const [tasks, setTasks] = useState<AutomationTask[]>([]); const [busy, setBusy] = useState("");
  const [verify, setVerify] = useState("您好，我们是摩托车配件供应商，希望与您建立联系。"); const [addFile, setAddFile] = useState<File | null>(null);
  const [replyName, setReplyName] = useState("客户私信 AI 自动回复"); const [replyRules, setReplyRules] = useState("先判断客户需求；回答简洁专业；信息不足时只追问一个关键问题；不得承诺价格、库存和交期。");
  const [replyLibraries, setReplyLibraries] = useState<string[]>([]); const [replySensitive, setReplySensitive] = useState("报价,价格,折扣,付款,合同,退款,投诉,法律,账号,密码"); const [autoReply, setAutoReply] = useState(true);
  const [testTask, setTestTask] = useState(""); const [testMessage, setTestMessage] = useState("请问你们刹车片的价格和最低起订量是多少？"); const [testResult, setTestResult] = useState("");
  const [broadcastName, setBroadcastName] = useState("欧洲摩托车配件客户群发"); const [scheduleType, setScheduleType] = useState<"now" | "datetime" | "weekly">("now");
  const [runAt, setRunAt] = useState(""); const [weekdays, setWeekdays] = useState<number[]>([1]); const [weeklyTime, setWeeklyTime] = useState("10:00");
  const [broadcastMode, setBroadcastMode] = useState<"ai" | "fixed">("ai"); const [broadcastRules, setBroadcastRules] = useState("介绍近期摩托车配件产品资料，语气专业克制，引导客户回复关注的品类，不虚构促销和库存。");
  const [broadcastContent, setBroadcastContent] = useState(""); const [broadcastLibraries, setBroadcastLibraries] = useState<string[]>([]); const [broadcastSensitive, setBroadcastSensitive] = useState("最低价,保证,绝对,免费,限时,付款,合同"); const [requireReview, setRequireReview] = useState(false);
  const eligible = leads.filter(lead => lead.phone.trim() || lead.whatsapp.trim()); const activeReplyTasks = tasks.filter(task => task.taskType === "private_reply" && task.status === "active");
  const taskLabels: Record<string, string> = { add_contact: "加微", private_reply: "AI 私聊", broadcast: "群发" };
  const statusLabels: Record<string, string> = { ready: "待执行", active: "运行中", scheduled: "已排期", running: "执行中", completed: "已生成队列", failed: "失败", paused: "已暂停", cancelled: "已取消" };
  async function refreshTasks() { const response = await fetch("/api/automation/tasks"); if (!response.ok) return; const data = await response.json() as { tasks?: AutomationTask[] }; setTasks(data.tasks ?? []); }
  useEffect(() => { const timer = window.setTimeout(() => { void refreshTasks(); }, 0); return () => window.clearTimeout(timer); }, []);
  function toggleLibrary(id: string, values: string[], update: (ids: string[]) => void) { update(values.includes(id) ? values.filter(item => item !== id) : [...values, id]); }
  function libraryPicker(values: string[], update: (ids: string[]) => void) {
    const labels = { knowledge: "知识库", corpus: "语料库", material: "素材库" };
    return <div className="automation-library-picker">{(["knowledge", "corpus", "material"] as const).map(type => <div key={type}><strong>{labels[type]}</strong>{knowledgeSources.filter(source => source.libraryType === type && source.status === "ready").map(source => <label key={source.id}><input type="checkbox" checked={values.includes(source.id)} onChange={() => toggleLibrary(source.id, values, update)} />{source.name}</label>)}{!knowledgeSources.some(source => source.libraryType === type && source.status === "ready") && <small>暂无可用内容</small>}</div>)}</div>;
  }
  async function createFromCustomers() {
    if (!eligible.length) return notify("客户库中还没有可用手机号或 WhatsApp"); setBusy("add");
    const response = await fetch("/api/automation/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_add_contact", sourceType: "search", leadIds: eligible.slice(0, 100).map(lead => lead.id), verify }) });
    const data = await response.json() as { error?: string; task?: AutomationTask }; setBusy(""); if (!response.ok) return notify(data.error ?? "创建加微任务失败"); await refreshTasks(); notify(`已从搜索/客户库生成 ${data.task?.config.targets?.length ?? 0} 个加微对象`);
  }
  async function uploadAddTask() {
    if (!addFile) return notify("请选择 Excel 或 CSV 名单"); setBusy("upload"); const form = new FormData(); form.set("file", addFile); form.set("verify", verify); form.set("name", `Excel 加微任务 · ${addFile.name}`);
    const response = await fetch("/api/automation/tasks", { method: "POST", body: form }); const data = await response.json() as { error?: string; imported?: number }; setBusy(""); if (!response.ok) return notify(data.error ?? "名单解析失败"); setAddFile(null); await refreshTasks(); notify(`已识别 ${data.imported ?? 0} 个加微对象`);
  }
  async function createReplyTask() {
    setBusy("reply"); const response = await fetch("/api/automation/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_private_reply", name: replyName, rules: replyRules, libraryIds: replyLibraries, sensitiveWords: replySensitive, autoReplyNormal: autoReply }) });
    const data = await response.json() as { error?: string; task?: AutomationTask }; setBusy(""); if (!response.ok) return notify(data.error ?? "私聊任务创建失败"); await refreshTasks(); setTestTask(data.task?.id ?? ""); notify("AI 私聊任务已启用");
  }
  async function simulateInbound() {
    if (!testTask || !testMessage.trim()) return notify("请选择私聊任务并填写测试消息"); setBusy("test");
    const response = await fetch("/api/automation/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: testTask, leadId: eligible[0]?.id, contact: eligible[0]?.contact || "测试客户", message: testMessage, simulated: true }) });
    const data = await response.json() as { error?: string; reply?: string; note?: string }; setBusy(""); if (!response.ok) return notify(data.error ?? "AI 私聊测试失败"); setTestResult(data.reply ?? ""); notify(data.note ?? "AI 回复已生成");
  }
  async function createBroadcast() {
    setBusy("broadcast"); const schedule = scheduleType === "now" ? { type: "now" } : scheduleType === "datetime" ? { type: "datetime", runAt } : { type: "weekly", weekdays, time: weeklyTime };
    const response = await fetch("/api/automation/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_broadcast", name: broadcastName, schedule, stages: ["新发现", "待触达", "沟通中", "有意向"], contentMode: broadcastMode, fixedContent: broadcastContent, rules: broadcastRules, libraryIds: broadcastLibraries, sensitiveWords: broadcastSensitive, requireReview }) });
    const data = await response.json() as { error?: string; task?: AutomationTask }; if (!response.ok) { setBusy(""); return notify(data.error ?? "群发任务创建失败"); }
    if (scheduleType === "now" && data.task?.id) await fetch("/api/automation/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "execute", id: data.task.id }) });
    setBusy(""); await refreshTasks(); notify(scheduleType === "now" ? "群发内容已生成并进入待发送/审核队列" : "群发计划已排期");
  }
  async function taskAction(id: string, action: "execute" | "cancel") { setBusy(id); const response = await fetch("/api/automation/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) }); const data = await response.json() as { error?: string }; setBusy(""); await refreshTasks(); notify(response.ok ? (action === "cancel" ? "任务已取消" : "任务已生成执行队列") : data.error ?? "任务操作失败"); }
  return <div className="view-stack automation-center">
    <section className="automation-overview"><div><span className="section-kicker">✦ AI CUSTOMER OPERATIONS</span><h2>客户自动化运营中台</h2><p>业务层已独立运行。任务、AI 内容、敏感审核与定时计划不依赖任何企微厂商；发送通道可后续接入。</p></div><div><strong>{tasks.filter(task => ["active", "scheduled", "ready"].includes(task.status)).length}</strong><span>运行中任务</span><strong>{usage.remainingToday}</strong><span>邮件今日余量</span></div></section>
    <section className="automation-feature-grid">
      <article className="panel automation-builder"><div className="panel-heading"><div><span className="step-badge">01</span><h3>加微任务</h3><p>从搜客/客户库触发，或上传 Excel、CSV 名单</p></div></div><label>加微验证话术<textarea value={verify} maxLength={120} onChange={event => setVerify(event.target.value)} /></label><div className="automation-actions"><button className="primary-button" onClick={createFromCustomers} disabled={Boolean(busy)}>从 {eligible.length} 个有号码客户创建</button><label className="secondary-button import-button">选择 Excel / CSV<input type="file" accept=".xlsx,.csv,.txt" onChange={event => setAddFile(event.target.files?.[0] ?? null)} /></label><button className="secondary-button" onClick={uploadAddTask} disabled={!addFile || Boolean(busy)}>{busy === "upload" ? "解析中…" : addFile ? `上传 ${addFile.name}` : "上传名单创建"}</button></div><small className="safe-hint">建议表头包含：公司、联系人、手机号/电话、微信号、备注；单次最多 500 行。</small></article>
      <article className="panel automation-builder"><div className="panel-heading"><div><span className="step-badge">02</span><h3>AI 私聊任务</h3><p>收到客户私信后按规则和资料自动生成回复</p></div></div><div className="automation-form-grid"><label>任务名称<input value={replyName} onChange={event => setReplyName(event.target.value)} /></label><label>敏感词（逗号分隔）<input value={replySensitive} onChange={event => setReplySensitive(event.target.value)} /></label></div><label>回复话术规则<textarea value={replyRules} onChange={event => setReplyRules(event.target.value)} /></label>{libraryPicker(replyLibraries, setReplyLibraries)}<label className="check-line"><input type="checkbox" checked={autoReply} onChange={event => setAutoReply(event.target.checked)} />常规内容自动通过；命中敏感词始终进入管理员审核</label><button className="primary-button" onClick={createReplyTask} disabled={busy === "reply"}>{busy === "reply" ? "创建中…" : "创建并启用私聊任务"}</button></article>
      <article className="panel automation-builder"><div className="panel-heading"><div><span className="step-badge">03</span><h3>私聊事件测试</h3><p>在供应商接入前，模拟收到私信验证完整 AI/审核流程</p></div></div><label>选择运行中的私聊任务<select value={testTask} onChange={event => setTestTask(event.target.value)}><option value="">请选择</option>{activeReplyTasks.map(task => <option value={task.id} key={task.id}>{task.name}</option>)}</select></label><label>模拟客户消息<textarea value={testMessage} onChange={event => setTestMessage(event.target.value)} /></label><button className="secondary-button" onClick={simulateInbound} disabled={busy === "test"}>{busy === "test" ? "AI 生成中…" : "模拟收到私信"}</button>{testResult && <div className="automation-result"><strong>AI 回复草稿</strong><p>{testResult}</p></div>}</article>
      <article className="panel automation-builder"><div className="panel-heading"><div><span className="step-badge">04</span><h3>客户群发任务</h3><p>支持立即、指定时间或每周循环，内容可固定或 AI 生成</p></div></div><div className="automation-form-grid"><label>任务名称<input value={broadcastName} onChange={event => setBroadcastName(event.target.value)} /></label><label>执行计划<select value={scheduleType} onChange={event => setScheduleType(event.target.value as typeof scheduleType)}><option value="now">立即生成</option><option value="datetime">指定时间</option><option value="weekly">每周循环</option></select></label></div>{scheduleType === "datetime" && <label>执行时间<input type="datetime-local" value={runAt} onChange={event => setRunAt(event.target.value)} /></label>}{scheduleType === "weekly" && <div className="weekly-rule"><div>{["日", "一", "二", "三", "四", "五", "六"].map((day, index) => <label key={day}><input type="checkbox" checked={weekdays.includes(index)} onChange={() => setWeekdays(weekdays.includes(index) ? weekdays.filter(item => item !== index) : [...weekdays, index])} />周{day}</label>)}</div><input type="time" value={weeklyTime} onChange={event => setWeeklyTime(event.target.value)} /></div>}<div className="knowledge-tabs"><button className={broadcastMode === "ai" ? "active" : ""} onClick={() => setBroadcastMode("ai")}>AI 生成</button><button className={broadcastMode === "fixed" ? "active" : ""} onClick={() => setBroadcastMode("fixed")}>固定内容</button></div><label>{broadcastMode === "ai" ? "AI 内容规则" : "群发内容"}<textarea value={broadcastMode === "ai" ? broadcastRules : broadcastContent} onChange={event => broadcastMode === "ai" ? setBroadcastRules(event.target.value) : setBroadcastContent(event.target.value)} /></label>{libraryPicker(broadcastLibraries, setBroadcastLibraries)}<label>敏感词（逗号分隔）<input value={broadcastSensitive} onChange={event => setBroadcastSensitive(event.target.value)} /></label><label className="check-line"><input type="checkbox" checked={requireReview} onChange={event => setRequireReview(event.target.checked)} />所有群发内容都要求管理员审核</label>{scheduleType !== "now" && <small className="safe-hint">当前 Vercel 免费版每日扫描一次到期任务，可能延迟执行；升级 Pro 后可无缝改为分钟级调度。</small>}<button className="primary-button" onClick={createBroadcast} disabled={busy === "broadcast"}>{busy === "broadcast" ? "创建中…" : scheduleType === "now" ? "立即生成群发队列" : "保存群发计划"}</button></article>
    </section>
    <section className="panel"><div className="panel-heading"><div><h3>自动化任务 <span className="soft-count">{tasks.length}</span></h3><p>所有动作都有状态和时间记录，发送通道接入前不会误发</p></div><button className="secondary-button" onClick={refreshTasks}>刷新</button></div>{tasks.length ? <div className="wecom-task-list">{tasks.map(task => <div key={task.id}><span className={`plan-state ${task.status}`}>{statusLabels[task.status] ?? task.status}</span><b>{taskLabels[task.taskType] ?? task.taskType} · {task.name}<small>{task.config.targets ? `${task.config.targets.length} 个对象` : task.nextRunAt ? `下次 ${new Date(task.nextRunAt).toLocaleString("zh-CN", { hour12: false })}` : task.config.lastError || "规则已保存"}</small></b><time>{new Date(task.createdAt).toLocaleString("zh-CN", { hour12: false })}</time><div>{task.taskType === "add_contact" && task.status === "ready" && <button onClick={() => taskAction(task.id, "execute")} disabled={Boolean(busy)}>生成队列</button>}{!["completed", "cancelled"].includes(task.status) && <button className="danger-link" onClick={() => taskAction(task.id, "cancel")} disabled={Boolean(busy)}>取消</button>}</div></div>)}</div> : <div className="empty-mini">还没有自动化任务，从上面的任一模块创建。</div>}</section>
    <section className="email-usage"><article><span>邮件今日已发送</span><strong>{usage.sentToday}</strong><small>Resend 真实记录</small></article><article><span>邮件待审核</span><strong>{messages.filter(item => item.status === "pending_review").length}</strong><small>邮件审核闭环继续运行</small></article><article><span>有号码客户</span><strong>{eligible.length}</strong><small>可进入加微/群发队列</small></article><article><span>已启用资料</span><strong>{knowledgeSources.filter(item => item.status === "ready").length}</strong><small>知识、语料与素材</small></article></section>
  </div>;
}

void AutomationView;

function ReviewView({
  messages,
  leads,
  integrations,
  refresh,
  channelReviews,
  refreshReviews,
  notify,
}: {
  messages: EmailMessage[];
  leads: Lead[];
  integrations: Integrations;
  refresh: () => Promise<void>;
  channelReviews: ChannelReview[];
  refreshReviews: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const pending = messages.filter((item) => item.status === "pending_review");
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const current = pending.find((item) => item.id === selectedId) ?? pending[0];
  const kindLabel: Record<string, string> = {
    first_contact: "首封开发信",
    follow_up: "自动跟进",
    reply: "客户回复",
  };
  const intentLabel: Record<string, string> = {
    interested: "客户有兴趣",
    quotation: "询价 / 商务条件",
    question: "产品问题",
    not_now: "暂不采购",
    unsubscribe: "要求退订",
    complaint: "投诉",
    other: "一般回复",
  };
  function company(message: EmailMessage) {
    return (
      leads.find((lead) => lead.id === message.leadId)?.company ??
      message.toEmail
    );
  }
  async function act(action: "approve" | "reject") {
    if (!current || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/email/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id, action }),
      });
      const data = (await response.json()) as {
        error?: string;
        status?: string;
      };
      if (!response.ok) return notify(data.error ?? "邮件操作失败");
      await refresh();
      setSelectedId("");
      notify(
        action === "approve" ? "邮件已通过审核并提交发送" : "邮件草稿已驳回",
      );
    } finally {
      setBusy(false);
    }
  }
  async function actChannel(id: string, action: "approve" | "reject") {
    if (busy) return; setBusy(true);
    try {
      const response = await fetch("/api/reviews", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
      const data = await response.json() as { error?: string; note?: string };
      if (!response.ok) return notify(data.error ?? "审核操作失败"); await refreshReviews(); notify(data.note ?? "审核完成");
    } finally { setBusy(false); }
  }
  return (
    <div className="view-stack">
      <section className="panel channel-review-panel"><div className="panel-heading"><div><h3>企微运营内容审核 <span className="soft-count">{channelReviews.filter(item => item.status === "pending").length}</span></h3><p>私聊和群发命中敏感词后必须由管理员确认；通过后仅进入待发送队列</p></div></div>{channelReviews.filter(item => item.status === "pending").length ? <div className="channel-review-list">{channelReviews.filter(item => item.status === "pending").map(item => { let metadata: { kind?: string; contact?: string; inbound?: string } = {}; try { metadata = JSON.parse(item.metadataJson); } catch { /* 数据异常时仍显示审核正文。 */ } return <article key={item.id}><div><span className="channel-badge green">{metadata.kind === "broadcast" ? "客户群发" : "AI 私聊"}</span><strong>{metadata.contact || leads.find(lead => lead.id === item.leadId)?.company || "客户"}</strong><small>{item.reason}</small></div>{metadata.inbound && <blockquote>客户：{metadata.inbound}</blockquote>}<p>{item.content}</p><div><button className="reject-button" onClick={() => actChannel(item.id, "reject")} disabled={busy}>驳回</button><button className="approve-button" onClick={() => actChannel(item.id, "approve")} disabled={busy}>批准进入待发送 →</button></div></article>; })}</div> : <div className="empty-mini">目前没有待审核的私聊或群发内容</div>}</section>
      <div className="review-layout">
      <section className="review-queue">
        <div className="queue-head">
          <h3>
            邮件审核队列 <span>{pending.length}</span>
          </h3>
        </div>
        {pending.map((item) => (
          <button
            className={`review-card ${current?.id === item.id ? "selected" : ""}`}
            key={item.id}
            onClick={() => setSelectedId(item.id)}
          >
            <span
              className={`channel-badge ${item.kind === "reply" ? "green" : "blue"}`}
            >
              {kindLabel[item.kind] ?? "邮件"}
            </span>
            <strong>{company(item)}</strong>
            <p>{item.subject}</p>
            <small>
              {item.intent
                ? (intentLabel[item.intent] ?? item.intent)
                : item.toEmail}
            </small>
          </button>
        ))}
      </section>
      {current ? (
        <section className="review-detail">
          <div className="detail-title">
            <div>
              <span
                className={`channel-badge ${current.kind === "reply" ? "green" : "blue"}`}
              >
                {kindLabel[current.kind] ?? "邮件"} · 人工审核
              </span>
              <h2>{company(current)}</h2>
              <p className="mail-subject">主题：{current.subject}</p>
            </div>
            <span
              className={`risk-pill ${current.riskLevel === "sensitive" ? "sensitive" : ""}`}
            >
              ●{" "}
              {current.riskLevel === "sensitive"
                ? "敏感内容，必须确认"
                : current.intent
                  ? (intentLabel[current.intent] ?? "待批准外发")
                  : "待批准外发"}
            </span>
          </div>
          <div className="conversation">
            <div className="message ai-message review-email">
              <small>✦ AI 草稿 · 收件人 {current.toEmail}</small>
              <textarea value={current.contentText} readOnly />
            </div>
          </div>
          <div className="safety-note">
            <span>◇</span>
            <div>
              <strong>批准后会发生什么？</strong>
              <p>
                {integrations.email?.configured
                  ? "系统将再次检查收件邮箱、黑名单与今日额度，然后通过 Resend 发送；客户回复后未发送的跟进计划会自动取消。"
                  : "Resend 尚未完整配置，批准动作会被服务端拦截，草稿不会丢失或误发。"}
              </p>
            </div>
          </div>
          <div className="review-actions">
            <button
              className="reject-button"
              onClick={() => act("reject")}
              disabled={busy}
            >
              驳回
            </button>
            <button
              className="approve-button"
              onClick={() => act("approve")}
              disabled={busy}
            >
              {busy
                ? "处理中…"
                : integrations.email?.configured
                  ? "批准并发送 →"
                  : "批准（等待配置）"}
            </button>
          </div>
        </section>
      ) : (
        <section className="review-detail empty-detail">
          <span>✓</span>
          <h2>没有待审核邮件</h2>
          <p>首封开发信、到期跟进和客户回复草稿都会进入这里。</p>
        </section>
      )}
      </div>
    </div>
  );
}

function KnowledgeView({ sources, refresh, notify }: { sources: KnowledgeSource[]; refresh: () => Promise<void>; notify: (text: string) => void }) {
  const [mode, setMode] = useState<"text" | "url" | "file">("text"); const [libraryType, setLibraryType] = useState<"knowledge" | "corpus" | "material">("knowledge"); const [editingId, setEditingId] = useState(""); const [name, setName] = useState(""); const [category, setCategory] = useState("产品资料"); const [content, setContent] = useState(""); const [url, setUrl] = useState(""); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const categories = ["产品资料", "FAQ", "报价边界", "物流交付", "合规规则", "公司介绍"];
  const ready = sources.filter(source => source.status === "ready"); const shownSources = sources.filter(source => source.libraryType === libraryType); const chunks = ready.reduce((total, source) => total + source.chunkCount, 0);
  function reset() { setEditingId(""); setName(""); setCategory("产品资料"); setContent(""); setUrl(""); setFile(null); setMode("text"); }
  function edit(source: KnowledgeSource) { if (source.libraryType === "sensitive") return; setEditingId(source.id); setLibraryType(source.libraryType); setName(source.name); setCategory(source.category); setContent(source.contentText); setUrl(source.sourceUrl); setMode("text"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function save() {
    if (!name.trim() && mode !== "file") return notify("请填写知识源名称"); if (!editingId && mode === "url" && !url.trim()) return notify("请填写网页地址"); if (!editingId && mode === "file" && !file) return notify("请选择要上传的资料文件"); if ((editingId || mode === "text") && !content.trim()) return notify("请填写知识内容");
    setBusy(true);
    try {
      let response: Response;
      if (!editingId && mode === "file" && file) { const form = new FormData(); form.set("file", file); form.set("name", name || file.name); form.set("category", category); form.set("libraryType", libraryType); response = await fetch("/api/knowledge", { method: "POST", body: form }); }
      else response = await fetch("/api/knowledge", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingId ? { id: editingId, name, category, libraryType, content } : { name, category, libraryType, content: mode === "text" ? content : "", url: mode === "url" ? url : "" }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) return notify(data.error ?? "保存知识失败"); await refresh(); reset(); notify(editingId ? "知识源已更新" : mode === "url" ? "网页知识已提取并启用" : mode === "file" ? "文件正文已提取并启用" : "知识源已添加并启用");
    } catch { notify("知识服务暂时不可用"); } finally { setBusy(false); }
  }
  async function toggle(source: KnowledgeSource) {
    const response = await fetch("/api/knowledge", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: source.id, status: source.status === "ready" ? "disabled" : "ready" }) });
    if (!response.ok) return notify("状态更新失败"); await refresh(); notify(source.status === "ready" ? "知识源已停用" : "知识源已启用");
  }
  async function remove(source: KnowledgeSource) {
    if (!window.confirm(`确认删除“${source.name}”？删除后无法恢复。`)) return;
    const response = await fetch(`/api/knowledge?id=${encodeURIComponent(source.id)}`, { method: "DELETE" }); if (!response.ok) return notify("删除失败"); if (editingId === source.id) reset(); await refresh(); notify("知识源已删除");
  }
  const typeLabel = { knowledge: "知识库", corpus: "语料库", material: "素材库" };
  return <div className="view-stack"><section className="knowledge-hero"><div><span className="section-kicker">✦ GROUNDED AI</span><h2>统一管理知识、语料与发送素材</h2><p>知识库保存事实和业务规则，语料库保存话术范例，素材库保存可复用的产品介绍与营销内容；创建私聊或群发任务时按需绑定。</p></div><span className="knowledge-bound">已接入私聊、群发与邮件工作流</span></section><section className="knowledge-stats"><article><strong>{sources.filter(item => item.libraryType === "knowledge").length}</strong><span>知识资料</span></article><article><strong>{sources.filter(item => item.libraryType === "corpus").length}</strong><span>话术语料</span></article><article><strong>{sources.filter(item => item.libraryType === "material").length}</strong><span>发送素材</span></article><article><strong>{chunks}</strong><span>启用片段</span></article></section><div className="library-type-tabs">{(["knowledge", "corpus", "material"] as const).map(type => <button key={type} className={libraryType === type ? "active" : ""} onClick={() => { setLibraryType(type); reset(); }}>{typeLabel[type]}<span>{sources.filter(item => item.libraryType === type).length}</span></button>)}</div><section className="knowledge-grid"><article className="panel knowledge-editor"><div className="panel-heading"><div><h3>{editingId ? `编辑${typeLabel[libraryType]}` : `添加${typeLabel[libraryType]}`}</h3><p>文件最大 10 MB、PDF 最多 100 页；敏感商业承诺仍需人工审核</p></div>{editingId && <button className="text-button" onClick={reset}>取消编辑</button>}</div><div className="knowledge-form"><div className="knowledge-tabs"><button className={mode === "file" ? "active" : ""} onClick={() => setMode("file")} disabled={Boolean(editingId)}>上传文件</button><button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")} disabled={Boolean(editingId)}>粘贴文本</button><button className={mode === "url" ? "active" : ""} onClick={() => setMode("url")} disabled={Boolean(editingId)}>导入网页</button></div><div className="knowledge-fields"><label>{typeLabel[libraryType]}名称<input value={name} onChange={event => setName(event.target.value)} placeholder={mode === "file" ? "不填则使用文件名" : libraryType === "corpus" ? "例如：欧洲客户询价回复范例" : libraryType === "material" ? "例如：刹车片新品介绍" : "例如：摩托车刹车片产品手册"} /></label><label>分类<select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(item => <option key={item}>{item}</option>)}</select></label></div>{mode === "file" && !editingId ? <label className="file-drop"><input type="file" accept=".pdf,.txt,.md,.markdown,.csv,.json,.html,.htm,.xml,.docx,.xlsx,text/*,application/pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} /><span>{file ? file.name : `选择或拖入${typeLabel[libraryType]}文件`}</span><small>PDF、Word、Excel、TXT、Markdown、CSV、JSON、HTML、XML</small></label> : mode === "url" && !editingId ? <label>公开网页地址<input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/products" /></label> : <label>内容正文<textarea value={content} onChange={event => setContent(event.target.value)} placeholder="粘贴真实资料、话术示例或发送素材…" /></label>}<button className="primary-button knowledge-save" onClick={save} disabled={busy}>{busy ? "正在保存…" : editingId ? "保存修改" : "保存并启用"}</button></div></article><article className="panel knowledge-list"><div className="panel-heading"><div><h3>{typeLabel[libraryType]} <span className="soft-count">{shownSources.length}</span></h3><p>仅“已启用”内容可由自动化任务调用</p></div></div>{shownSources.length ? <div>{shownSources.map(source => <div className={`source-row ${source.status === "disabled" ? "disabled" : ""}`} key={source.id}><span className="file-icon">{source.kind === "url" ? "↗" : source.kind === "file" ? "↑" : "T"}</span><button className="source-main" onClick={() => edit(source)}><strong>{source.name}</strong><small>{source.category} · {source.chunkCount} 个片段{source.kind === "file" ? ` · ${(source.fileSize / 1024 / 1024).toFixed(2)} MB${source.pageCount ? ` · ${source.pageCount} 页/表` : ""}` : source.sourceUrl ? ` · ${new URL(source.sourceUrl).hostname}` : ""}</small><p>{source.summary || source.contentText.slice(0, 140)}</p></button><span className="source-actions">{source.kind === "file" && <a href={`/api/knowledge/file?id=${encodeURIComponent(source.id)}`}>下载</a>}<button className={`source-toggle ${source.status}`} onClick={() => toggle(source)}>{source.status === "ready" ? "已启用" : "已停用"}</button><button className="source-delete" aria-label={`删除 ${source.name}`} onClick={() => remove(source)}>×</button></span></div>)}</div> : <div className="empty-state"><span>▤</span><h3>尚未添加{typeLabel[libraryType]}</h3><p>可上传文件、粘贴文本或导入公开网页。</p></div>}</article></section></div>;
}

function FinanceView({ data, leads, update, refreshLeads, notify }: { data: FinanceData; leads: Lead[]; update: (data: FinanceData) => void; refreshLeads: () => Promise<void>; notify: (text: string) => void }) {
  const [today] = useState(() => new Date().toISOString().slice(0, 10)); const [defaultDue] = useState(() => { const date = new Date(); date.setUTCDate(date.getUTCDate() + 30); return date.toISOString().slice(0, 10); });
  const [currency, setCurrency] = useState("USD"); const [filterCurrency, setFilterCurrency] = useState("全部"); const [filterStatus, setFilterStatus] = useState("全部");
  const [leadId, setLeadId] = useState(""); const [amount, setAmount] = useState(""); const [orderDate, setOrderDate] = useState(today); const [dueDate, setDueDate] = useState(defaultDue); const [notes, setNotes] = useState(""); const [creating, setCreating] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState<OrderRecord | null>(null); const [paymentAmount, setPaymentAmount] = useState(""); const [paidAt, setPaidAt] = useState(today); const [method, setMethod] = useState("银行转账"); const [reference, setReference] = useState(""); const [paymentNotes, setPaymentNotes] = useState(""); const [paying, setPaying] = useState(false);
  const currencies = [...new Set(["USD", "EUR", "GBP", "CNY", ...Object.keys(data.totalsByCurrency)])]; const total = data.totalsByCurrency[currency] ?? { orderMinor: 0, paidMinor: 0, receivableMinor: 0, overdueMinor: 0, overdueOrders: 0 };
  const shown = data.orders.filter(order => (filterCurrency === "全部" || order.currency === filterCurrency) && (filterStatus === "全部" || order.status === filterStatus));
  const orderById = new Map(data.orders.map(order => [order.id, order]));
  async function createOrder() {
    if (!leadId || !amount) return notify("请选择客户并填写订单金额"); setCreating(true);
    try {
      const response = await fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "order", leadId, amount, currency, orderDate, dueDate, notes }) });
      const result = await response.json() as FinanceData & { error?: string };
      if (!response.ok) return notify(result.error ?? "订单创建失败"); update(result); await refreshLeads(); setLeadId(""); setAmount(""); setNotes(""); notify("订单已创建，客户阶段已更新为已成交");
    } finally { setCreating(false); }
  }
  function startPayment(order: OrderRecord) { setPaymentOrder(order); setPaymentAmount((order.outstandingMinor / 100).toFixed(2)); setPaidAt(today); setMethod("银行转账"); setReference(""); setPaymentNotes(""); }
  async function recordPayment() {
    if (!paymentOrder || !paymentAmount) return; setPaying(true);
    try {
      const response = await fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "payment", orderId: paymentOrder.id, amount: paymentAmount, paidAt, method, reference, notes: paymentNotes, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json() as FinanceData & { error?: string };
      if (!response.ok) return notify(result.error ?? "回款登记失败"); update(result); setPaymentOrder(null); notify("回款已登记并计入经营分析");
    } finally { setPaying(false); }
  }
  async function changeStatus(order: OrderRecord, status: string) {
    const response = await fetch("/api/finance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: order.id, status }) }); const result = await response.json() as FinanceData & { error?: string };
    if (!response.ok) return notify(result.error ?? "状态更新失败"); update(result); notify("订单状态已更新");
  }
  function exportOrders() {
    const headers = ["订单号", "客户", "币种", "订单金额", "已回款", "待回款", "订单状态", "回款状态", "订单日期", "付款到期日", "是否逾期", "备注"];
    const rows = shown.map(order => [order.orderNo, order.company, order.currency, (order.totalMinor / 100).toFixed(2), (order.paidMinor / 100).toFixed(2), (order.outstandingMinor / 100).toFixed(2), order.status, order.settlementStatus, order.orderDate, order.dueDate, order.overdue ? "是" : "否", order.notes]);
    const blob = new Blob(["\ufeff", [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "贸客AI-订单回款.csv"; anchor.click(); URL.revokeObjectURL(url);
  }
  return <div className="view-stack finance-view">
    <section className="finance-currency"><span>经营币种</span>{currencies.map(item => <button key={item} className={currency === item ? "active" : ""} onClick={() => setCurrency(item)}>{item}</button>)}</section>
    <section className="finance-metrics"><article><span>订单金额</span><strong>{money(total.orderMinor, currency)}</strong><small>未取消订单</small></article><article><span>已回款</span><strong>{money(total.paidMinor, currency)}</strong><small>{total.orderMinor ? `回款率 ${Math.round(total.paidMinor / total.orderMinor * 100)}%` : "等待订单"}</small></article><article><span>待回款</span><strong>{money(total.receivableMinor, currency)}</strong><small>真实剩余应收</small></article><article className={total.overdueMinor ? "alert" : ""}><span>逾期应收</span><strong>{money(total.overdueMinor, currency)}</strong><small>{total.overdueOrders} 笔逾期订单</small></article></section>
    <section className="finance-layout"><article className="panel order-create"><div className="panel-heading"><div><h3>新建外贸订单</h3><p>从客户库选择成交客户，金额按最小货币单位安全存储</p></div></div><div className="order-form"><label>客户<select value={leadId} onChange={event => setLeadId(event.target.value)}><option value="">请选择客户</option>{leads.map(lead => <option value={lead.id} key={lead.id}>{lead.company}</option>)}</select></label><div className="money-fields"><label>订单金额<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="10000.00" /></label><label>币种<select value={currency} onChange={event => setCurrency(event.target.value)}>{currencies.map(item => <option key={item}>{item}</option>)}</select></label></div><div className="date-fields"><label>订单日期<input type="date" value={orderDate} onChange={event => setOrderDate(event.target.value)} /></label><label>付款到期日<input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label></div><label>备注<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="产品、付款节点、业务说明…" /></label><button className="primary-button" onClick={createOrder} disabled={creating || !leads.length}>{creating ? "创建中…" : leads.length ? "创建订单" : "请先保存客户"}</button></div></article>
      <article className="panel payment-activity"><div className="panel-heading"><div><h3>最近回款</h3><p>每笔入账保留日期、方式与流水号</p></div></div>{data.payments.length ? <div className="payment-list">{data.payments.slice(0, 8).map(payment => <div key={payment.id}><span>✓</span><b>{orderById.get(payment.orderId)?.company ?? "客户"}<small>{payment.paidAt} · {payment.method}{payment.reference ? ` · ${payment.reference}` : ""}</small></b><strong>{money(payment.amountMinor, payment.currency)}</strong></div>)}</div> : <div className="empty-mini">登记客户回款后，将在这里形成不可重复的入账记录</div>}</article></section>
    <section className="panel orders-panel"><div className="panel-heading"><div><h3>订单与应收 <span className="soft-count">{shown.length}</span></h3><p>到期未结清订单会自动标记逾期</p></div><div className="heading-actions"><select value={filterCurrency} onChange={event => setFilterCurrency(event.target.value)}><option>全部</option>{currencies.map(item => <option key={item}>{item}</option>)}</select><select value={filterStatus} onChange={event => setFilterStatus(event.target.value)}><option>全部</option>{["待确认", "生产中", "已发货", "已完成", "已取消"].map(item => <option key={item}>{item}</option>)}</select><button className="secondary-button" onClick={exportOrders} disabled={!shown.length}>导出对账表</button></div></div>{shown.length ? <div className="orders-table"><div className="order-row order-head"><span>订单 / 客户</span><span>订单金额</span><span>回款进度</span><span>付款到期</span><span>订单状态</span><span /></div>{shown.map(order => <div className={`order-row ${order.overdue ? "overdue" : ""}`} key={order.id}><span><b>{order.orderNo}</b><small>{order.company}</small></span><strong>{money(order.totalMinor, order.currency)}</strong><span className="collection-cell"><b>{money(order.paidMinor, order.currency)}</b><i><em style={{ width: `${Math.min(100, order.totalMinor ? order.paidMinor / order.totalMinor * 100 : 0)}%` }} /></i><small>{order.settlementStatus}</small></span><span><b>{order.dueDate}</b><small>{order.overdue ? `逾期 · 待收 ${money(order.outstandingMinor, order.currency)}` : `待收 ${money(order.outstandingMinor, order.currency)}`}</small></span><select value={order.status} onChange={event => changeStatus(order, event.target.value)}>{["待确认", "生产中", "已发货", "已完成", "已取消"].map(item => <option key={item}>{item}</option>)}</select><button className="secondary-button" onClick={() => startPayment(order)} disabled={order.outstandingMinor <= 0 || order.status === "已取消"}>{order.outstandingMinor > 0 ? "登记回款" : "已结清"}</button></div>)}</div> : <div className="empty-state"><span>账</span><h3>还没有订单记录</h3><p>从左上方选择客户并创建第一笔订单。</p></div>}</section>
    {paymentOrder && <div className="finance-modal-backdrop"><section className="finance-modal"><button className="drawer-close" onClick={() => setPaymentOrder(null)}>×</button><span className="section-kicker">PAYMENT RECONCILIATION</span><h2>登记回款</h2><p>{paymentOrder.company} · {paymentOrder.orderNo}<br />剩余应收 {money(paymentOrder.outstandingMinor, paymentOrder.currency)}</p><label>到账金额<div className="amount-input"><span>{paymentOrder.currency}</span><input inputMode="decimal" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} /></div></label><div className="date-fields"><label>到账日期<input type="date" value={paidAt} onChange={event => setPaidAt(event.target.value)} /></label><label>收款方式<select value={method} onChange={event => setMethod(event.target.value)}>{["银行转账", "信用证", "PayPal", "信用卡", "其他"].map(item => <option key={item}>{item}</option>)}</select></label></div><label>银行流水号<input value={reference} onChange={event => setReference(event.target.value)} placeholder="用于防止重复入账" /></label><label>备注<textarea value={paymentNotes} onChange={event => setPaymentNotes(event.target.value)} /></label><button className="primary-button" onClick={recordPayment} disabled={paying || !paymentAmount}>{paying ? "正在入账…" : "确认登记回款"}</button></section></div>}
  </div>;
}

function AnalyticsView({ stats, leads, finance }: { stats: Stats; leads: Lead[]; finance: FinanceData }) {
  const currencyOptions = [...new Set(["USD", "EUR", "GBP", "CNY", ...Object.keys(finance.totalsByCurrency)])]; const [currency, setCurrency] = useState(currencyOptions[0] ?? "USD");
  const total = finance.totalsByCurrency[currency] ?? { orderMinor: 0, paidMinor: 0, receivableMinor: 0, overdueMinor: 0, overdueOrders: 0 }; const collectionRate = total.orderMinor ? Math.round(total.paidMinor / total.orderMinor * 100) : 0;
  const countries = Object.entries(leads.reduce<Record<string, number>>((map, lead) => { const key = lead.country || "待补全"; map[key] = (map[key] ?? 0) + 1; return map; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = Math.max(1, ...countries.map(item => item[1]));
  const customerTotals = Object.entries(finance.orders.filter(order => order.currency === currency && order.status !== "已取消").reduce<Record<string, number>>((map, order) => { map[order.company] = (map[order.company] ?? 0) + order.totalMinor; return map; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6); const maxCustomer = Math.max(1, ...customerTotals.map(item => item[1]));
  const statusCounts = ["待确认", "生产中", "已发货", "已完成"].map(status => [status, finance.orders.filter(order => order.currency === currency && order.status === status).length] as const); const maxStatus = Math.max(1, ...statusCounts.map(item => item[1]));
  return <div className="view-stack analytics-view"><section className="analytics-toolbar"><div><span className="section-kicker">LIVE BUSINESS ANALYTICS</span><h2>经营分析</h2><p>订单、回款与客户数据全部来自线上数据库</p></div><select value={currency} onChange={event => setCurrency(event.target.value)}>{currencyOptions.map(item => <option key={item}>{item}</option>)}</select></section><section className="analytics-summary"><article><p>订单金额</p><strong>{money(total.orderMinor, currency)}</strong><small>{finance.orders.filter(order => order.currency === currency && order.status !== "已取消").length} 笔有效订单</small></article><article><p>已回款</p><strong>{money(total.paidMinor, currency)}</strong><small>回款率 {collectionRate}%</small></article><article><p>待回款</p><strong>{money(total.receivableMinor, currency)}</strong><small>真实剩余应收</small></article><article className={total.overdueMinor ? "alert" : ""}><p>逾期应收</p><strong>{money(total.overdueMinor, currency)}</strong><small>{total.overdueOrders} 笔逾期</small></article></section><section className="business-grid"><article className="panel collection-card"><div className="panel-heading"><div><h3>回款健康度</h3><p>已回款占有效订单金额比例</p></div></div><div className="collection-overview"><strong>{collectionRate}%</strong><div><i style={{ width: `${collectionRate}%` }} /></div><p>{collectionRate >= 80 ? "回款表现良好" : collectionRate >= 50 ? "仍有部分应收需要跟进" : total.orderMinor ? "建议优先处理到期和逾期订单" : "创建订单后开始统计"}</p></div><div className="status-bars">{statusCounts.map(item => <div key={item[0]}><span>{item[0]}</span><i><b style={{ width: `${item[1] / maxStatus * 100}%` }} /></i><strong>{item[1]}</strong></div>)}</div></article><article className="panel customer-value"><div className="panel-heading"><div><h3>客户贡献排行</h3><p>按当前币种订单金额</p></div></div>{customerTotals.length ? customerTotals.map(item => <div className="value-row" key={item[0]}><b>{item[0]}</b><i><em style={{ width: `${item[1] / maxCustomer * 100}%` }} /></i><strong>{money(item[1], currency)}</strong></div>) : <div className="empty-mini">创建订单后显示客户贡献</div>}</article></section><section className="analytics-grid"><article className="panel chart-card"><div className="panel-heading"><div><h3>客户阶段分布</h3><p>{stats.total} 个真实客户</p></div></div><div className="bar-chart">{stages.map(item => { const value = stats.byStage[item] ?? 0; const height = stats.total ? Math.max(6, value / stats.total * 100) : 6; return <div key={item}><i style={{ height: `${height}%` }}><b style={{ height: `${Math.max(5, height * .25)}%` }} /></i><span>{item}<small>{value}</small></span></div>; })}</div></article><article className="panel market-card"><div className="panel-heading"><div><h3>客户市场</h3><p>按已保存客户数</p></div></div>{countries.length ? countries.map(item => <div className="market-row" key={item[0]}><span>{item[0]}</span><i><b style={{ width: `${item[1] / max * 100}%` }} /></i><strong>{item[1]}</strong></div>) : <div className="empty-mini">保存客户后显示市场分布</div>}</article></section></div>;
}

function SettingsView({ integrations, notify }: { integrations: Integrations; notify: (text: string) => void }) {
  const services = [
    ["OpenRouter", integrations.openrouter?.model || "大模型生成与回复草稿", integrations.openrouter?.configured ? "已连接" : "未配置", "AI"],
    ["Tavily Search", "全网商业搜索", integrations.search?.configured ? "已连接" : "未配置", "⌕"],
    ["扣子工作流", "调用用户发布的私聊/群发工作流", integrations.coze?.configured ? "已连接" : "未配置", "扣"],
    ["鲸域企微", "加微、欢迎语与私聊", integrations.jingyu?.configured ? "已连接" : "待商务开通", "企"],
    ["Resend", "外贸邮件与退订管理", integrations.email?.configured ? "已连接" : "未配置", "✉"],
  ];
  return <div className="settings-grid"><section className="panel settings-main"><div className="settings-section"><div className="settings-title"><div><h3>外部服务</h3><p>状态来自线上运行环境，密钥仅保存在服务端</p></div></div>{services.map(item => <div className="setting-row" key={item[0]}><span className="setting-logo">{item[3]}</span><div><strong>{item[0]}</strong><small>{item[1]}</small></div><em className={item[2] === "已连接" ? "connected" : ""}>{item[2]}</em><button onClick={() => notify(`${item[0]} 通过服务端环境变量配置`)}>详情</button></div>)}</div><div className="settings-section"><div className="settings-title"><div><h3>团队成员</h3><p>当前为工作流原型，正式权限将在后续接入</p></div></div>{owners.filter(owner => owner.id).map((owner, index) => <div className="member-row" key={owner.id}><span className="avatar">{owner.name[0]}</span><div><strong>{owner.name}</strong><small>{index === 0 ? "管理员" : index === 1 ? "销售主管" : "业务员"}</small></div><span className="role-pill">{index === 0 ? "管理员" : index === 1 ? "销售主管" : "业务员"}</span></div>)}</div></section><aside className="panel compliance-card"><span className="shield">◇</span><h3>自动化安全边界</h3><ul><li>仅使用公开商业联系信息</li><li>不绕过验证码或平台风控</li><li>加微与邮件设置每日上限</li><li>支持退订、黑名单与失败暂停</li><li>敏感业务内容必须人工审核</li><li>所有自动动作保留审计日志</li></ul></aside></div>;
}

function LeadDrawer({ lead, close, notify, onUpdate, onSubmitEmail, onEnrich }: { lead: Lead; close: () => void; notify: (text: string) => void; onUpdate: (id: string, changes: { stage?: string; ownerId?: string }) => Promise<void>; onSubmitEmail: (message: { leadId: string; to: string; subject: string; content: string }) => Promise<boolean>; onEnrich: (lead: Lead) => Promise<void> }) {
  const [stage, setStage] = useState(lead.stage); const [ownerId, setOwnerId] = useState(lead.ownerId ?? ""); const [subject, setSubject] = useState(`Motorcycle parts sourcing cooperation with ${lead.company}`); const [draft, setDraft] = useState(""); const [generating, setGenerating] = useState(false); const [submitting, setSubmitting] = useState(false); const [enriching, setEnriching] = useState(false);
  async function generate() { setGenerating(true); try { const response = await fetch("/api/ai/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `Draft a concise first-contact sales email to ${lead.company}. Their likely products are ${lead.products.join(", ")}. Ask for their current sourcing needs and offer a product catalog.`, context: lead.description, language: "English" }) }); const data = await response.json() as { reply?: string }; setDraft(data.reply ?? ""); if (!response.ok) notify("开发信生成失败"); } catch { notify("开发信生成失败"); } finally { setGenerating(false); } }
  async function saveChanges() { await onUpdate(lead.id, { stage, ownerId }); notify("客户阶段与负责人已保存"); }
  async function submitEmail() { setSubmitting(true); const created = await onSubmitEmail({ leadId: lead.id, to: lead.email, subject, content: draft }); setSubmitting(false); if (created) close(); }
  async function enrich() { setEnriching(true); await onEnrich(lead); setEnriching(false); }
  return <><button className="drawer-backdrop" onClick={close} aria-label="关闭客户详情" /><aside className="lead-drawer"><button className="drawer-close" onClick={close}>×</button><div className="drawer-hero"><span className="company-logo">{lead.company[0]}</span><div><span className="score-pill">✦ AI 匹配 {lead.score}</span><h2>{lead.company}</h2><p>{lead.country || "国家待补全"} · {lead.city || "城市待补全"}</p></div></div><div className="drawer-actions"><button className="primary-button" onClick={generate} disabled={generating}>{generating ? "生成中…" : "✦ 生成开发信"}</button><button className="secondary-button" onClick={enrich} disabled={enriching}>{enriching ? "正在搜索官网…" : "⌕ 补全公开联系方式"}</button></div>{draft && <section className="draft-card"><h3>AI 开发信草稿</h3><label>邮件主题<input value={subject} onChange={event => setSubject(event.target.value)} /></label><label>正文<textarea value={draft} onChange={event => setDraft(event.target.value)} /></label><small>提交后进入审核台，不会自动发送。</small><button className="primary-button submit-review" onClick={submitEmail} disabled={submitting || !lead.email || !subject.trim() || !draft.trim()}>{submitting ? "提交中…" : lead.email ? "提交邮件审核 →" : "客户邮箱待补全"}</button></section>}<section><h3>客户管理</h3><div className="drawer-fields"><label>阶段<select value={stage} onChange={event => setStage(event.target.value)}>{stages.map(item => <option key={item}>{item}</option>)}</select></label><label>负责人<select value={ownerId} onChange={event => setOwnerId(event.target.value)}>{owners.map(owner => <option value={owner.id} key={owner.id}>{owner.name}</option>)}</select></label></div><button className="secondary-button save-fields" onClick={saveChanges}>保存变更</button></section><section><h3>企业概览</h3><p>{lead.description || "暂无企业简介"}</p><div className="product-tags">{lead.products.map(product => <span key={product}>{product}</span>)}</div></section><section><h3>主要联系人</h3><div className="contact-card"><span className="avatar">{lead.contact?.[0] || "?"}</span><div><strong>{lead.contact || "待补全"}</strong><small>{lead.title || "职位待补全"}</small></div></div><dl><div><dt>邮箱</dt><dd>{lead.email || "未公开"}</dd></div><div><dt>电话</dt><dd>{lead.phone || "未公开"}</dd></div><div><dt>WhatsApp</dt><dd>{lead.whatsapp || "未公开"}</dd></div><div><dt>官网</dt><dd>{lead.website || "未公开"}</dd></div></dl>{lead.contactEvidence?.length ? <div className="evidence-list"><h4>公开来源证据</h4>{lead.contactEvidence.slice(0, 8).map((item, index) => <a href={item.url} target="_blank" rel="noreferrer" key={`${item.field}-${index}`}><span>{item.field}</span><b>{item.value}</b><small>查看来源 ↗</small></a>)}</div> : <p className="evidence-empty">尚未运行联系方式补全，现有字段可能缺少来源证据。</p>}</section><section className="source-note"><h3>数据来源</h3><p>{lead.source || "未记录"}</p><small>最近验证：{lead.verifiedAt || "未记录"}</small></section></aside></>;
}

export default function MaokeApp() {
  const [view, setView] = useState<View>("dashboard"); const [leads, setLeads] = useState<Lead[]>([]); const [searchResults, setSearchResults] = useState<Lead[]>([]); const [selected, setSelected] = useState<Lead | null>(null); const [toast, setToast] = useState("");
  const [stats, setStats] = useState<Stats>({ total: 0, byStage: {}, searchJobs: 0 }); const [jobs, setJobs] = useState<SearchJob[]>([]); const [integrations, setIntegrations] = useState<Integrations>({}); const [emailMessages, setEmailMessages] = useState<EmailMessage[]>([]); const [emailUsage, setEmailUsage] = useState<EmailUsage>({ dailyLimit: 100, sentToday: 0, remainingToday: 100 }); const [suppressions, setSuppressions] = useState<Suppression[]>([]); const [followUpPlans, setFollowUpPlans] = useState<FollowUpPlan[]>([]); const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]); const [channelReviews, setChannelReviews] = useState<ChannelReview[]>([]); const [finance, setFinance] = useState<FinanceData>(emptyFinance);
  void emailUsage; void suppressions; void followUpPlans;
  async function refreshLeads() { const response = await fetch("/api/leads"); if (response.ok) { const data = await response.json() as { leads?: Lead[] }; setLeads(data.leads ?? []); } }
  async function refreshStats() { const response = await fetch("/api/stats"); if (response.ok) setStats(await response.json() as Stats); }
  async function refreshJobs() { const response = await fetch("/api/search/jobs"); if (response.ok) { const data = await response.json() as { jobs?: SearchJob[] }; setJobs(data.jobs ?? []); } }
  async function refreshEmailMessages() { const response = await fetch("/api/email/messages"); if (response.ok) { const data = await response.json() as { messages?: EmailMessage[] } & EmailUsage; setEmailMessages(data.messages ?? []); setEmailUsage({ dailyLimit: data.dailyLimit ?? 100, sentToday: data.sentToday ?? 0, remainingToday: data.remainingToday ?? 100 }); } }
  async function refreshSuppressions() { const response = await fetch("/api/email/suppressions"); if (response.ok) { const data = await response.json() as { suppressions?: Suppression[] }; setSuppressions(data.suppressions ?? []); } }
  async function refreshFollowUps() { const response = await fetch("/api/email/followups"); if (response.ok) { const data = await response.json() as { plans?: FollowUpPlan[] }; setFollowUpPlans(data.plans ?? []); } }
  async function refreshKnowledge() { const response = await fetch("/api/knowledge"); if (response.ok) { const data = await response.json() as { sources?: KnowledgeSource[] }; setKnowledgeSources(data.sources ?? []); } }
  async function refreshChannelReviews() { const response = await fetch("/api/reviews"); if (response.ok) { const data = await response.json() as { reviews?: ChannelReview[] }; setChannelReviews(data.reviews ?? []); } }
  async function refreshFinance() { const response = await fetch("/api/finance"); if (response.ok) setFinance(await response.json() as FinanceData); }
  useEffect(() => { const timer = window.setTimeout(() => { void Promise.all([refreshLeads(), refreshStats(), refreshJobs(), refreshEmailMessages(), refreshSuppressions(), refreshFollowUps(), refreshKnowledge(), refreshChannelReviews(), refreshFinance(), fetch("/api/integrations").then(response => response.ok ? response.json() : {}).then(data => setIntegrations(data as Integrations))]); }, 0); return () => window.clearTimeout(timer); }, []);
  const pendingReviews = emailMessages.filter(item => item.status === "pending_review").length + channelReviews.filter(item => item.status === "pending").length;
  const labels = useMemo(() => ({ dashboard: ["早上好，Jack", `${stats.total} 个真实客户 · ${stats.searchJobs} 个搜客任务`], search: ["AI 搜客", "全网商业数据 · 公开来源 · 分批任务"], leads: ["客户库", `${stats.total} 个客户 · ${stats.byStage["有意向"] ?? 0} 个高意向`], "automation-add": ["加微任务", "名单导入 · 定时执行 · 逐条结果"], "automation-reply": ["私聊任务", "可视化 AI 回复工作流"], "automation-broadcast": ["群发任务", "工作流内容 · 一次或周期计划"], review: ["审核台", `${pendingReviews} 项内容待管理员审核`], knowledge: ["知识、语料与素材库", "产品事实、话术范例与发送素材统一管理"], sensitive: ["敏感词库", "私聊和群发内容安全规则"], finance: ["订单回款", `${finance.orders.length} 笔订单 · ${finance.orders.filter(order => order.overdue).length} 笔逾期`], analytics: ["数据分析", "客户、订单与回款实时经营分析"], settings: ["团队与设置", "成员权限与外部服务"] } as Record<View, string[]>), [finance.orders, pendingReviews, stats]);
  function notify(text: string) { setToast(text); window.setTimeout(() => setToast(""), 3200); }
  async function addSaved(saved: Lead[]) { setLeads(current => uniqueLeads([...saved.map(lead => ({ ...lead, saved: true })), ...current])); await refreshStats(); }
  async function importLeads(imported: Lead[]) { const response = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leads: imported }) }); if (!response.ok) return notify("导入失败，请检查文件格式"); const data = await response.json() as { leads?: Lead[] }; await addSaved(data.leads ?? imported); notify(`成功导入 ${data.leads?.length ?? imported.length} 家客户`); }
  async function updateLeads(ids: string[], changes: { stage?: string; ownerId?: string }) { const response = await fetch("/api/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, ...changes }) }); if (!response.ok) return notify("更新失败，请稍后重试"); setLeads(current => current.map(lead => ids.includes(lead.id) ? { ...lead, ...changes } : lead)); setSelected(current => current && ids.includes(current.id) ? { ...current, ...changes } : current); await refreshStats(); }
  async function submitEmail(message: { leadId: string; to: string; subject: string; content: string }) { const response = await fetch("/api/email/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message) }); const data = await response.json() as { error?: string }; if (!response.ok) { notify(data.error ?? "提交审核失败"); return false; } await refreshEmailMessages(); notify("开发信已提交审核台"); setView("review"); return true; }
  async function enrichLead(lead: Lead) { const response = await fetch("/api/leads/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead }) }); const data = await response.json() as { lead?: Lead; error?: string; completeness?: number; total?: number; sources?: number }; if (!response.ok || !data.lead) return notify(data.error ?? "联系方式补全失败"); const enriched = data.lead; setLeads(current => current.map(item => item.id === enriched.id ? { ...enriched, saved: item.saved } : item)); setSearchResults(current => current.map(item => item.id === enriched.id ? { ...enriched, saved: item.saved } : item)); setSelected(current => current?.id === enriched.id ? { ...enriched, saved: current.saved } : current); notify(`补全完成：${data.completeness ?? 0}/${data.total ?? 5} 类联系方式，核验 ${data.sources ?? 0} 个公开页面`); }
  return <main className="app-shell"><Sidebar view={view} onChange={setView} leadCount={stats.total} reviewCount={pendingReviews} /><section className="content"><Header title={labels[view][0]} subtitle={labels[view][1]} onSearch={() => setView("search")} />{view === "dashboard" && <Dashboard leads={leads} stats={stats} setView={setView} openLead={setSelected} />}{view === "search" && <SearchView results={searchResults} update={setSearchResults} openLead={setSelected} notify={notify} onSaved={addSaved} jobs={jobs} refreshJobs={refreshJobs} />}{view === "leads" && <LeadsView leads={leads} stats={stats} openLead={setSelected} onImport={importLeads} onBulkUpdate={updateLeads} notify={notify} />}{view === "automation-add" && <AddContactView leads={leads} notify={notify} />}{view === "automation-reply" && <PrivateReplyView leads={leads} libraries={knowledgeSources} notify={notify} />}{view === "automation-broadcast" && <BroadcastView leads={leads} libraries={knowledgeSources} notify={notify} />}{view === "review" && <ReviewView messages={emailMessages} leads={leads} integrations={integrations} channelReviews={channelReviews} refreshReviews={refreshChannelReviews} refresh={async () => { await Promise.all([refreshEmailMessages(), refreshFollowUps()]); }} notify={notify} />}{view === "knowledge" && <KnowledgeView sources={knowledgeSources} refresh={refreshKnowledge} notify={notify} />}{view === "sensitive" && <SensitiveWordsView sources={knowledgeSources} refresh={refreshKnowledge} notify={notify} />}{view === "finance" && <FinanceView data={finance} leads={leads} update={setFinance} refreshLeads={async () => { await Promise.all([refreshLeads(), refreshStats()]); }} notify={notify} />}{view === "analytics" && <AnalyticsView stats={stats} leads={leads} finance={finance} />}{view === "settings" && <SettingsView integrations={integrations} notify={notify} />}</section>{selected && <LeadDrawer key={selected.id} lead={selected} close={() => setSelected(null)} notify={notify} onUpdate={(id, changes) => updateLeads([id], changes)} onSubmitEmail={submitEmail} onEnrich={enrichLead} />}{toast && <div className="toast"><span>✓</span>{toast}</div>}</main>;
}
