"use client";

import { useEffect, useState } from "react";

type Parameter = {
  key: string;
  type: string;
  title: string;
  description: string;
  required: boolean;
  defaultValue?: unknown;
  enumValues: unknown[];
};

type Schema = {
  inputParameters: Parameter[];
  outputParameters: Parameter[];
  endpointHost: string;
};

export type CozeVibeSelection = {
  integrationMode: "vibe";
  workflowName: string;
  inputParameter: string;
  contextParameter: string;
  rulesParameter: string;
  contactParameter: string;
  outputField: string;
  staticParameters: Record<string, unknown>;
  requiredParameters: string[];
};

function preferredParameter(parameters: Parameter[], candidates: string[]) {
  const normalized = new Map(parameters.map((item) => [item.key.toLowerCase(), item.key]));
  for (const candidate of candidates) {
    const exact = normalized.get(candidate.toLowerCase());
    if (exact) return exact;
  }
  return parameters.find((item) => item.required && item.type === "string")?.key
    || parameters.find((item) => item.type === "string")?.key
    || parameters[0]?.key
    || "";
}

function defaultSelection(schema: Schema, current: CozeVibeSelection): CozeVibeSelection {
  const inputKeys = new Set(schema.inputParameters.map((item) => item.key));
  const outputKeys = new Set(schema.outputParameters.map((item) => item.key));
  const inputParameter = inputKeys.has(current.inputParameter)
    ? current.inputParameter
    : preferredParameter(schema.inputParameters, ["BOT_USER_INPUT", "USER_INPUT", "user_input", "message", "input", "content", "query", "city_name"]);
  const outputField = outputKeys.has(current.outputField)
    ? current.outputField
    : preferredParameter(schema.outputParameters, ["output", "answer", "text", "message", "content", "reply", "result"]);
  const staticParameters = { ...current.staticParameters };
  for (const item of schema.inputParameters) {
    if (item.key !== inputParameter && staticParameters[item.key] === undefined && item.defaultValue !== undefined) staticParameters[item.key] = item.defaultValue;
  }
  delete staticParameters[inputParameter];
  return {
    ...current,
    integrationMode: "vibe",
    workflowName: `扣子编程项目 · ${schema.endpointHost}`,
    inputParameter,
    outputField,
    staticParameters,
    requiredParameters: schema.inputParameters.filter((item) => item.required).map((item) => item.key),
  };
}

function parseValue(value: string, type: string) {
  if (type === "number" || type === "integer") return value === "" ? undefined : Number(value);
  if (type === "boolean") return value === "true";
  if (type === "array" || type === "object") {
    if (!value.trim()) return undefined;
    try { return JSON.parse(value) as unknown; } catch { return value; }
  }
  return value;
}

export default function CozeVibeConnector({
  configured,
  value,
  testing,
  testResult,
  onChange,
  onTest,
}: {
  configured: boolean;
  value: CozeVibeSelection;
  testing: boolean;
  testResult: string;
  onChange: (selection: CozeVibeSelection) => void;
  onTest: (message: string) => void;
}) {
  const [schema, setSchema] = useState<Schema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [testMessage, setTestMessage] = useState("请问你们的产品最低起订量是多少？");
  async function loadSchema() {
    if (!configured) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/integrations/coze/vibe", { cache: "no-store" });
      const data = await response.json() as { schema?: Schema; error?: string };
      if (!response.ok || !data.schema) throw new Error(data.error || "无法读取扣子编程工作流参数");
      setSchema(data.schema);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法读取扣子编程工作流参数");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSchema(), 0);
    return () => window.clearTimeout(timer);
    // 首次进入或连接状态变化时读取，用户可通过“重新读取参数”手动同步新部署。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  useEffect(() => {
    if (!schema) return;
    const next = defaultSelection(schema, value);
    if (JSON.stringify(next) !== JSON.stringify(value)) onChange(next);
  }, [schema, value, onChange]);

  function update(next: Partial<CozeVibeSelection>) {
    onChange({ ...value, ...next, integrationMode: "vibe" });
  }

  function updateStatic(parameter: Parameter, rawValue: string) {
    const parsed = parseValue(rawValue, parameter.type);
    const staticParameters = { ...value.staticParameters };
    if (parsed === undefined || parsed === "") delete staticParameters[parameter.key];
    else staticParameters[parameter.key] = parsed;
    update({ staticParameters });
  }

  if (!configured) return <div className="coze-picker-empty"><strong>扣子编程项目尚未连接</strong><p>请在 Vercel 生产环境配置接口地址与项目 API Token，令牌只会在服务端使用。</p></div>;

  const extraInputs = schema?.inputParameters.filter((item) => item.key !== value.inputParameter) ?? [];
  const missingRequired = extraInputs.filter((item) => item.required && value.staticParameters[item.key] === undefined);
  return <div className="coze-workflow-config coze-vibe-connector">
    <div className="coze-config-heading"><div><span className="coze-logo">编</span><div><h4>扣子编程项目 API</h4><p>系统从部署接口自动读取参数，不保存接口令牌。</p></div></div><em className="connected">项目已连接</em></div>
    <div className="coze-vibe-actions"><button type="button" className="primary-button" onClick={() => window.open("https://code.coze.cn/", "_blank", "noopener,noreferrer")}>去扣子编程编辑并部署 ↗</button><button type="button" className="secondary-button" onClick={() => void loadSchema()} disabled={loading}>{loading ? "读取中…" : "重新读取参数"}</button></div>
    {error && <div className="coze-picker-error">{error}</div>}
    {schema && <>
      <div className="coze-vibe-endpoint"><span>✓</span><p><strong>{schema.endpointHost}</strong><small>已识别 {schema.inputParameters.length} 个输入参数、{schema.outputParameters.length} 个输出参数</small></p></div>
      <div className="coze-vibe-mapping">
        <label>客户消息自动传给<select value={value.inputParameter} onChange={(event) => { const inputParameter = event.target.value; const staticParameters = { ...value.staticParameters }; delete staticParameters[inputParameter]; update({ inputParameter, staticParameters }); }}>{schema.inputParameters.map((item) => <option key={item.key} value={item.key}>{item.title}（{item.key}）</option>)}</select></label>
        <label>把该输出作为回复话术<select value={value.outputField} onChange={(event) => update({ outputField: event.target.value })}>{schema.outputParameters.map((item) => <option key={item.key} value={item.key}>{item.title}（{item.key}）</option>)}</select></label>
      </div>
      {extraInputs.length > 0 && <div className="coze-vibe-extra"><h5>其他工作流输入</h5><p>系统已读取当前部署的参数；必填项需要提供固定值，客户消息参数会在实际运行时自动替换。</p><div>{extraInputs.map((item) => <label key={item.key}><span>{item.title}{item.required ? <b>必填</b> : <small>可选</small>}<i>{item.description || item.key}</i></span>{item.enumValues.length ? <select value={String(value.staticParameters[item.key] ?? "")} onChange={(event) => updateStatic(item, event.target.value)}><option value="">请选择</option>{item.enumValues.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select> : item.type === "boolean" ? <select value={String(value.staticParameters[item.key] ?? "")} onChange={(event) => updateStatic(item, event.target.value)}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select> : <input type={["number", "integer"].includes(item.type) ? "number" : "text"} value={typeof value.staticParameters[item.key] === "object" ? JSON.stringify(value.staticParameters[item.key]) : String(value.staticParameters[item.key] ?? "")} placeholder={item.defaultValue === undefined ? "请输入" : `默认：${String(item.defaultValue)}`} onChange={(event) => updateStatic(item, event.target.value)} />}</label>)}</div></div>}
      {missingRequired.length > 0 && <div className="coze-picker-error">请先填写必填参数：{missingRequired.map((item) => item.title).join("、")}</div>}
      <div className="coze-vibe-test"><label>测试输入<input value={testMessage} onChange={(event) => setTestMessage(event.target.value)} placeholder={`内容会传给 ${value.inputParameter || "工作流输入"}`} /></label><button className="secondary-button" disabled={testing || !testMessage.trim() || missingRequired.length > 0} onClick={() => onTest(testMessage.trim())}>{testing ? "执行中…" : "测试当前部署"}</button></div>
      {testResult && <div className="coze-test-result"><strong>扣子返回结果</strong><p>{testResult}</p></div>}
    </>}
    {!schema && !loading && !error && <div className="coze-picker-empty"><strong>尚未读取到工作流参数</strong><p>请点击“重新读取参数”。</p></div>}
  </div>;
}
