package api

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

type automationTask struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"workspaceId"`
	Name        string         `json:"name"`
	Channel     string         `json:"channel"`
	TaskType    string         `json:"taskType"`
	SourceType  string         `json:"sourceType"`
	Status      string         `json:"status"`
	Config      map[string]any `json:"config"`
	NextRunAt   *string        `json:"nextRunAt"`
	LastRunAt   *string        `json:"lastRunAt"`
	CreatedAt   string         `json:"createdAt"`
	UpdatedAt   string         `json:"updatedAt"`
}
type channelMessage struct {
	ID                 string `json:"id"`
	WorkspaceID        string `json:"workspaceId"`
	TaskID             string `json:"taskId"`
	LeadID             string `json:"leadId"`
	Direction          string `json:"direction"`
	Kind               string `json:"kind"`
	Contact            string `json:"contact"`
	Content            string `json:"content"`
	Status             string `json:"status"`
	RiskLevel          string `json:"riskLevel"`
	SensitiveWordsJSON string `json:"sensitiveWordsJson"`
	MetadataJSON       string `json:"metadataJson"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
}
type contactTarget struct {
	LeadID  string `json:"leadId,omitempty"`
	Company string `json:"company"`
	Contact string `json:"contact"`
	Phone   string `json:"phone"`
	Wechat  string `json:"wechat"`
	Notes   string `json:"notes"`
	Status  string `json:"status"`
	Source  string `json:"source"`
	Result  string `json:"result,omitempty"`
}

func scanTask(row rowScanner) (automationTask, error) {
	var task automationTask
	var config string
	err := row.Scan(&task.ID, &task.WorkspaceID, &task.Name, &task.Channel, &task.TaskType, &task.SourceType, &task.Status, &config, &task.NextRunAt, &task.LastRunAt, &task.CreatedAt, &task.UpdatedAt)
	task.Config = jsonMap(config)
	return task, err
}

const taskColumns = "id,workspace_id,name,channel,task_type,source_type,status,config_json,next_run_at,last_run_at,created_at,updated_at"

func (s *Server) automationTasks(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	rows, err := s.pool.Query(r.Context(), "SELECT "+taskColumns+" FROM automation_tasks WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100", workspaceID)
	if err != nil {
		writeError(w, 503, "自动化任务不可用")
		return
	}
	tasks := []automationTask{}
	for rows.Next() {
		task, scanErr := scanTask(rows)
		if scanErr != nil {
			err = scanErr
			break
		}
		tasks = append(tasks, task)
	}
	rows.Close()
	if err != nil {
		writeError(w, 503, "自动化任务不可用")
		return
	}
	messages, err := s.pool.Query(r.Context(), `SELECT id,workspace_id,task_id,lead_id,direction,kind,contact,content,status,risk_level,sensitive_words_json,metadata_json,created_at,updated_at FROM channel_messages WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100`, workspaceID)
	if err != nil {
		writeError(w, 503, "消息记录不可用")
		return
	}
	items := []channelMessage{}
	for messages.Next() {
		var item channelMessage
		err = messages.Scan(&item.ID, &item.WorkspaceID, &item.TaskID, &item.LeadID, &item.Direction, &item.Kind, &item.Contact, &item.Content, &item.Status, &item.RiskLevel, &item.SensitiveWordsJSON, &item.MetadataJSON, &item.CreatedAt, &item.UpdatedAt)
		if err != nil {
			break
		}
		items = append(items, item)
	}
	messages.Close()
	if err != nil {
		writeError(w, 503, "消息记录不可用")
		return
	}
	writeJSON(w, 200, map[string]any{"tasks": tasks, "messages": items, "provider": map[string]any{"configured": false, "executionBatchSize": 100, "note": "企微厂商尚未对接；加微和消息会进入待投递队列，不会宣称已真实发送。"}})
}

func (s *Server) insertTask(r *http.Request, task automationTask) error {
	_, err := s.pool.Exec(r.Context(), `INSERT INTO automation_tasks(id,workspace_id,name,channel,task_type,source_type,status,config_json,next_run_at,last_run_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, task.ID, task.WorkspaceID, task.Name, task.Channel, task.TaskType, task.SourceType, task.Status, jsonString(task.Config), task.NextRunAt, task.LastRunAt, task.CreatedAt, task.UpdatedAt)
	return err
}

func (s *Server) targetsFromLeads(r *http.Request, ids []string, source string) ([]contactTarget, error) {
	rows, err := s.pool.Query(r.Context(), `SELECT id,company,contact,phone,whatsapp FROM leads WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 300`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	allowed := map[string]bool{}
	for _, id := range ids {
		allowed[id] = true
	}
	targets := []contactTarget{}
	for rows.Next() {
		var id, company, contact, phone, whatsapp string
		if rows.Scan(&id, &company, &contact, &phone, &whatsapp) != nil {
			continue
		}
		if len(allowed) > 0 && !allowed[id] {
			continue
		}
		if phone == "" {
			phone = whatsapp
		}
		if phone == "" {
			continue
		}
		targets = append(targets, contactTarget{LeadID: id, Company: company, Contact: contact, Phone: phone, Status: "queued", Source: source})
		if len(targets) >= 100 {
			break
		}
	}
	return targets, nil
}

func aliases(name string) string {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "公司", "公司名称", "企业", "企业名称", "company", "company name":
		return "company"
	case "联系人", "姓名", "客户姓名", "contact", "contact name", "name":
		return "contact"
	case "手机号", "手机", "电话", "电话号码", "phone", "mobile", "tel", "whatsapp":
		return "phone"
	case "微信", "微信号", "企微", "企微号", "wechat", "weixin", "wxid":
		return "wechat"
	case "备注", "说明", "标签", "来源", "notes", "note", "remark", "source":
		return "notes"
	}
	return ""
}
func parseContactRows(rows [][]string, source string) ([]contactTarget, error) {
	if len(rows) == 0 {
		return nil, errors.New("名单为空")
	}
	columns := map[string]int{}
	for i, cell := range rows[0] {
		if key := aliases(cell); key != "" {
			columns[key] = i
		}
	}
	if _, phone := columns["phone"]; !phone {
		if _, wechat := columns["wechat"]; !wechat {
			return nil, errors.New("表头请包含手机号/电话或微信号")
		}
	}
	read := func(row []string, key string) string {
		index, ok := columns[key]
		if !ok || index >= len(row) {
			return ""
		}
		return truncate(strings.TrimSpace(row[index]), 160)
	}
	targets := []contactTarget{}
	for index, row := range rows[1:] {
		if len(row) == 0 {
			continue
		}
		phone, wechat := read(row, "phone"), read(row, "wechat")
		if phone == "" && wechat == "" {
			return nil, fmt.Errorf("第 %d 行缺少微信号或手机号", index+2)
		}
		company := read(row, "company")
		if company == "" {
			company = fmt.Sprintf("导入客户 %d", index+1)
		}
		targets = append(targets, contactTarget{Company: company, Contact: read(row, "contact"), Phone: phone, Wechat: wechat, Notes: read(row, "notes"), Status: "queued", Source: source})
		if len(targets) >= 500 {
			break
		}
	}
	if len(targets) == 0 {
		return nil, errors.New("未识别到客户号码")
	}
	return targets, nil
}
func parseContactUpload(filename string, data []byte) ([]contactTarget, error) {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == ".xlsx" {
		value, _, err := extractXlsx(data)
		if err != nil {
			return nil, err
		}
		var firstErr error
		for _, section := range strings.Split(value, "\n\n") {
			lines := strings.Split(section, "\n")
			if len(lines) < 2 {
				continue
			}
			rows := [][]string{}
			for _, line := range lines[1:] {
				rows = append(rows, strings.Split(line, "\t"))
			}
			if targets, err := parseContactRows(rows, "excel"); err == nil {
				return targets, nil
			} else if firstErr == nil || strings.Contains(firstErr.Error(), "表头") {
				firstErr = err
			}
		}
		if firstErr != nil {
			return nil, firstErr
		}
		return nil, errors.New("Excel 表头请包含手机号/电话或微信号")
	}
	if ext != ".csv" && ext != ".txt" {
		return nil, errors.New("客户名单仅支持 XLSX、CSV 或 TXT")
	}
	delimiter := ','
	if ext == ".txt" || bytes.Contains(bytes.SplitN(data, []byte("\n"), 2)[0], []byte("\t")) {
		delimiter = '\t'
	}
	reader := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})))
	reader.Comma = delimiter
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, errors.New("名单表格格式无效")
	}
	return parseContactRows(rows, "excel")
}

func (s *Server) createAddContact(w http.ResponseWriter, r *http.Request, name, verify, source string, targets []contactTarget, schedule scheduleConfig, imported bool) {
	if len(targets) == 0 {
		writeError(w, 400, "没有识别到可用手机号或微信号")
		return
	}
	next, err := nextSchedule(schedule, time.Now())
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if name == "" {
		name = fmt.Sprintf("加微任务 · %d 个客户", len(targets))
	}
	if verify == "" {
		verify = "您好，希望与您建立联系。"
	}
	status := "scheduled"
	if schedule.Type == "now" {
		status = "ready"
	}
	task := automationTask{ID: newID(), WorkspaceID: workspaceID, Name: truncate(name, 120), Channel: "wecom", TaskType: "add_contact", SourceType: source, Status: status, Config: map[string]any{"targets": targets, "verify": truncate(verify, 120), "schedule": schedule}, NextRunAt: &next, CreatedAt: now, UpdatedAt: now}
	if s.insertTask(r, task) != nil {
		writeError(w, 503, "创建任务失败")
		return
	}
	result := map[string]any{"task": task}
	if imported {
		result["imported"] = len(targets)
	}
	writeJSON(w, 201, result)
}

func (s *Server) automationTaskAction(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		r.Body = http.MaxBytesReader(w, r.Body, 11<<20)
		if r.ParseMultipartForm(10<<20) != nil {
			writeError(w, 413, "客户名单不能超过 10 MB")
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			writeError(w, 400, "请选择 Excel 或 CSV 客户名单")
			return
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, 10_000_001))
		if err != nil || len(data) > 10_000_000 {
			writeError(w, 413, "客户名单不能超过 10 MB")
			return
		}
		targets, err := parseContactUpload(header.Filename, data)
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		schedule, _ := parseSchedule(jsonMap(r.FormValue("schedule")))
		s.createAddContact(w, r, r.FormValue("name"), r.FormValue("verify"), "excel", targets, schedule, true)
		return
	}
	var input map[string]any
	if decodeJSON(r, &input) != nil {
		writeError(w, 400, "任务参数无效")
		return
	}
	action := anyString(input["action"])
	switch action {
	case "create_add_contact":
		source := "customer_library"
		if input["sourceType"] == "search" {
			source = "search"
		}
		targets, err := s.targetsFromLeads(r, stringsFromAny(input["leadIds"], 100), source)
		if err != nil {
			writeError(w, 503, "获取客户失败")
			return
		}
		schedule, _ := parseSchedule(input["schedule"])
		s.createAddContact(w, r, anyString(input["name"]), anyString(input["verify"]), source, targets, schedule, false)
	case "create_private_reply", "create_broadcast":
		s.createWorkflowTask(w, r, input, action)
	case "cancel", "pause", "resume":
		id := anyString(input["id"])
		if id == "" {
			writeError(w, 400, "任务 ID 无效")
			return
		}
		status := "active"
		if action == "cancel" {
			status = "cancelled"
		} else if action == "pause" {
			status = "paused"
		}
		tag, err := s.pool.Exec(r.Context(), "UPDATE automation_tasks SET status=$1,updated_at=$2 WHERE workspace_id=$3 AND id=$4", status, time.Now().UTC().Format(time.RFC3339), workspaceID, id)
		if err != nil || tag.RowsAffected() == 0 {
			writeError(w, 404, "任务不存在")
			return
		}
		writeJSON(w, 200, map[string]string{"status": status})
	case "execute":
		id := anyString(input["id"])
		if id == "" {
			writeError(w, 400, "任务 ID 无效")
			return
		}
		result, err := s.runDueAutomation(r.Context(), id)
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"status": "completed", "result": result})
	default:
		writeError(w, 400, "无效的任务操作")
	}
}
