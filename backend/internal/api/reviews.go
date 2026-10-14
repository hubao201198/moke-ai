package api

import (
	"net/http"
	"time"
)

type reviewItem struct {
	ID           string  `json:"id"`
	WorkspaceID  string  `json:"workspaceId"`
	LeadID       string  `json:"leadId"`
	Channel      string  `json:"channel"`
	MessageID    string  `json:"messageId"`
	Reason       string  `json:"reason"`
	Content      string  `json:"content"`
	MetadataJSON string  `json:"metadataJson"`
	Status       string  `json:"status"`
	CreatedAt    string  `json:"createdAt"`
	ReviewedAt   *string `json:"reviewedAt"`
}

func (s *Server) reviewsList(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	rows, err := s.pool.Query(r.Context(), `SELECT id,workspace_id,lead_id,channel,message_id,reason,content,metadata_json,status,created_at,reviewed_at FROM review_items WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100`, workspaceID)
	if err != nil {
		writeError(w, 503, "审核台不可用")
		return
	}
	defer rows.Close()
	items := []reviewItem{}
	for rows.Next() {
		var item reviewItem
		if rows.Scan(&item.ID, &item.WorkspaceID, &item.LeadID, &item.Channel, &item.MessageID, &item.Reason, &item.Content, &item.MetadataJSON, &item.Status, &item.CreatedAt, &item.ReviewedAt) != nil {
			writeError(w, 503, "审核台不可用")
			return
		}
		items = append(items, item)
	}
	writeJSON(w, 200, map[string]any{"reviews": items})
}

func (s *Server) reviewsUpdate(w http.ResponseWriter, r *http.Request) {
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
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, 503, "审核失败")
		return
	}
	defer tx.Rollback(r.Context())
	var status, messageID string
	err = tx.QueryRow(r.Context(), "SELECT status,message_id FROM review_items WHERE workspace_id=$1 AND id=$2 FOR UPDATE", workspaceID, input.ID).Scan(&status, &messageID)
	if err != nil {
		writeError(w, 404, "审核项不存在")
		return
	}
	if status != "pending" {
		writeError(w, 409, "该内容已经审核")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	status = "approved"
	messageStatus := "ready_to_send"
	note := "审核通过，已进入待发送队列"
	if input.Action == "reject" {
		status = "rejected"
		messageStatus = "rejected"
		note = "内容已驳回"
	}
	_, err = tx.Exec(r.Context(), "UPDATE review_items SET status=$1,reviewed_at=$2 WHERE workspace_id=$3 AND id=$4", status, now, workspaceID, input.ID)
	if err == nil && messageID != "" {
		_, err = tx.Exec(r.Context(), "UPDATE channel_messages SET status=$1,updated_at=$2 WHERE workspace_id=$3 AND id=$4", messageStatus, now, workspaceID, messageID)
	}
	if err != nil || tx.Commit(r.Context()) != nil {
		writeError(w, 503, "审核失败")
		return
	}
	writeJSON(w, 200, map[string]string{"status": status, "note": note})
}
