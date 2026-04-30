// Package batchutil 抽出 PLAN-023 多个 batch 端点（vm/floating-ip/user）共享的
// 输入校验、错误聚合、HTTP 状态码决议逻辑。
//
// 典型用法（参考 vm_batch.go）：
//
//	if verr := batchutil.Validate(len(req.Names), req.Action, allowedActions); verr != nil {
//	    writeJSON(w, verr.Status, verr.Body)
//	    return
//	}
//	resp := batchutil.New[string]()
//	resp.Total = len(req.Names)
//	for _, name := range req.Names {
//	    if err := doOp(ctx, name); err != nil {
//	        resp.Fail(name, err)
//	    } else {
//	        resp.OK(name)
//	    }
//	}
//	writeJSON(w, resp.Status(), resp)
package batchutil

import (
	"net/http"
)

// MaxItems 是所有 batch 端点共用的硬上限。前端切片调用，超过 400。
const MaxItems = 50

// Failure 单条失败的描述。Key 为业务实体的主键（VM name / FIP id / user id 等）。
type Failure[K any] struct {
	Key   K      `json:"key"`
	Error string `json:"error"`
}

// Response 聚合结果；HTTP 状态码由 Status() 决定（succeeded>0 → 200、全失败 → 207）。
type Response[K any] struct {
	Total     int          `json:"total"`
	Succeeded []K          `json:"succeeded"`
	Failed    []Failure[K] `json:"failed"`
}

// New 初始化一个空 Response。Total 由 Validate 时回填，方便提前返回 400。
func New[K any]() Response[K] {
	return Response[K]{
		Succeeded: make([]K, 0),
		Failed:    make([]Failure[K], 0),
	}
}

// OK 记录一条成功。
func (r *Response[K]) OK(key K) {
	r.Succeeded = append(r.Succeeded, key)
}

// Fail 记录一条失败（error 不为空才会被追加）。
func (r *Response[K]) Fail(key K, err error) {
	if err == nil {
		return
	}
	r.Failed = append(r.Failed, Failure[K]{Key: key, Error: err.Error()})
}

// Status 决议 HTTP 状态码。
//
//	至少 1 个成功 → 200 OK（包括"全部成功"和"部分成功"）
//	无成功且有失败 → 207 Multi-Status
//	全空 → 400（调用方应在 Validate 阶段拦下，正常路径不到这里）
func (r *Response[K]) Status() int {
	if len(r.Succeeded) > 0 {
		return http.StatusOK
	}
	if len(r.Failed) > 0 {
		return http.StatusMultiStatus
	}
	return http.StatusBadRequest
}

// Validate 检查输入是否合法。返回非 nil 时调用方应直接 writeJSON(err.Status, err.Body) 退出。
func Validate(itemCount int, action string, allowed []string) *Error {
	if itemCount == 0 {
		return &Error{Status: http.StatusBadRequest, Body: map[string]any{"error": "items cannot be empty"}}
	}
	if itemCount > MaxItems {
		return &Error{
			Status: http.StatusBadRequest,
			Body: map[string]any{
				"error": "too many items",
				"max":   MaxItems,
			},
		}
	}
	if !contains(allowed, action) {
		return &Error{
			Status: http.StatusBadRequest,
			Body: map[string]any{
				"error":   "invalid action",
				"allowed": allowed,
			},
		}
	}
	return nil
}

// Error 统一的错误返回（用于 Validate）。
type Error struct {
	Status int
	Body   map[string]any
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
