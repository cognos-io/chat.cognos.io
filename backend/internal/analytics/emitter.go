package analytics

type Emitter interface {
	Emit(event UsageEvent) error
}

type RecordingEmitter struct {
	Events []UsageEvent
}

func (e *RecordingEmitter) Emit(event UsageEvent) error {
	e.Events = append(e.Events, event)
	return nil
}
