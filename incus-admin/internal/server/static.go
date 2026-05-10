package server

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
	"sync"
)

//go:embed all:dist
var distFS embed.FS

var (
	distHashOnce sync.Once
	distHashHex  string
)

// DistHash returns the hex sha256 of the embedded dist/index.html. It is cached
// after first call. Returns "" if the file is missing (development / broken build).
// Ops can compare this value to the one produced by `task web-build` to catch
// the "forgot to rebuild frontend before go build" footgun.
func DistHash() string {
	distHashOnce.Do(func() {
		data, err := distFS.ReadFile("dist/index.html")
		if err != nil {
			return
		}
		sum := sha256.Sum256(data)
		distHashHex = hex.EncodeToString(sum[:])
	})
	return distHashHex
}

func staticHandler() http.Handler {
	subFS, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic("embedded dist not found: " + err.Error())
	}

	fileServer := http.FileServer(http.FS(subFS))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// API and auth paths are handled by other handlers. When we fall through
		// to here, the specific API route was not matched — return structured
		// JSON 404 so frontend error handling can parse it uniformly.
		if strings.HasPrefix(path, "/api/") {
			writeJSONError(w, http.StatusNotFound, "not found")
			return
		}
		if strings.HasPrefix(path, "/auth/") {
			http.NotFound(w, r)
			return
		}

		// Try to serve the file directly
		if f, err := fs.Stat(subFS, strings.TrimPrefix(path, "/")); err == nil && !f.IsDir() {
			// Session-3 §1🔴-2：hashed 静态资源用 immutable 长缓存；HTML 入口
			// no-cache 保证 deploy 后旧 SPA 立即拿到新 entry hash。woff2 / 图标
			// 也走 immutable —— vite 输出的产物名都带 8 字符 hash。
			switch {
			case strings.HasPrefix(path, "/assets/"),
				strings.HasSuffix(path, ".woff2"),
				strings.HasSuffix(path, ".woff"):
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			case strings.HasPrefix(path, "/locales/"):
				// 翻译文件文件名固定（common.json），不能 immutable；但允许短缓存 + 协商。
				w.Header().Set("Cache-Control", "public, max-age=300, must-revalidate")
			case path == "/" || strings.HasSuffix(path, "/index.html"):
				w.Header().Set("Cache-Control", "no-cache")
			}
			fileServer.ServeHTTP(w, r)
			return
		}

		// QA-007 BUG-01: file-asset prefixes must NOT fall back to index.html.
		// Otherwise old clients that still reference a since-deleted chunk hash
		// (after a deploy) receive HTML, browsers fail to parse it as a module
		// and the page goes blank. i18n with an unsupported language hits the
		// same trap and breaks JSON.parse.
		if strings.HasPrefix(path, "/assets/") || strings.HasPrefix(path, "/locales/") {
			http.NotFound(w, r)
			return
		}

		// SPA fallback: serve index.html for all non-file routes.
		// 同样写 no-cache，避免 SPA 路由跳转后浏览器复用旧 HTML。
		w.Header().Set("Cache-Control", "no-cache")
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}

// writeJSONError writes a uniform `{"error": "<msg>"}` response so the
// frontend can parse API errors without checking content-type.
func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
