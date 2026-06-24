package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// signInitData builds a valid signed initData query string for tests.
func signInitData(botToken string, vals map[string]string) string {
	pairs := make([]string, 0, len(vals))
	for k, v := range vals {
		pairs = append(pairs, k+"="+v)
	}
	sort.Strings(pairs)
	dataCheck := strings.Join(pairs, "\n")

	secret := hmac.New(sha256.New, []byte("WebAppData"))
	secret.Write([]byte(botToken))
	mac := hmac.New(sha256.New, secret.Sum(nil))
	mac.Write([]byte(dataCheck))
	hash := hex.EncodeToString(mac.Sum(nil))

	q := url.Values{}
	for k, v := range vals {
		q.Set(k, v)
	}
	q.Set("hash", hash)
	return q.Encode()
}

func TestValidateInitData_OK(t *testing.T) {
	token := "123456:ABCDEF"
	vals := map[string]string{
		"auth_date": strconv.FormatInt(time.Now().Unix(), 10),
		"user":      `{"id":42,"username":"neo","first_name":"Tom"}`,
	}
	u, err := validateInitData(signInitData(token, vals), token, 24*time.Hour)
	if err != nil {
		t.Fatalf("valid initData rejected: %v", err)
	}
	if u.ID != 42 || u.Username != "neo" {
		t.Fatalf("got %+v", u)
	}
}

func TestValidateInitData_BadToken(t *testing.T) {
	token := "123456:ABCDEF"
	vals := map[string]string{
		"auth_date": strconv.FormatInt(time.Now().Unix(), 10),
		"user":      `{"id":1}`,
	}
	signed := signInitData(token, vals)
	if _, err := validateInitData(signed, "999:WRONG", 24*time.Hour); err == nil {
		t.Fatal("expected rejection with wrong bot token")
	}
}

func TestValidateInitData_Expired(t *testing.T) {
	token := "123456:ABCDEF"
	vals := map[string]string{
		"auth_date": strconv.FormatInt(time.Now().Add(-48*time.Hour).Unix(), 10),
		"user":      `{"id":1}`,
	}
	if _, err := validateInitData(signInitData(token, vals), token, 24*time.Hour); err == nil {
		t.Fatal("expected expired rejection")
	}
}
