package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

type scheduleConfig struct {
	Type     string `json:"type"`
	RunAt    string `json:"runAt"`
	Weekdays []int  `json:"weekdays"`
	Time     string `json:"time"`
	Timezone string `json:"timezone"`
	Repeat   bool   `json:"repeat"`
}
type workflowSettings struct {
	LibraryIDs          []string
	SensitiveLibraryIDs []string
	Rules               string
	Model               string
	RequireReview       bool
}

func anyString(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}
func anyBool(value any, otherwise bool) bool {
	if parsed, ok := value.(bool); ok {
		return parsed
	}
	return otherwise
}
func stringsFromAny(value any, maxItems int) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	found := map[string]bool{}
	result := []string{}
	for _, item := range raw {
		entry := anyString(item)
		if entry != "" && !found[entry] {
			found[entry] = true
			result = append(result, entry)
			if len(result) >= maxItems {
				break
			}
		}
	}
	return result
}
func jsonMap(value string) map[string]any {
	result := map[string]any{}
	_ = json.Unmarshal([]byte(value), &result)
	return result
}
func jsonString(value any) string { encoded, _ := json.Marshal(value); return string(encoded) }
func configuredWords(value any) []string {
	raw := []string{}
	if list, ok := value.([]any); ok {
		for _, item := range list {
			raw = append(raw, anyString(item))
		}
	} else {
		raw = regexp.MustCompile(`[,，\n]`).Split(anyString(value), -1)
	}
	found := map[string]bool{}
	out := []string{}
	for _, item := range raw {
		word := strings.ToLower(strings.TrimSpace(item))
		if word != "" && !found[word] {
			found[word] = true
			out = append(out, word)
			if len(out) >= 100 {
				break
			}
		}
	}
	return out
}
func sensitiveHits(text string, words []string) []string {
	lower := strings.ToLower(text)
	hits := []string{}
	for _, word := range words {
		if word != "" && strings.Contains(lower, word) {
			hits = append(hits, word)
		}
	}
	return hits
}

func workflowConfig(value any) workflowSettings {
	settings := workflowSettings{}
	workflow := mapValue(value)
	nodes := arrayValue(workflow["nodes"])
	for _, node := range nodes {
		data := mapValue(mapValue(node)["data"])
		kind := anyString(data["kind"])
		config := mapValue(data["config"])
		switch kind {
		case "knowledge":
			settings.LibraryIDs = append(settings.LibraryIDs, stringsFromAny(config["libraryIds"], 30)...)
		case "sensitive":
			settings.SensitiveLibraryIDs = append(settings.SensitiveLibraryIDs, stringsFromAny(config["libraryIds"], 30)...)
		case "model":
			settings.Model = truncate(anyString(config["model"]), 160)
		case "prompt", "intent":
			instruction := anyString(config["prompt"])
			if instruction == "" {
				instruction = anyString(config["instruction"])
			}
			if instruction != "" {
				settings.Rules += truncate(instruction, 4000) + "\n"
			}
		case "review":
			settings.RequireReview = settings.RequireReview || anyBool(config["requireReview"], false)
		}
	}
	settings.LibraryIDs = dedupeStrings(settings.LibraryIDs, 30)
	settings.SensitiveLibraryIDs = dedupeStrings(settings.SensitiveLibraryIDs, 30)
	return settings
}
func dedupeStrings(values []string, limit int) []string {
	out := []string{}
	found := map[string]bool{}
	for _, v := range values {
		if v != "" && !found[v] {
			found[v] = true
			out = append(out, v)
			if len(out) >= limit {
				break
			}
		}
	}
	return out
}

func parseSchedule(value any) (scheduleConfig, error) {
	s := scheduleConfig{Type: "now", Timezone: "Asia/Shanghai", Repeat: true}
	raw := mapValue(value)
	if kind := anyString(raw["type"]); kind == "datetime" || kind == "weekly" {
		s.Type = kind
	}
	s.RunAt = anyString(raw["runAt"])
	s.Time = anyString(raw["time"])
	s.Repeat = anyBool(raw["repeat"], true)
	for _, entry := range arrayValue(raw["weekdays"]) {
		if day, ok := entry.(float64); ok && day >= 0 && day <= 6 {
			s.Weekdays = append(s.Weekdays, int(day))
		}
	}
	return s, nil
}
func nextSchedule(s scheduleConfig, after time.Time) (string, error) {
	if s.Type == "now" {
		return after.UTC().Format(time.RFC3339), nil
	}
	if s.Type == "datetime" {
		raw := s.RunAt
		if raw == "" {
			return "", errors.New("定时执行时间无效")
		}
		for _, layout := range []string{time.RFC3339, "2006-01-02T15:04", "2006-01-02 15:04"} {
			if parsed, err := time.Parse(layout, raw); err == nil {
				if layout != time.RFC3339 {
					location, _ := time.LoadLocation("Asia/Shanghai")
					parsed, err = time.ParseInLocation(layout, raw, location)
					if err != nil {
						continue
					}
				}
				return parsed.UTC().Format(time.RFC3339), nil
			}
		}
		return "", errors.New("定时执行时间无效")
	}
	if len(s.Weekdays) == 0 {
		return "", errors.New("每周任务至少选择一天")
	}
	clock, err := time.Parse("15:04", s.Time)
	if err != nil {
		return "", errors.New("每周任务时间无效")
	}
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return "", err
	}
	now := after.In(location)
	for add := 0; add <= 7; add++ {
		day := now.AddDate(0, 0, add)
		match := false
		for _, weekday := range s.Weekdays {
			if int(day.Weekday()) == weekday {
				match = true
				break
			}
		}
		if !match {
			continue
		}
		candidate := time.Date(day.Year(), day.Month(), day.Day(), clock.Hour(), clock.Minute(), 0, 0, location)
		if candidate.After(after.Add(30 * time.Second)) {
			return candidate.UTC().Format(time.RFC3339), nil
		}
	}
	return "", errors.New("无法计算下次群发时间")
}

func (s *Server) selectedLibraryContext(ctx context.Context, ids []string) string {
	if s.pool == nil || len(ids) == 0 {
		return ""
	}
	rows, err := s.pool.Query(ctx, "SELECT id,library_type,name,category,content_text FROM knowledge_sources WHERE workspace_id=$1 AND status='ready'", workspaceID)
	if err != nil {
		return ""
	}
	defer rows.Close()
	allowed := map[string]bool{}
	for _, id := range ids {
		allowed[id] = true
	}
	parts := []string{}
	for rows.Next() {
		var id, kind, name, category, content string
		if rows.Scan(&id, &kind, &name, &category, &content) != nil {
			continue
		}
		if allowed[id] {
			parts = append(parts, fmt.Sprintf("[%s] %s（%s）\n%s", kind, name, category, truncate(content, 2400)))
		}
	}
	sort.Strings(parts)
	return truncate(strings.Join(parts, "\n\n"), 12000)
}
func (s *Server) selectedSensitiveWords(ctx context.Context, ids []string) []string {
	if s.pool == nil || len(ids) == 0 {
		return nil
	}
	rows, err := s.pool.Query(ctx, "SELECT id,content_text FROM knowledge_sources WHERE workspace_id=$1 AND status='ready' AND library_type='sensitive'", workspaceID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	allowed := map[string]bool{}
	for _, id := range ids {
		allowed[id] = true
	}
	var parts []string
	for rows.Next() {
		var id, content string
		if rows.Scan(&id, &content) == nil && allowed[id] {
			parts = append(parts, content)
		}
	}
	return configuredWords(strings.Join(parts, "\n"))
}
