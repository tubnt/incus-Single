package notify

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/smtp"
	"strconv"
	"strings"
)

// SMTP sender：发邮件告警。
//
// 安全：
//   - host:port 必须明文配置，不接受 host-only（避免被 spoof 默认端口）
//   - 默认 STARTTLS（587）；可选 TLS-implicit（465）；明文 SMTP 拒绝
//   - 凭据从加密配置取，不进 log
//
// 一期不引入 net/mail 富 mime 库，简单 plain text 邮件够用。

type SMTPSender struct{}

func NewSMTPSender() *SMTPSender { return &SMTPSender{} }

func (s *SMTPSender) Kind() string { return "smtp" }

type smtpConfig struct {
	Host     string   `json:"host"`
	Port     int      `json:"port"`
	Username string   `json:"username"`
	Password string   `json:"password"`
	From     string   `json:"from"`
	To       []string `json:"to"`
	// 'tls' = implicit TLS (465), 'starttls' = explicit upgrade (587)
	TLSMode string `json:"tls"`
}

func (s *SMTPSender) Send(ctx context.Context, configJSON json.RawMessage, ev AlertEvent) error {
	var cfg smtpConfig
	if err := json.Unmarshal(configJSON, &cfg); err != nil {
		return fmt.Errorf("%w: %v", ErrConfigInvalid, err)
	}
	if cfg.Host == "" || cfg.From == "" || len(cfg.To) == 0 {
		return fmt.Errorf("%w: host/from/to required", ErrConfigInvalid)
	}
	if cfg.Port == 0 {
		cfg.Port = 587
	}
	if cfg.TLSMode == "" {
		if cfg.Port == 465 {
			cfg.TLSMode = "tls"
		} else {
			cfg.TLSMode = "starttls"
		}
	}

	addr := cfg.Host + ":" + strconv.Itoa(cfg.Port)
	auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)

	subject := FormatTitle(ev)
	body := buildSMTPBody(ev)
	msg := buildSMTPMessage(cfg.From, cfg.To, subject, body)

	tlsCfg := &tls.Config{
		ServerName: cfg.Host,
		MinVersion: tls.VersionTLS12,
	}

	switch cfg.TLSMode {
	case "tls":
		// implicit TLS（465）
		conn, err := tls.Dial("tcp", addr, tlsCfg)
		if err != nil {
			return fmt.Errorf("smtp tls dial: %w", err)
		}
		defer conn.Close()
		c, err := smtp.NewClient(conn, cfg.Host)
		if err != nil {
			return fmt.Errorf("smtp client: %w", err)
		}
		defer c.Quit()
		return sendWithSMTP(c, auth, cfg.From, cfg.To, msg)
	case "starttls":
		c, err := smtp.Dial(addr)
		if err != nil {
			return fmt.Errorf("smtp dial: %w", err)
		}
		defer c.Quit()
		if err := c.StartTLS(tlsCfg); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
		return sendWithSMTP(c, auth, cfg.From, cfg.To, msg)
	default:
		return fmt.Errorf("%w: unsupported tls mode %s", ErrConfigInvalid, cfg.TLSMode)
	}
}

func sendWithSMTP(c *smtp.Client, auth smtp.Auth, from string, to []string, msg []byte) error {
	if auth != nil {
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := c.Mail(from); err != nil {
		return fmt.Errorf("smtp mail: %w", err)
	}
	for _, addr := range to {
		if err := c.Rcpt(addr); err != nil {
			return fmt.Errorf("smtp rcpt: %w", err)
		}
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	return w.Close()
}

func buildSMTPMessage(from string, to []string, subject, body string) []byte {
	var b strings.Builder
	b.WriteString("From: ")
	b.WriteString(from)
	b.WriteString("\r\n")
	b.WriteString("To: ")
	b.WriteString(strings.Join(to, ", "))
	b.WriteString("\r\n")
	b.WriteString("Subject: ")
	b.WriteString(subject)
	b.WriteString("\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("\r\n")
	b.WriteString(body)
	return []byte(b.String())
}

func buildSMTPBody(ev AlertEvent) string {
	var b strings.Builder
	b.WriteString(FormatTitle(ev))
	b.WriteString("\n\n")
	if ev.Cluster != "" {
		b.WriteString("Cluster: ")
		b.WriteString(ev.Cluster)
		b.WriteString("\n")
	}
	b.WriteString("Kind: ")
	b.WriteString(ev.Kind)
	b.WriteString("\n")
	b.WriteString("Severity: ")
	b.WriteString(ev.Severity)
	b.WriteString("\n")
	b.WriteString("Phase: ")
	b.WriteString(ev.Phase)
	b.WriteString("\n")
	if ev.Message != "" {
		b.WriteString("\n")
		b.WriteString(ev.Message)
		b.WriteString("\n")
	}
	return b.String()
}
