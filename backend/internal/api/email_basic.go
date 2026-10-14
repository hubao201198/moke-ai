package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html"
	"net/http"
	"net/mail"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const dailyEmailLimit = 100

type emailMessage struct {
	ID                string  `json:"id"`
	WorkspaceID       string  `json:"workspaceId"`
	LeadID            string  `json:"leadId"`
	Direction         string  `json:"direction"`
	Kind              string  `json:"kind"`
	ParentMessageID   string  `json:"parentMessageId"`
	ToEmail           string  `json:"toEmail"`
	Subject           string  `json:"subject"`
	ContentText       string  `json:"contentText"`
	Status            string  `json:"status"`
	Intent            string  `json:"intent"`
	RiskLevel         string  `json:"riskLevel"`
	ProviderMessageID *string `json:"providerMessageId"`
	ErrorMessage      *string `json:"errorMessage"`
	ReviewedAt        *string `json:"reviewedAt"`
	SentAt            *string `json:"sentAt"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

const emailColumns = "id,workspace_id,lead_id,direction,kind,parent_message_id,to_email,subject,content_text,status,intent,risk_level,provider_message_id,error_message,reviewed_at,sent_at,created_at,updated_at"

func scanEmail(row rowScanner) (emailMessage, error) {
	var e emailMessage
	err := row.Scan(&e.ID, &e.WorkspaceID, &e.LeadID, &e.Direction, &e.Kind, &e.ParentMessageID, &e.ToEmail, &e.Subject, &e.ContentText, &e.Status, &e.Intent, &e.RiskLevel, &e.ProviderMessageID, &e.ErrorMessage, &e.ReviewedAt, &e.SentAt, &e.CreatedAt, &e.UpdatedAt)
	return e, err
}
func normalizedEmail(raw string) string {
	address, err := mail.ParseAddress(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	email := strings.ToLower(strings.TrimSpace(address.Address))
	if len(email) > 254 || !strings.Contains(email, ".") {
		return ""
	}
	return email
}

func (s *Server) emailMessagesList(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	rows, err := s.pool.Query(r.Context(), "SELECT "+emailColumns+" FROM email_messages WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100", workspaceID)
	if err != nil {
		writeError(w, 503, "邮件记录不可用")
		return
	}
	items := []emailMessage{}
	for rows.Next() {
		item, scanErr := scanEmail(rows)
		if scanErr != nil {
			err = scanErr
			break
		}
		items = append(items, item)
	}
	rows.Close()
	if err != nil {
		writeError(w, 503, "邮件记录不可用")
		return
	}
	var sent int
	_ = s.pool.QueryRow(r.Context(), "SELECT COUNT(*) FROM email_messages WHERE workspace_id=$1 AND sent_at >= $2", workspaceID, time.Now().UTC().Format("2006-01-02T00:00:00Z")).Scan(&sent)
	writeJSON(w, 200, map[string]any{"messages": items, "dailyLimit": dailyEmailLimit, "sentToday": sent, "remainingToday": max(0, dailyEmailLimit-sent)})
}
func (s *Server) emailMessageCreate(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var input struct {
		LeadID  string `json:"leadId"`
		To      string `json:"to"`
		Subject string `json:"subject"`
		Content string `json:"content"`
	}
	if decodeJSON(r, &input) != nil {
		writeError(w, 400, "邮件参数无效")
		return
	}
	email := normalizedEmail(input.To)
	subject := truncate(strings.TrimSpace(input.Subject), 300)
	content := truncate(strings.TrimSpace(input.Content), 20000)
	if input.LeadID == "" || email == "" || subject == "" || content == "" {
		writeError(w, 400, "客户、有效邮箱、主题和正文均为必填")
		return
	}
	var leadEmail string
	if s.pool.QueryRow(r.Context(), "SELECT email FROM leads WHERE workspace_id=$1 AND id=$2", workspaceID, input.LeadID).Scan(&leadEmail) != nil {
		writeError(w, 404, "客户不存在，请先保存到客户库")
		return
	}
	if normalizedEmail(leadEmail) != email {
		writeError(w, 409, "收件邮箱必须与客户库记录一致")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	id := newID()
	_, err := s.pool.Exec(r.Context(), `INSERT INTO email_messages(id,workspace_id,lead_id,direction,kind,parent_message_id,to_email,subject,content_text,status,intent,risk_level,created_at,updated_at) VALUES($1,$2,$3,'outbound','first_contact','',$4,$5,$6,'pending_review','','normal',$7,$7)`, id, workspaceID, input.LeadID, email, subject, content, now)
	if err != nil {
		writeError(w, 503, "创建邮件失败")
		return
	}
	item, err := scanEmail(s.pool.QueryRow(r.Context(), "SELECT "+emailColumns+" FROM email_messages WHERE id=$1", id))
	if err != nil {
		writeError(w, 503, "读取邮件失败")
		return
	}
	writeJSON(w, 201, map[string]any{"message": item})
}

type suppression struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	Email       string `json:"email"`
	Reason      string `json:"reason"`
	Source      string `json:"source"`
	CreatedAt   string `json:"createdAt"`
}

func (s *Server) suppressionsList(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	rows, err := s.pool.Query(r.Context(), "SELECT id,workspace_id,email,reason,source,created_at FROM suppression_list WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 500", workspaceID)
	if err != nil {
		writeError(w, 503, "黑名单不可用")
		return
	}
	items := []suppression{}
	for rows.Next() {
		var item suppression
		if rows.Scan(&item.ID, &item.WorkspaceID, &item.Email, &item.Reason, &item.Source, &item.CreatedAt) != nil {
			rows.Close()
			writeError(w, 503, "黑名单不可用")
			return
		}
		items = append(items, item)
	}
	rows.Close()
	writeJSON(w, 200, map[string]any{"suppressions": items})
}
func (s *Server) upsertSuppression(r *http.Request, email, reason, source string) error {
	_, err := s.pool.Exec(r.Context(), `INSERT INTO suppression_list(id,workspace_id,email,reason,source,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,email) DO UPDATE SET reason=EXCLUDED.reason,source=EXCLUDED.source`, newID(), workspaceID, email, reason, source, time.Now().UTC().Format(time.RFC3339))
	return err
}
func (s *Server) suppressionCreate(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var input struct {
		Email  string `json:"email"`
		Reason string `json:"reason"`
		Source string `json:"source"`
	}
	if decodeJSON(r, &input) != nil {
		writeError(w, 400, "参数无效")
		return
	}
	email := normalizedEmail(input.Email)
	if email == "" {
		writeError(w, 400, "请输入有效邮箱")
		return
	}
	reason := truncate(strings.TrimSpace(input.Reason), 300)
	if reason == "" {
		reason = "手动加入黑名单"
	}
	source := truncate(strings.TrimSpace(input.Source), 100)
	if source == "" {
		source = "manual"
	}
	if s.upsertSuppression(r, email, reason, source) != nil {
		writeError(w, 503, "黑名单更新失败")
		return
	}
	writeJSON(w, 201, map[string]any{"suppression": map[string]any{"email": email, "reason": reason, "source": source}})
}
func (s *Server) suppressionDelete(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	email := normalizedEmail(r.URL.Query().Get("email"))
	if email == "" {
		writeError(w, 400, "email is required")
		return
	}
	var source string
	err := s.pool.QueryRow(r.Context(), "SELECT source FROM suppression_list WHERE workspace_id=$1 AND email=$2", workspaceID, email).Scan(&source)
	if err != nil {
		writeJSON(w, 200, map[string]bool{"removed": false})
		return
	}
	if source == "resend_webhook" || source == "unsubscribe" || source == "reply_intent" {
		writeError(w, 409, "客户退订、退信或投诉记录不能手动解除")
		return
	}
	_, err = s.pool.Exec(r.Context(), "DELETE FROM suppression_list WHERE workspace_id=$1 AND email=$2", workspaceID, email)
	if err != nil {
		writeError(w, 503, "删除黑名单失败")
		return
	}
	writeJSON(w, 200, map[string]bool{"removed": true})
}

func unsubscribeSignature(email string) string {
	mac := hmac.New(sha256.New, []byte(env("EMAIL_UNSUBSCRIBE_SECRET")))
	mac.Write([]byte(email))
	return hex.EncodeToString(mac.Sum(nil))
}
func unsubscribeURL(email string) string {
	if env("EMAIL_UNSUBSCRIBE_SECRET") == "" {
		return ""
	}
	site := env("SITE_URL")
	if site == "" {
		site = "https://maoke-ai.vercel.app"
	}
	return strings.TrimRight(site, "/") + "/api/email/unsubscribe?email=" + url.QueryEscape(email) + "&token=" + unsubscribeSignature(email)
}

var tokenPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func validUnsubscribe(email, token string) bool {
	return env("EMAIL_UNSUBSCRIBE_SECRET") != "" && tokenPattern.MatchString(token) && hmac.Equal([]byte(token), []byte(unsubscribeSignature(email)))
}
func renderOutreach(content, link string) string {
	paragraphs := []string{}
	for _, item := range strings.Split(content, "\n\n") {
		paragraphs = append(paragraphs, "<p style='margin:0 0 16px;line-height:1.65'>"+strings.ReplaceAll(html.EscapeString(item), "\n", "<br>")+"</p>")
	}
	footer := ""
	if link != "" {
		footer = "<p style='margin-top:28px;font-size:12px'>If you do not wish to receive further messages, <a href='" + html.EscapeString(link) + "'>unsubscribe here</a>.</p>"
	}
	return "<div style='max-width:640px;margin:auto;font-family:Arial,sans-serif;color:#263248;font-size:15px'>" + strings.Join(paragraphs, "") + footer + "</div>"
}
func replyAddress(messageID string) string {
	configured := env("EMAIL_REPLY_TO")
	base := normalizedEmail(configured)
	if base == "" {
		return configured
	}
	parts := strings.SplitN(base, "@", 2)
	local := strings.SplitN(parts[0], "+", 2)[0]
	return fmt.Sprintf("%s+reply-%s@%s", local, messageID, parts[1])
}
func (s *Server) unsubscribe(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	email := normalizedEmail(r.URL.Query().Get("email"))
	token := r.URL.Query().Get("token")
	if email == "" || !validUnsubscribe(email, token) {
		http.Error(w, "Invalid unsubscribe link", 400)
		return
	}
	if s.upsertSuppression(r, email, "客户主动退订", "unsubscribe") != nil {
		http.Error(w, "Unable to unsubscribe", 503)
		return
	}
	w.Header().Set("Content-Type", "text/html;charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte("<!doctype html><html lang='en'><meta charset='utf-8'><title>Unsubscribed</title><body style='font-family:Arial;padding:48px;color:#263248'><h1>You have been unsubscribed</h1><p>We will not send further outreach emails to this address.</p></body></html>"))
}
