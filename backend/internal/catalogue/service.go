package catalogue

import (
	"context"
	"slices"
	"strings"
	"sync"
	"time"
)

const DefaultCacheTTL = time.Minute

type Repo interface {
	ActiveModels(ctx context.Context) ([]Model, error)
}

type Service interface {
	ActiveModels(ctx context.Context) ([]Model, error)
	GetModelByID(ctx context.Context, modelID string) (Model, bool, error)
	Invalidate()
}

type CachedService struct {
	repo Repo
	ttl  time.Duration
	now  func() time.Time

	mu       sync.RWMutex
	models   []Model
	modelsBy map[string]Model
	expires  time.Time
}

func NewCachedService(repo Repo, ttl time.Duration, now func() time.Time) *CachedService {
	if ttl <= 0 {
		ttl = DefaultCacheTTL
	}
	if now == nil {
		now = time.Now
	}

	return &CachedService{
		repo: repo,
		ttl:  ttl,
		now:  now,
	}
}

func (s *CachedService) ActiveModels(ctx context.Context) ([]Model, error) {
	snapshot, err := s.snapshot(ctx)
	if err != nil {
		return nil, err
	}

	return CloneModels(snapshot.models), nil
}

func (s *CachedService) GetModelByID(ctx context.Context, modelID string) (Model, bool, error) {
	snapshot, err := s.snapshot(ctx)
	if err != nil {
		return Model{}, false, err
	}

	model, ok := snapshot.modelsBy[strings.TrimSpace(modelID)]
	if !ok {
		return Model{}, false, nil
	}

	return model, true, nil
}

func (s *CachedService) Invalidate() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.models = nil
	s.modelsBy = nil
	s.expires = time.Time{}
}

type serviceSnapshot struct {
	models   []Model
	modelsBy map[string]Model
}

func (s *CachedService) snapshot(ctx context.Context) (serviceSnapshot, error) {
	if s == nil || s.repo == nil {
		return serviceSnapshot{}, nil
	}

	now := s.now()

	s.mu.RLock()
	if now.Before(s.expires) {
		snapshot := serviceSnapshot{
			models:   CloneModels(s.models),
			modelsBy: mapsClone(s.modelsBy),
		}
		s.mu.RUnlock()
		return snapshot, nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()

	now = s.now()
	if now.Before(s.expires) {
		return serviceSnapshot{
			models:   CloneModels(s.models),
			modelsBy: mapsClone(s.modelsBy),
		}, nil
	}

	models, err := s.repo.ActiveModels(ctx)
	if err != nil {
		return serviceSnapshot{}, err
	}

	slices.SortFunc(models, func(a, b Model) int {
		if a.ProviderName != b.ProviderName {
			return strings.Compare(a.ProviderName, b.ProviderName)
		}
		if a.Name != b.Name {
			return strings.Compare(a.Name, b.Name)
		}
		return strings.Compare(a.ID, b.ID)
	})

	modelsBy := make(map[string]Model, len(models))
	for _, model := range models {
		modelsBy[model.ID] = model
	}

	s.models = CloneModels(models)
	s.modelsBy = mapsClone(modelsBy)
	s.expires = now.Add(s.ttl)

	return serviceSnapshot{
		models:   CloneModels(models),
		modelsBy: mapsClone(modelsBy),
	}, nil
}

func mapsClone(input map[string]Model) map[string]Model {
	if len(input) == 0 {
		return map[string]Model{}
	}

	cloned := make(map[string]Model, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
}
