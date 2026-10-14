package api

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/hubao201198/moke-ai/backend/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

const workspaceID = "demo"
const cookieName = "maoke_session"

type Server struct {
	mux  *http.ServeMux
	pool *pgxpool.Pool
}

func NewServer() *Server {
	s := &Server{mux: http.NewServeMux()}
	if databaseURL := os.Getenv("DATABASE_URL"); databaseURL != "" {
		pool, err := pgxpool.New(context.Background(), databaseURL)
		if err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err = pool.Ping(ctx); err == nil {
				err = migrations.Apply(ctx, pool)
			}
			if err == nil {
				s.pool = pool
			} else {
				log.Printf("database initialization failed: %v", err)
				pool.Close()
			}
		}
	}
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !isPublicPath(r.URL.Path) && !validSession(r) {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}
	s.mux.ServeHTTP(w, r)
}

func isPublicPath(path string) bool {
	switch path {
	case "/api/health", "/api/auth/login", "/api/auth/logout", "/api/email/unsubscribe", "/api/cron/followups", "/api/cron/automation", "/api/webhooks/resend":
		return true
	default:
		return false
	}
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.health)
	s.mux.HandleFunc("POST /api/auth/login", s.login)
	s.mux.HandleFunc("POST /api/auth/logout", s.logout)
	s.mux.HandleFunc("GET /api/leads", s.listLeads)
	s.mux.HandleFunc("POST /api/leads", s.saveLeads)
	s.mux.HandleFunc("PATCH /api/leads", s.updateLeads)
	s.mux.HandleFunc("GET /api/stats", s.stats)
	s.mux.HandleFunc("GET /api/search/jobs", s.searchJobs)
	s.mux.HandleFunc("POST /api/search", s.search)
	s.mux.HandleFunc("POST /api/leads/enrich", s.enrichLead)
	s.mux.HandleFunc("POST /api/ai/reply", s.aiReply)
	s.mux.HandleFunc("GET /api/integrations", s.integrations)
	s.mux.HandleFunc("GET /api/integrations/coze", s.cozeStatus)
	s.mux.HandleFunc("POST /api/integrations/coze", s.cozeRun)
	s.mux.HandleFunc("GET /api/integrations/coze/workflows", s.cozeWorkflows)
	s.mux.HandleFunc("GET /api/integrations/coze/vibe", s.cozeVibeStatus)
	s.mux.HandleFunc("POST /api/integrations/coze/vibe", s.cozeVibeRun)
	s.mux.HandleFunc("GET /api/automation/tasks", s.automationTasks)
	s.mux.HandleFunc("POST /api/automation/tasks", s.automationTaskAction)
	s.mux.HandleFunc("POST /api/automation/inbound", s.automationInbound)
	s.mux.HandleFunc("GET /api/cron/automation", s.automationCron)
	s.mux.HandleFunc("GET /api/cron/followups", s.followupsCron)
	s.mux.HandleFunc("GET /api/knowledge", s.knowledgeList)
	s.mux.HandleFunc("POST /api/knowledge", s.knowledgeCreate)
	s.mux.HandleFunc("PATCH /api/knowledge", s.knowledgeUpdate)
	s.mux.HandleFunc("DELETE /api/knowledge", s.knowledgeDelete)
	s.mux.HandleFunc("GET /api/knowledge/file", s.knowledgeFile)
	s.mux.HandleFunc("GET /api/reviews", s.reviewsList)
	s.mux.HandleFunc("PATCH /api/reviews", s.reviewsUpdate)
	s.mux.HandleFunc("GET /api/finance", s.financeList)
	s.mux.HandleFunc("POST /api/finance", s.financeCreate)
	s.mux.HandleFunc("PATCH /api/finance", s.financeUpdate)
	s.mux.HandleFunc("GET /api/email/messages", s.emailMessagesList)
	s.mux.HandleFunc("POST /api/email/messages", s.emailMessageCreate)
	s.mux.HandleFunc("PATCH /api/email/messages", s.emailMessageUpdate)
	s.mux.HandleFunc("GET /api/email/suppressions", s.suppressionsList)
	s.mux.HandleFunc("POST /api/email/suppressions", s.suppressionCreate)
	s.mux.HandleFunc("DELETE /api/email/suppressions", s.suppressionDelete)
	s.mux.HandleFunc("GET /api/email/followups", s.followUpsList)
	s.mux.HandleFunc("POST /api/email/followups", s.followUpAction)
	s.mux.HandleFunc("GET /api/email/unsubscribe", s.unsubscribe)
	s.mux.HandleFunc("POST /api/email/unsubscribe", s.unsubscribe)
	s.mux.HandleFunc("POST /api/webhooks/resend", s.resendWebhook)
}

func (s *Server) requireDB(w http.ResponseWriter) bool {
	if s.pool != nil {
		return true
	}
	writeError(w, http.StatusServiceUnavailable, "数据库未配置或不可用")
	return false
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ready := s.pool != nil && os.Getenv("APP_ACCESS_PASSWORD") != "" && os.Getenv("APP_SESSION_SECRET") != ""
	if ready {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		ready = s.pool.Ping(ctx) == nil
	}
	status := http.StatusOK
	if !ready {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{"ok": ready, "service": "maoke-api"})
}

func sessionSignature(message string) string {
	h := hmac.New(sha256.New, []byte(os.Getenv("APP_SESSION_SECRET")))
	h.Write([]byte(message))
	return hex.EncodeToString(h.Sum(nil))
}

func validSession(r *http.Request) bool {
	if os.Getenv("APP_ACCESS_PASSWORD") == "" || os.Getenv("APP_SESSION_SECRET") == "" {
		return false
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 2 {
		return false
	}
	if !hmac.Equal([]byte(parts[1]), []byte(sessionSignature(parts[0]))) {
		return false
	}
	message, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	fields := strings.SplitN(string(message), ":", 2)
	if len(fields) != 2 || fields[1] == "" {
		return false
	}
	issuedAt, err := strconv.ParseInt(fields[0], 10, 64)
	return err == nil && issuedAt <= time.Now().Unix()+60 && issuedAt > time.Now().Add(-7*24*time.Hour).Unix()
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeError(w, http.StatusBadRequest, "登录表单无效")
		return
	}
	password, expected, secret := r.FormValue("password"), os.Getenv("APP_ACCESS_PASSWORD"), os.Getenv("APP_SESSION_SECRET")
	if expected == "" || secret == "" || !hmac.Equal(passwordDigest(password, secret), passwordDigest(expected, secret)) {
		http.Redirect(w, r, "/login?error=invalid", http.StatusSeeOther)
		return
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		writeError(w, http.StatusInternalServerError, "无法创建登录会话")
		return
	}
	message := base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(time.Now().Unix(), 10) + ":" + hex.EncodeToString(nonce)))
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: message + "." + sessionSignature(message), Path: "/", MaxAge: 7 * 24 * 60 * 60, HttpOnly: true, Secure: secure, SameSite: http.SameSiteStrictMode})
	next := r.FormValue("next")
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		next = "/"
	}
	http.Redirect(w, r, next, http.StatusSeeOther)
}

func passwordDigest(value, secret string) []byte {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(value))
	return h.Sum(nil)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func decodeJSON(r *http.Request, value any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 4<<20)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return errors.New("只能提交一个 JSON 对象")
	}
	return nil
}

func env(name string) string { return strings.TrimSpace(os.Getenv(name)) }

func (s *Server) requireCron(w http.ResponseWriter, r *http.Request) bool {
	secret := env("CRON_SECRET")
	if secret != "" && hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+secret)) {
		return true
	}
	writeError(w, http.StatusUnauthorized, "定时任务密钥无效")
	return false
}
