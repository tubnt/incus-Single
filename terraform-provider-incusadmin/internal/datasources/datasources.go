// Package datasources 实现 3 个只读数据源（D21 决策：订单 / 余额 / 发票只读，
// 避免 Terraform 误重建带钱的资源）。
package datasources

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/incuscloud/terraform-provider-incusadmin/internal/client"
)

// ============================================================================
// orders datasource
// ============================================================================

type ordersDataSource struct{ c *client.Client }

func NewOrdersDataSource() datasource.DataSource { return &ordersDataSource{} }

type orderItemModel struct {
	ID        types.Int64   `tfsdk:"id"`
	UserID    types.Int64   `tfsdk:"user_id"`
	ProductID types.Int64   `tfsdk:"product_id"`
	Status    types.String  `tfsdk:"status"`
	Amount    types.Float64 `tfsdk:"amount"`
}

type ordersDSModel struct {
	Orders []orderItemModel `tfsdk:"orders"`
}

func (d *ordersDataSource) Metadata(_ context.Context, _ datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = "incusadmin_orders"
}

func (d *ordersDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "当前 token user 的订单列表（只读）。",
		Attributes: map[string]schema.Attribute{
			"orders": schema.ListNestedAttribute{
				Computed: true,
				NestedObject: schema.NestedAttributeObject{
					Attributes: map[string]schema.Attribute{
						"id":         schema.Int64Attribute{Computed: true},
						"user_id":    schema.Int64Attribute{Computed: true},
						"product_id": schema.Int64Attribute{Computed: true},
						"status":     schema.StringAttribute{Computed: true},
						"amount":     schema.Float64Attribute{Computed: true},
					},
				},
			},
		},
	}
}

func (d *ordersDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, _ *datasource.ConfigureResponse) {
	if req.ProviderData != nil {
		d.c, _ = req.ProviderData.(*client.Client)
	}
}

func (d *ordersDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var out struct {
		Orders []client.Order `json:"orders"`
	}
	if err := d.c.Do(ctx, "GET", "/api/portal/orders", nil, &out); err != nil {
		resp.Diagnostics.AddError("list orders failed", err.Error())
		return
	}
	model := ordersDSModel{Orders: make([]orderItemModel, 0, len(out.Orders))}
	for _, o := range out.Orders {
		model.Orders = append(model.Orders, orderItemModel{
			ID:        types.Int64Value(o.ID),
			UserID:    types.Int64Value(o.UserID),
			ProductID: types.Int64Value(o.ProductID),
			Status:    types.StringValue(o.Status),
			Amount:    types.Float64Value(o.Amount),
		})
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &model)...)
}

// ============================================================================
// invoices datasource
// ============================================================================

type invoicesDataSource struct{ c *client.Client }

func NewInvoicesDataSource() datasource.DataSource { return &invoicesDataSource{} }

type invoiceItemModel struct {
	ID      types.Int64   `tfsdk:"id"`
	OrderID types.Int64   `tfsdk:"order_id"`
	Amount  types.Float64 `tfsdk:"amount"`
	Status  types.String  `tfsdk:"status"`
}

type invoicesDSModel struct {
	Invoices []invoiceItemModel `tfsdk:"invoices"`
}

func (d *invoicesDataSource) Metadata(_ context.Context, _ datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = "incusadmin_invoices"
}

func (d *invoicesDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "当前 token user 的发票列表（只读）。",
		Attributes: map[string]schema.Attribute{
			"invoices": schema.ListNestedAttribute{
				Computed: true,
				NestedObject: schema.NestedAttributeObject{
					Attributes: map[string]schema.Attribute{
						"id":       schema.Int64Attribute{Computed: true},
						"order_id": schema.Int64Attribute{Computed: true},
						"amount":   schema.Float64Attribute{Computed: true},
						"status":   schema.StringAttribute{Computed: true},
					},
				},
			},
		},
	}
}

func (d *invoicesDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, _ *datasource.ConfigureResponse) {
	if req.ProviderData != nil {
		d.c, _ = req.ProviderData.(*client.Client)
	}
}

func (d *invoicesDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var out struct {
		Invoices []client.Invoice `json:"invoices"`
	}
	if err := d.c.Do(ctx, "GET", "/api/portal/invoices", nil, &out); err != nil {
		resp.Diagnostics.AddError("list invoices failed", err.Error())
		return
	}
	model := invoicesDSModel{Invoices: make([]invoiceItemModel, 0, len(out.Invoices))}
	for _, v := range out.Invoices {
		model.Invoices = append(model.Invoices, invoiceItemModel{
			ID:      types.Int64Value(v.ID),
			OrderID: types.Int64Value(v.OrderID),
			Amount:  types.Float64Value(v.Amount),
			Status:  types.StringValue(v.Status),
		})
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &model)...)
}

// ============================================================================
// user datasource
//
// P0 CR 修复（#6）：原方案 incusadmin_user 资源 POST /admin/users 端点不存在
// （用户由 OIDC 登录自动创建）。改成只读 datasource，按 email 查找。
// ============================================================================

type userDataSource struct{ c *client.Client }

func NewUserDataSource() datasource.DataSource { return &userDataSource{} }

type userDSModel struct {
	ID      types.Int64   `tfsdk:"id"`
	Email   types.String  `tfsdk:"email"`
	Role    types.String  `tfsdk:"role"`
	Balance types.Float64 `tfsdk:"balance"`
}

func (d *userDataSource) Metadata(_ context.Context, _ datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = "incusadmin_user"
}

func (d *userDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "按 email 查找用户（admin only，只读）。",
		Attributes: map[string]schema.Attribute{
			"email":   schema.StringAttribute{Required: true},
			"id":      schema.Int64Attribute{Computed: true},
			"role":    schema.StringAttribute{Computed: true},
			"balance": schema.Float64Attribute{Computed: true},
		},
	}
}

func (d *userDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, _ *datasource.ConfigureResponse) {
	if req.ProviderData != nil {
		d.c, _ = req.ProviderData.(*client.Client)
	}
}

func (d *userDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var cfg userDSModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &cfg)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var out struct {
		Users []client.User `json:"users"`
	}
	if err := d.c.Do(ctx, "GET", "/api/admin/users", nil, &out); err != nil {
		resp.Diagnostics.AddError("list users failed", err.Error())
		return
	}
	target := cfg.Email.ValueString()
	for _, u := range out.Users {
		if u.Email == target {
			resp.Diagnostics.Append(resp.State.Set(ctx, &userDSModel{
				ID:      types.Int64Value(u.ID),
				Email:   types.StringValue(u.Email),
				Role:    types.StringValue(u.Role),
				Balance: types.Float64Value(u.Balance),
			})...)
			return
		}
	}
	resp.Diagnostics.AddError("user not found", "no user with email="+target)
}

// ============================================================================
// balance datasource
// ============================================================================

type balanceDataSource struct{ c *client.Client }

func NewBalanceDataSource() datasource.DataSource { return &balanceDataSource{} }

type balanceDSModel struct {
	Balance types.Float64 `tfsdk:"balance"`
	Email   types.String  `tfsdk:"email"`
}

func (d *balanceDataSource) Metadata(_ context.Context, _ datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = "incusadmin_balance"
}

func (d *balanceDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "当前 token user 的余额（只读）。",
		Attributes: map[string]schema.Attribute{
			"balance": schema.Float64Attribute{Computed: true},
			"email":   schema.StringAttribute{Computed: true},
		},
	}
}

func (d *balanceDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, _ *datasource.ConfigureResponse) {
	if req.ProviderData != nil {
		d.c, _ = req.ProviderData.(*client.Client)
	}
}

func (d *balanceDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var out struct {
		Balance float64 `json:"balance"`
		Email   string  `json:"email"`
	}
	if err := d.c.Do(ctx, "GET", "/api/auth/me", nil, &out); err != nil {
		resp.Diagnostics.AddError("read balance failed", err.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &balanceDSModel{
		Balance: types.Float64Value(out.Balance),
		Email:   types.StringValue(out.Email),
	})...)
}
