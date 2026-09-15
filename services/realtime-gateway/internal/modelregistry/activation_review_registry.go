package modelregistry

import (
	"errors"
	"sort"
	"sync"
)

var (
	ErrActivationReviewAlreadyRegistered = errors.New("VSN provider activation review already registered")
	ErrActivationReviewNotFound          = errors.New("VSN provider activation review not found")
)

// ActivationReviewRegistry is an in-memory audit boundary for validated,
// non-activating provider review packets. Registration never mutates provider
// routing state or authorizes activation.
type ActivationReviewRegistry struct {
	mu      sync.RWMutex
	reviews map[string]ProviderActivationReview
}

func NewActivationReviewRegistry() *ActivationReviewRegistry {
	return &ActivationReviewRegistry{reviews: make(map[string]ProviderActivationReview)}
}

// Register validates the review against the exact disabled candidate before
// storing an immutable defensive copy. Review IDs are append-only identities:
// an existing review cannot be overwritten or replaced.
func (r *ActivationReviewRegistry) Register(candidate ProviderCandidate, review ProviderActivationReview) error {
	if r == nil {
		return ErrInvalidProviderActivationReview
	}
	if err := ValidateProviderActivationReview(candidate, review); err != nil {
		return err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.reviews[review.ReviewID]; exists {
		return ErrActivationReviewAlreadyRegistered
	}
	r.reviews[review.ReviewID] = cloneProviderActivationReview(review)
	return nil
}

func (r *ActivationReviewRegistry) Get(reviewID string) (ProviderActivationReview, error) {
	if r == nil {
		return ProviderActivationReview{}, ErrActivationReviewNotFound
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	review, ok := r.reviews[reviewID]
	if !ok {
		return ProviderActivationReview{}, ErrActivationReviewNotFound
	}
	return cloneProviderActivationReview(review), nil
}

// Snapshot returns deterministic defensive copies ordered by review ID.
func (r *ActivationReviewRegistry) Snapshot() []ProviderActivationReview {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]ProviderActivationReview, 0, len(r.reviews))
	for _, review := range r.reviews {
		result = append(result, cloneProviderActivationReview(review))
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].ReviewID < result[j].ReviewID
	})
	return result
}

func cloneProviderActivationReview(review ProviderActivationReview) ProviderActivationReview {
	review.Capabilities = append(review.Capabilities[:0:0], review.Capabilities...)
	return review
}
