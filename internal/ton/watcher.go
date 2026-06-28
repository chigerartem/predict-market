// Package ton watches the house TON deposit address for inbound transfers and
// credits each to a user by the memo carried in the transfer's text comment.
//
// Attribution: every user gets a unique memo (see internal/deposits). The Mini App
// (TON Connect) puts that memo in the transfer comment; the watcher reads confirmed
// inbound transfers, matches the comment to a user, and credits the *actual*
// on-chain amount 1:1. Idempotency is by transaction hash, so re-polling the same
// transactions (every cycle / after a restart) never double-credits.
package ton

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/deposits"
)

const toncenterBase = "https://toncenter.com/api/v2"

// Watcher polls toncenter for inbound transfers to the deposit address.
type Watcher struct {
	pool    *pgxpool.Pool
	address string
	apiKey  string // optional — raises toncenter rate limits; empty uses the free tier
	limit   int
	http    *http.Client
}

// NewWatcher builds a watcher for the given deposit address. apiKey may be empty.
func NewWatcher(pool *pgxpool.Pool, address, apiKey string) *Watcher {
	return &Watcher{
		pool:    pool,
		address: address,
		apiKey:  apiKey,
		limit:   30,
		http:    &http.Client{Timeout: 20 * time.Second},
	}
}

// txResponse is the subset of toncenter getTransactions we read.
type txResponse struct {
	OK     bool   `json:"ok"`
	Error  string `json:"error"`
	Result []struct {
		TransactionID struct {
			Hash string `json:"hash"`
		} `json:"transaction_id"`
		InMsg struct {
			Source  string `json:"source"`  // empty for external (non-deposit) messages
			Value   string `json:"value"`   // nano-TON, decimal string
			Message string `json:"message"` // decoded text comment, when present
		} `json:"in_msg"`
	} `json:"result"`
}

// Poll fetches recent transactions and credits any new inbound deposit transfers.
// Returns how many transfers were credited this cycle.
func (wc *Watcher) Poll(ctx context.Context) (int, error) {
	q := url.Values{}
	q.Set("address", wc.address)
	q.Set("limit", strconv.Itoa(wc.limit))
	if wc.apiKey != "" {
		q.Set("api_key", wc.apiKey)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		toncenterBase+"/getTransactions?"+q.Encode(), nil)
	if err != nil {
		return 0, err
	}
	resp, err := wc.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("toncenter: http %d", resp.StatusCode)
	}
	var body txResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, err
	}
	if !body.OK {
		return 0, fmt.Errorf("toncenter: %s", body.Error)
	}

	credited := 0
	for _, t := range body.Result {
		in := t.InMsg
		// Only inbound internal transfers carry a source; skip external messages.
		if in.Source == "" {
			continue
		}
		memo := strings.TrimSpace(in.Message)
		if memo == "" {
			continue // no comment → can't attribute
		}
		amount, err := strconv.ParseInt(in.Value, 10, 64)
		if err != nil || amount < deposits.MinTonDepositNano {
			continue // unparseable or dust
		}
		hash := t.TransactionID.Hash
		if hash == "" {
			continue
		}

		userID, err := deposits.UserByTonMemo(ctx, wc.pool, memo)
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				log.Printf("ton watcher: lookup memo %q: %v", memo, err)
			}
			continue // unknown memo → stray transfer, ignore
		}
		if err := deposits.CreditTON(ctx, wc.pool, userID, amount, hash); err != nil {
			log.Printf("ton watcher: credit user %d tx %s: %v", userID, hash, err)
			continue
		}
		credited++
	}
	return credited, nil
}
