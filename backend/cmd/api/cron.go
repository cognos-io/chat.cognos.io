package main

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/go-co-op/gocron/v2"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

type ExpiredMessagesRepo interface {
	FindExpiredMessages() ([]string, error)
	CleanUpExpiredMessages(messageIds []string) (sql.Result, error)
}

type DeletedRecordRepo interface {
	DeleteCreatedBefore(cutoff time.Time) error
}

func cleanUpExpiredMessageJob(
	scheduler gocron.Scheduler,
	logger *slog.Logger,
	expiredMessagesRepo ExpiredMessagesRepo,
) (gocron.Job, error) {
	return scheduler.NewJob(
		gocron.DurationRandomJob(
			3*time.Minute,
			7*time.Minute,
		),
		gocron.NewTask(func(logger *slog.Logger, repo ExpiredMessagesRepo) {
			messageIds, err := repo.FindExpiredMessages()
			if err != nil {
				logger.Error("failed to find expired messages", "err", err)
				return
			}

			if len(messageIds) == 0 {
				return
			}

			if _, err := repo.CleanUpExpiredMessages(messageIds); err != nil {
				logger.Error("failed to clean up expired messages", "err", err)
				return
			}
		}, logger, expiredMessagesRepo),
	)
}

// retryPaygOverageJob is the spec §11.3 / §14.7 backstop: every ~5 minutes it
// re-posts any PAYG overage charge that never landed (the webhook's synchronous
// post failed and isn't re-dispatched on retry). The deterministic idempotency
// key makes a re-post safe, so this self-heals dropped charges + missed
// rollover webhooks without ever double-billing.
func retryPaygOverageJob(
	scheduler gocron.Scheduler,
	logger *slog.Logger,
	repo *billing.PocketBaseRepo,
	client paddle.Client,
	overagePriceID string,
) (gocron.Job, error) {
	return scheduler.NewJob(
		gocron.DurationRandomJob(
			4*time.Minute,
			6*time.Minute,
		),
		gocron.NewTask(func() {
			if client == nil || overagePriceID == "" {
				return
			}
			posted, err := repo.RetryUnpostedOverages(
				context.Background(), client, overagePriceID, logger,
			)
			if err != nil {
				logger.Error("payg overage backstop failed", "err", err)
				return
			}
			if posted > 0 {
				logger.Info("payg overage backstop posted charges", "count", posted)
			}
		}),
	)
}

func cleanUpDeletedRecordJob(
	scheduler gocron.Scheduler,
	logger *slog.Logger,
	deletedRecordRepo DeletedRecordRepo,
) (gocron.Job, error) {
	const retention = 30 * 24 * time.Hour

	return scheduler.NewJob(
		gocron.DurationRandomJob(
			1*time.Hour,
			2*time.Hour,
		),
		gocron.NewTask(func(logger *slog.Logger, repo DeletedRecordRepo) {
			cutoff := time.Now().UTC().Add(-retention)
			if err := repo.DeleteCreatedBefore(cutoff); err != nil {
				logger.Error("failed to clean up deleted records", "err", err)
			}
		}, logger, deletedRecordRepo),
	)
}
