package main

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/go-co-op/gocron/v2"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue/requestysync"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

type ExpiredMessagesRepo interface {
	FindExpiredMessages() ([]string, error)
	CleanUpExpiredMessages(messageIds []string) (sql.Result, error)
}

type DeletedRecordRepo interface {
	DeleteCreatedBefore(cutoff time.Time) error
}

type ExpiredConversationsRepo interface {
	FindExpiredConversationIDs(now time.Time) ([]string, error)
	DeleteConversations(ids []string) (int, error)
}

type VaultSessionWrapKeyRepo interface {
	DeleteIdleBefore(cutoff time.Time) error
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

// fairUseReportJob is the nightly fair-use monitor (spec §8): it flags Unlimited
// accounts whose rolling 30-day user-cost exceeds the threshold and logs them
// for operator review. Read-only — it never throttles or blocks anyone.
func fairUseReportJob(
	scheduler gocron.Scheduler,
	logger *slog.Logger,
	repo *billing.PocketBaseRepo,
	thresholdRappen int64,
) (gocron.Job, error) {
	return scheduler.NewJob(
		gocron.DurationRandomJob(
			23*time.Hour,
			25*time.Hour,
		),
		gocron.NewTask(func() {
			since := time.Now().UTC().Add(-billing.DefaultFairUseWindow)
			flags, err := repo.FlagFairUseOutliers(since, thresholdRappen)
			if err != nil {
				logger.Error("fair-use report failed", "err", err)
				return
			}
			if len(flags) == 0 {
				return
			}
			logger.Warn("fair-use: Unlimited accounts over threshold",
				"count", len(flags), "threshold_rappen", thresholdRappen)
			for _, flag := range flags {
				logger.Warn("fair-use outlier",
					"user_id", flag.UserID,
					"rolling_cost_rappen", flag.RollingCostRappen,
					"request_count", flag.RequestCount)
			}
		}),
	)
}

// cleanUpIdleVaultSessionsJob sweeps persistent-session wrap keys that have not
// been used within the idle TTL. Now that there is no idle auto-logout, this
// bounds how long an abandoned-but-open device stays unlockable without a fresh
// Account Key entry. The TTL is deliberately longer than the auth-token TTL so
// a returning user re-authenticates (password) without also re-entering their
// Account Key — only genuinely abandoned sessions are revoked.
func cleanUpIdleVaultSessionsJob(
	scheduler gocron.Scheduler,
	logger *slog.Logger,
	vaultSessionRepo VaultSessionWrapKeyRepo,
) (gocron.Job, error) {
	const idleTTL = 30 * 24 * time.Hour

	return scheduler.NewJob(
		gocron.DurationRandomJob(
			1*time.Hour,
			2*time.Hour,
		),
		gocron.NewTask(func(logger *slog.Logger, repo VaultSessionWrapKeyRepo) {
			cutoff := time.Now().UTC().Add(-idleTTL)
			if err := repo.DeleteIdleBefore(cutoff); err != nil {
				logger.Error("failed to sweep idle vault sessions", "err", err)
			}
		}, logger, vaultSessionRepo),
	)
}

// syncRequestyModelsJob keeps the curated Requesty models current: it runs once
// shortly after boot and every ~6h thereafter, enriching matched models with
// fresh reasoning/pricing/context metadata from Requesty's API. It runs in the
// background, so a slow or unavailable Requesty never blocks startup or
// requests, and it only writes derived fields (never curation/compliance).
func syncRequestyModelsJob(
	scheduler gocron.Scheduler,
	app core.App,
	logger *slog.Logger,
	baseURL string,
	apiKey string,
	forceDisableAbsent bool,
) (gocron.Job, error) {
	service := requestysync.NewService(app, requestysync.NewClient(baseURL, apiKey), logger)
	opts := requestysync.SyncOptions{ForceDisableAbsent: forceDisableAbsent}

	return scheduler.NewJob(
		gocron.DurationRandomJob(
			6*time.Hour,
			7*time.Hour,
		),
		gocron.NewTask(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if _, err := service.Run(ctx, opts); err != nil {
				logger.Error("requesty model sync failed", "err", err)
			}
		}),
		gocron.WithStartAt(gocron.WithStartImmediately()),
	)
}

// cleanUpExpiredConversationsJob enforces account- and per-conversation
// auto-delete (retention): every ~30-60 minutes it permanently deletes
// conversations whose effective retention window has elapsed (measured from
// last activity), cascading to their messages/keys/participants/shares. It logs
// counts only — never conversation content, ids, or user identifiers — per the
// security rule. The common "nobody opted in" case finds nothing and is cheap.
func cleanUpExpiredConversationsJob(
	scheduler gocron.Scheduler,
	logger *slog.Logger,
	repo ExpiredConversationsRepo,
) (gocron.Job, error) {
	return scheduler.NewJob(
		gocron.DurationRandomJob(
			30*time.Minute,
			60*time.Minute,
		),
		gocron.NewTask(func(logger *slog.Logger, repo ExpiredConversationsRepo) {
			ids, err := repo.FindExpiredConversationIDs(time.Now().UTC())
			if err != nil {
				logger.Error("failed to find expired conversations", "err", err)
				return
			}
			if len(ids) == 0 {
				return
			}
			deleted, err := repo.DeleteConversations(ids)
			if err != nil {
				logger.Error("failed to delete some expired conversations",
					"deleted", deleted, "eligible", len(ids), "err", err)
				return
			}
			logger.Info("retention: deleted expired conversations", "count", deleted)
		}, logger, repo),
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
