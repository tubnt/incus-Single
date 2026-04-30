package portal

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/middleware"
	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/repository"
	"github.com/incuscloud/incus-admin/internal/service"
	"github.com/incuscloud/incus-admin/internal/service/jobs"
)

type OrderHandler struct {
	orders   *repository.OrderRepo
	products *repository.ProductRepo
	vmSvc    *service.VMService
	vmRepo   *repository.VMRepo
	sshKeys  *repository.SSHKeyRepo
	clusters *cluster.Manager
	// PLAN-025：异步 provisioning 入口。jobs == nil 时回退同步路径（保留无异步运行时的部署兜底）。
	jobs    *jobs.Runtime
	jobRepo *repository.ProvisioningJobRepo
}

func NewOrderHandler(orders *repository.OrderRepo, products *repository.ProductRepo, vmSvc *service.VMService, vmRepo *repository.VMRepo, sshKeys *repository.SSHKeyRepo, clusters *cluster.Manager) *OrderHandler {
	return &OrderHandler{orders: orders, products: products, vmSvc: vmSvc, vmRepo: vmRepo, sshKeys: sshKeys, clusters: clusters}
}

// WithJobs 注入 PLAN-025 异步 provisioning 运行时。main 在 wire 阶段调一次。
func (h *OrderHandler) WithJobs(rt *jobs.Runtime, jobRepo *repository.ProvisioningJobRepo) *OrderHandler {
	h.jobs = rt
	h.jobRepo = jobRepo
	return h
}

func (h *OrderHandler) PortalRoutes(r chi.Router) {
	r.Get("/orders", h.ListMine)
	r.Post("/orders", h.Create)
	r.Post("/orders/{id}/pay", h.Pay)
	r.Post("/orders/{id}/cancel", h.Cancel)
}

func (h *OrderHandler) AdminRoutes(r chi.Router) {
	r.Get("/orders", h.ListAll)
	r.Get("/orders/{id}", h.AdminGetByID)
	r.Put("/orders/{id}/status", h.UpdateStatus)
}

func (h *OrderHandler) AdminGetByID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid order id"})
		return
	}
	order, err := h.orders.GetByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if order == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "order not found"})
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (h *OrderHandler) ListMine(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	orders, err := h.orders.ListByUser(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to list orders"})
		return
	}
	if orders == nil {
		orders = []model.Order{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"orders": orders})
}

func (h *OrderHandler) ListAll(w http.ResponseWriter, r *http.Request) {
	p := ParsePageParams(r)
	orders, total, err := h.orders.ListPaged(r.Context(), p.Limit, p.Offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to list orders"})
		return
	}
	if orders == nil {
		orders = []model.Order{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"orders": orders,
		"total":  total,
		"limit":  p.Limit,
		"offset": p.Offset,
	})
}

func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)

	var req struct {
		ProductID   int64  `json:"product_id"   validate:"required,gt=0"`
		VMName      string `json:"vm_name"      validate:"omitempty,safename"`
		OSImage     string `json:"os_image"     validate:"omitempty,max=200"`
		ClusterID   int64  `json:"cluster_id"   validate:"omitempty,gt=0"`
		ClusterName string `json:"cluster_name" validate:"omitempty,safename"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}

	product, err := h.products.GetByID(r.Context(), req.ProductID)
	if err != nil || product == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "product not found"})
		return
	}
	if req.OSImage == "" {
		req.OSImage = "images:ubuntu/24.04/cloud"
	}

	clients := h.clusters.List()
	if len(clients) == 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "no clusters"})
		return
	}
	clusterID := req.ClusterID
	if clusterID == 0 && req.ClusterName != "" {
		clusterID = h.clusters.IDByName(req.ClusterName)
	}
	if clusterID == 0 {
		// Fallback: first registered cluster. Keeps single-cluster deployments unchanged.
		clusterID = h.clusters.IDByName(clients[0].Name)
	}
	if clusterID == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid cluster"})
		return
	}

	order, err := h.orders.Create(r.Context(), userID, req.ProductID, clusterID, product.PriceMonthly, product.Currency)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	audit(r.Context(), r, "order.create", "order", order.ID, map[string]any{
		"product_id": req.ProductID,
		"cluster_id": clusterID,
		"amount":     product.PriceMonthly,
		"currency":   product.Currency,
	})
	writeJSON(w, http.StatusCreated, map[string]any{"order": order})
}

func (h *OrderHandler) Pay(w http.ResponseWriter, r *http.Request) {
	orderID, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)

	var payReq struct {
		VMName  string `json:"vm_name"  validate:"omitempty,safename"`
		OSImage string `json:"os_image" validate:"omitempty,max=200"`
	}
	if !decodeAndValidate(w, r, &payReq) {
		return
	}

	order, err := h.orders.GetByID(r.Context(), orderID)
	if err != nil || order == nil || order.UserID != userID {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "order not found"})
		return
	}

	if err := h.orders.PayWithBalance(r.Context(), orderID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}

	product, _ := h.products.GetByID(r.Context(), order.ProductID)
	if product == nil {
		writeJSON(w, http.StatusOK, map[string]any{"status": "paid", "note": "product not found, VM not created"})
		return
	}

	clients := h.clusters.List()
	if len(clients) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"status": "paid", "note": "no cluster, VM not created"})
		return
	}

	// Resolve the order's cluster; fall back to first cluster for legacy orders
	// whose cluster_id may not be registered any more.
	client := clients[0]
	if order.ClusterID > 0 {
		if name := h.clusters.NameByID(order.ClusterID); name != "" {
			if c, ok := h.clusters.Get(name); ok {
				client = c
			}
		}
	}
	cc, _ := h.clusters.ConfigByName(client.Name)

	defProject := cc.DefaultProject
	if defProject == "" { defProject = "customers" }
	pool := cc.StoragePool
	if pool == "" { pool = "ceph-pool" }
	network := cc.Network
	if network == "" { network = "br-pub" }

	ip, gateway, cidr, ipErr := allocateIP(r.Context(), cc, 0)
	if ipErr != nil {
		slog.Error("allocate IP failed", "order", orderID, "error", ipErr)
		h.rollbackPayment(r.Context(), order, "", "ip allocation failed: "+ipErr.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "IP allocation failed, payment refunded"})
		return
	}

	sshKeys, _ := h.sshKeys.GetByUser(r.Context(), userID)

	osImage := payReq.OSImage
	if osImage == "" {
		osImage = "images:ubuntu/24.04/cloud"
	}

	// 生成最终 VM 名（与原 service.Create 同规则：用户给名 / 自动生成）
	vmName := payReq.VMName
	if vmName == "" {
		vmName = service.GenerateVMName()
	}

	if h.jobs == nil || h.jobRepo == nil {
		// 兜底：未注入 jobs runtime 时回退到旧同步路径，保证未启用异步的部署仍可用
		h.payWithSyncProvisioning(w, r, order, orderID, userID, client, product, vmName, osImage, sshKeys, defProject, ip, gateway, cidr, pool, network)
		return
	}

	// 异步路径：先把订单推到 provisioning，INSERT vms row(creating)，attach IP，
	// INSERT provisioning_jobs，Enqueue 后立刻 202 返回。
	if err := h.orders.UpdateStatus(r.Context(), orderID, model.OrderProvisioning); err != nil {
		slog.Error("order status -> provisioning failed", "order", orderID, "error", err)
		h.rollbackPayment(r.Context(), order, ip, "set provisioning failed: "+err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal error, payment refunded"})
		return
	}

	clusterID := h.clusters.IDByName(client.Name)

	ipRef := ip
	vm := &model.VM{
		Name:      vmName,
		ClusterID: clusterID,
		UserID:    userID,
		OrderID:   &orderID,
		Status:    model.VMStatusCreating,
		CPU:       product.CPU,
		MemoryMB:  product.MemoryMB,
		DiskGB:    product.DiskGB,
		OSImage:   osImage,
		IP:        &ipRef,
	}
	if err := h.vmRepo.Create(r.Context(), vm); err != nil {
		slog.Error("vm row insert failed", "order", orderID, "name", vmName, "error", err)
		h.rollbackPayment(r.Context(), order, ip, "vm row insert failed: "+err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "VM record creation failed, payment refunded"})
		return
	}
	attachIPToVM(r.Context(), ip, vm.ID)

	job, err := h.jobRepo.Create(r.Context(), model.JobKindVMCreate, userID, clusterID, &orderID, &vm.ID, vmName)
	if err != nil {
		slog.Error("create provisioning job failed", "order", orderID, "error", err)
		h.rollbackPayment(r.Context(), order, ip, "job create failed: "+err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal error, payment refunded"})
		return
	}

	if err := h.jobs.Enqueue(r.Context(), job.ID, jobs.Params{
		Project:     defProject,
		CPU:         product.CPU,
		MemoryMB:    product.MemoryMB,
		DiskGB:      product.DiskGB,
		OSImage:     osImage,
		SSHKeys:     sshKeys,
		IP:          ip,
		Gateway:     gateway,
		SubnetCIDR:  cidr,
		StoragePool: pool,
		Network:     network,
		OrderAmount: order.Amount,
	}); err != nil {
		slog.Error("enqueue job failed", "order", orderID, "job_id", job.ID, "error", err)
		_ = h.jobRepo.Finish(r.Context(), job.ID, model.JobStatusFailed, "enqueue failed: "+err.Error())
		h.rollbackPayment(r.Context(), order, ip, "enqueue failed")
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal error, payment refunded"})
		return
	}

	audit(r.Context(), r, "order.pay", "order", orderID, map[string]any{
		"vm_name": vmName,
		"ip":      ip,
		"amount":  order.Amount,
		"job_id":  job.ID,
	})

	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":   "provisioning",
		"job_id":   job.ID,
		"vm_id":    vm.ID,
		"order_id": orderID,
		"vm_name":  vmName,
		"ip":       ip,
	})
}

// payWithSyncProvisioning 是 jobs runtime 未注入时的回退路径：维持原 sync 行为
// 不变，避免没启用异步运行时的部署在升级期间断流。新部署应配置 jobs runtime。
func (h *OrderHandler) payWithSyncProvisioning(w http.ResponseWriter, r *http.Request, order *model.Order, orderID, userID int64, client *cluster.Client, product *model.Product, vmName, osImage string, sshKeys []string, defProject, ip, gateway, cidr, pool, network string) {
	result, err := h.vmSvc.Create(r.Context(), service.CreateVMParams{
		ClusterName: client.Name,
		Project:     defProject,
		UserID:      userID,
		VMName:      vmName,
		CPU:         product.CPU,
		MemoryMB:    product.MemoryMB,
		DiskGB:      product.DiskGB,
		OSImage:     osImage,
		SSHKeys:     sshKeys,
		IP:          ip,
		Gateway:     gateway,
		SubnetCIDR:  cidr,
		StoragePool: pool,
		Network:     network,
	})
	if err != nil {
		slog.Error("auto-provision VM failed after payment", "order", orderID, "error", err)
		h.rollbackPayment(r.Context(), order, ip, "vm provisioning failed: "+err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "VM provisioning failed, payment refunded"})
		return
	}

	_ = h.orders.UpdateStatus(r.Context(), orderID, model.OrderActive)

	vm := &model.VM{
		Name:      result.VMName,
		ClusterID: h.clusters.IDByName(client.Name),
		UserID:    userID,
		OrderID:   &orderID,
		Status:    model.VMStatusRunning,
		CPU:       product.CPU,
		MemoryMB:  product.MemoryMB,
		DiskGB:    product.DiskGB,
		OSImage:   osImage,
		Node:      result.Node,
		Password:  &result.Password,
	}
	if result.IP != "" {
		vm.IP = &result.IP
	}
	if err := h.vmRepo.Create(r.Context(), vm); err != nil {
		slog.Error("vm row insert failed", "order", orderID, "name", result.VMName, "error", err)
	} else {
		attachIPToVM(r.Context(), result.IP, vm.ID)
	}

	slog.Info("VM auto-provisioned after payment", "order", orderID, "vm", result.VMName)
	audit(r.Context(), r, "order.pay", "order", orderID, map[string]any{
		"vm_name": result.VMName,
		"ip":      result.IP,
		"amount":  order.Amount,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "provisioned",
		"vm_name":  result.VMName,
		"ip":       result.IP,
		"password": result.Password,
		"username": result.Username,
	})
}

func (h *OrderHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	orderID, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)

	order, err := h.orders.GetByID(r.Context(), orderID)
	if err != nil || order == nil || order.UserID != userID {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "order not found"})
		return
	}
	if order.Status != model.OrderPending {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "only pending orders can be cancelled"})
		return
	}

	changed, err := h.orders.CancelIfPending(r.Context(), orderID, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if !changed {
		// 条件 UPDATE 未生效：Pay 已在并发中抢先提交，订单已非 pending。
		writeJSON(w, http.StatusConflict, map[string]any{"error": "order was modified by another operation"})
		return
	}

	audit(r.Context(), r, "order.cancel", "order", orderID, nil)
	writeJSON(w, http.StatusOK, map[string]any{"status": "cancelled"})
}

func (h *OrderHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	orderID, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var req struct {
		Status string `json:"status" validate:"required,oneof=pending paid provisioning active expired cancelled"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}
	if err := h.orders.UpdateStatus(r.Context(), orderID, req.Status); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "order.update_status", "order", orderID, map[string]any{
		"status": req.Status,
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": req.Status})
}

// rollbackPayment 在扣款成功但后续 VM 创建失败时调用：退款 + 释放 IP + 订单置 cancelled。
// 失败的每一步都只记日志，不 panic，以免破坏 HTTP 响应。
func (h *OrderHandler) rollbackPayment(ctx context.Context, order *model.Order, ip, reason string) {
	if userRepo != nil {
		desc := fmt.Sprintf("订单 #%d 失败退款: %s", order.ID, reason)
		// 不传 createdBy=order.ID —— transactions.created_by FK 指向 users.id，
		// 传订单 ID 会触发 FK 23503。订单关联信息已写入 desc 中，足够审计。
		// PLAN-025 交互测试发现：历史代码这里就有此 bug，但 refund 路径从未真在生产
		// 触发过所以一直未暴露；异步化首次跑通失败 case 时直接撞上。
		if err := userRepo.AdjustBalance(ctx, order.UserID, order.Amount, "refund", desc, nil); err != nil {
			slog.Error("payment refund failed", "order", order.ID, "error", err)
		}
	}
	if ip != "" && ipAddrRepo != nil {
		if err := ipAddrRepo.Release(ctx, ip); err != nil {
			slog.Error("release IP on rollback failed", "order", order.ID, "ip", ip, "error", err)
		}
	}
	if err := h.orders.UpdateStatus(ctx, order.ID, model.OrderCancelled); err != nil {
		slog.Error("mark order cancelled failed", "order", order.ID, "error", err)
	}
	slog.Warn("order payment rolled back", "order", order.ID, "reason", reason)
}
