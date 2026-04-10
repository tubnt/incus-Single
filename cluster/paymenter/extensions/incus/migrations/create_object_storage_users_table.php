<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 创建对象存储用户表 — 记录 Ceph RGW 用户与平台用户的映射关系
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('object_storage_users', function (Blueprint $table) {
            $table->id();

            // 关联平台用户
            $table->unsignedBigInteger('user_id')->index();
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');

            // RGW 用户标识
            $table->string('rgw_uid')->unique()->comment('radosgw-admin 用户 UID');
            $table->string('display_name')->nullable()->comment('显示名称');

            // S3 凭据（加密存储）
            $table->text('access_key')->comment('S3 Access Key（加密）');
            $table->text('secret_key')->comment('S3 Secret Key（加密）');

            // 配额与用量
            $table->unsignedBigInteger('quota_max_size_gb')->default(0)->comment('配额上限 (GB)，0=无限制');
            $table->unsignedBigInteger('usage_size_kb')->default(0)->comment('当前用量 (KB)');
            $table->unsignedBigInteger('usage_objects')->default(0)->comment('当前对象数');

            // 状态
            $table->enum('status', ['active', 'suspended', 'deleted'])->default('active');

            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('object_storage_users');
    }
};
