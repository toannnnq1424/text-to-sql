// Copyright 2025 Google LLC
// SPDX-License-Identifier: Apache-2.0
// Adapted from internal/sources/cache.go. Changes: bounded pools, active leases,
// request cancellation, safe credential fingerprints and explicit shutdown.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"time"
)

var ErrBusy = errors.New("runtime capacity reached")

type poolEntry struct {
	source   *Source
	err      error
	ready    chan struct{}
	leases   int
	lastUsed time.Time
}

type PoolManager struct {
	mu       sync.Mutex
	items    map[string]*poolEntry
	maxPools int
	idleTTL  time.Duration
	closed   bool
	opener   func(context.Context, string, Connection) (*Source, error)
}

func NewPoolManager(maxPools int, idleTTL time.Duration) *PoolManager {
	return &PoolManager{
		items:    make(map[string]*poolEntry),
		maxPools: maxPools,
		idleTTL:  idleTTL,
		opener:   OpenSource,
	}
}

func poolKey(request QueryRequest) string {
	encoded, _ := json.Marshal(struct {
		WarehouseID string
		Engine      string
		Connection  Connection
	}{request.WarehouseID, request.Engine, request.Connection})
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func (manager *PoolManager) Acquire(ctx context.Context, request QueryRequest) (*Source, func(), error) {
	key := poolKey(request)
	manager.mu.Lock()
	if manager.closed {
		manager.mu.Unlock()
		return nil, nil, ErrBusy
	}
	entry, found := manager.items[key]
	if !found {
		if len(manager.items) >= manager.maxPools {
			var oldestKey string
			var oldest *poolEntry
			for candidateKey, candidate := range manager.items {
				if candidate.leases == 0 && (oldest == nil || candidate.lastUsed.Before(oldest.lastUsed)) {
					oldestKey, oldest = candidateKey, candidate
				}
			}
			if oldest == nil {
				manager.mu.Unlock()
				return nil, nil, ErrBusy
			}
			delete(manager.items, oldestKey)
			oldest.source.Close()
		}
		entry = &poolEntry{ready: make(chan struct{}), lastUsed: time.Now()}
		manager.items[key] = entry
	}
	entry.leases++
	manager.mu.Unlock()
	release := func() {
		manager.mu.Lock()
		entry.leases--
		entry.lastUsed = time.Now()
		manager.mu.Unlock()
	}
	if !found {
		entry.source, entry.err = manager.opener(ctx, request.Engine, request.Connection)
		manager.mu.Lock()
		if entry.err != nil {
			delete(manager.items, key)
		}
		close(entry.ready)
		manager.mu.Unlock()
	}
	select {
	case <-ctx.Done():
		release()
		return nil, nil, ctx.Err()
	case <-entry.ready:
		if entry.err != nil {
			release()
			return nil, nil, entry.err
		}
		return entry.source, release, nil
	}
}

func (manager *PoolManager) DeleteExpired() {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	for key, entry := range manager.items {
		if entry.leases == 0 && time.Since(entry.lastUsed) > manager.idleTTL {
			entry.source.Close()
			delete(manager.items, key)
		}
	}
}

func (manager *PoolManager) Close() {
	manager.mu.Lock()
	manager.closed = true
	entries := manager.items
	manager.items = make(map[string]*poolEntry)
	manager.mu.Unlock()
	for _, entry := range entries {
		<-entry.ready
		if entry.source != nil {
			entry.source.Close()
		}
	}
}
