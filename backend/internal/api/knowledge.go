package api

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

type knowledgeSource struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	LibraryType string `json:"libraryType"`
	Category    string `json:"category"`
	SourceURL   string `json:"sourceUrl"`
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	FileSize    int    `json:"fileSize"`
	PageCount   int    `json:"pageCount"`
	ContentText string `json:"contentText"`
	Summary     string `json:"summary"`
	Status      string `json:"status"`
	ChunkCount  int    `json:"chunkCount"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

const knowledgeColumns = "id,workspace_id,name,kind,library_type,category,source_url,file_name,content_type,file_size,page_count,content_text,summary,status,chunk_count,created_at,updated_at"

func scanKnowledge(row rowScanner) (knowledgeSource, error) {
	var item knowledgeSource
	err := row.Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.Kind, &item.LibraryType, &item.Category, &item.SourceURL, &item.FileName, &item.ContentType, &item.FileSize, &item.PageCount, &item.ContentText, &item.Summary, &item.Status, &item.ChunkCount, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func (s *Server) knowledgeList(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	rows, err := s.pool.Query(r.Context(), "SELECT "+knowledgeColumns+" FROM knowledge_sources WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 200", workspaceID)
	if err != nil {
		writeError(w, 503, "知识库不可用")
		return
	}
	defer rows.Close()
	items := []knowledgeSource{}
	for rows.Next() {
		item, err := scanKnowledge(rows)
		if err != nil {
			writeError(w, 503, "知识库不可用")
			return
		}
		items = append(items, item)
	}
	writeJSON(w, 200, map[string]any{"sources": items})
}

func validLibrary(value string) string {
	switch value {
	case "knowledge", "corpus", "material", "sensitive":
		return value
	default:
		return "knowledge"
	}
}
func validCategory(value string) string {
	switch value {
	case "产品资料", "FAQ", "报价边界", "物流交付", "合规规则", "公司介绍":
		return value
	default:
		return "产品资料"
	}
}

var markupPattern = regexp.MustCompile(`[#*_>\[\]` + "`" + `]`)
var whitespacePattern = regexp.MustCompile(`\s+`)

func summarize(value string) string {
	return truncate(strings.TrimSpace(whitespacePattern.ReplaceAllString(markupPattern.ReplaceAllString(value, " "), " ")), 360)
}
func cleanText(value string, limit int) string {
	return truncate(strings.TrimSpace(strings.ReplaceAll(value, "\x00", "")), limit)
}

func publicSourceURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		return ""
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return ""
	}
	if ip := net.ParseIP(host); ip != nil && (!ip.IsGlobalUnicast() || ip.IsPrivate()) {
		return ""
	}
	return parsed.String()
}

func (s *Server) extractURL(ctx context.Context, source string) (string, error) {
	if env("TAVILY_API_KEY") == "" {
		return "", fmt.Errorf("Tavily 尚未配置")
	}
	var result struct {
		Results []struct {
			RawContent string `json:"raw_content"`
		} `json:"results"`
	}
	err := requestJSON(ctx, "https://api.tavily.com/extract", map[string]string{"Authorization": "Bearer " + env("TAVILY_API_KEY")}, map[string]any{"urls": []string{source}, "extract_depth": "advanced", "format": "markdown", "timeout": 30}, 38*time.Second, &result)
	if err != nil {
		return "", err
	}
	if len(result.Results) == 0 || result.Results[0].RawContent == "" {
		return "", fmt.Errorf("网页没有可提取的正文")
	}
	return cleanText(result.Results[0].RawContent, 30000), nil
}

func (s *Server) knowledgeCreate(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	item := knowledgeSource{ID: newID(), WorkspaceID: workspaceID, Status: "ready", CreatedAt: time.Now().UTC().Format(time.RFC3339), UpdatedAt: time.Now().UTC().Format(time.RFC3339)}
	fileData := ""
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
		if err := r.ParseMultipartForm(3 << 20); err != nil {
			writeError(w, 413, "文件不能超过 3 MB")
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			writeError(w, 400, "请选择要上传的文件")
			return
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, 3_000_001))
		if err != nil || len(data) > 3_000_000 {
			writeError(w, 413, "文件不能超过 3 MB")
			return
		}
		item.FileName = cleanText(strings.NewReplacer("/", "_", "\\", "_", "\r", "_", "\n", "_").Replace(header.Filename), 180)
		item.Name = cleanText(r.FormValue("name"), 160)
		if item.Name == "" {
			item.Name = item.FileName
		}
		item.Category = validCategory(r.FormValue("category"))
		item.LibraryType = validLibrary(r.FormValue("libraryType"))
		item.Kind = "file"
		item.ContentType = header.Header.Get("Content-Type")
		if item.ContentType == "" {
			item.ContentType = "application/octet-stream"
		}
		item.FileSize = len(data)
		item.ContentText, item.PageCount, err = extractDocument(r.Context(), item.FileName, data)
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		fileData = base64.StdEncoding.EncodeToString(data)
	} else {
		var input struct {
			Name        string `json:"name"`
			Category    string `json:"category"`
			LibraryType string `json:"libraryType"`
			Content     string `json:"content"`
			URL         string `json:"url"`
		}
		if err := decodeJSON(r, &input); err != nil {
			writeError(w, 400, "知识源格式无效")
			return
		}
		item.Name = cleanText(input.Name, 160)
		item.Category = validCategory(input.Category)
		item.LibraryType = validLibrary(input.LibraryType)
		item.SourceURL = publicSourceURL(input.URL)
		item.ContentText = cleanText(input.Content, 30000)
		if item.Name == "" {
			writeError(w, 400, "请填写知识源名称")
			return
		}
		if item.ContentText == "" && item.SourceURL != "" {
			var err error
			item.ContentText, err = s.extractURL(r.Context(), item.SourceURL)
			if err != nil {
				writeError(w, 502, err.Error())
				return
			}
		}
		if item.ContentText == "" {
			writeError(w, 400, "请粘贴知识内容或填写网页地址")
			return
		}
		item.Kind = "text"
		if item.SourceURL != "" {
			item.Kind = "url"
		}
	}
	item.Summary = summarize(item.ContentText)
	item.ChunkCount = max(1, (len(item.ContentText)+799)/800)
	_, err := s.pool.Exec(r.Context(), `INSERT INTO knowledge_sources (id,workspace_id,name,kind,library_type,category,source_url,object_key,file_name,content_type,file_size,page_count,content_text,file_data,summary,status,chunk_count,created_at,updated_at)
	VALUES ($1,$2,$3,$4,$5,$6,$7,'',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, item.ID, workspaceID, item.Name, item.Kind, item.LibraryType, item.Category, item.SourceURL, item.FileName, item.ContentType, item.FileSize, item.PageCount, item.ContentText, fileData, item.Summary, item.Status, item.ChunkCount, item.CreatedAt, item.UpdatedAt)
	if err != nil {
		writeError(w, 503, "添加知识失败")
		return
	}
	writeJSON(w, 201, map[string]any{"source": item})
}

func (s *Server) knowledgeUpdate(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var input struct {
		ID          string  `json:"id"`
		Name        *string `json:"name"`
		Category    *string `json:"category"`
		LibraryType *string `json:"libraryType"`
		Content     *string `json:"content"`
		Status      *string `json:"status"`
	}
	if err := decodeJSON(r, &input); err != nil || input.ID == "" {
		writeError(w, 400, "id is required")
		return
	}
	item, err := scanKnowledge(s.pool.QueryRow(r.Context(), "SELECT "+knowledgeColumns+" FROM knowledge_sources WHERE workspace_id=$1 AND id=$2", workspaceID, input.ID))
	if err != nil {
		writeError(w, 404, "知识源不存在")
		return
	}
	if input.Name != nil {
		item.Name = cleanText(*input.Name, 160)
		if item.Name == "" {
			writeError(w, 400, "名称不能为空")
			return
		}
	}
	if input.Category != nil {
		item.Category = validCategory(*input.Category)
	}
	if input.LibraryType != nil {
		item.LibraryType = validLibrary(*input.LibraryType)
	}
	if input.Content != nil {
		item.ContentText = cleanText(*input.Content, 30000)
		if item.ContentText == "" {
			writeError(w, 400, "内容不能为空")
			return
		}
		item.Summary = summarize(item.ContentText)
		item.ChunkCount = max(1, (len(item.ContentText)+799)/800)
	}
	if input.Status != nil {
		item.Status = "ready"
		if *input.Status == "disabled" {
			item.Status = "disabled"
		}
	}
	item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	_, err = s.pool.Exec(r.Context(), "UPDATE knowledge_sources SET name=$1,category=$2,library_type=$3,content_text=$4,summary=$5,chunk_count=$6,status=$7,updated_at=$8 WHERE workspace_id=$9 AND id=$10", item.Name, item.Category, item.LibraryType, item.ContentText, item.Summary, item.ChunkCount, item.Status, item.UpdatedAt, workspaceID, item.ID)
	if err != nil {
		writeError(w, 503, "更新知识失败")
		return
	}
	writeJSON(w, 200, map[string]any{"source": item})
}

func (s *Server) knowledgeDelete(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, 400, "id is required")
		return
	}
	_, err := s.pool.Exec(r.Context(), "DELETE FROM knowledge_sources WHERE workspace_id=$1 AND id=$2", workspaceID, id)
	if err != nil {
		writeError(w, 503, "删除知识失败")
		return
	}
	writeJSON(w, 200, map[string]bool{"deleted": true})
}

func (s *Server) knowledgeFile(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, 400, "id is required")
		return
	}
	var filename, contentType, fileData string
	err := s.pool.QueryRow(r.Context(), "SELECT file_name,content_type,file_data FROM knowledge_sources WHERE workspace_id=$1 AND id=$2", workspaceID, id).Scan(&filename, &contentType, &fileData)
	if err != nil || fileData == "" {
		writeError(w, 404, "文件不存在")
		return
	}
	data, err := base64.StdEncoding.DecodeString(fileData)
	if err != nil {
		writeError(w, 503, "文件下载失败")
		return
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(filename))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(200)
	_, _ = w.Write(data)
}

var latinTokens = regexp.MustCompile(`[a-z0-9][a-z0-9+_.-]{1,}`)
var chineseRuns = regexp.MustCompile(`[\p{Han}]{2,}`)

func (s *Server) relevantKnowledge(ctx context.Context, query string, libraryIDs []string) string {
	if s.pool == nil {
		return ""
	}
	rows, err := s.pool.Query(ctx, "SELECT id,name,category,source_url,content_text,summary FROM knowledge_sources WHERE workspace_id=$1 AND status='ready' AND library_type='knowledge' ORDER BY updated_at DESC LIMIT 200", workspaceID)
	if err != nil {
		return ""
	}
	defer rows.Close()
	query = strings.ToLower(query)
	tokens := latinTokens.FindAllString(query, 100)
	for _, run := range chineseRuns.FindAllString(query, 40) {
		part := []rune(run)
		for i := 0; i+1 < len(part); i++ {
			tokens = append(tokens, string(part[i:i+2]))
		}
	}
	if len(tokens) == 0 {
		return ""
	}
	allowed := map[string]bool{}
	for _, id := range libraryIDs {
		allowed[id] = true
	}
	type match struct {
		score int
		text  string
	}
	matches := []match{}
	for rows.Next() {
		var id, name, category, source, content, summary string
		if rows.Scan(&id, &name, &category, &source, &content, &summary) != nil {
			continue
		}
		if len(allowed) > 0 && !allowed[id] {
			continue
		}
		haystack := strings.ToLower(name + " " + category + " " + summary + " " + content)
		score := 0
		first := -1
		for _, token := range tokens {
			if index := strings.Index(haystack, token); index >= 0 {
				score++
				if first < 0 || index < first {
					first = index
				}
				if strings.Contains(strings.ToLower(name+" "+category), token) {
					score += 3
				}
			}
		}
		if score == 0 {
			continue
		}
		start := max(0, first-180)
		excerpt := truncate(content[start:], 1200)
		matches = append(matches, match{score: score, text: fmt.Sprintf("[知识] %s（%s）\n%s\n%s", name, category, source, excerpt)})
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].score > matches[j].score })
	parts := []string{}
	for i, item := range matches {
		if i >= 5 {
			break
		}
		parts = append(parts, item.text)
	}
	return truncate(strings.Join(parts, "\n\n"), 6500)
}
