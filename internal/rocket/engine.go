package rocket

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"math"
	"sync"
	"time"
)

// Phase names broadcast to clients and stored on the round.
const (
	phaseBetting = "BETTING"
	phaseFlying  = "FLYING"
	phaseCrashed = "CRASHED"
)

// Engine-level errors (store has the DB-level ones).
var (
	ErrStakeTooSmall = errors.New("rocket: stake too small")
	ErrStakeTooLarge = errors.New("rocket: stake too large")
	ErrNotFlying     = errors.New("rocket: round is not in flight")
	ErrTooLate       = errors.New("rocket: too late, round crashed")
)

// Config tunes round pacing and economics. All durations are wall-clock; money
// amounts are nano-TON; multipliers are ×1000 (milli).
type Config struct {
	BettingMs    int64   // betting window length
	PauseMs      int64   // gap between a crash and the next betting window
	TickMs       int64   // flying broadcast cadence
	GrowthPerSec float64 // k in multiplier m(t) = e^{k·t}
	EdgeBp       int64   // house edge in basis points (500 = 5%)
	MaxMilli     int64   // crash multiplier cap (bounds round length + single-round liability)
	MinStakeNano int64
	MaxStakeNano int64 // 0 = no cap
}

// DefaultConfig returns sensible production defaults: ~6s betting, 5% edge, a 50x
// cap (≈26s max flight at k=0.15: 2x≈4.6s, 10x≈15s), min stake 0.1 TON, NO max stake
// (0 = uncapped — operator decision for the test phase; real cap is the balance).
func DefaultConfig() Config {
	return Config{
		BettingMs:    5000,
		PauseMs:      2500, // крашевый экран (взрыв+красные иксы), затем сразу отсчёт от 5
		TickMs:       100,
		GrowthPerSec: 0.15,
		EdgeBp:       500,
		MaxMilli:     50000,
		MinStakeNano: 100_000_000, // 0.1 TON
		MaxStakeNano: 0,           // без верхнего лимита
	}
}

// roundState is the live state of the current round, guarded by Engine.mu. We track
// only the shared game state — the "other players" feed shown in the UI is faked
// client-side, so the engine never carries per-player data here.
type roundState struct {
	id         int64
	phase      string
	seedHash   string
	seed       []byte // revealed only once crashed
	crashMilli int64  // secret until crashed; never put in a payload before then
	phaseEnd   time.Time
	flyStart   time.Time
}

// Engine owns the single round goroutine and fans state out to SSE subscribers.
type Engine struct {
	cfg   Config
	store *Store
	hub   *hub

	mu      sync.RWMutex
	cur     roundState
	history []int64 // recent crash points (milli), newest first
}

// New builds an Engine over store. Call Run in a goroutine to start the rounds.
func New(store *Store, cfg Config) *Engine {
	return &Engine{cfg: cfg, store: store, hub: newHub(), cur: roundState{phase: phaseBetting}}
}

// Warm preloads the recent-crashes strip so the very first stream shows history.
func (e *Engine) Warm(ctx context.Context) {
	if h, err := e.store.RecentCrashes(ctx, 20); err == nil {
		e.mu.Lock()
		e.history = h
		e.mu.Unlock()
	}
}

// Run drives rounds until ctx is cancelled.
func (e *Engine) Run(ctx context.Context) {
	for ctx.Err() == nil {
		if err := e.runRound(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("rocket: round error: %v", err)
			if !sleepCtx(ctx, 3*time.Second) {
				return
			}
		}
	}
}

func (e *Engine) runRound(ctx context.Context) error {
	seed, err := GenerateSeed()
	if err != nil {
		return err
	}
	hash := SeedHash(seed)
	id, err := e.store.InsertRound(ctx, hash)
	if err != nil {
		return err
	}
	crash := CrashMilli(seed, id, e.cfg.EdgeBp, e.cfg.MaxMilli)
	if err := e.store.SetRoundCrash(ctx, id, crash); err != nil {
		return err
	}

	// BETTING — open the round, accept bets, count down.
	e.mu.Lock()
	e.cur = roundState{
		id: id, phase: phaseBetting, seedHash: hash, crashMilli: crash,
		phaseEnd: time.Now().Add(d(e.cfg.BettingMs)),
	}
	e.mu.Unlock()
	e.publish()
	if !e.tickedWait(ctx, d(e.cfg.BettingMs)) {
		return ctx.Err()
	}

	// FLYING — the multiplier climbs until it reaches the predetermined crash point.
	if err := e.store.StartFlying(ctx, id); err != nil {
		return err
	}
	start := time.Now()
	e.mu.Lock()
	e.cur.phase = phaseFlying
	e.cur.flyStart = start
	e.mu.Unlock()
	e.publish()

	tCrash := e.timeToCrash(crash)
	ticker := time.NewTicker(d(e.cfg.TickMs))
	for {
		stop := false
		select {
		case <-ctx.Done():
			ticker.Stop()
			return ctx.Err()
		case <-ticker.C:
			if time.Since(start) >= tCrash {
				stop = true
				break
			}
			e.publish()
		}
		if stop {
			break
		}
	}
	ticker.Stop()

	// CRASH — close to cashouts, settle the busts, reveal the seed.
	e.mu.Lock()
	e.cur.phase = phaseCrashed
	e.cur.seed = seed
	e.cur.phaseEnd = time.Now().Add(d(e.cfg.PauseMs))
	e.history = append([]int64{crash}, e.history...)
	if len(e.history) > 20 {
		e.history = e.history[:20]
	}
	e.mu.Unlock()

	if _, err := e.store.CrashRound(ctx, id, seed); err != nil {
		// Money is DB-guarded and idempotent; log and keep the game running.
		log.Printf("rocket: settle busts for round %d: %v", id, err)
	}
	e.publish()

	if !e.tickedWait(ctx, d(e.cfg.PauseMs)) {
		return ctx.Err()
	}
	return nil
}

// PlaceBet locks a stake into the current round during its betting window. Returns
// the round and bet ids.
func (e *Engine) PlaceBet(ctx context.Context, userID, stakeNano int64) (roundID, betID int64, err error) {
	if stakeNano < e.cfg.MinStakeNano {
		return 0, 0, ErrStakeTooSmall
	}
	if e.cfg.MaxStakeNano > 0 && stakeNano > e.cfg.MaxStakeNano {
		return 0, 0, ErrStakeTooLarge
	}
	e.mu.RLock()
	phase, rid := e.cur.phase, e.cur.id
	e.mu.RUnlock()
	if phase != phaseBetting {
		return 0, 0, ErrBettingClosed
	}

	betID, err = e.store.PlaceBet(ctx, rid, userID, stakeNano)
	if err != nil {
		return 0, 0, err
	}
	return rid, betID, nil
}

// Cashout settles the caller's bet in the current flight at the live multiplier.
// Returns the multiplier (milli) and payout (nano).
func (e *Engine) Cashout(ctx context.Context, userID int64) (multMilli, payoutNano int64, err error) {
	e.mu.RLock()
	phase, rid, crash, flyStart := e.cur.phase, e.cur.id, e.cur.crashMilli, e.cur.flyStart
	e.mu.RUnlock()
	if phase != phaseFlying {
		return 0, 0, ErrNotFlying
	}
	mNow := e.multAt(time.Since(flyStart))
	if mNow >= crash {
		return 0, 0, ErrTooLate // the round has effectively crashed
	}

	payoutNano, err = e.store.Cashout(ctx, rid, userID, mNow)
	if err != nil {
		return 0, 0, err
	}
	return mNow, payoutNano, nil
}

// timeToCrash is how long the flight lasts before it reaches crashMilli.
func (e *Engine) timeToCrash(crashMilli int64) time.Duration {
	if crashMilli <= 1000 {
		return 0
	}
	sec := math.Log(float64(crashMilli)/1000.0) / e.cfg.GrowthPerSec
	return time.Duration(sec * float64(time.Second))
}

// multAt is the displayed multiplier (milli) after a flight has run for dur.
func (e *Engine) multAt(dur time.Duration) int64 {
	if dur <= 0 {
		return 1000
	}
	return int64(1000 * math.Exp(e.cfg.GrowthPerSec*dur.Seconds()))
}

// ---- Broadcast payload ----

type statePayload struct {
	Phase       string  `json:"phase"`
	RoundID     int64   `json:"round_id"`
	MultMilli   int64   `json:"multiplier_milli"`
	CrashMilli  int64   `json:"crash_milli,omitempty"`
	SeedHash    string  `json:"seed_hash"`
	Seed        string  `json:"seed,omitempty"`
	TimeLeftMs  int64   `json:"time_left_ms"`
	History     []int64 `json:"history,omitempty"`
	ServerNowMs int64   `json:"server_now_ms"`
}

// snapshot builds the current public state. Never exposes crashMilli or the seed
// before the round has crashed.
func (e *Engine) snapshot() statePayload {
	e.mu.RLock()
	defer e.mu.RUnlock()

	p := statePayload{
		Phase:       e.cur.phase,
		RoundID:     e.cur.id,
		SeedHash:    e.cur.seedHash,
		History:     append([]int64(nil), e.history...),
		ServerNowMs: time.Now().UnixMilli(),
	}
	switch e.cur.phase {
	case phaseBetting:
		p.MultMilli = 1000
		p.TimeLeftMs = msUntil(e.cur.phaseEnd)
	case phaseFlying:
		p.MultMilli = e.multAt(time.Since(e.cur.flyStart))
	case phaseCrashed:
		p.MultMilli = e.cur.crashMilli
		p.CrashMilli = e.cur.crashMilli
		p.Seed = hex.EncodeToString(e.cur.seed)
		p.TimeLeftMs = msUntil(e.cur.phaseEnd)
	}
	return p
}

// SnapshotJSON returns the current state as a JSON document (for the SSE handshake
// and a plain GET state endpoint).
func (e *Engine) SnapshotJSON() []byte {
	b, _ := json.Marshal(e.snapshot())
	return b
}

func (e *Engine) publish() {
	e.hub.broadcast(e.SnapshotJSON())
}

// tickedWait waits dur, re-publishing state every 500ms so countdowns stay live and
// the SSE connections stay warm. Returns false if ctx is cancelled first.
func (e *Engine) tickedWait(ctx context.Context, dur time.Duration) bool {
	deadline := time.Now().Add(dur)
	t := time.NewTicker(500 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-t.C:
			if !time.Now().Before(deadline) {
				return true
			}
			e.publish()
		}
	}
}

// Subscribe registers an SSE listener. The returned cancel must be called to free it.
func (e *Engine) Subscribe() (<-chan []byte, func()) {
	return e.hub.subscribe()
}

func d(ms int64) time.Duration { return time.Duration(ms) * time.Millisecond }

func msUntil(t time.Time) int64 {
	ms := time.Until(t).Milliseconds()
	if ms < 0 {
		return 0
	}
	return ms
}

func sleepCtx(ctx context.Context, dur time.Duration) bool {
	t := time.NewTimer(dur)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// ---- SSE hub ----

type hub struct {
	mu   sync.Mutex
	subs map[chan []byte]struct{}
}

func newHub() *hub { return &hub{subs: make(map[chan []byte]struct{})} }

func (h *hub) subscribe() (<-chan []byte, func()) {
	ch := make(chan []byte, 16)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	cancel := func() {
		h.mu.Lock()
		if _, ok := h.subs[ch]; ok {
			delete(h.subs, ch)
			close(ch)
		}
		h.mu.Unlock()
	}
	return ch, cancel
}

// broadcast sends to every subscriber, dropping the message for any that is too
// slow rather than blocking the round goroutine. A dropped tick is recovered by the
// next one (and the crash/phase change publishes again).
func (h *hub) broadcast(msg []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- msg:
		default:
		}
	}
}
