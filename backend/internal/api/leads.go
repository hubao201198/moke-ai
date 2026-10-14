package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type evidence struct {
	Field string `json:"field"`
	Value string `json:"value"`
	URL   string `json:"url"`
}

type social struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

type lead struct {
	ID              string     `json:"id"`
	Company         string     `json:"company"`
	Country         string     `json:"country"`
	City            string     `json:"city"`
	Website         string     `json:"website"`
	Description     string     `json:"description"`
	Products        []string   `json:"products"`
	Contact         string     `json:"contact"`
	Title           string     `json:"title"`
	Email           string     `json:"email"`
	Phone           string     `json:"phone"`
	WhatsApp        string     `json:"whatsapp"`
	Socials         []social   `json:"socials"`
	ContactEvidence []evidence `json:"contactEvidence"`
	Score           int        `json:"score"`
	Stage           string     `json:"stage"`
	Source          string     `json:"source"`
	VerifiedAt      string     `json:"verifiedAt"`
	OwnerID         string     `json:"ownerId"`
	Saved           bool       `json:"saved"`
}

type rowScanner interface{ Scan(dest ...any) error }

const leadColumns = "id, company, country, city, website, description, products_json, contact, title, email, phone, whatsapp, socials_json, contact_evidence_json, score, stage, source, verified_at, owner_id"

func scanLead(row rowScanner) (lead, error) {
	var item lead
	var products, socials, contactEvidence string
	err := row.Scan(&item.ID, &item.Company, &item.Country, &item.City, &item.Website, &item.Description, &products, &item.Contact, &item.Title, &item.Email, &item.Phone, &item.WhatsApp, &socials, &contactEvidence, &item.Score, &item.Stage, &item.Source, &item.VerifiedAt, &item.OwnerID)
	if err != nil {
		return lead{}, err
	}
	item.Products = []string{}
	item.Socials = []social{}
	item.ContactEvidence = []evidence{}
	_ = json.Unmarshal([]byte(products), &item.Products)
	_ = json.Unmarshal([]byte(socials), &item.Socials)
	_ = json.Unmarshal([]byte(contactEvidence), &item.ContactEvidence)
	item.Saved = true
	return item, nil
}

func (s *Server) listLeads(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	stage := strings.TrimSpace(r.URL.Query().Get("stage"))
	query := "SELECT " + leadColumns + " FROM leads WHERE workspace_id=$1"
	args := []any{workspaceID}
	if stage != "" && stage != "全部" {
		args = append(args, stage)
		query += fmt.Sprintf(" AND stage=$%d", len(args))
	}
	if q != "" {
		args = append(args, "%"+q+"%")
		query += fmt.Sprintf(" AND (company ILIKE $%d OR contact ILIKE $%d OR country ILIKE $%d OR products_json ILIKE $%d)", len(args), len(args), len(args), len(args))
	}
	rows, err := s.pool.Query(r.Context(), query+" ORDER BY created_at DESC LIMIT 500", args...)
	if err != nil {
		writeError(w, 503, "客户库读取失败")
		return
	}
	defer rows.Close()
	items := []lead{}
	for rows.Next() {
		item, err := scanLead(rows)
		if err != nil {
			writeError(w, 503, "客户库读取失败")
			return
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		writeError(w, 503, "客户库读取失败")
		return
	}
	writeJSON(w, 200, map[string]any{"leads": items})
}

func newID() string {
	bytes := make([]byte, 16)
	_, _ = rand.Read(bytes)
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	value := hex.EncodeToString(bytes)
	return value[:8] + "-" + value[8:12] + "-" + value[12:16] + "-" + value[16:20] + "-" + value[20:]
}

func (s *Server) saveLeads(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var raw json.RawMessage
	if err := decodeJSON(r, &raw); err != nil {
		writeError(w, 400, "客户资料格式无效")
		return
	}
	var batch struct {
		Leads []lead `json:"leads"`
	}
	_ = json.Unmarshal(raw, &batch)
	if batch.Leads == nil {
		var one lead
		if err := json.Unmarshal(raw, &one); err != nil {
			writeError(w, 400, "客户资料格式无效")
			return
		}
		batch.Leads = []lead{one}
	}
	if len(batch.Leads) > 500 {
		batch.Leads = batch.Leads[:500]
	}
	saved := []lead{}
	for _, item := range batch.Leads {
		item.Company = strings.TrimSpace(item.Company)
		if item.Company == "" {
			continue
		}
		if item.ID == "" {
			item.ID = newID()
		}
		if item.Products == nil {
			item.Products = []string{}
		}
		if item.Socials == nil {
			item.Socials = []social{}
		}
		if item.ContactEvidence == nil {
			item.ContactEvidence = []evidence{}
		}
		if item.Stage == "" {
			item.Stage = "新发现"
		}
		if item.Source == "" {
			item.Source = "CSV 导入"
		}
		if item.VerifiedAt == "" {
			item.VerifiedAt = time.Now().UTC().Format("2006-01-02")
		}
		products, _ := json.Marshal(item.Products)
		socials, _ := json.Marshal(item.Socials)
		evidence, _ := json.Marshal(item.ContactEvidence)
		_, err := s.pool.Exec(r.Context(), `INSERT INTO leads (id,workspace_id,company,country,city,website,description,products_json,contact,title,email,phone,whatsapp,socials_json,contact_evidence_json,score,stage,source,verified_at,owner_id,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,CURRENT_TIMESTAMP)
		ON CONFLICT (id) DO UPDATE SET company=EXCLUDED.company,country=EXCLUDED.country,city=EXCLUDED.city,website=EXCLUDED.website,description=EXCLUDED.description,products_json=EXCLUDED.products_json,contact=EXCLUDED.contact,title=EXCLUDED.title,email=EXCLUDED.email,phone=EXCLUDED.phone,whatsapp=EXCLUDED.whatsapp,socials_json=EXCLUDED.socials_json,contact_evidence_json=EXCLUDED.contact_evidence_json,score=EXCLUDED.score,stage=EXCLUDED.stage,source=EXCLUDED.source,verified_at=EXCLUDED.verified_at,owner_id=EXCLUDED.owner_id,updated_at=CURRENT_TIMESTAMP
		WHERE leads.workspace_id=EXCLUDED.workspace_id`, item.ID, workspaceID, item.Company, item.Country, item.City, item.Website, item.Description, string(products), item.Contact, item.Title, strings.ToLower(item.Email), item.Phone, item.WhatsApp, string(socials), string(evidence), item.Score, item.Stage, item.Source, item.VerifiedAt, item.OwnerID)
		if err != nil {
			writeError(w, 503, "客户保存失败")
			return
		}
		item.Saved = true
		saved = append(saved, item)
	}
	if len(saved) == 0 {
		writeError(w, 400, "至少需要公司名称")
		return
	}
	writeJSON(w, 201, map[string]any{"leads": saved})
}

func (s *Server) updateLeads(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var input struct {
		ID      string   `json:"id"`
		IDs     []string `json:"ids"`
		Stage   *string  `json:"stage"`
		OwnerID *string  `json:"ownerId"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, 400, "更新内容无效")
		return
	}
	if len(input.IDs) == 0 && input.ID != "" {
		input.IDs = []string{input.ID}
	}
	if len(input.IDs) == 0 {
		writeError(w, 400, "id is required")
		return
	}
	if len(input.IDs) > 500 {
		input.IDs = input.IDs[:500]
	}
	changes := map[string]any{}
	for _, id := range input.IDs {
		if input.Stage != nil {
			_, err := s.pool.Exec(r.Context(), "UPDATE leads SET stage=$1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$2 AND id=$3", *input.Stage, workspaceID, id)
			if err != nil {
				writeError(w, 503, "客户更新失败")
				return
			}
			changes["stage"] = *input.Stage
		}
		if input.OwnerID != nil {
			_, err := s.pool.Exec(r.Context(), "UPDATE leads SET owner_id=$1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$2 AND id=$3", *input.OwnerID, workspaceID, id)
			if err != nil {
				writeError(w, 503, "客户更新失败")
				return
			}
			changes["ownerId"] = *input.OwnerID
		}
	}
	writeJSON(w, 200, map[string]any{"updated": len(input.IDs), "changes": changes})
}

func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var total, jobs int
	if err := s.pool.QueryRow(r.Context(), "SELECT count(*) FROM leads WHERE workspace_id=$1", workspaceID).Scan(&total); err != nil {
		writeError(w, 503, "统计读取失败")
		return
	}
	if err := s.pool.QueryRow(r.Context(), "SELECT count(*) FROM search_jobs WHERE workspace_id=$1", workspaceID).Scan(&jobs); err != nil {
		writeError(w, 503, "统计读取失败")
		return
	}
	rows, err := s.pool.Query(r.Context(), "SELECT stage,count(*) FROM leads WHERE workspace_id=$1 GROUP BY stage", workspaceID)
	if err != nil {
		writeError(w, 503, "统计读取失败")
		return
	}
	defer rows.Close()
	byStage := map[string]int{}
	for rows.Next() {
		var stage string
		var count int
		if err := rows.Scan(&stage, &count); err != nil {
			writeError(w, 503, "统计读取失败")
			return
		}
		byStage[stage] = count
	}
	writeJSON(w, 200, map[string]any{"total": total, "byStage": byStage, "searchJobs": jobs})
}

func (s *Server) searchJobs(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	rows, err := s.pool.Query(r.Context(), "SELECT id,query,status,result_count,provider,cost_cents,created_at,completed_at FROM search_jobs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 10", workspaceID)
	if err != nil {
		writeError(w, 503, "搜索记录读取失败")
		return
	}
	defer rows.Close()
	jobs := []map[string]any{}
	for rows.Next() {
		var id, query, status, provider, created string
		var count, cost int
		var completed *string
		if err := rows.Scan(&id, &query, &status, &count, &provider, &cost, &created, &completed); err != nil {
			writeError(w, 503, "搜索记录读取失败")
			return
		}
		jobs = append(jobs, map[string]any{"id": id, "query": query, "status": status, "resultCount": count, "provider": provider, "costCents": cost, "createdAt": created, "completedAt": completed})
	}
	writeJSON(w, 200, map[string]any{"jobs": jobs})
}

func (s *Server) getLead(ctx context.Context, id string) (lead, error) {
	item, err := scanLead(s.pool.QueryRow(ctx, "SELECT "+leadColumns+" FROM leads WHERE workspace_id=$1 AND id=$2", workspaceID, id))
	if err == pgx.ErrNoRows {
		return lead{}, err
	}
	return item, err
}
