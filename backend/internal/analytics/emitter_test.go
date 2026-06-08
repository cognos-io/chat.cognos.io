package analytics

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRecordingEmitterAppendsEvents(t *testing.T) {
	t.Parallel()

	emitter := &RecordingEmitter{}
	first := UsageEvent{EventID: "evt-1"}
	second := UsageEvent{EventID: "evt-2"}

	if err := emitter.Emit(first); err != nil {
		t.Fatalf("Emit(first) error = %v", err)
	}
	if err := emitter.Emit(second); err != nil {
		t.Fatalf("Emit(second) error = %v", err)
	}
	if len(emitter.Events) != 2 {
		t.Fatalf("len(Events) = %d, want %d", len(emitter.Events), 2)
	}
	if emitter.Events[0].EventID != "evt-1" || emitter.Events[1].EventID != "evt-2" {
		t.Fatalf("Events IDs = [%q, %q], want [%q, %q]", emitter.Events[0].EventID, emitter.Events[1].EventID, "evt-1", "evt-2")
	}
}

type batchSink struct {
	mu      sync.Mutex
	batches [][]UsageEvent
	err     error
}

func (s *batchSink) Flush(events []UsageEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	batch := make([]UsageEvent, len(events))
	copy(batch, events)
	s.batches = append(s.batches, batch)
	return s.err
}

func (s *batchSink) flatten() []UsageEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []UsageEvent
	for _, batch := range s.batches {
		out = append(out, batch...)
	}
	return out
}

func TestBufferedEmitterFlushesWhenBatchSizeReached(t *testing.T) {
	t.Parallel()

	sink := &batchSink{}
	now := time.Unix(0, 0)
	clock := func() time.Time { return now }

	emitter := NewBufferedEmitter(sink, 3, time.Hour, clock, slog.Default())

	for i := 0; i < 2; i++ {
		if err := emitter.Emit(UsageEvent{EventID: "evt"}); err != nil {
			t.Fatalf("Emit() error = %v", err)
		}
	}
	if pending := emitter.PendingCount(); pending != 2 {
		t.Fatalf("PendingCount = %d, want 2 (under batch size)", pending)
	}
	if len(sink.batches) != 0 {
		t.Fatalf("batches before threshold = %d, want 0", len(sink.batches))
	}

	if err := emitter.Emit(UsageEvent{EventID: "evt"}); err != nil {
		t.Fatalf("Emit() error = %v", err)
	}
	if pending := emitter.PendingCount(); pending != 0 {
		t.Fatalf("PendingCount after flush = %d, want 0", pending)
	}
	if len(sink.batches) != 1 || len(sink.batches[0]) != 3 {
		t.Fatalf("batches = %v, want one batch of three events", sink.batches)
	}
}

func TestBufferedEmitterFlushesAfterInterval(t *testing.T) {
	t.Parallel()

	sink := &batchSink{}
	now := time.Unix(0, 0)
	clock := func() time.Time { return now }

	emitter := NewBufferedEmitter(sink, 100, time.Minute, clock, slog.Default())

	if err := emitter.Emit(UsageEvent{EventID: "first"}); err != nil {
		t.Fatalf("Emit() error = %v", err)
	}
	if len(sink.batches) != 0 {
		t.Fatalf("flushed too early with %d batches", len(sink.batches))
	}

	now = now.Add(2 * time.Minute)
	if err := emitter.Emit(UsageEvent{EventID: "second"}); err != nil {
		t.Fatalf("Emit() error = %v", err)
	}
	if len(sink.batches) != 1 {
		t.Fatalf("len(batches) = %d, want 1 after interval", len(sink.batches))
	}
	if len(sink.batches[0]) != 2 {
		t.Fatalf("batch contents = %d events, want 2", len(sink.batches[0]))
	}
}

func TestBufferedEmitterManualFlushDrainsBuffer(t *testing.T) {
	t.Parallel()

	sink := &batchSink{}
	emitter := NewBufferedEmitter(sink, 100, time.Hour, func() time.Time { return time.Unix(0, 0) }, slog.Default())

	for i := 0; i < 5; i++ {
		if err := emitter.Emit(UsageEvent{EventID: "evt"}); err != nil {
			t.Fatalf("Emit() error = %v", err)
		}
	}
	if emitter.PendingCount() != 5 {
		t.Fatalf("PendingCount = %d, want 5 before manual flush", emitter.PendingCount())
	}

	if err := emitter.Flush(); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}
	if emitter.PendingCount() != 0 {
		t.Fatalf("PendingCount = %d, want 0 after manual flush", emitter.PendingCount())
	}
	if got := sink.flatten(); len(got) != 5 {
		t.Fatalf("forwarded events = %d, want 5", len(got))
	}
}

func TestBufferedEmitterFlushOnEmptyBufferIsNoop(t *testing.T) {
	t.Parallel()

	sink := &batchSink{}
	emitter := NewBufferedEmitter(sink, 10, time.Hour, nil, slog.Default())

	if err := emitter.Flush(); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}
	if len(sink.batches) != 0 {
		t.Fatalf("len(batches) = %d, want 0 on empty flush", len(sink.batches))
	}
}

func TestBufferedEmitterDrainsBufferEvenWhenSinkErrors(t *testing.T) {
	t.Parallel()

	sink := &batchSink{err: errors.New("downstream blew up")}
	emitter := NewBufferedEmitter(sink, 2, time.Hour, func() time.Time { return time.Unix(0, 0) }, slog.Default())

	if err := emitter.Emit(UsageEvent{EventID: "evt-1"}); err != nil {
		t.Fatalf("Emit() error = %v", err)
	}
	if err := emitter.Emit(UsageEvent{EventID: "evt-2"}); err != nil {
		t.Fatalf("Emit() error = %v", err)
	}
	if pending := emitter.PendingCount(); pending != 0 {
		t.Fatalf("PendingCount = %d, want 0 (buffer must drain even on sink error)", pending)
	}
}

func TestBufferedEmitterToleratesNilSink(t *testing.T) {
	t.Parallel()

	emitter := NewBufferedEmitter(nil, 1, time.Hour, nil, slog.Default())
	if err := emitter.Emit(UsageEvent{EventID: "evt"}); err != nil {
		t.Fatalf("Emit() error = %v", err)
	}
}

func TestBufferedEmitterConcurrentEmitsAreSafe(t *testing.T) {
	t.Parallel()

	sink := &batchSink{}
	emitter := NewBufferedEmitter(sink, 7, time.Hour, func() time.Time { return time.Unix(0, 0) }, slog.Default())

	const goroutines = 16
	const perGoroutine = 25

	var wg sync.WaitGroup
	var emitted atomic.Int64
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < perGoroutine; i++ {
				if err := emitter.Emit(UsageEvent{EventID: "evt"}); err == nil {
					emitted.Add(1)
				}
			}
		}()
	}
	wg.Wait()

	if err := emitter.Flush(); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	total := len(sink.flatten())
	if int64(total) != emitted.Load() {
		t.Fatalf("total forwarded = %d, want %d (no events lost under concurrency)", total, emitted.Load())
	}
}

func TestLoggerSinkEmitsJSONForEachEvent(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	sink := NewLoggerSink(logger)

	events := []UsageEvent{
		{EventID: "evt-1", ModelID: "model-a", InputTokens: 10, OutputTokens: 20},
		{EventID: "evt-2", ModelID: "model-b", InputTokens: 1, OutputTokens: 2},
	}
	if err := sink.Flush(events); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("log lines = %d, want 2 (one per event)", len(lines))
	}

	for i, line := range lines {
		var parsed struct {
			Msg   string     `json:"msg"`
			Event UsageEvent `json:"event"`
		}
		if err := json.Unmarshal([]byte(line), &parsed); err != nil {
			t.Fatalf("log line %d not valid JSON: %v", i, err)
		}
		if parsed.Msg != "analytics.usage_event" {
			t.Errorf("line %d msg = %q, want %q", i, parsed.Msg, "analytics.usage_event")
		}
		if parsed.Event.EventID != events[i].EventID {
			t.Errorf("line %d EventID = %q, want %q", i, parsed.Event.EventID, events[i].EventID)
		}
	}
}
