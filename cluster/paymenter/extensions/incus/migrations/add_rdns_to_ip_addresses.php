<?php
/**
 * 迁移：为 ip_addresses 表添加 rdns_hostname 字段
 *
 * 用于存储 IP 地址对应的反向 DNS 主机名。
 * 支持 IPv4 和 IPv6 地址的 rDNS 记录管理。
 */

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ip_addresses', function (Blueprint $table) {
            $table->string('rdns_hostname', 255)->nullable()->after('order_id')
                ->comment('反向 DNS 主机名（FQDN）');
            $table->index('rdns_hostname');
        });
    }

    public function down(): void
    {
        Schema::table('ip_addresses', function (Blueprint $table) {
            $table->dropIndex(['rdns_hostname']);
            $table->dropColumn('rdns_hostname');
        });
    }
};
