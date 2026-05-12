// Terraform provider for incus-admin.
//
// PLAN-042 / INFRA-010 一期：5 资源 + 3 datasource。Plugin Framework v1.x。
//
// 用法：
//
//	terraform {
//	  required_providers {
//	    incusadmin = {
//	      source  = "5ok.co/incuscloud/incusadmin"
//	      version = "0.1.0"
//	    }
//	  }
//	}
//
//	provider "incusadmin" {
//	  endpoint  = "https://vmc.5ok.co"
//	  api_token = var.incusadmin_token  # 推荐用 env INCUSADMIN_API_TOKEN
//	}
package main

import (
	"context"
	"flag"
	"log"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"

	"github.com/incuscloud/terraform-provider-incusadmin/internal/provider"
)

var (
	// 由 GoReleaser 在发布时通过 -ldflags 注入；本地构建用 dev 占位。
	version = "0.1.0-dev"
)

func main() {
	var debug bool
	flag.BoolVar(&debug, "debug", false, "set to true to run the provider with support for debuggers")
	flag.Parse()

	opts := providerserver.ServeOpts{
		Address: "5ok.co/incuscloud/incusadmin",
		Debug:   debug,
	}
	if err := providerserver.Serve(context.Background(), provider.New(version), opts); err != nil {
		log.Fatal(err.Error())
	}
}
