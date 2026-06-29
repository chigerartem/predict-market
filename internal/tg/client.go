// Package tg is a thin Telegram Bot API client — only the calls the prediction
// market needs (Stars invoices and payment confirmation). No third-party deps.
package tg

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const apiBase = "https://api.telegram.org"

// Client calls the Telegram Bot API with a bot token.
type Client struct {
	token string
	http  *http.Client
}

// New returns a client for the given bot token.
func New(token string) *Client {
	return &Client{token: token, http: &http.Client{Timeout: 15 * time.Second}}
}

// LabeledPrice is one line of an invoice. For Stars (XTR) the amount is the
// number of stars (integer, no decimals).
type LabeledPrice struct {
	Label  string `json:"label"`
	Amount int64  `json:"amount"`
}

// CreateStarsInvoiceLink creates a Stars (XTR) invoice link the Mini App opens
// via Telegram.WebApp.openInvoice. payload is an opaque string echoed back in the
// successful_payment update — we use it to tag the deposit.
func (c *Client) CreateStarsInvoiceLink(ctx context.Context, title, description, payload string, stars int64) (string, error) {
	req := map[string]any{
		"title":          title,
		"description":    description,
		"payload":        payload,
		"currency":       "XTR",
		"prices":         []LabeledPrice{{Label: title, Amount: stars}},
		"provider_token": "", // empty for digital goods paid in Stars
	}
	var link string
	if err := c.call(ctx, "createInvoiceLink", req, &link); err != nil {
		return "", err
	}
	return link, nil
}

// AnswerPreCheckoutQuery confirms (or rejects) a pending Stars payment. Telegram
// requires an answer within 10 seconds or the payment fails.
func (c *Client) AnswerPreCheckoutQuery(ctx context.Context, queryID string, ok bool, errMsg string) error {
	req := map[string]any{"pre_checkout_query_id": queryID, "ok": ok}
	if !ok {
		req["error_message"] = errMsg
	}
	return c.call(ctx, "answerPreCheckoutQuery", req, nil)
}

// SetWebhook registers url to receive updates. secret (optional) is echoed back by
// Telegram in the X-Telegram-Bot-Api-Secret-Token header on every call, so the
// receiver can reject forged requests. We only need message + pre_checkout_query.
func (c *Client) SetWebhook(ctx context.Context, url, secret string) error {
	req := map[string]any{
		"url":             url,
		"allowed_updates": []string{"message", "pre_checkout_query"},
	}
	if secret != "" {
		req["secret_token"] = secret
	}
	return c.call(ctx, "setWebhook", req, nil)
}

// call performs one Bot API method call and unwraps the {ok, result} envelope.
func (c *Client) call(ctx context.Context, method string, body any, out any) error {
	buf, err := json.Marshal(body)
	if err != nil {
		return err
	}
	url := fmt.Sprintf("%s/bot%s/%s", apiBase, c.token, method)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(httpReq)
	if err != nil {
		// Scrub the bot token: a *url.Error from Do embeds the request URL (token in path).
		return fmt.Errorf("tg: %s request failed: %s", method, strings.ReplaceAll(err.Error(), c.token, "***"))
	}
	defer resp.Body.Close()

	var env struct {
		OK          bool            `json:"ok"`
		Result      json.RawMessage `json:"result"`
		Description string          `json:"description"`
		ErrorCode   int             `json:"error_code"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return fmt.Errorf("tg: decode %s response: %w", method, err)
	}
	if !env.OK {
		return fmt.Errorf("tg: %s failed (%d): %s", method, env.ErrorCode, env.Description)
	}
	if out != nil {
		if err := json.Unmarshal(env.Result, out); err != nil {
			return fmt.Errorf("tg: unmarshal %s result: %w", method, err)
		}
	}
	return nil
}
