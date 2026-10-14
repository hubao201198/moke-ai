package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type automationRunResult struct {
	TaskID         string   `json:"taskId"`
	Created        int      `json:"created"`
	NeedsReview    bool     `json:"needsReview,omitempty"`
	SensitiveWords []string `json:"sensitiveWords,omitempty"`
	NextRunAt      *string  `json:"nextRunAt"`
	Error          string   `json:"error,omitempty"`
}
type broadcastTarget struct {
	ID       string
	Company  string
	Phone    string
	Whatsapp string
	Stage    string
}

func (s *Server) broadcastTargets(ctx context.Context, config map[string]any) ([]broadcastTarget, error) {
	rows, err := s.pool.Query(ctx, "SELECT id,company,phone,whatsapp,stage FROM leads WHERE workspace_id=$1 ORDER BY created_at ASC LIMIT 500", workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := stringsFromAny(config["leadIds"], 100)
	stages := stringsFromAny(config["stages"], 20)
	allowedIDs := map[string]bool{}
	allowedStages := map[string]bool{}
	for _, id := range ids {
		allowedIDs[id] = true
	}
	for _, stage := range stages {
		allowedStages[stage] = true
	}
	targets := []broadcastTarget{}
	for rows.Next() {
		var target broadcastTarget
		if rows.Scan(&target.ID, &target.Company, &target.Phone, &target.Whatsapp, &target.Stage) != nil {
			continue
		}
		if len(ids) > 0 && !allowedIDs[target.ID] {
			continue
		}
		if len(stages) > 0 && !allowedStages[target.Stage] {
			continue
		}
		if target.Phone == "" && target.Whatsapp == "" {
			continue
		}
		targets = append(targets, target)
		if len(targets) >= 100 {
			break
		}
	}
	return targets, nil
}

func (s *Server) runAddContact(ctx context.Context, task automationTask) (automationRunResult, error) {
	targets := arrayValue(task.Config["targets"])
	if len(targets) == 0 {
		return automationRunResult{}, errors.New("加微任务没有有效客户")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return automationRunResult{}, err
	}
	defer tx.Rollback(ctx)
	created := 0
	for _, raw := range targets {
		target := mapValue(raw)
		status := anyString(target["status"])
		if status != "queued" && status != "scheduled" {
			continue
		}
		contact := anyString(target["wechat"])
		if contact == "" {
			contact = anyString(target["phone"])
		}
		if contact == "" {
			target["status"] = "failed"
			target["result"] = "缺少微信号或手机号"
			continue
		}
		_, err = tx.Exec(ctx, `INSERT INTO channel_messages(id,workspace_id,task_id,lead_id,direction,kind,contact,content,status,risk_level,sensitive_words_json,metadata_json,created_at,updated_at) VALUES($1,$2,$3,$4,'outbound','add_contact',$5,$6,'ready_to_send','normal','[]',$7,$8,$8)`, newID(), workspaceID, task.ID, anyString(target["leadId"]), contact, anyString(task.Config["verify"]), jsonString(map[string]any{"target": target, "providerPending": true}), now)
		if err != nil {
			return automationRunResult{}, err
		}
		target["status"] = "ready_to_send"
		target["result"] = "加微请求已进入待投递队列；尚未接入企微厂商"
		created++
	}
	task.Config["targets"] = targets
	_, err = tx.Exec(ctx, "UPDATE automation_tasks SET status='completed',last_run_at=$1,next_run_at=NULL,updated_at=$1,config_json=$2 WHERE workspace_id=$3 AND id=$4", now, jsonString(task.Config), workspaceID, task.ID)
	if err != nil {
		return automationRunResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return automationRunResult{}, err
	}
	return automationRunResult{TaskID: task.ID, Created: created}, nil
}

func (s *Server) runBroadcast(ctx context.Context, task automationTask) (automationRunResult, error) {
	config := task.Config
	settings := workflowConfig(config["workflow"])
	targets, err := s.broadcastTargets(ctx, config)
	if err != nil {
		return automationRunResult{}, err
	}
	if len(targets) == 0 {
		return automationRunResult{}, errors.New("没有符合群发规则且带手机号/WhatsApp 的客户")
	}
	knowledge := s.selectedLibraryContext(ctx, append(stringsFromAny(config["libraryIds"], 30), settings.LibraryIDs...))
	rules := strings.TrimSpace(anyString(config["rules"]) + "\n" + settings.Rules)
	audience := anyString(config["audience"])
	if audience == "" {
		audience = fmt.Sprintf("面向 %d 个外贸客户", len(targets))
	}
	model := settings.Model
	if model == "" {
		model = anyString(config["model"])
	}
	var content string
	var cozeInfo *cozeResult
	if config["generator"] == "coze" {
		coze, configErr := normalizedCoze(config["coze"])
		if configErr != nil {
			return automationRunResult{}, configErr
		}
		result, runErr := runCoze(ctx, coze, cozeInput{Message: audience, Context: knowledge, Rules: rules, Contact: "客户群发"})
		if runErr != nil {
			return automationRunResult{}, runErr
		}
		content = result.Text
		cozeInfo = &result
	} else {
		fixed := ""
		if config["contentMode"] == "fixed" {
			fixed = anyString(config["fixedContent"])
		}
		content, err = s.broadcastText(ctx, rules, knowledge, audience, fixed, model)
		if err != nil {
			return automationRunResult{}, err
		}
	}
	words := append(configuredWords(config["sensitiveWords"]), s.selectedSensitiveWords(ctx, append(stringsFromAny(config["sensitiveLibraryIds"], 30), settings.SensitiveLibraryIDs...))...)
	hits := sensitiveHits(content, words)
	needsReview := anyBool(config["requireReview"], false) || settings.RequireReview || len(hits) > 0
	now := time.Now().UTC().Format(time.RFC3339)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return automationRunResult{}, err
	}
	defer tx.Rollback(ctx)
	for _, lead := range targets {
		contact := lead.Phone
		if contact == "" {
			contact = lead.Whatsapp
		}
		status := "ready_to_send"
		risk := "normal"
		if needsReview {
			status = "pending_review"
		}
		if len(hits) > 0 {
			risk = "sensitive"
		}
		messageID := newID()
		metadata := map[string]any{"company": lead.Company, "providerPending": true, "generator": config["generator"]}
		if cozeInfo != nil {
			metadata["cozeExecuteId"] = cozeInfo.ExecuteID
			metadata["cozeDebugUrl"] = cozeInfo.DebugURL
		}
		_, err = tx.Exec(ctx, `INSERT INTO channel_messages(id,workspace_id,task_id,lead_id,direction,kind,contact,content,status,risk_level,sensitive_words_json,metadata_json,created_at,updated_at) VALUES($1,$2,$3,$4,'outbound','broadcast',$5,$6,$7,$8,$9,$10,$11,$11)`, messageID, workspaceID, task.ID, lead.ID, contact, content, status, risk, jsonString(hits), jsonString(metadata), now)
		if err != nil {
			return automationRunResult{}, err
		}
		if needsReview {
			reason := "群发任务配置为发送前审核"
			if len(hits) > 0 {
				reason = "群发内容命中敏感词：" + strings.Join(hits, "、")
			}
			_, err = tx.Exec(ctx, `INSERT INTO review_items(id,workspace_id,lead_id,channel,message_id,reason,content,metadata_json,status,created_at) VALUES($1,$2,$3,'wecom',$4,$5,$6,$7,'pending',$8)`, newID(), workspaceID, lead.ID, messageID, reason, content, jsonString(map[string]any{"taskId": task.ID, "kind": "broadcast", "company": lead.Company, "contact": contact}), now)
			if err != nil {
				return automationRunResult{}, err
			}
		}
	}
	schedule, _ := parseSchedule(config["schedule"])
	var next *string
	status := "completed"
	if schedule.Type == "weekly" && schedule.Repeat {
		candidate, nextErr := nextSchedule(schedule, time.Now().Add(time.Minute))
		if nextErr != nil {
			return automationRunResult{}, nextErr
		}
		next = &candidate
		status = "active"
	}
	delete(config, "lastError")
	config["lastGeneratedContent"] = content
	config["lastGeneratedCount"] = len(targets)
	_, err = tx.Exec(ctx, "UPDATE automation_tasks SET status=$1,last_run_at=$2,next_run_at=$3,updated_at=$2,config_json=$4 WHERE workspace_id=$5 AND id=$6", status, now, next, jsonString(config), workspaceID, task.ID)
	if err != nil {
		return automationRunResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return automationRunResult{}, err
	}
	return automationRunResult{TaskID: task.ID, Created: len(targets), NeedsReview: needsReview, SensitiveWords: hits, NextRunAt: next}, nil
}

func (s *Server) runDueAutomation(ctx context.Context, onlyID string) ([]automationRunResult, error) {
	results := []automationRunResult{}
	var rows []automationTask
	if onlyID != "" {
		task, err := scanTask(s.pool.QueryRow(ctx, "SELECT "+taskColumns+" FROM automation_tasks WHERE workspace_id=$1 AND id=$2", workspaceID, onlyID))
		if err != nil {
			return nil, errors.New("任务不存在")
		}
		rows = append(rows, task)
	} else {
		query, err := s.pool.Query(ctx, "SELECT "+taskColumns+" FROM automation_tasks WHERE workspace_id=$1 AND task_type IN ('broadcast','add_contact') AND status IN ('scheduled','active','ready') AND next_run_at<=$2 ORDER BY next_run_at ASC LIMIT 10", workspaceID, time.Now().UTC().Format(time.RFC3339))
		if err != nil {
			return nil, err
		}
		for query.Next() {
			task, scanErr := scanTask(query)
			if scanErr != nil {
				query.Close()
				return nil, scanErr
			}
			rows = append(rows, task)
		}
		query.Close()
	}
	for _, task := range rows {
		if task.TaskType != "broadcast" && task.TaskType != "add_contact" {
			if onlyID != "" {
				return nil, errors.New("私聊任务由客户消息触发，无需手动执行")
			}
			continue
		}
		tag, err := s.pool.Exec(ctx, "UPDATE automation_tasks SET status='running',updated_at=$1 WHERE workspace_id=$2 AND id=$3 AND status IN ('ready','scheduled','active')", time.Now().UTC().Format(time.RFC3339), workspaceID, task.ID)
		if err != nil {
			return results, err
		}
		if tag.RowsAffected() == 0 {
			if onlyID != "" {
				return nil, errors.New("任务正在运行或已结束")
			}
			continue
		}
		var result automationRunResult
		if task.TaskType == "broadcast" {
			result, err = s.runBroadcast(ctx, task)
		} else {
			result, err = s.runAddContact(ctx, task)
		}
		if err != nil {
			task.Config["lastError"] = err.Error()
			_, _ = s.pool.Exec(ctx, "UPDATE automation_tasks SET status='failed',updated_at=$1,config_json=$2 WHERE workspace_id=$3 AND id=$4", time.Now().UTC().Format(time.RFC3339), jsonString(task.Config), workspaceID, task.ID)
			result = automationRunResult{TaskID: task.ID, Error: err.Error()}
		}
		results = append(results, result)
	}
	return results, nil
}

func (s *Server) automationCron(w http.ResponseWriter, r *http.Request) {
	if !s.requireCron(w, r) || !s.requireDB(w) {
		return
	}
	results, err := s.runDueAutomation(r.Context(), "")
	if err != nil {
		writeError(w, 503, "自动化调度失败")
		return
	}
	writeJSON(w, 200, map[string]any{"results": results})
}
