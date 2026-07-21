package handler

import "sync"

// keyedMutex serialises work for one domain key without blocking unrelated
// keys. Entries are reference-counted so one-off Organisation and webhook IDs
// do not accumulate for the lifetime of the process.
type keyedMutex struct {
	mu      sync.Mutex
	entries map[string]*keyedMutexEntry
}

type keyedMutexEntry struct {
	mu   sync.Mutex
	refs int
}

func newKeyedMutex() *keyedMutex {
	return &keyedMutex{entries: make(map[string]*keyedMutexEntry)}
}

func (m *keyedMutex) lock(key string) func() {
	m.mu.Lock()
	entry := m.entries[key]
	if entry == nil {
		entry = &keyedMutexEntry{}
		m.entries[key] = entry
	}
	entry.refs++
	m.mu.Unlock()

	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()

		m.mu.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(m.entries, key)
		}
		m.mu.Unlock()
	}
}
