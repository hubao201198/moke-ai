package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type cozeConfig struct {
	IntegrationMode  string         `json:"integrationMode"`
	ExecutionMode    string         `json:"executionMode"`
	WorkflowID       string         `json:"workflowId"`
	InputParameter   string         `json:"inputParameter"`
	ContextParameter string         `json:"contextParameter"`
	RulesParameter   string         `json:"rulesParameter"`
	ContactParameter string         `json:"contactParameter"`
	OutputField      string         `json:"outputField"`
	BotID            string         `json:"botId"`
	AppID            string         `json:"appId"`
	StaticParameters map[string]any `json:"staticParameters"`
}

type cozeInput struct {
	Message string
	Context string
	Rules   string
	Contact string
}
type cozeResult struct {
	Text      string `json:"text"`
	ExecuteID string `json:"executeId"`
	DebugURL  string `json:"debugUrl"`
}

var cozeIDPattern = regexp.MustCompile(`^\d{6,40}$`)
var cozeKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.-]{0,79}$`)

func cozeToken() (string, error) {
	token := strings.TrimSpace(strings.TrimPrefix(env("COZE_API_TOKEN"), "Bearer "))
	if len(token) < 20 || strings.ContainsAny(token, " \t\r\n\"'") {
		return "", errors.New("扣子访问令牌尚未正确配置")
	}
	return token, nil
}

func cozeBase() (string, error) {
	value := env("COZE_API_BASE")
	if value == "" {
		value = "https://api.coze.cn"
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || (parsed.Hostname() != "api.coze.cn" && parsed.Hostname() != "api.coze.com") {
		return "", errors.New("扣子 API 地址必须为官方域名")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

func vibeEndpoint() (string, string, error) {
	configured := env("COZE_VIBE_API_URL")
	if configured == "" || env("COZE_VIBE_API_TOKEN") == "" {
		return "", "", errors.New("扣子编程项目接口尚未配置")
	}
	parsed, err := url.Parse(configured)
	if err != nil || parsed.Scheme != "https" || !strings.HasSuffix(parsed.Hostname(), ".coze.site") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", "", errors.New("扣子编程项目接口必须使用 HTTPS coze.site 域名")
	}
	path := strings.TrimRight(parsed.Path, "/")
	for _, suffix := range []string{"/run/stream", "/stream_run", "/graph_parameter", "/async_run", "/run"} {
		if strings.HasSuffix(path, suffix) {
			path = strings.TrimSuffix(path, suffix)
			break
		}
	}
	return parsed.Scheme + "://" + parsed.Host + path, parsed.Hostname(), nil
}

func fetchCoze(ctx context.Context, endpoint, token string, body any) (map[string]any, error) {
	requestCtx, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	var reader io.Reader
	method := http.MethodGet
	if body != nil {
		encoded, _ := json.Marshal(body)
		reader = bytes.NewReader(encoded)
		method = http.MethodPost
	}
	request, err := http.NewRequestWithContext(requestCtx, method, endpoint, reader)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("扣子 HTTP %d: %s", response.StatusCode, truncate(string(data), 300))
	}
	var output map[string]any
	if err := json.Unmarshal(data, &output); err != nil {
		return nil, errors.New("扣子返回了无法识别的数据")
	}
	if code, exists := output["code"]; exists && fmt.Sprint(code) != "0" {
		return nil, fmt.Errorf("扣子返回错误码 %v: %v", code, output["msg"])
	}
	return output, nil
}

func mapValue(value any) map[string]any {
	result, _ := value.(map[string]any)
	if result == nil {
		return map[string]any{}
	}
	return result
}
func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}
func arrayValue(value any) []any { result, _ := value.([]any); return result }
func firstArray(data map[string]any, keys ...string) []any {
	for _, key := range keys {
		if rows := arrayValue(data[key]); rows != nil {
			return rows
		}
	}
	return nil
}

func (s *Server) cozeStatus(w http.ResponseWriter, r *http.Request) {
	open := env("COZE_API_TOKEN") != ""
	vibe := env("COZE_VIBE_API_URL") != "" && env("COZE_VIBE_API_TOKEN") != ""
	writeJSON(w, 200, map[string]any{"configured": open || vibe, "openApiConfigured": open, "vibeConfigured": vibe, "label": "扣子工作流", "note": "服务端连接状态"})
}

func cozeParameters(config cozeConfig, input cozeInput) map[string]any {
	parameters := map[string]any{}
	for key, value := range config.StaticParameters {
		if cozeKeyPattern.MatchString(key) {
			parameters[key] = value
		}
	}
	key := config.InputParameter
	if !cozeKeyPattern.MatchString(key) {
		key = "input"
	}
	parameters[key] = truncate(input.Message, 12000)
	for _, pair := range []struct{ key, value string }{{config.ContextParameter, input.Context}, {config.RulesParameter, input.Rules}, {config.ContactParameter, input.Contact}} {
		if cozeKeyPattern.MatchString(pair.key) && pair.value != "" {
			parameters[pair.key] = truncate(pair.value, 12000)
		}
	}
	return parameters
}

func outputText(data any, field string) string {
	if field == "" {
		field = "output"
	}
	current := data
	for _, part := range strings.Split(field, ".") {
		current = mapValue(current)[part]
	}
	if value := stringValue(current); value != "" && value != "<nil>" && value != "[]" && value != "{}" {
		return value
	}
	for _, key := range []string{"output", "text", "answer", "message", "content"} {
		if value := stringValue(mapValue(data)[key]); value != "" {
			return value
		}
	}
	return ""
}

func runCoze(ctx context.Context, config cozeConfig, input cozeInput) (cozeResult, error) {
	parameters := cozeParameters(config, input)
	if config.IntegrationMode == "vibe" {
		base, _, err := vibeEndpoint()
		if err != nil {
			return cozeResult{}, err
		}
		data, err := fetchCoze(ctx, base+"/run", env("COZE_VIBE_API_TOKEN"), parameters)
		if err != nil {
			return cozeResult{}, err
		}
		text := outputText(data, config.OutputField)
		if text == "" {
			return cozeResult{}, errors.New("扣子编程返回为空，请检查输出字段")
		}
		return cozeResult{Text: truncate(text, 12000)}, nil
	}
	token, err := cozeToken()
	if err != nil {
		return cozeResult{}, err
	}
	base, err := cozeBase()
	if err != nil {
		return cozeResult{}, err
	}
	if !cozeIDPattern.MatchString(config.WorkflowID) {
		return cozeResult{}, errors.New("扣子工作流 ID 无效")
	}
	if config.BotID != "" && config.AppID != "" {
		return cozeResult{}, errors.New("不能同时配置智能体和应用 ID")
	}
	body := map[string]any{"workflow_id": config.WorkflowID, "parameters": parameters}
	if config.BotID != "" {
		body["bot_id"] = config.BotID
	}
	if config.AppID != "" {
		body["app_id"] = config.AppID
	}
	endpoint := base + "/v1/workflow/run"
	if config.ExecutionMode == "stream" {
		endpoint = base + "/v1/workflow/stream_run"
	}
	if config.ExecutionMode != "stream" {
		data, err := fetchCoze(ctx, endpoint, token, body)
		if err != nil {
			return cozeResult{}, err
		}
		output := data["data"]
		if raw, okay := output.(string); okay {
			var parsed any
			if json.Unmarshal([]byte(raw), &parsed) == nil {
				output = parsed
			}
		}
		text := outputText(output, config.OutputField)
		if text == "" {
			return cozeResult{}, errors.New("扣子工作流返回为空，请检查输入与结束节点输出")
		}
		return cozeResult{Text: truncate(text, 12000), ExecuteID: stringValue(data["execute_id"]), DebugURL: stringValue(data["debug_url"])}, nil
	}
	encoded, _ := json.Marshal(body)
	requestCtx, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return cozeResult{}, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return cozeResult{}, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return cozeResult{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return cozeResult{}, fmt.Errorf("扣子 HTTP %d: %s", response.StatusCode, truncate(string(data), 300))
	}
	var output any
	fragments := []string{}
	result := cozeResult{}
	for _, block := range strings.Split(string(data), "\n\n") {
		var event, bodyText string
		for _, line := range strings.Split(block, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "event:") {
				event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			}
			if strings.HasPrefix(line, "data:") {
				bodyText += strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			}
		}
		if bodyText == "" || event == "Done" {
			continue
		}
		var parsed map[string]any
		if json.Unmarshal([]byte(bodyText), &parsed) != nil {
			continue
		}
		if event == "Error" {
			return cozeResult{}, fmt.Errorf("扣子工作流错误: %v", parsed["error_message"])
		}
		if value := stringValue(parsed["execute_id"]); value != "" {
			result.ExecuteID = value
		}
		if value := stringValue(parsed["debug_url"]); value != "" {
			result.DebugURL = value
		}
		content := stringValue(parsed["content"])
		if content == "" {
			continue
		}
		var structured any
		if json.Unmarshal([]byte(content), &structured) == nil && outputText(structured, config.OutputField) != "" {
			output = structured
		} else {
			fragments = append(fragments, content)
		}
	}
	if output == nil {
		output = strings.Join(fragments, "")
	}
	result.Text = truncate(outputText(output, config.OutputField), 12000)
	if result.Text == "" {
		return cozeResult{}, errors.New("扣子工作流返回为空，请检查开始与结束节点参数")
	}
	return result, nil
}

func (s *Server) cozeRun(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Config  cozeConfig `json:"config"`
		Message string     `json:"message"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, 400, "工作流配置无效")
		return
	}
	if strings.TrimSpace(input.Message) == "" {
		input.Message = "这是一条连接测试消息，请返回简短的话术。"
	}
	result, err := runCoze(r.Context(), input.Config, cozeInput{Message: input.Message, Context: "贸客 AI 连接测试", Rules: "仅返回测试话术，不执行外部动作", Contact: "测试客户"})
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "text": result.Text, "executeId": result.ExecuteID, "debugUrl": result.DebugURL})
}

func (s *Server) cozeVibeRun(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Config  cozeConfig `json:"config"`
		Message string     `json:"message"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, 400, "编程工作流配置无效")
		return
	}
	input.Config.IntegrationMode = "vibe"
	if strings.TrimSpace(input.Message) == "" {
		input.Message = "这是一条连接测试消息，请返回简短的话术。"
	}
	result, err := runCoze(r.Context(), input.Config, cozeInput{Message: input.Message, Context: "贸客 AI 连接测试", Rules: "仅返回测试话术，不执行外部动作", Contact: "测试客户"})
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "text": result.Text})
}

func (s *Server) cozeVibeStatus(w http.ResponseWriter, r *http.Request) {
	base, host, err := vibeEndpoint()
	if err != nil {
		writeJSON(w, 200, map[string]any{"configured": false, "note": err.Error()})
		return
	}
	data, err := fetchCoze(r.Context(), base+"/graph_parameter", env("COZE_VIBE_API_TOKEN"), nil)
	if err != nil {
		writeError(w, 502, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"configured": true, "schema": map[string]any{"inputParameters": schemaParams(data["input_schema"]), "outputParameters": schemaParams(data["output_schema"]), "endpointHost": host}})
}

func schemaParams(value any) []map[string]any {
	schema := mapValue(value)
	properties := mapValue(schema["properties"])
	required := map[string]bool{}
	for _, key := range arrayValue(schema["required"]) {
		required[stringValue(key)] = true
	}
	result := []map[string]any{}
	for key, property := range properties {
		if !cozeKeyPattern.MatchString(key) {
			continue
		}
		definition := mapValue(property)
		row := map[string]any{"key": key, "type": stringValue(definition["type"]), "title": stringValue(definition["title"]), "description": stringValue(definition["description"]), "required": required[key], "enumValues": arrayValue(definition["enum"])}
		if row["title"] == "" {
			row["title"] = key
		}
		if row["enumValues"] == nil {
			row["enumValues"] = []any{}
		}
		if value, okay := definition["default"]; okay {
			row["defaultValue"] = value
		}
		result = append(result, row)
	}
	return result
}

func cozeGET(ctx context.Context, path string) (map[string]any, error) {
	token, err := cozeToken()
	if err != nil {
		return nil, err
	}
	base, err := cozeBase()
	if err != nil {
		return nil, err
	}
	result, err := fetchCoze(ctx, base+path, token, nil)
	if err != nil {
		return nil, err
	}
	return mapValue(result["data"]), nil
}

func (s *Server) cozeWorkflows(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspaceId")
	if workspace == "" {
		data, err := cozeGET(r.Context(), "/v1/workspaces?page_num=1&page_size=50")
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		items := []map[string]string{}
		for _, raw := range firstArray(data, "workspaces", "items", "list") {
			item := mapValue(raw)
			id := stringValue(item["workspace_id"])
			if id == "" {
				id = stringValue(item["id"])
			}
			if !cozeIDPattern.MatchString(id) {
				continue
			}
			name := stringValue(item["workspace_name"])
			if name == "" {
				name = stringValue(item["name"])
			}
			items = append(items, map[string]string{"id": id, "name": name})
		}
		writeJSON(w, 200, map[string]any{"workspaces": items})
		return
	}
	if !cozeIDPattern.MatchString(workspace) {
		writeError(w, 400, "工作空间 ID 无效")
		return
	}
	items := []map[string]string{}
	for page := 1; page <= 5; page++ {
		path := fmt.Sprintf("/v1/workflows?workspace_id=%s&page_num=%d&page_size=30&workflow_mode=workflow&publish_status=published_online", url.QueryEscape(workspace), page)
		data, err := cozeGET(r.Context(), path)
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		rows := firstArray(data, "items", "workflows", "list")
		for _, raw := range rows {
			item := mapValue(raw)
			id := stringValue(item["workflow_id"])
			if id == "" {
				id = stringValue(item["id"])
			}
			if !cozeIDPattern.MatchString(id) {
				continue
			}
			name := stringValue(item["workflow_name"])
			if name == "" {
				name = stringValue(item["name"])
			}
			items = append(items, map[string]string{"id": id, "name": name, "description": stringValue(item["description"]), "appId": stringValue(item["app_id"]), "workspaceId": workspace, "iconUrl": stringValue(item["icon_url"]), "updatedAt": stringValue(item["updated_at"])})
		}
		if data["has_more"] != true || len(rows) == 0 {
			break
		}
	}
	writeJSON(w, 200, map[string]any{"workflows": items})
}

func (s *Server) integrations(w http.ResponseWriter, r *http.Request) {
	open := env("COZE_API_TOKEN") != ""
	vibe := env("COZE_VIBE_API_URL") != "" && env("COZE_VIBE_API_TOKEN") != ""
	email := env("RESEND_API_KEY") != "" && env("EMAIL_FROM") != "" && env("RESEND_WEBHOOK_SECRET") != "" && env("EMAIL_UNSUBSCRIBE_SECRET") != ""
	jingyu := env("JINGYU_API_BASE") != "" && env("JINGYU_API_KEY") != "" && env("JINGYU_GUID") != ""
	model := env("OPENROUTER_MODEL")
	if model == "" {
		model = "deepseek/deepseek-v4-flash-0731"
	}
	writeJSON(w, 200, map[string]any{"openrouter": map[string]any{"configured": env("OPENROUTER_API_KEY") != "", "label": "OpenRouter", "model": model}, "search": map[string]any{"configured": env("TAVILY_API_KEY") != "", "label": "Tavily Search"}, "coze": map[string]any{"configured": open || vibe, "label": "扣子工作流", "note": "工作流库与编程项目分开接入"}, "email": map[string]any{"configured": email, "label": "Resend", "note": "需配置发送、Webhook 与退订密钥"}, "jingyu": map[string]any{"configured": false, "accountConfigured": jingyu, "protocolVerified": false, "label": "鲸域企微", "docsUrl": "https://console-api.ugiyu.com/doc.html", "consoleUrl": "https://console.ugiyu.com/", "note": "鲸域租户专属 OpenAPI 尚未验证，暂不发送企微消息", "requiredFromVendor": []string{"租户专属 OpenAPI 文档", "鉴权方式", "加好友和发消息接口", "事件回调签名说明"}, "callbackUrl": env("SITE_URL") + "/api/webhooks/jingyu"}})
}
