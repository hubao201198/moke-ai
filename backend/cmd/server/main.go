package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/hubao201198/moke-ai/backend/internal/api"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           api.NewServer(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("maoke api listening on :%s", port)
	log.Fatal(server.ListenAndServe())
}
