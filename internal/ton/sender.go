// Sender signs and broadcasts native TON payouts from the house hot wallet. It is
// the write counterpart to the read-only deposit Watcher in this package: deposits
// are credited by watching inbound transfers; withdrawals are paid by signing and
// sending outbound transfers from a wallet derived from a mnemonic.
//
// Construct one Sender at startup (it opens a long-lived liteserver connection and
// derives the wallet) and reuse it. Sends are serialized so the wallet seqno is
// consumed in order.
package ton

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"sync"

	"github.com/xssnick/tonutils-go/address"
	"github.com/xssnick/tonutils-go/liteclient"
	"github.com/xssnick/tonutils-go/tlb"
	tonapi "github.com/xssnick/tonutils-go/ton"
	"github.com/xssnick/tonutils-go/ton/wallet"
)

// globalConfigURL is the public TON mainnet liteserver config — no API key needed.
const globalConfigURL = "https://ton.org/global.config.json"

// ErrBadAddress is returned when a payout destination cannot be parsed.
var ErrBadAddress = errors.New("ton: invalid address")

// Sender holds the house hot wallet and its liteserver connection.
type Sender struct {
	w  *wallet.Wallet
	mu sync.Mutex // serialize sends so the wallet seqno is consumed in order
}

// NewSender connects to TON mainnet and derives the hot wallet from the given
// space-separated mnemonic (wallet version V4R2). It blocks on a startup network
// call to load the liteserver config; the caller should treat failure as "disable
// withdrawals" rather than fatal.
func NewSender(ctx context.Context, mnemonic string) (*Sender, error) {
	words := strings.Fields(mnemonic)
	if len(words) < 12 {
		return nil, errors.New("ton: mnemonic looks too short")
	}
	pool := liteclient.NewConnectionPool()
	cfg, err := liteclient.GetConfigFromUrl(ctx, globalConfigURL)
	if err != nil {
		return nil, fmt.Errorf("ton: load global config: %w", err)
	}
	if err := pool.AddConnectionsFromConfig(ctx, cfg); err != nil {
		return nil, fmt.Errorf("ton: connect liteservers: %w", err)
	}
	api := tonapi.NewAPIClient(pool).WithRetry()
	w, err := wallet.FromSeed(api, words, wallet.V4R2)
	if err != nil {
		return nil, fmt.Errorf("ton: derive wallet: %w", err)
	}
	return &Sender{w: w}, nil
}

// Address returns the hot wallet's address so the operator can verify and fund it.
func (s *Sender) Address() string { return s.w.WalletAddress().String() }

// ValidateAddress parses a user-supplied TON address (EQ.../UQ.../raw) without
// touching the network — safe to call in the request path.
func ValidateAddress(addr string) error {
	if _, err := address.ParseAddr(strings.TrimSpace(addr)); err != nil {
		return ErrBadAddress
	}
	return nil
}

// Send broadcasts a transfer of amountNano to `to` with an optional text comment
// and waits for inclusion on-chain, returning the transaction hash (hex). Sends
// are serialized so concurrent callers consume the seqno in order.
func (s *Sender) Send(ctx context.Context, to string, amountNano int64, comment string) (string, error) {
	addr, err := address.ParseAddr(strings.TrimSpace(to))
	if err != nil {
		return "", ErrBadAddress
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	amount := tlb.FromNanoTON(big.NewInt(amountNano))
	// Respect the address's bounceable flag: user wallets are non-bounceable
	// (UQ...), so a payout won't bounce back if the destination account is fresh.
	msg, err := s.w.BuildTransfer(addr, amount, addr.IsBounceable(), comment)
	if err != nil {
		return "", fmt.Errorf("ton: build transfer: %w", err)
	}
	tx, _, err := s.w.SendWaitTransaction(ctx, msg)
	if err != nil {
		return "", fmt.Errorf("ton: send: %w", err)
	}
	return hex.EncodeToString(tx.Hash), nil
}
