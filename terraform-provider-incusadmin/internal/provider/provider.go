package provider

import (
	"context"
	"os"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/incuscloud/terraform-provider-incusadmin/internal/client"
	"github.com/incuscloud/terraform-provider-incusadmin/internal/datasources"
	"github.com/incuscloud/terraform-provider-incusadmin/internal/resources"
)

type incusadminProvider struct {
	version string
}

func New(version string) func() provider.Provider {
	return func() provider.Provider {
		return &incusadminProvider{version: version}
	}
}

type providerModel struct {
	Endpoint types.String `tfsdk:"endpoint"`
	APIToken types.String `tfsdk:"api_token"`
}

func (p *incusadminProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "incusadmin"
	resp.Version = p.version
}

func (p *incusadminProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "incus-admin 私有云管理面板 Terraform Provider。资源粒度按 PLAN-042 一期：5 资源 + 3 datasource。",
		Attributes: map[string]schema.Attribute{
			"endpoint": schema.StringAttribute{
				Description: "incus-admin 服务地址（如 https://vmc.5ok.co）。也可由 INCUSADMIN_ENDPOINT 提供。",
				Optional:    true,
			},
			"api_token": schema.StringAttribute{
				Description: "API Bearer token。也可由 INCUSADMIN_TOKEN 提供（推荐：避免写入 .tfstate）。在 portal 创建：POST /portal/api-tokens。",
				Optional:    true,
				Sensitive:   true,
			},
		},
	}
}

func (p *incusadminProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var data providerModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &data)...)
	if resp.Diagnostics.HasError() {
		return
	}

	endpoint := data.Endpoint.ValueString()
	if endpoint == "" {
		endpoint = os.Getenv("INCUSADMIN_ENDPOINT")
	}
	token := data.APIToken.ValueString()
	if token == "" {
		token = os.Getenv("INCUSADMIN_TOKEN")
	}
	if endpoint == "" {
		resp.Diagnostics.AddError("missing endpoint", "set provider endpoint or INCUSADMIN_ENDPOINT")
		return
	}
	if token == "" {
		resp.Diagnostics.AddError("missing api_token", "set provider api_token or INCUSADMIN_TOKEN")
		return
	}
	c := client.New(endpoint, token)
	resp.DataSourceData = c
	resp.ResourceData = c
}

func (p *incusadminProvider) Resources(_ context.Context) []func() resource.Resource {
	// P0 CR 修复（#6）：移除 incusadmin_user 资源，改为只读 datasource。
	// 一期 4 个资源：vm / firewall_group / floating_ip / ssh_key。
	return []func() resource.Resource{
		resources.NewVMResource,
		resources.NewFirewallGroupResource,
		resources.NewFloatingIPResource,
		resources.NewSSHKeyResource,
	}
}

func (p *incusadminProvider) DataSources(_ context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{
		datasources.NewOrdersDataSource,
		datasources.NewInvoicesDataSource,
		datasources.NewBalanceDataSource,
		datasources.NewUserDataSource, // P0 CR 修复 #6
	}
}
