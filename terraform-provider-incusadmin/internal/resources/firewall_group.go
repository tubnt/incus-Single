package resources

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/incuscloud/terraform-provider-incusadmin/internal/client"
)

func NewFirewallGroupResource() resource.Resource { return &fwGroupResource{} }

type fwGroupResource struct{ c *client.Client }

type fwRuleModel struct {
	Direction       types.String `tfsdk:"direction"`
	Action          types.String `tfsdk:"action"`
	Protocol        types.String `tfsdk:"protocol"`
	DestinationPort types.String `tfsdk:"destination_port"`
	SourceCIDR      types.String `tfsdk:"source_cidr"`
	Description     types.String `tfsdk:"description"`
	SortOrder       types.Int64  `tfsdk:"sort_order"`
}

type fwGroupModel struct {
	ID          types.Int64   `tfsdk:"id"`
	Slug        types.String  `tfsdk:"slug"`
	Name        types.String  `tfsdk:"name"`
	Description types.String  `tfsdk:"description"`
	Rules       []fwRuleModel `tfsdk:"rules"`
}

func (r *fwGroupResource) Metadata(_ context.Context, _ resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = "incusadmin_firewall_group"
}

func (r *fwGroupResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "用户级防火墙组（私有 / 共享）。Import ID 用 numeric ID。",
		Attributes: map[string]schema.Attribute{
			"id": schema.Int64Attribute{Computed: true},
			"slug": schema.StringAttribute{
				Required:      true,
				PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()},
			},
			"name":        schema.StringAttribute{Required: true},
			"description": schema.StringAttribute{Optional: true, Computed: true},
			"rules": schema.ListNestedAttribute{
				Required: true,
				NestedObject: schema.NestedAttributeObject{
					Attributes: map[string]schema.Attribute{
						"direction":        schema.StringAttribute{Optional: true, Computed: true},
						"action":           schema.StringAttribute{Required: true},
						"protocol":         schema.StringAttribute{Optional: true, Computed: true},
						"destination_port": schema.StringAttribute{Optional: true, Computed: true},
						"source_cidr":      schema.StringAttribute{Optional: true, Computed: true},
						"description":      schema.StringAttribute{Optional: true, Computed: true},
						"sort_order":       schema.Int64Attribute{Optional: true, Computed: true},
					},
				},
			},
		},
	}
}

func (r *fwGroupResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.c, _ = req.ProviderData.(*client.Client)
	}
}

func (r *fwGroupResource) toAPI(m *fwGroupModel) client.FirewallGroup {
	rules := make([]client.FirewallRule, 0, len(m.Rules))
	for _, x := range m.Rules {
		rules = append(rules, client.FirewallRule{
			Direction:       x.Direction.ValueString(),
			Action:          x.Action.ValueString(),
			Protocol:        x.Protocol.ValueString(),
			DestinationPort: x.DestinationPort.ValueString(),
			SourceCIDR:      x.SourceCIDR.ValueString(),
			Description:     x.Description.ValueString(),
			SortOrder:       int(x.SortOrder.ValueInt64()),
		})
	}
	return client.FirewallGroup{
		Slug:        m.Slug.ValueString(),
		Name:        m.Name.ValueString(),
		Description: m.Description.ValueString(),
		Rules:       rules,
	}
}

func (r *fwGroupResource) fromAPI(g *client.FirewallGroup) []fwRuleModel {
	rules := make([]fwRuleModel, 0, len(g.Rules))
	for _, x := range g.Rules {
		rules = append(rules, fwRuleModel{
			Direction:       types.StringValue(x.Direction),
			Action:          types.StringValue(x.Action),
			Protocol:        types.StringValue(x.Protocol),
			DestinationPort: types.StringValue(x.DestinationPort),
			SourceCIDR:      types.StringValue(x.SourceCIDR),
			Description:     types.StringValue(x.Description),
			SortOrder:       types.Int64Value(int64(x.SortOrder)),
		})
	}
	return rules
}

func (r *fwGroupResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan fwGroupModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := r.toAPI(&plan)
	var out struct {
		Group client.FirewallGroup `json:"group"`
	}
	if err := r.c.Do(ctx, "POST", "/api/portal/firewall/groups", body, &out); err != nil {
		resp.Diagnostics.AddError("create firewall group failed", err.Error())
		return
	}
	plan.ID = types.Int64Value(out.Group.ID)
	plan.Description = types.StringValue(out.Group.Description)
	plan.Rules = r.fromAPI(&out.Group)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *fwGroupResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state fwGroupModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var out struct {
		Groups []client.FirewallGroup `json:"groups"`
	}
	if err := r.c.Do(ctx, "GET", "/api/portal/firewall/groups", nil, &out); err != nil {
		resp.Diagnostics.AddError("list firewall groups failed", err.Error())
		return
	}
	for _, g := range out.Groups {
		if g.ID == state.ID.ValueInt64() {
			state.Slug = types.StringValue(g.Slug)
			state.Name = types.StringValue(g.Name)
			state.Description = types.StringValue(g.Description)
			state.Rules = r.fromAPI(&g)
			resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
			return
		}
	}
	resp.State.RemoveResource(ctx)
}

func (r *fwGroupResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan fwGroupModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	id := plan.ID.ValueInt64()
	if err := r.c.Do(ctx, "PUT", fmt.Sprintf("/api/portal/firewall/groups/%d", id), map[string]any{
		"name":        plan.Name.ValueString(),
		"description": plan.Description.ValueString(),
	}, nil); err != nil {
		resp.Diagnostics.AddError("update group failed", err.Error())
		return
	}
	if err := r.c.Do(ctx, "PUT", fmt.Sprintf("/api/portal/firewall/groups/%d/rules", id),
		map[string]any{"rules": r.toAPI(&plan).Rules}, nil); err != nil {
		resp.Diagnostics.AddError("replace rules failed", err.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *fwGroupResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state fwGroupModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if err := r.c.Do(ctx, "DELETE", fmt.Sprintf("/api/portal/firewall/groups/%d", state.ID.ValueInt64()), nil, nil); err != nil {
		resp.Diagnostics.AddError("delete group failed", err.Error())
	}
}

func (r *fwGroupResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}
