package analytics

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"
)

// Emitter is the seam handlers use to record an analytics usage event without
// blocking on persistence.
type Emitter interface {
	Emit(event UsageEvent) error
}

// RecordingEmitter is an in-memory test double that retains every emitted
// event in order.
type RecordingEmitter struct {
	mu     sync.Mutex
	Events []UsageEvent
}

func (e *RecordingEmitter) Emit(event UsageEvent) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.Events = append(e.Events, event)
	return nil
}

// Sink is the persistence target for buffered usage events. Implementations
// should treat the input slice as read-only and may be called concurrently.
type Sink interface {
	Flush(events []UsageEvent) error
}

// SinkFunc is a function-based Sink convenience for adapters and tests.
type SinkFunc func(events []UsageEvent) error

func (f SinkFunc) Flush(events []UsageEvent) error { return f(events) }

const (
	// DefaultBufferedEmitterBatchSize is the size-based flush threshold used
	// when none is configured.
	DefaultBufferedEmitterBatchSize = 32
	// DefaultBufferedEmitterFlushInterval is the time-based flush threshold
	// used when none is configured.
	DefaultBufferedEmitterFlushInterval = 30 * time.Second
)

// BufferedEmitter batches usage events and forwards them to a Sink when the
// configured batch size or flush interval is exceeded. The current
// implementation is lazy: flush is triggered from inside Emit, never from a
// background goroutine, so the emitter has no lifecycle to shut down.
//
// All flush errors are logged and the buffer is drained anyway: analytics
// loss is preferable to retrying indefinitely on the request hot path.
type BufferedEmitter struct {
	sink      Sink
	batchSize int
	interval  time.Duration
	now       func() time.Time
	logger    *slog.Logger

	mu        sync.Mutex
	buffer    []UsageEvent
	lastFlush time.Time
}

// NewBufferedEmitter wraps a Sink with size + time triggered flushing.
// Non-positive batchSize or interval fall back to the package defaults.
// A nil clock falls back to time.Now and a nil logger to slog.Default.
func NewBufferedEmitter(sink Sink, batchSize int, interval time.Duration, now func() time.Time, logger *slog.Logger) *BufferedEmitter {
	if batchSize <= 0 {
		batchSize = DefaultBufferedEmitterBatchSize
	}
	if interval <= 0 {
		interval = DefaultBufferedEmitterFlushInterval
	}
	if now == nil {
		now = time.Now
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &BufferedEmitter{
		sink:      sink,
		batchSize: batchSize,
		interval:  interval,
		now:       now,
		logger:    logger,
		lastFlush: now(),
	}
}

// Emit appends an event to the in-memory buffer and triggers a flush when
// either the batch size or the flush interval has been exceeded since the
// last successful flush.
func (e *BufferedEmitter) Emit(event UsageEvent) error {
	e.mu.Lock()
	e.buffer = append(e.buffer, event)
	shouldFlush := len(e.buffer) >= e.batchSize ||
		e.now().Sub(e.lastFlush) >= e.interval
	e.mu.Unlock()

	if shouldFlush {
		// #nosec G104 -- automatic flush failures are logged; Emit remains non-blocking.
		e.flush()
	}
	return nil
}

// Flush drains the buffer and forwards everything to the Sink. Errors are
// returned to the caller and also logged.
func (e *BufferedEmitter) Flush() error {
	return e.flush()
}

// PendingCount returns the number of events currently waiting in the buffer.
// Intended for tests and operational instrumentation.
func (e *BufferedEmitter) PendingCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.buffer)
}

func (e *BufferedEmitter) flush() error {
	e.mu.Lock()
	if len(e.buffer) == 0 {
		e.lastFlush = e.now()
		e.mu.Unlock()
		return nil
	}
	batch := e.buffer
	e.buffer = nil
	e.lastFlush = e.now()
	e.mu.Unlock()

	if e.sink == nil {
		return nil
	}

	if err := e.sink.Flush(batch); err != nil {
		e.logger.Error(
			"analytics buffered flush failed",
			"err", err,
			"batch_size", len(batch),
		)
		return err
	}
	return nil
}

// LoggerSink writes each event to a structured logger at info level. The
// UsageEvent shape excludes plaintext content, prompts, and direct user
// identifiers by construction, so logging is safe under the project's
// security guidelines.
type LoggerSink struct {
	logger *slog.Logger
}

// NewLoggerSink returns a Sink that emits each event as a JSON object on the
// given logger. A nil logger falls back to slog.Default.
func NewLoggerSink(logger *slog.Logger) *LoggerSink {
	if logger == nil {
		logger = slog.Default()
	}
	return &LoggerSink{logger: logger}
}

// Flush serialises each event individually so a malformed event cannot mask
// the rest of the batch.
func (s *LoggerSink) Flush(events []UsageEvent) error {
	for _, event := range events {
		payload, err := json.Marshal(event)
		if err != nil {
			s.logger.Error("analytics event serialization failed", "err", err, "event_id", event.EventID)
			continue
		}
		s.logger.Info("analytics.usage_event", "event", json.RawMessage(payload))
	}
	return nil
}
