FROM golang:1.22-alpine AS builder

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o console-proxy .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates
COPY --from=builder /build/console-proxy /usr/local/bin/console-proxy
COPY --from=builder /build/static /var/www/static

WORKDIR /var/www
EXPOSE 6080

ENTRYPOINT ["console-proxy"]
