package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

func resendConfigured() bool {
	return env("RESEND_API_KEY") != "" && env("EMAIL_FROM") != "" && env("RESEND_WEBHOOK_SECRET") != "" && env("EMAIL_UNSUBSCRIBE_SECRET") != ""
}
func (s *Server) resendSend(ctx context.Context, message emailMessage) (string, error) {
	if !resendConfigured() {
		return "", errors.New("Resend 或发件地址尚未配置")
	}
	link := unsubscribeURL(message.ToEmail)
	headers := map[string]string{"Authorization": "Bearer " + env("RESEND_API_KEY"), "Idempotency-Key": "maoke-outreach/" + message.ID}
	mailHeaders := map[string]string{}
	if link != "" {
		mailHeaders["List-Unsubscribe"] = "<" + link + ">"
		mailHeaders["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
	}
	body := map[string]any{"from": env("EMAIL_FROM"), "to": []string{message.ToEmail}, "subject": message.Subject, "text": message.ContentText, "html": renderOutreach(message.ContentText, link), "headers": mailHeaders}
	if reply := replyAddress(message.ID); reply != "" {
		body["reply_to"] = []string{reply}
	}
	var result struct {
		ID string `json:"id"`
	}
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		err = requestJSON(ctx, "https://api.resend.com/emails", headers, body, 20*time.Second, &result)
		if err == nil && result.ID != "" {
			return result.ID, nil
		}
		if err == nil {
			err = errors.New("Resend 未返回邮件 ID")
		}
		if !strings.Contains(err.Error(), "HTTP 429") && !strings.Contains(err.Error(), "HTTP 5") {
			break
		}
		if attempt < 2 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(time.Duration(1<<attempt) * time.Second):
			}
		}
	}
	return "", err
}

func (s *Server) claimEmailForSend(ctx context.Context, id string) (emailMessage, int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return emailMessage{}, 503, err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(473291001)")
	if err != nil {
		return emailMessage{}, 503, err
	}
	message, err := scanEmail(tx.QueryRow(ctx, "SELECT "+emailColumns+" FROM email_messages WHERE workspace_id=$1 AND id=$2 FOR UPDATE", workspaceID, id))
	if err != nil || message.Direction != "outbound" {
		return emailMessage{}, 404, errors.New("邮件不存在")
	}
	if message.Status != "pending_review" && message.Status != "failed" {
		return emailMessage{}, 409, errors.New("该邮件不能重复发送")
	}
	var suppressed int
	_ = tx.QueryRow(ctx, "SELECT COUNT(*) FROM suppression_list WHERE workspace_id=$1 AND email=$2", workspaceID, message.ToEmail).Scan(&suppressed)
	if suppressed > 0 {
		return emailMessage{}, 409, errors.New("该邮箱位于黑名单，禁止发送")
	}
	var sent int
	_ = tx.QueryRow(ctx, "SELECT COUNT(*) FROM email_messages WHERE workspace_id=$1 AND (sent_at >= $2 OR (status='sending' AND updated_at >= $2))", workspaceID, time.Now().UTC().Format("2006-01-02T00:00:00Z")).Scan(&sent)
	if sent >= dailyEmailLimit {
		return emailMessage{}, 429, errors.New("今日发送量已达到 100 封上限")
	}
	_, err = tx.Exec(ctx, "UPDATE email_messages SET status='sending',updated_at=$1 WHERE workspace_id=$2 AND id=$3", time.Now().UTC().Format(time.RFC3339), workspaceID, id)
	if err != nil {
		return emailMessage{}, 503, err
	}
	if err = tx.Commit(ctx); err != nil {
		return emailMessage{}, 503, err
	}
	return message, 200, nil
}

func (s *Server) emailMessageUpdate(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var input struct {
		ID     string `json:"id"`
		Action string `json:"action"`
	}
	if decodeJSON(r, &input) != nil || input.ID == "" || (input.Action != "approve" && input.Action != "reject") {
		writeError(w, 400, "审核操作无效")
		return
	}
	if input.Action == "reject" {
		now := time.Now().UTC().Format(time.RFC3339)
		tag, err := s.pool.Exec(r.Context(), "UPDATE email_messages SET status='rejected',reviewed_at=$1,updated_at=$1 WHERE workspace_id=$2 AND id=$3 AND direction='outbound' AND status IN ('pending_review','failed')", now, workspaceID, input.ID)
		if err != nil {
			writeError(w, 503, "邮件驳回失败")
			return
		}
		if tag.RowsAffected() == 0 {
			writeError(w, 409, "邮件不存在或已处理")
			return
		}
		_, _ = s.pool.Exec(r.Context(), "UPDATE follow_up_plans SET status='cancelled',updated_at=$1 WHERE workspace_id=$2 AND draft_message_id=$3", now, workspaceID, input.ID)
		writeJSON(w, 200, map[string]any{"id": input.ID, "status": "rejected"})
		return
	}
	if !resendConfigured() {
		writeError(w, 503, "Resend 或发件地址尚未配置")
		return
	}
	message, status, err := s.claimEmailForSend(r.Context(), input.ID)
	if err != nil {
		writeError(w, status, err.Error())
		return
	}
	providerID, err := s.resendSend(r.Context(), message)
	now := time.Now().UTC().Format(time.RFC3339)
	if err != nil {
		_, _ = s.pool.Exec(r.Context(), "UPDATE email_messages SET status='failed',error_message=$1,reviewed_at=$2,updated_at=$2 WHERE workspace_id=$3 AND id=$4", truncate(err.Error(), 500), now, workspaceID, message.ID)
		writeError(w, 502, "Resend 发送失败："+truncate(err.Error(), 300))
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, 503, "邮件已提交给 Resend，但数据库更新失败；请勿再次点击发送")
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), "UPDATE email_messages SET status='sent',provider_message_id=$1,error_message=NULL,reviewed_at=$2,sent_at=$2,updated_at=$2 WHERE workspace_id=$3 AND id=$4", providerID, now, workspaceID, message.ID)
	if err == nil && message.Kind == "first_contact" {
		for index, days := range []int{3, 7, 14} {
			due := time.Now().UTC().AddDate(0, 0, days).Format(time.RFC3339)
			_, err = tx.Exec(r.Context(), `INSERT INTO follow_up_plans(id,workspace_id,lead_id,root_message_id,draft_message_id,step_number,delay_days,due_at,status,created_at,updated_at) VALUES($1,$2,$3,$4,'',$5,$6,$7,'scheduled',$8,$8) ON CONFLICT(root_message_id,step_number) DO NOTHING`, newID(), workspaceID, message.LeadID, message.ID, index+1, days, due, now)
			if err != nil {
				break
			}
		}
	}
	if err == nil && message.Kind == "follow_up" {
		_, err = tx.Exec(r.Context(), "UPDATE follow_up_plans SET status='sent',updated_at=$1 WHERE workspace_id=$2 AND draft_message_id=$3", now, workspaceID, message.ID)
	}
	if err != nil || tx.Commit(r.Context()) != nil {
		writeError(w, 503, "邮件已提交给 Resend，但数据库更新失败；请勿再次点击发送")
		return
	}
	writeJSON(w, 200, map[string]any{"id": message.ID, "status": "sent", "providerMessageId": providerID})
}
