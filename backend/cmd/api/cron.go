package main

import (
	"database/sql"
	"log/slog"
	"time"

	"github.com/go-co-op/gocron/v2"
)

type ExpiredMessagesRepo interface {
	FindExpiredMessages() ([]string, error)
	CleanUpExpiredMessages(messageIds []string) (sql.Result, error)
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
				logger.Error("failed to find expired messages", err)
				return
			}

			if len(messageIds) == 0 {
				return
			}

			if _, err := repo.CleanUpExpiredMessages(messageIds); err != nil {
				logger.Error("failed to clean up expired messages", err)
				return
			}
		}, logger, expiredMessagesRepo),
	)
}
