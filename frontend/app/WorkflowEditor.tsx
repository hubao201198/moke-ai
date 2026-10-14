"use client";

import { useEffect, useState } from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export type WorkflowKind = "trigger" | "intent" | "knowledge" | "model" | "prompt" | "sensitive" | "review" | "output";
export type WorkflowNodeData = Record<string, unknown> & {
  kind: WorkflowKind;
  label: string;
  config: { libraryIds?: string[]; model?: string; prompt?: string; instruction?: string; requireReview?: boolean };
};
export type WorkflowDefinition = { nodes: Array<Node<WorkflowNodeData>>; edges: Edge[] };
export type WorkflowLibrary = { id: string; name: string; libraryType: "knowledge" | "corpus" | "material" | "sensitive"; status: string };

const nodeMeta: Record<WorkflowKind, { label: string; description: string; color: string }> = {
  trigger: { label: "收到客户消息", description: "工作流入口", color: "#dbeafe" },
  intent: { label: "意图识别", description: "判断询价、投诉等意图", color: "#f3e8ff" },
  knowledge: { label: "知识检索", description: "选择知识、语料或素材", color: "#dcfce7" },
  model: { label: "大模型", description: "选择 OpenRouter 模型", color: "#e0e7ff" },
  prompt: { label: "提示词", description: "定义角色和回复规则", color: "#fef3c7" },
  sensitive: { label: "敏感词检测", description: "引用独立敏感词库", color: "#fee2e2" },
  review: { label: "人工审核", description: "命中规则后进入审核台", color: "#ffedd5" },
  output: { label: "生成发送队列", description: "等待企微通道投递", color: "#ccfbf1" },
};

function createNode(kind: WorkflowKind, index: number): Node<WorkflowNodeData> {
  const meta = nodeMeta[kind];
  const config: WorkflowNodeData["config"] = kind === "model"
    ? { model: "deepseek/deepseek-v4-flash-0731" }
    : kind === "review"
      ? { requireReview: true }
      : kind === "intent"
        ? { prompt: "识别客户的询价、产品咨询、样品、投诉、退订和其他意图；信息不足时标记为需要澄清。" }
        : kind === "prompt"
          ? { prompt: "使用客户语言，回复简洁专业；只依据所选资料，不虚构价格、库存、交期或认证；信息不足时只追问一个关键问题。" }
          : {};
  return {
    id: `${kind}-${crypto.randomUUID()}`,
    type: "default",
    position: { x: 55 + (index % 4) * 220, y: 55 + Math.floor(index / 4) * 145 },
    data: { kind, label: meta.label, config },
    style: { width: 180, borderColor: meta.color, borderWidth: 2, borderRadius: 12, background: "#fff", boxShadow: "0 8px 24px rgba(35,58,112,.08)" },
  };
}

export function defaultWorkflow(mode: "reply" | "broadcast"): WorkflowDefinition {
  const kinds: WorkflowKind[] = mode === "reply"
    ? ["trigger", "intent", "knowledge", "model", "prompt", "sensitive", "review", "output"]
    : ["trigger", "knowledge", "model", "prompt", "sensitive", "review", "output"];
  const nodes = kinds.map((kind, index) => createNode(kind, index));
  const edges = nodes.slice(1).map((node, index) => ({ id: `edge-${index}-${node.id}`, source: nodes[index].id, target: node.id, animated: true }));
  return { nodes, edges };
}

export default function WorkflowEditor({ value, onChange, libraries, mode }: { value: WorkflowDefinition; onChange: (value: WorkflowDefinition) => void; libraries: WorkflowLibrary[]; mode: "reply" | "broadcast" }) {
  const [nodes, setNodes] = useState(value.nodes);
  const [edges, setEdges] = useState(value.edges);
  const [selectedId, setSelectedId] = useState(value.nodes.find(node => node.data.kind === "prompt")?.id ?? value.nodes[0]?.id ?? "");
  const selected = nodes.find(node => node.id === selectedId);

  useEffect(() => { onChange({ nodes, edges }); }, [edges, nodes, onChange]);
  function changeNodes(changes: NodeChange<Node<WorkflowNodeData>>[]) {
    setNodes(current => applyNodeChanges(changes, current));
  }
  function changeEdges(changes: EdgeChange[]) {
    setEdges(current => applyEdgeChanges(changes, current));
  }
  function connect(connection: Connection) {
    setEdges(current => addEdge({ ...connection, animated: true }, current));
  }
  function add(kind: WorkflowKind) {
    const node = createNode(kind, nodes.length); setNodes(current => [...current, node]); setSelectedId(node.id);
  }
  function updateConfig(changes: Partial<WorkflowNodeData["config"]>) {
    setNodes(current => current.map(node => node.id === selectedId ? { ...node, data: { ...node.data, config: { ...node.data.config, ...changes } } } : node));
  }
  function toggleLibrary(id: string) {
    const current = selected?.data.config.libraryIds ?? [];
    updateConfig({ libraryIds: current.includes(id) ? current.filter(item => item !== id) : [...current, id] });
  }
  const available = selected?.data.kind === "sensitive"
    ? libraries.filter(item => item.libraryType === "sensitive" && item.status === "ready")
    : libraries.filter(item => item.libraryType !== "sensitive" && item.status === "ready");

  return <div className="workflow-editor-shell">
    <div className="workflow-toolbar" aria-label="工作流节点工具栏">
      <span>添加节点</span>
      {(mode === "reply" ? ["intent", "knowledge", "model", "prompt", "sensitive", "review"] : ["knowledge", "model", "prompt", "sensitive", "review"]).map(kind => <button type="button" key={kind} onClick={() => add(kind as WorkflowKind)}>+ {nodeMeta[kind as WorkflowKind].label}</button>)}
    </div>
    <div className="workflow-workspace">
      <div className="workflow-canvas">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={changeNodes} onEdgesChange={changeEdges} onConnect={connect} onNodeClick={(_, node) => setSelectedId(node.id)} fitView minZoom={0.45} maxZoom={1.6} deleteKeyCode={["Backspace", "Delete"]}>
          <MiniMap nodeColor={node => nodeMeta[(node.data?.kind as WorkflowKind) || "prompt"].color} pannable zoomable />
          <Controls />
          <Background gap={18} size={1} color="#dbe3f3" />
        </ReactFlow>
      </div>
      <aside className="workflow-inspector">
        {selected ? <>
          <span className="workflow-node-type">{nodeMeta[selected.data.kind].label}</span>
          <h4>{selected.data.label}</h4><p>{nodeMeta[selected.data.kind].description}</p>
          {["intent", "prompt"].includes(selected.data.kind) && <label>{selected.data.kind === "intent" ? "意图识别规则" : "系统提示词"}<textarea value={selected.data.config.prompt ?? selected.data.config.instruction ?? ""} onChange={event => updateConfig({ prompt: event.target.value })} placeholder={selected.data.kind === "intent" ? "例如：识别询价、样品、投诉、退订；不确定时转人工。" : "例如：只依据知识库回答，信息不足时追问一个问题。"} /></label>}
          {selected.data.kind === "model" && <label>OpenRouter 模型<input value={selected.data.config.model ?? ""} onChange={event => updateConfig({ model: event.target.value })} placeholder="deepseek/deepseek-v4-flash-0731" /></label>}
          {["knowledge", "sensitive"].includes(selected.data.kind) && <div className="workflow-library-list"><strong>{selected.data.kind === "sensitive" ? "选择敏感词库" : "选择资料库"}</strong>{available.length ? available.map(item => <label key={item.id}><input type="checkbox" checked={(selected.data.config.libraryIds ?? []).includes(item.id)} onChange={() => toggleLibrary(item.id)} />{item.name}<small>{item.libraryType === "knowledge" ? "知识库" : item.libraryType === "corpus" ? "语料库" : item.libraryType === "material" ? "素材库" : "敏感词库"}</small></label>) : <p>暂无可选内容，请先到对应管理页面添加。</p>}</div>}
          {selected.data.kind === "review" && <label className="check-line"><input type="checkbox" checked={selected.data.config.requireReview !== false} onChange={event => updateConfig({ requireReview: event.target.checked })} />该节点要求管理员审核</label>}
          {["trigger", "output"].includes(selected.data.kind) && <div className="workflow-readonly">系统节点无需配置</div>}
        </> : <p>点击节点后在这里配置。</p>}
      </aside>
    </div>
  </div>;
}
