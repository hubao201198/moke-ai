"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import dynamic from "next/dynamic";
import {
  defaultWorkflow,
  type WorkflowDefinition,
  type WorkflowLibrary,
} from "./WorkflowEditor";
import CozeWorkflowPicker, {
  type CozeWorkflowSelection,
} from "./CozeWorkflowPicker";
import CozeVibeConnector, {
  type CozeVibeSelection,
} from "./CozeVibeConnector";

const WorkflowEditor = dynamic(() => import("./WorkflowEditor"), {
  ssr: false,
  loading: () => <div className="workflow-loading">正在加载工作流画布…</div>,
});

type Lead = {
  id: string;
  company: string;
  contact: string;
  phone: string;
  whatsapp: string;
  stage: string;
};
type Target = {
  leadId?: string;
  company: string;
  contact?: string;
  phone?: string;
  wechat?: string;
  notes?: string;
  status: string;
  result?: string;
  source?: string;
};
type Schedule = {
  type: "now" | "datetime" | "weekly";
  runAt?: string;
  weekdays?: number[];
  time?: string;
  repeat?: boolean;
};
type CozeSettings = {
  integrationMode: "openapi" | "vibe";
  executionMode: "sync" | "stream";
  workflowId: string;
  inputParameter: string;
  contextParameter: string;
  rulesParameter: string;
  contactParameter: string;
  outputField: string;
  botId: string;
  appId: string;
  workspaceId: string;
  workflowName: string;
  staticParameters: Record<string, unknown>;
  requiredParameters: string[];
};
type Task = {
  id: string;
  name: string;
  taskType: "add_contact" | "private_reply" | "broadcast";
  sourceType: string;
  status: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  createdAt: string;
  config: {
    targets?: Target[];
    schedule?: Schedule;
    workflow?: WorkflowDefinition;
    generator?: "internal" | "coze";
    coze?: Partial<CozeSettings>;
    lastError?: string;
    lastGeneratedCount?: number;
  };
};
type Source = WorkflowLibrary & {
  kind: string;
  category: string;
  contentText: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
};
type Notice = (text: string) => void;

const statusLabel: Record<string, string> = {
  ready: "未开始",
  scheduled: "未开始",
  active: "运行中",
  running: "运行中",
  completed: "已完成",
  failed: "执行失败",
  paused: "已暂停",
  cancelled: "已取消",
};
const targetStatus: Record<string, string> = {
  queued: "等待执行",
  scheduled: "等待执行",
  ready_to_send: "待通道投递",
  sent: "请求已发出",
  accepted: "已通过",
  rejected: "被拒绝",
  failed: "失败",
};
const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatDate(value?: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}
function scheduleText(schedule?: Schedule) {
  if (!schedule || schedule.type === "now") return "立即执行";
  if (schedule.type === "datetime")
    return `指定时间 · ${formatDate(schedule.runAt)}`;
  return `${(schedule.weekdays ?? []).map((day) => dayNames[day]).join("、")} ${schedule.time ?? ""}${schedule.repeat === false ? " · 仅一次" : " · 每周重复"}`;
}

function AutomationHero({
  title,
  description,
  active,
  completed,
}: {
  title: string;
  description: string;
  active: number;
  completed: number;
}) {
  return (
    <section className="automation-overview automation-page-hero">
      <div>
        <span className="section-kicker">✦ AUTOMATION WORKSPACE</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div>
        <strong>{active}</strong>
        <span>未完成任务</span>
        <strong>{completed}</strong>
        <span>已完成任务</span>
      </div>
    </section>
  );
}

function TaskDetail({ task, close }: { task: Task; close: () => void }) {
  const targets = task.config.targets ?? [];
  return (
    <>
      <button
        className="drawer-backdrop"
        onClick={close}
        aria-label="关闭任务详情"
      />
      <aside className="task-drawer">
        <button className="drawer-close" onClick={close}>
          ×
        </button>
        <span className={`plan-state ${task.status}`}>
          {statusLabel[task.status] ?? task.status}
        </span>
        <h2>{task.name}</h2>
        <p className="task-detail-meta">
          {scheduleText(task.config.schedule)} · 创建于{" "}
          {formatDate(task.createdAt)}
        </p>
        <section className="task-progress">
          <div>
            <span>未开始</span>
            <i
              className={
                ["ready", "scheduled"].includes(task.status) ? "active" : "done"
              }
            />
          </div>
          <div>
            <span>运行中</span>
            <i
              className={
                task.status === "running" || task.status === "active"
                  ? "active"
                  : ["completed", "failed"].includes(task.status)
                    ? "done"
                    : ""
              }
            />
          </div>
          <div>
            <span>已完成</span>
            <i className={task.status === "completed" ? "active done" : ""} />
          </div>
        </section>
        <dl className="task-facts">
          <div>
            <dt>下次执行</dt>
            <dd>{formatDate(task.nextRunAt)}</dd>
          </div>
          <div>
            <dt>最近执行</dt>
            <dd>{formatDate(task.lastRunAt)}</dd>
          </div>
          <div>
            <dt>数据来源</dt>
            <dd>
              {task.sourceType === "excel"
                ? "Excel 名单"
                : task.sourceType === "search"
                  ? "搜索客户"
                  : task.sourceType === "schedule"
                    ? "客户筛选规则"
                    : task.sourceType}
            </dd>
          </div>
        </dl>
        {task.config.lastError && (
          <div className="search-error">
            <strong>执行失败</strong>
            <p>{task.config.lastError}</p>
          </div>
        )}
        {task.taskType === "add_contact" && (
          <section>
            <h3>
              客户执行明细 <span className="soft-count">{targets.length}</span>
            </h3>
            <div className="task-target-table">
              <div className="task-target-head">
                <span>客户</span>
                <span>微信号 / 手机号</span>
                <span>执行结果</span>
              </div>
              {targets.map((target, index) => (
                <div
                  key={`${target.leadId || target.phone || target.wechat}-${index}`}
                >
                  <span>
                    <b>{target.company}</b>
                    <small>{target.contact || `第 ${index + 1} 行`}</small>
                  </span>
                  <span>{target.wechat || target.phone || "缺失"}</span>
                  <span className={`target-result ${target.status}`}>
                    {target.result ||
                      targetStatus[target.status] ||
                      target.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
        {task.taskType !== "add_contact" && (
          <section>
            <h3>工作流配置</h3>
            {task.config.generator === "coze" ? (
              <div className="coze-task-summary">
                <span>扣</span>
                <div>
                  <strong>扣子工作流</strong>
                  <small>
                  {task.config.coze?.integrationMode === "vibe"
                    ? task.config.coze?.workflowName || "扣子编程项目 API"
                    : `${task.config.coze?.workflowName || "已发布工作流"} · ID：${task.config.coze?.workflowId || "未记录"}`}
                  </small>
                </div>
              </div>
            ) : (
              <div className="workflow-summary">
                {task.config.workflow?.nodes?.map((node) => (
                  <span key={node.id}>
                    {String(node.data.label || node.data.kind)}
                  </span>
                )) ?? <span>旧版规则任务</span>}
              </div>
            )}
            {task.config.lastGeneratedCount !== undefined && (
              <p>最近生成 {task.config.lastGeneratedCount} 条发送记录。</p>
            )}
          </section>
        )}
      </aside>
    </>
  );
}

function TaskList({
  tasks,
  type,
  refresh,
  execute,
  cancel,
}: {
  tasks: Task[];
  type: Task["taskType"];
  refresh: () => void;
  execute: (id: string) => void;
  cancel: (id: string) => void;
}) {
  const [selected, setSelected] = useState<Task | null>(null);
  const shown = tasks.filter((task) => task.taskType === type);
  return (
    <section className="panel automation-task-panel">
      <div className="panel-heading">
        <div>
          <h3>
            任务记录 <span className="soft-count">{shown.length}</span>
          </h3>
          <p>点击整行查看状态、执行计划和逐条结果</p>
        </div>
        <button className="secondary-button" onClick={refresh}>
          刷新
        </button>
      </div>
      {shown.length ? (
        <div className="automation-task-table">
          {shown.map((task) => (
            <div className="automation-task-row" key={task.id}>
              <button
                className="task-row-open"
                onClick={() => setSelected(task)}
                aria-label={`查看 ${task.name} 详情`}
              />
              <span className={`plan-state ${task.status}`}>
                {statusLabel[task.status] ?? task.status}
              </span>
              <b>
                {task.name}
                <small>{scheduleText(task.config.schedule)}</small>
              </b>
              <span>
                {task.config.targets
                  ? `${task.config.targets.length} 个客户`
                  : task.config.workflow
                    ? `${task.config.workflow.nodes.length} 个节点`
                    : "规则任务"}
              </span>
              <time>{formatDate(task.nextRunAt || task.createdAt)}</time>
              <div>
                {["ready", "scheduled"].includes(task.status) &&
                  task.config.schedule?.type === "now" && (
                    <button onClick={() => execute(task.id)}>立即执行</button>
                  )}
                {!["completed", "cancelled"].includes(task.status) && (
                  <button
                    className="danger-link"
                    onClick={() => cancel(task.id)}
                  >
                    取消
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span>⇄</span>
          <h3>还没有任务</h3>
          <p>完成上方配置后创建第一条任务。</p>
        </div>
      )}
      {selected && (
        <TaskDetail
          task={tasks.find((task) => task.id === selected.id) ?? selected}
          close={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function useTasks(notify: Notice) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState("");
  async function refresh() {
    const response = await fetch("/api/automation/tasks");
    if (response.ok) {
      const data = (await response.json()) as { tasks?: Task[] };
      setTasks(data.tasks ?? []);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function act(id: string, action: "execute" | "cancel") {
    if (busy) return;
    setBusy(id);
    const response = await fetch("/api/automation/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    const data = (await response.json()) as { error?: string };
    setBusy("");
    await refresh();
    notify(
      response.ok
        ? action === "cancel"
          ? "任务已取消"
          : "任务执行完成"
        : (data.error ?? "任务操作失败"),
    );
  }
  return {
    tasks,
    busy,
    setBusy,
    refresh,
    execute: (id: string) => void act(id, "execute"),
    cancel: (id: string) => void act(id, "cancel"),
  };
}

export function AddContactView({
  leads,
  notify,
}: {
  leads: Lead[];
  notify: Notice;
}) {
  const manager = useTasks(notify);
  const [source, setSource] = useState<"search" | "customer_library" | "excel">(
    "excel",
  );
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("欧洲客户加微任务");
  const [verify, setVerify] = useState(
    "您好，我们是摩托车配件供应商，希望与您建立联系。",
  );
  const [scheduleType, setScheduleType] = useState<"now" | "datetime">(
    "datetime",
  );
  const [runAt, setRunAt] = useState("");
  const eligible = useMemo(
    () => leads.filter((lead) => lead.phone.trim() || lead.whatsapp.trim()),
    [leads],
  );
  const shown = manager.tasks.filter((task) => task.taskType === "add_contact");
  async function create() {
    if (source === "excel" && !file)
      return notify("请选择 XLSX、CSV 或 TXT 客户名单");
    if (scheduleType === "datetime" && !runAt) return notify("请选择执行时间");
    manager.setBusy("create");
    const schedule =
      scheduleType === "now" ? { type: "now" } : { type: "datetime", runAt };
    let response: Response;
    if (source === "excel" && file) {
      const form = new FormData();
      form.set("file", file);
      form.set("name", name);
      form.set("verify", verify);
      form.set("schedule", JSON.stringify(schedule));
      response = await fetch("/api/automation/tasks", {
        method: "POST",
        body: form,
      });
    } else
      response = await fetch("/api/automation/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_add_contact",
          sourceType: source,
          name,
          verify,
          schedule,
          leadIds: eligible.slice(0, 100).map((lead) => lead.id),
        }),
      });
    const data = (await response.json()) as {
      error?: string;
      task?: Task;
      imported?: number;
    };
    if (response.ok && scheduleType === "now" && data.task?.id)
      await fetch("/api/automation/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute", id: data.task.id }),
      });
    manager.setBusy("");
    await manager.refresh();
    if (!response.ok) return notify(data.error ?? "加微任务创建失败");
    setFile(null);
    notify(
      `加微任务已创建${data.imported ? `，识别 ${data.imported} 条记录` : ""}`,
    );
  }
  return (
    <div className="view-stack automation-center">
      <AutomationHero
        title="加微任务"
        description="从搜索客户、客户库或 Excel 名单创建任务，并在指定时间生成加微请求队列。"
        active={
          shown.filter(
            (task) => !["completed", "cancelled"].includes(task.status),
          ).length
        }
        completed={shown.filter((task) => task.status === "completed").length}
      />
      <section className="panel automation-builder single-automation-builder">
        <div className="panel-heading">
          <div>
            <span className="step-badge">01</span>
            <h3>创建加微任务</h3>
            <p>Excel 每一行必须至少包含微信号或手机号之一，最多 500 行</p>
          </div>
        </div>
        <div className="automation-form-grid">
          <label>
            任务名称
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            客户来源
            <select
              value={source}
              onChange={(event) =>
                setSource(event.target.value as typeof source)
              }
            >
              <option value="excel">上传 Excel 名单</option>
              <option value="search">搜索到的新客户</option>
              <option value="customer_library">客户库已有客户</option>
            </select>
          </label>
          <label>
            执行方式
            <select
              value={scheduleType}
              onChange={(event) =>
                setScheduleType(event.target.value as typeof scheduleType)
              }
            >
              <option value="now">立即执行</option>
              <option value="datetime">指定时间执行</option>
            </select>
          </label>
          {scheduleType === "datetime" && (
            <label>
              执行时间
              <input
                type="datetime-local"
                value={runAt}
                onChange={(event) => setRunAt(event.target.value)}
              />
            </label>
          )}
        </div>
        {source === "excel" ? (
          <label className="file-drop">
            <input
              type="file"
              accept=".xlsx,.csv,.txt"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setFile(event.target.files?.[0] ?? null)
              }
            />
            <span>{file?.name || "选择 XLSX、CSV 或制表符 TXT"}</span>
            <small>表头支持：公司、联系人、手机号/电话、微信号、备注</small>
          </label>
        ) : (
          <div className="source-preview">
            <strong>{eligible.length}</strong>
            <span>个客户包含手机号或 WhatsApp，可进入本次任务</span>
          </div>
        )}
        <label>
          加微验证话术
          <textarea
            maxLength={120}
            value={verify}
            onChange={(event) => setVerify(event.target.value)}
          />
        </label>
        <div className="builder-footer">
          <small>
            到期后系统生成逐条加微请求；企微通道尚未接入时会显示“待通道投递”。
          </small>
          <button
            className="primary-button"
            onClick={create}
            disabled={manager.busy === "create"}
          >
            {manager.busy === "create" ? "创建中…" : "创建任务"}
          </button>
        </div>
      </section>
      <TaskList
        tasks={manager.tasks}
        type="add_contact"
        refresh={() => void manager.refresh()}
        execute={manager.execute}
        cancel={manager.cancel}
      />
    </div>
  );
}

function WorkflowTaskView({
  kind,
  leads,
  libraries,
  notify,
}: {
  kind: "private_reply" | "broadcast";
  leads: Lead[];
  libraries: Source[];
  notify: Notice;
}) {
  const manager = useTasks(notify);
  const mode = kind === "private_reply" ? "reply" : "broadcast";
  const [name, setName] = useState(
    kind === "private_reply"
      ? "客户私信 AI 自动回复"
      : "欧洲摩托车配件客户群发",
  );
  const [workflow, setWorkflow] = useState<WorkflowDefinition>(() =>
    defaultWorkflow(mode),
  );
  const [generator, setGenerator] = useState<"internal" | "coze">("internal");
  const [autoReply, setAutoReply] = useState(true);
  const [scheduleType, setScheduleType] = useState<
    "now" | "datetime" | "weekly"
  >("datetime");
  const [runAt, setRunAt] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [time, setTime] = useState("10:00");
  const [repeat, setRepeat] = useState(true);
  const [cozeConfigured, setCozeConfigured] = useState(false);
  const [cozeOpenApiConfigured, setCozeOpenApiConfigured] = useState(false);
  const [cozeVibeConfigured, setCozeVibeConfigured] = useState(false);
  const [testingCoze, setTestingCoze] = useState(false);
  const [cozeTestResult, setCozeTestResult] = useState("");
  const [coze, setCoze] = useState<CozeSettings>({
    integrationMode: "openapi",
    executionMode: "stream",
    workflowId: "",
    inputParameter: "BOT_USER_INPUT",
    contextParameter: "",
    rulesParameter: "",
    contactParameter: "",
    outputField: "output",
    botId: "",
    appId: "",
    workspaceId: "",
    workflowName: "",
    staticParameters: {},
    requiredParameters: [],
  });
  const shown = manager.tasks.filter((task) => task.taskType === kind);
  const eligible = leads.filter(
    (lead) => lead.phone.trim() || lead.whatsapp.trim(),
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/integrations/coze")
        .then((response) => (response.ok ? response.json() : {}))
        .then((data: { configured?: boolean; openApiConfigured?: boolean; vibeConfigured?: boolean }) => {
          setCozeConfigured(Boolean(data.configured));
          setCozeOpenApiConfigured(Boolean(data.openApiConfigured));
          setCozeVibeConfigured(Boolean(data.vibeConfigured));
          if (data.vibeConfigured && !data.openApiConfigured) setCoze((current) => ({ ...current, integrationMode: "vibe" }));
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  function cozePayload() {
    if (coze.integrationMode === "vibe") {
      if (!cozeVibeConfigured) throw new Error("扣子编程项目尚未连接");
      if (!coze.workflowName || !coze.inputParameter || !coze.outputField) throw new Error("尚未读取扣子编程工作流参数");
      const missing = coze.requiredParameters.filter((key) => key !== coze.inputParameter && coze.staticParameters[key] === undefined);
      if (missing.length) throw new Error(`请先填写扣子编程必填参数：${missing.join("、")}`);
      return coze;
    }
    if (!coze.workflowId) throw new Error("请先从扣子选择一个已发布工作流");
    return coze;
  }
  function selectCozeWorkflow(selection: CozeWorkflowSelection) {
    setCoze((current) => ({
      ...current,
      ...selection,
      integrationMode: "openapi",
      inputParameter: "BOT_USER_INPUT",
      outputField: "output",
      botId: "",
      staticParameters: {},
    }));
    setCozeTestResult("");
    notify(`已选择扣子工作流：${selection.workflowName}`);
  }
  function selectCozeVibe(selection: CozeVibeSelection) {
    setCoze((current) => ({
      ...current,
      ...selection,
      integrationMode: "vibe",
      executionMode: "sync",
      workflowId: "",
      botId: "",
      appId: "",
      workspaceId: "",
    }));
    setCozeTestResult("");
  }
  async function testCoze(messageOverride?: string) {
    const defaultMessage =
      kind === "private_reply"
        ? "请问你们的产品最低起订量是多少？"
        : "为欧洲摩托车配件客户生成一条简短产品介绍。";
    const testMessage = messageOverride ?? window.prompt(
      `请输入本次工作流测试内容（将发送到 ${coze.inputParameter || "input"}）`,
      defaultMessage,
    );
    if (testMessage === null) return;
    if (!testMessage.trim()) return notify("请输入工作流测试内容");
    try {
      setTestingCoze(true);
      setCozeTestResult("");
      const response = await fetch(coze.integrationMode === "vibe" ? "/api/integrations/coze/vibe" : "/api/integrations/coze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: cozePayload(),
          message: testMessage.trim(),
        }),
      });
      const data = (await response.json()) as { error?: string; text?: string };
      if (!response.ok) return notify(data.error ?? "扣子工作流测试失败");
      if (!data.text?.trim())
        return notify("扣子工作流没有返回话术，请检查结束节点输出");
      setCozeTestResult(data.text);
      notify("扣子工作流连接测试成功");
    } catch (error) {
      notify(error instanceof Error ? error.message : "扣子配置无效");
    } finally {
      setTestingCoze(false);
    }
  }
  async function create() {
    if (kind === "broadcast" && scheduleType === "datetime" && !runAt)
      return notify("请选择群发时间");
    if (kind === "broadcast" && scheduleType === "weekly" && !weekdays.length)
      return notify("每周计划至少选择一天");
    let cozeConfig: CozeSettings | undefined;
    try {
      if (generator === "coze") cozeConfig = cozePayload();
    } catch (error) {
      return notify(error instanceof Error ? error.message : "扣子配置无效");
    }
    manager.setBusy("create");
    const schedule: Schedule =
      scheduleType === "now"
        ? { type: "now" }
        : scheduleType === "datetime"
          ? { type: "datetime", runAt }
          : { type: "weekly", weekdays, time, repeat };
    const payload =
      kind === "private_reply"
        ? {
            action: "create_private_reply",
            name,
            generator,
            workflow,
            coze: cozeConfig,
            autoReplyNormal: autoReply,
          }
        : {
            action: "create_broadcast",
            name,
            generator,
            workflow,
            coze: cozeConfig,
            schedule,
            stages: ["新发现", "待触达", "沟通中", "有意向"],
            contentMode: "ai",
            audience: `当前 ${eligible.length} 个有号码客户`,
          };
    const response = await fetch("/api/automation/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as { error?: string; task?: Task };
    if (
      response.ok &&
      kind === "broadcast" &&
      scheduleType === "now" &&
      data.task?.id
    )
      await fetch("/api/automation/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute", id: data.task.id }),
      });
    manager.setBusy("");
    await manager.refresh();
    notify(
      response.ok
        ? kind === "private_reply"
          ? "私聊工作流已启用"
          : "群发工作流已排期"
        : (data.error ?? "任务创建失败"),
    );
  }
  return (
    <div className="view-stack automation-center">
      <AutomationHero
        title={kind === "private_reply" ? "私聊任务" : "群发任务"}
        description={
          kind === "private_reply"
            ? "收到客户私信后，可选择系统工作流或调用用户在扣子创建并发布的工作流生成话术。"
            : "群发内容既可由系统工作流生成，也可调用扣子工作流，并配置一次性或周期计划。"
        }
        active={
          shown.filter(
            (task) => !["completed", "cancelled"].includes(task.status),
          ).length
        }
        completed={shown.filter((task) => task.status === "completed").length}
      />
      <section className="panel workflow-builder-panel">
        <div className="panel-heading">
          <div>
            <span className="step-badge">
              {kind === "private_reply" ? "02" : "03"}
            </span>
            <h3>配置{kind === "private_reply" ? "私聊" : "群发"}工作流</h3>
            <p>选择系统内置画布，或调用已在扣子发布的工作流</p>
          </div>
        </div>
        <div className="automation-form-grid workflow-basics">
          <label>
            任务名称
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {kind === "private_reply" ? (
            <label className="check-line">
              <input
                type="checkbox"
                checked={autoReply}
                onChange={(event) => setAutoReply(event.target.checked)}
              />
              普通内容自动进入待发送队列
            </label>
          ) : (
            <label>
              执行计划
              <select
                value={scheduleType}
                onChange={(event) =>
                  setScheduleType(event.target.value as typeof scheduleType)
                }
              >
                <option value="now">立即执行一次</option>
                <option value="datetime">指定时间执行一次</option>
                <option value="weekly">每周定时</option>
              </select>
            </label>
          )}
        </div>
        {kind === "broadcast" && scheduleType === "datetime" && (
          <label className="schedule-inline">
            发送时间
            <input
              type="datetime-local"
              value={runAt}
              onChange={(event) => setRunAt(event.target.value)}
            />
          </label>
        )}
        {kind === "broadcast" && scheduleType === "weekly" && (
          <div className="weekly-rule">
            <div>
              {dayNames.map((day, index) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    checked={weekdays.includes(index)}
                    onChange={() =>
                      setWeekdays((current) =>
                        current.includes(index)
                          ? current.filter((item) => item !== index)
                          : [...current, index],
                      )
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
            <label className="check-line">
              <input
                type="checkbox"
                checked={repeat}
                onChange={(event) => setRepeat(event.target.checked)}
              />
              每周重复
            </label>
          </div>
        )}
        {kind === "broadcast" && (
          <p className="schedule-notice" role="note">
            当前使用 Vercel 免费版调度：系统每天检查一次到期任务，实际生成待发送队列通常会比设定时间晚，接近一天；任务积压时可能更久。未接入发送渠道前不会自动发出消息。
          </p>
        )}
        <div className="workflow-provider-tabs">
          <button
            className={generator === "internal" ? "active" : ""}
            onClick={() => setGenerator("internal")}
          >
            <span>流</span>
            <b>
              系统工作流<small>React Flow 可视化编排</small>
            </b>
          </button>
          <button
            className={generator === "coze" ? "active" : ""}
            onClick={() => setGenerator("coze")}
          >
            <span>扣</span>
            <b>
              扣子工作流
              <small>
                {cozeConfigured ? "访问令牌已连接" : "等待配置访问令牌"}
              </small>
            </b>
          </button>
        </div>
        {generator === "internal" ? (
          <WorkflowEditor
            value={workflow}
            onChange={setWorkflow}
            libraries={libraries}
            mode={mode}
          />
        ) : (
          <div className="coze-integration-stack">
            <div className="coze-submode-panel">
              <div className="coze-submode-heading">
                <span>子选项</span>
                <div>
                  <strong>选择扣子工作流的接入方式</strong>
                  <small>以下两项均属于上方“扣子工作流”</small>
                </div>
              </div>
              <div className="coze-mode-tabs" role="group" aria-label="扣子工作流接入方式">
                <button type="button" className={coze.integrationMode === "openapi" ? "active" : ""} onClick={() => { setCoze((current) => ({ ...current, integrationMode: "openapi" })); setCozeTestResult(""); }}><span>流</span><b>工作流库<small>选择已发布低代码工作流</small></b><i>{cozeOpenApiConfigured ? "已连接" : "未连接"}</i></button>
                <button type="button" className={coze.integrationMode === "vibe" ? "active" : ""} onClick={() => { setCoze((current) => ({ ...current, integrationMode: "vibe" })); setCozeTestResult(""); }}><span>编</span><b>扣子编程项目<small>调用 coze.site 独立部署</small></b><i>{cozeVibeConfigured ? "已连接" : "未连接"}</i></button>
              </div>
            </div>
            {coze.integrationMode === "openapi" ? <CozeWorkflowPicker
              configured={cozeOpenApiConfigured}
              selectedWorkflowId={coze.workflowId}
              testing={testingCoze}
              testResult={cozeTestResult}
              onSelect={selectCozeWorkflow}
              onTest={() => void testCoze()}
            /> : <CozeVibeConnector
              configured={cozeVibeConfigured}
              value={{ integrationMode: "vibe", workflowName: coze.workflowName, inputParameter: coze.inputParameter, contextParameter: coze.contextParameter, rulesParameter: coze.rulesParameter, contactParameter: coze.contactParameter, outputField: coze.outputField, staticParameters: coze.staticParameters, requiredParameters: coze.requiredParameters }}
              testing={testingCoze}
              testResult={cozeTestResult}
              onChange={selectCozeVibe}
              onTest={(message) => void testCoze(message)}
            />}
          </div>
        )}
        <div className="builder-footer">
          <small>
            {generator === "coze"
              ? coze.integrationMode === "vibe"
                ? "客户消息会自动写入识别出的输入参数；项目 API Token 仅在服务端使用。敏感词审核仍由贸客 AI 执行。"
                : "客户消息、所选知识上下文和任务规则会作为开始节点参数发送到扣子。敏感词审核仍由贸客 AI 执行。"
              : kind === "private_reply"
                ? "敏感词命中或工作流包含人工审核节点时，回复会进入审核台。"
                : "Vercel 免费版按日扫描到期任务，精确到分钟需要后续升级调度服务。"}
          </small>
          <button
            className="primary-button"
            onClick={create}
            disabled={manager.busy === "create"}
          >
            {manager.busy === "create"
              ? "保存中…"
              : kind === "private_reply"
                ? "保存并启用工作流"
                : "创建群发任务"}
          </button>
        </div>
      </section>
      <TaskList
        tasks={manager.tasks}
        type={kind}
        refresh={() => void manager.refresh()}
        execute={manager.execute}
        cancel={manager.cancel}
      />
    </div>
  );
}

export function PrivateReplyView(props: {
  leads: Lead[];
  libraries: Source[];
  notify: Notice;
}) {
  return <WorkflowTaskView kind="private_reply" {...props} />;
}
export function BroadcastView(props: {
  leads: Lead[];
  libraries: Source[];
  notify: Notice;
}) {
  return <WorkflowTaskView kind="broadcast" {...props} />;
}

export function SensitiveWordsView({
  sources,
  refresh,
  notify,
}: {
  sources: Source[];
  refresh: () => Promise<void>;
  notify: Notice;
}) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const sensitive = sources.filter(
    (source) => source.libraryType === "sensitive",
  );
  async function save() {
    if (!name.trim() || !content.trim())
      return notify("请填写词库名称和敏感词");
    setBusy(true);
    const response = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        category: "合规规则",
        libraryType: "sensitive",
        content,
      }),
    });
    const data = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) return notify(data.error ?? "敏感词库保存失败");
    setName("");
    setContent("");
    await refresh();
    notify("敏感词库已保存，可在工作流节点中选择");
  }
  async function toggle(source: Source) {
    await fetch("/api/knowledge", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: source.id,
        status: source.status === "ready" ? "disabled" : "ready",
      }),
    });
    await refresh();
  }
  async function remove(source: Source) {
    if (!window.confirm(`确认删除“${source.name}”？`)) return;
    await fetch(`/api/knowledge?id=${encodeURIComponent(source.id)}`, {
      method: "DELETE",
    });
    await refresh();
    notify("敏感词库已删除");
  }
  return (
    <div className="view-stack">
      <section className="knowledge-hero sensitive-hero">
        <div>
          <span className="section-kicker">✦ CONTENT SAFETY</span>
          <h2>敏感词库</h2>
          <p>
            集中管理报价、付款、合同、投诉、法律等高风险词；私聊和群发工作流通过“敏感词检测”节点引用。
          </p>
        </div>
        <span className="knowledge-bound">已接入工作流与审核台</span>
      </section>
      <section className="knowledge-grid">
        <article className="panel knowledge-editor">
          <div className="panel-heading">
            <div>
              <h3>新建敏感词库</h3>
              <p>支持逗号、中文逗号或换行分隔，系统会去重</p>
            </div>
          </div>
          <div className="knowledge-form">
            <label>
              词库名称
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：商务承诺敏感词"
              />
            </label>
            <label>
              敏感词
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={
                  "价格, 最低价, 付款\n合同, 退款, 投诉\n保证, 绝对, 法律"
                }
              />
            </label>
            <button className="primary-button" onClick={save} disabled={busy}>
              {busy ? "保存中…" : "保存并启用"}
            </button>
          </div>
        </article>
        <article className="panel knowledge-list">
          <div className="panel-heading">
            <div>
              <h3>
                敏感词库 <span className="soft-count">{sensitive.length}</span>
              </h3>
              <p>仅启用的词库可被工作流选择</p>
            </div>
          </div>
          {sensitive.length ? (
            <div>
              {sensitive.map((source) => (
                <div
                  className={`source-row ${source.status === "disabled" ? "disabled" : ""}`}
                  key={source.id}
                >
                  <span className="file-icon">敏</span>
                  <span className="source-main">
                    <strong>{source.name}</strong>
                    <small>
                      {
                        source.contentText.split(/[,，\n]/).filter(Boolean)
                          .length
                      }{" "}
                      个词 · {source.category}
                    </small>
                    <p>{source.contentText.slice(0, 140)}</p>
                  </span>
                  <span className="source-actions">
                    <button
                      className={`source-toggle ${source.status}`}
                      onClick={() => void toggle(source)}
                    >
                      {source.status === "ready" ? "已启用" : "已停用"}
                    </button>
                    <button
                      className="source-delete"
                      aria-label={`删除 ${source.name}`}
                      onClick={() => void remove(source)}
                    >
                      ×
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span>敏</span>
              <h3>尚未创建敏感词库</h3>
              <p>创建后即可在私聊或群发工作流中引用。</p>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
