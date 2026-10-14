package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestSessionAndRouteProtection(t *testing.T) {
	t.Setenv("APP_ACCESS_PASSWORD", "test-password")
	t.Setenv("APP_SESSION_SECRET", "test-session-secret")
	t.Setenv("DATABASE_URL", "")
	s := NewServer()

	request := httptest.NewRequest(http.MethodGet, "/api/leads", nil)
	response := httptest.NewRecorder()
	s.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("protected route without session: got %d", response.Code)
	}

	login := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader("password=test-password&next=%2F"))
	login.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	loginResponse := httptest.NewRecorder()
	s.ServeHTTP(loginResponse, login)
	if loginResponse.Code != http.StatusSeeOther || len(loginResponse.Result().Cookies()) != 1 {
		t.Fatalf("login failed: status=%d cookies=%d", loginResponse.Code, len(loginResponse.Result().Cookies()))
	}
	request.AddCookie(loginResponse.Result().Cookies()[0])
	response = httptest.NewRecorder()
	s.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("authenticated route without db: got %d", response.Code)
	}

	invalid := httptest.NewRequest(http.MethodGet, "/api/leads", nil)
	invalid.AddCookie(&http.Cookie{Name: cookieName, Value: loginResponse.Result().Cookies()[0].Value + "tampered"})
	response = httptest.NewRecorder()
	s.ServeHTTP(response, invalid)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("tampered cookie accepted: got %d", response.Code)
	}
}

func TestSvixVerification(t *testing.T) {
	secretKey := []byte("test-signature-key")
	secret := "whsec_" + base64.StdEncoding.EncodeToString(secretKey)
	messageID, timestamp, payload := "msg_test", strconv.FormatInt(time.Now().Unix(), 10), []byte(`{"type":"email.received"}`)
	mac := hmac.New(sha256.New, secretKey)
	mac.Write([]byte(messageID + "." + timestamp + "."))
	mac.Write(payload)
	headers := http.Header{}
	headers.Set("svix-id", messageID)
	headers.Set("svix-timestamp", timestamp)
	headers.Set("svix-signature", "v1,"+base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	if err := verifySvix(headers, payload, secret); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
	if verifySvix(headers, []byte(`{"type":"email.bounced"}`), secret) == nil {
		t.Fatal("modified payload accepted")
	}
	headers.Set("svix-timestamp", strconv.FormatInt(time.Now().Add(-time.Hour).Unix(), 10))
	if verifySvix(headers, payload, secret) == nil {
		t.Fatal("expired signature accepted")
	}
}

func TestNextWeeklyScheduleShanghai(t *testing.T) {
	after := time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC) // Monday 08:00 Shanghai
	schedule := scheduleConfig{Type: "weekly", Weekdays: []int{1}, Time: "09:30", Repeat: true}
	next, err := nextSchedule(schedule, after)
	if err != nil || next != "2026-10-12T01:30:00Z" {
		t.Fatalf("next schedule: value=%q error=%v", next, err)
	}
	if _, err := nextSchedule(scheduleConfig{Type: "weekly", Time: "09:30"}, after); err == nil {
		t.Fatal("weekly schedule without days accepted")
	}
}
