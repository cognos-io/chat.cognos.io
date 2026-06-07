package analytics

import "testing"

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
