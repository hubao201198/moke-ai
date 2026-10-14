"use client";

import { useCallback, useEffect, useState } from "react";

type Workspace = { id: string; name: string };
type Workflow = { id: string; name: string; description: string; appId: string; workspaceId: string; updatedAt: string };

export type CozeWorkflowSelection = { workflowId: string; workflowName: string; workspaceId: string; appId: string };

export default function CozeWorkflowPicker({ configured, selectedWorkflowId, testing, testResult, onSelect, onTest }: {
  configured: boolean;
  selectedWorkflowId: string;
  testing: boolean;
  testResult: string;
  onSelect: (workflow: CozeWorkflowSelection) => void;
  onTest: () => void;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [awaitingReturn, setAwaitingReturn] = useState(false);

  const loadWorkflows = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/integrations/coze/workflows?workspaceId=${encodeURIComponent(id)}`);
      const data = await response.json() as { workflows?: Workflow[]; error?: string };
      if (!response.ok) throw new Error(data.error || "读取扣子工作流失败");
      setWorkflows(data.workflows ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取扣子工作流失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/integrations/coze/workflows");
        const data = await response.json() as { workspaces?: Workspace[]; error?: string };
        if (!response.ok) throw new Error(data.error || "读取扣子空间失败");
        if (!active) return;
        const items = data.workspaces ?? [];
        setWorkspaces(items);
        const first = items[0]?.id ?? "";
        setWorkspaceId(first);
        if (first) await loadWorkflows(first);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "读取扣子空间失败");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [configured, loadWorkflows]);

  useEffect(() => {
    function refreshAfterReturn() {
      if (!awaitingReturn || !workspaceId) return;
      setAwaitingReturn(false);
      void loadWorkflows(workspaceId);
    }
    window.addEventListener("focus", refreshAfterReturn);
    return () => window.removeEventListener("focus", refreshAfterReturn);
  }, [awaitingReturn, loadWorkflows, workspaceId]);

  function openCoze(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
    setAwaitingReturn(true);
  }

  const selected = workflows.find(item => item.id === selectedWorkflowId);
  const workspaceUrl = workspaceId ? `https://www.coze.cn/space/${workspaceId}` : "https://www.coze.cn/home";

  return <div className="coze-workflow-config coze-picker">
    <div className="coze-config-heading"><div><span className="coze-logo">扣</span><div><h4>从扣子选择工作流</h4><p>去扣子创建并发布，返回本页后自动同步，无需填写工作流 ID 或参数字段。</p></div></div><em className={configured ? "connected" : ""}>{configured ? "扣子已连接" : "扣子未连接"}</em></div>
    {!configured ? <div className="coze-picker-empty"><strong>尚未连接扣子</strong><p>请先配置服务端访问令牌；后续多用户版本将切换为 OAuth 授权。</p></div> : <>
      <div className="coze-picker-toolbar"><label>扣子工作空间<select value={workspaceId} onChange={event => { const id = event.target.value; setWorkspaceId(id); void loadWorkflows(id); }}>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div><button className="primary-button" onClick={() => openCoze(workspaceUrl)}>去扣子创建工作流 ↗</button><button className="secondary-button" onClick={() => void loadWorkflows(workspaceId)} disabled={loading}>{loading ? "同步中…" : "刷新工作流"}</button></div></div>
      {awaitingReturn && <div className="coze-return-hint"><span>↗</span><p><strong>扣子已在新窗口打开</strong>完成搭建并发布后回到这里，列表会自动刷新；也可以点击“刷新工作流”。</p></div>}
      {error && <div className="coze-picker-error">{error}</div>}
      {!loading && !error && !workflows.length ? <div className="coze-picker-empty"><strong>当前空间没有已发布工作流</strong><p>在扣子创建并发布后，返回这里刷新即可选择。</p></div> : <div className="coze-workflow-list">{workflows.map(item => <article className={item.id === selectedWorkflowId ? "selected" : ""} key={item.id}><button className="coze-workflow-select" onClick={() => onSelect({ workflowId: item.id, workflowName: item.name, workspaceId: item.workspaceId, appId: item.appId === "0" ? "" : item.appId })}><span>{item.name.slice(0, 1).toUpperCase()}</span><div><strong>{item.name}</strong><p>{item.description || "已发布扣子工作流"}</p><small>{item.appId && item.appId !== "0" ? "应用工作流" : "空间工作流"} · ID 尾号 {item.id.slice(-6)}</small></div><i>{item.id === selectedWorkflowId ? "已选择" : "选择"}</i></button><button className="coze-edit-link" onClick={() => openCoze(`https://www.coze.cn/work_flow?space_id=${encodeURIComponent(item.workspaceId)}&workflow_id=${encodeURIComponent(item.id)}`)}>在扣子编辑 ↗</button></article>)}</div>}
      {selected && <div className="coze-selected"><div><span>✓</span><p><strong>{selected.name}</strong><small>已绑定；标准输入 BOT_USER_INPUT，标准输出 output</small></p></div><button className="secondary-button" onClick={onTest} disabled={testing}>{testing ? "正在测试…" : "测试所选工作流"}</button></div>}
      {testResult && <div className="coze-test-result"><strong>扣子返回话术</strong><p>{testResult}</p></div>}
    </>}
  </div>;
}
