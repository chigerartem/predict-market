package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// TgUser is the Telegram user extracted from validated initData.
type TgUser struct {
	ID        int64
	Username  string
	FirstName string
}

var errInvalidInitData = errors.New("invalid initData")

// validateInitData verifies Telegram WebApp initData per the documented
// HMAC-SHA256 scheme and returns the user. Mirrors the cashback project's
// auth (Authorization: tma <initData>).
func validateInitData(initData, botToken string, maxAge time.Duration) (TgUser, error) {
	if botToken == "" {
		return TgUser{}, errors.New("bot token not configured")
	}
	parsed, err := url.ParseQuery(initData)
	if err != nil {
		return TgUser{}, errInvalidInitData
	}
	hash := parsed.Get("hash")
	if hash == "" {
		return TgUser{}, errInvalidInitData
	}

	pairs := make([]string, 0, len(parsed))
	for k, v := range parsed {
		if k == "hash" {
			continue
		}
		pairs = append(pairs, k+"="+v[0])
	}
	sort.Strings(pairs)
	dataCheck := strings.Join(pairs, "\n")

	secret := hmac.New(sha256.New, []byte("WebAppData"))
	secret.Write([]byte(botToken))
	mac := hmac.New(sha256.New, secret.Sum(nil))
	mac.Write([]byte(dataCheck))
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(hash)) {
		return TgUser{}, errInvalidInitData
	}

	if maxAge > 0 {
		authDate, err := strconv.ParseInt(parsed.Get("auth_date"), 10, 64)
		if err != nil {
			return TgUser{}, errInvalidInitData
		}
		if time.Since(time.Unix(authDate, 0)) > maxAge {
			return TgUser{}, errors.New("initData expired")
		}
	}

	var u struct {
		ID        int64  `json:"id"`
		Username  string `json:"username"`
		FirstName string `json:"first_name"`
	}
	if err := json.Unmarshal([]byte(parsed.Get("user")), &u); err != nil || u.ID == 0 {
		return TgUser{}, errInvalidInitData
	}
	return TgUser{ID: u.ID, Username: u.Username, FirstName: u.FirstName}, nil
}

// parseInitDataUnverified extracts the Telegram user from initData WITHOUT verifying
// the HMAC signature. Use ONLY for token-less testing (gated by ALLOW_INSECURE_INITDATA).
func parseInitDataUnverified(initData string) (TgUser, error) {
	parsed, err := url.ParseQuery(initData)
	if err != nil {
		return TgUser{}, errInvalidInitData
	}
	var u struct {
		ID        int64  `json:"id"`
		Username  string `json:"username"`
		FirstName string `json:"first_name"`
	}
	if err := json.Unmarshal([]byte(parsed.Get("user")), &u); err != nil || u.ID == 0 {
		return TgUser{}, errInvalidInitData
	}
	return TgUser{ID: u.ID, Username: u.Username, FirstName: u.FirstName}, nil
}
