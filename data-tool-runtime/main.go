package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func main() {
	token := os.Getenv("DATA_TOOL_RUNTIME_TOKEN")
	if len(token) < 32 {
		log.Fatal("Private runtime service token must have at least 32 characters")
	}
	if len(os.Args) == 2 && os.Args[1] == "health" {
		request, _ := http.NewRequest("GET", "http://127.0.0.1:8090/internal/v1/health", nil)
		request.Header.Set("Authorization", "Bearer "+token)
		client := &http.Client{Timeout: 2 * time.Second}
		response, err := client.Do(request)
		if err != nil {
			os.Exit(1)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		return
	}
	if err := RegisterMySQLPublicKey(os.Getenv("DATA_TOOL_MYSQL_PUBLIC_KEY")); err != nil {
		log.Fatal("Private runtime MySQL public key is unavailable or invalid")
	}
	hosts := make(map[string]bool)
	for _, host := range strings.Split(os.Getenv("WAREHOUSE_ALLOWED_HOSTS"), ",") {
		if host = strings.TrimSpace(host); host != "" {
			hosts[host] = true
		}
	}
	if len(hosts) == 0 {
		log.Fatal("Private runtime requires a warehouse host allowlist")
	}
	pools := NewPoolManager(32, 5*time.Minute)
	defer pools.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	address := os.Getenv("DATA_TOOL_RUNTIME_BIND")
	if address == "" {
		address = ":8090"
	}
	server := &http.Server{
		Addr:              address,
		Handler:           &Executor{Token: token, AllowedHosts: hosts, Pools: pools, Slots: make(chan struct{}, 8)},
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      125 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    16384,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 125*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				pools.DeleteExpired()
			}
		}
	}()
	log.Print("Private warehouse runtime listening on port 8090")
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal("Private warehouse runtime listener failed")
	}
}
