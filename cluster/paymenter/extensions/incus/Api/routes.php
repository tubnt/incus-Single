<?php

use Extensions\Incus\Api\ApiController;
use Extensions\Incus\Api\ApiMiddleware;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Incus Extension — 用户 REST API 路由
|--------------------------------------------------------------------------
|
| 所有路由均需通过 ApiMiddleware 进行 Bearer Token 认证和 Rate Limiting。
| 前缀: /api/v1
|
*/

Route::prefix('api/v1')->middleware(ApiMiddleware::class)->group(function () {

    // --- 实例管理 ---
    Route::get('/instances', [ApiController::class, 'listInstances'])
        ->middleware('api.scope:instances.list');

    Route::get('/instances/{id}', [ApiController::class, 'getInstance'])
        ->middleware('api.scope:instances.read')
        ->where('id', '[0-9]+');

    Route::post('/instances/{id}/actions', [ApiController::class, 'instanceAction'])
        ->middleware('api.scope:instances.actions')
        ->where('id', '[0-9]+');

    // --- 快照 ---
    Route::get('/instances/{id}/snapshots', [ApiController::class, 'listSnapshots'])
        ->middleware('api.scope:snapshots.list')
        ->where('id', '[0-9]+');

    Route::post('/instances/{id}/snapshots', [ApiController::class, 'createSnapshot'])
        ->middleware('api.scope:snapshots.create')
        ->where('id', '[0-9]+');

    // --- 防火墙 ---
    Route::get('/instances/{id}/firewall', [ApiController::class, 'getFirewall'])
        ->middleware('api.scope:firewall.read')
        ->where('id', '[0-9]+');

    Route::patch('/instances/{id}/firewall', [ApiController::class, 'updateFirewall'])
        ->middleware('api.scope:firewall.write')
        ->where('id', '[0-9]+');

    // --- 监控 ---
    Route::get('/instances/{id}/metrics', [ApiController::class, 'getMetrics'])
        ->middleware('api.scope:metrics.read')
        ->where('id', '[0-9]+');

    // --- 账户 ---
    Route::get('/account/balance', [ApiController::class, 'getBalance'])
        ->middleware('api.scope:account.read');

    Route::get('/account/invoices', [ApiController::class, 'listInvoices'])
        ->middleware('api.scope:account.read');

    // --- Token 自助管理（仅需基础认证，无额外 scope 要求）---
    Route::get('/tokens', [ApiController::class, 'listTokens']);
    Route::post('/tokens', [ApiController::class, 'createToken']);
    Route::delete('/tokens/{tokenId}', [ApiController::class, 'revokeToken'])
        ->where('tokenId', '[0-9]+');
});
