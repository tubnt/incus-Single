{{-- 管理后台 — 收入报表 --}}
@extends('admin.layouts.app')

@section('title', '收入报表')

@section('content')
<div class="container-fluid py-4">
    <div class="d-flex justify-content-between align-items-center mb-4">
        <h4 class="mb-0">收入报表</h4>
        <div>
            <a href="{{ route('admin.incus.dashboard') }}" class="btn btn-outline-secondary btn-sm">返回概览</a>
        </div>
    </div>

    {{-- 汇总卡片 --}}
    <div class="row g-3 mb-4">
        <div class="col-md-2">
            <div class="card border-0 shadow-sm">
                <div class="card-body text-center">
                    <p class="text-muted small mb-1">总收入</p>
                    <h4 class="mb-0 text-success">${{ number_format($summary['total_revenue'] ?? 0, 2) }}</h4>
                </div>
            </div>
        </div>
        <div class="col-md-2">
            <div class="card border-0 shadow-sm">
                <div class="card-body text-center">
                    <p class="text-muted small mb-1">总退款</p>
                    <h4 class="mb-0 text-danger">${{ number_format($summary['total_refunds'] ?? 0, 2) }}</h4>
                </div>
            </div>
        </div>
        <div class="col-md-2">
            <div class="card border-0 shadow-sm">
                <div class="card-body text-center">
                    <p class="text-muted small mb-1">净收入</p>
                    <h4 class="mb-0">${{ number_format($summary['total_net'] ?? 0, 2) }}</h4>
                </div>
            </div>
        </div>
        <div class="col-md-2">
            <div class="card border-0 shadow-sm">
                <div class="card-body text-center">
                    <p class="text-muted small mb-1">新订单数</p>
                    <h4 class="mb-0">{{ $summary['total_orders'] ?? 0 }}</h4>
                </div>
            </div>
        </div>
        <div class="col-md-2">
            <div class="card border-0 shadow-sm">
                <div class="card-body text-center">
                    <p class="text-muted small mb-1">续费次数</p>
                    <h4 class="mb-0">{{ $summary['total_renewals'] ?? 0 }}</h4>
                </div>
            </div>
        </div>
        <div class="col-md-2">
            <div class="card border-0 shadow-sm">
                <div class="card-body text-center">
                    <p class="text-muted small mb-1">月均净收入</p>
                    <h4 class="mb-0">${{ number_format($summary['avg_monthly'] ?? 0, 2) }}</h4>
                </div>
            </div>
        </div>
    </div>

    {{-- 收入趋势图表 --}}
    <div class="card border-0 shadow-sm mb-4">
        <div class="card-header bg-white">
            <h6 class="mb-0">月度收入趋势</h6>
        </div>
        <div class="card-body">
            <canvas id="revenueTrendChart" height="100"></canvas>
        </div>
    </div>

    {{-- 月度明细表 --}}
    <div class="card border-0 shadow-sm mb-4">
        <div class="card-header bg-white">
            <h6 class="mb-0">月度明细</h6>
        </div>
        <div class="card-body p-0">
            <div class="table-responsive">
                <table class="table table-hover mb-0">
                    <thead class="table-light">
                        <tr>
                            <th>月份</th>
                            <th class="text-end">新订单数</th>
                            <th class="text-end">新订单收入</th>
                            <th class="text-end">续费次数</th>
                            <th class="text-end">续费收入</th>
                            <th class="text-end">总收入</th>
                            <th class="text-end">退款</th>
                            <th class="text-end">净收入</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse($monthly ?? [] as $row)
                        <tr>
                            <td><strong>{{ $row['month'] }}</strong></td>
                            <td class="text-end">{{ $row['new_orders'] }}</td>
                            <td class="text-end">${{ number_format($row['new_revenue'], 2) }}</td>
                            <td class="text-end">{{ $row['renewals'] }}</td>
                            <td class="text-end">${{ number_format($row['renewal_revenue'], 2) }}</td>
                            <td class="text-end">${{ number_format($row['total_revenue'], 2) }}</td>
                            <td class="text-end text-danger">
                                @if(($row['refund_amount'] ?? 0) > 0)
                                    -${{ number_format($row['refund_amount'], 2) }}
                                    <small class="text-muted">({{ $row['refunds'] ?? 0 }} 笔)</small>
                                @else
                                    -
                                @endif
                            </td>
                            <td class="text-end">
                                <strong class="{{ ($row['net_revenue'] ?? 0) >= 0 ? 'text-success' : 'text-danger' }}">
                                    ${{ number_format($row['net_revenue'] ?? 0, 2) }}
                                </strong>
                            </td>
                        </tr>
                        @empty
                        <tr>
                            <td colspan="8" class="text-center text-muted py-4">暂无数据</td>
                        </tr>
                        @endforelse
                    </tbody>
                    @if(!empty($monthly))
                    <tfoot class="table-light">
                        <tr>
                            <td><strong>合计</strong></td>
                            <td class="text-end"><strong>{{ $summary['total_orders'] ?? 0 }}</strong></td>
                            <td class="text-end">-</td>
                            <td class="text-end"><strong>{{ $summary['total_renewals'] ?? 0 }}</strong></td>
                            <td class="text-end">-</td>
                            <td class="text-end"><strong>${{ number_format($summary['total_revenue'] ?? 0, 2) }}</strong></td>
                            <td class="text-end text-danger"><strong>-${{ number_format($summary['total_refunds'] ?? 0, 2) }}</strong></td>
                            <td class="text-end"><strong class="text-success">${{ number_format($summary['total_net'] ?? 0, 2) }}</strong></td>
                        </tr>
                    </tfoot>
                    @endif
                </table>
            </div>
        </div>
    </div>

    {{-- 产品收入分布 --}}
    @if(!empty($byProduct))
    <div class="row g-3">
        <div class="col-md-6">
            <div class="card border-0 shadow-sm">
                <div class="card-header bg-white">
                    <h6 class="mb-0">产品收入分布</h6>
                </div>
                <div class="card-body">
                    <canvas id="productChart" height="200"></canvas>
                </div>
            </div>
        </div>
        <div class="col-md-6">
            <div class="card border-0 shadow-sm">
                <div class="card-header bg-white">
                    <h6 class="mb-0">产品明细</h6>
                </div>
                <div class="card-body p-0">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th>产品</th>
                                <th class="text-end">订单数</th>
                                <th class="text-end">总收入</th>
                                <th class="text-end">占比</th>
                            </tr>
                        </thead>
                        <tbody>
                            @php $totalProductRevenue = array_sum(array_column($byProduct, 'total_revenue')); @endphp
                            @foreach($byProduct as $product)
                            <tr>
                                <td>{{ $product->product_name }}</td>
                                <td class="text-end">{{ $product->order_count }}</td>
                                <td class="text-end">${{ number_format($product->total_revenue, 2) }}</td>
                                <td class="text-end">
                                    {{ $totalProductRevenue > 0
                                        ? round($product->total_revenue / $totalProductRevenue * 100, 1)
                                        : 0 }}%
                                </td>
                            </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
    @endif
</div>

@push('scripts')
<script>
document.addEventListener('DOMContentLoaded', function() {
    // 月度收入趋势图
    const monthlyData = @json($monthly ?? []);
    if (monthlyData.length > 0) {
        const trendCtx = document.getElementById('revenueTrendChart').getContext('2d');
        new Chart(trendCtx, {
            type: 'bar',
            data: {
                labels: monthlyData.map(r => r.month),
                datasets: [
                    {
                        label: '新订单',
                        data: monthlyData.map(r => r.new_revenue),
                        backgroundColor: 'rgba(54, 162, 235, 0.7)',
                        stack: 'revenue',
                    },
                    {
                        label: '续费',
                        data: monthlyData.map(r => r.renewal_revenue),
                        backgroundColor: 'rgba(75, 192, 192, 0.7)',
                        stack: 'revenue',
                    },
                    {
                        label: '退款',
                        data: monthlyData.map(r => -(r.refund_amount || 0)),
                        backgroundColor: 'rgba(255, 99, 132, 0.5)',
                        stack: 'refund',
                    },
                    {
                        label: '净收入',
                        data: monthlyData.map(r => r.net_revenue),
                        type: 'line',
                        borderColor: 'rgba(255, 159, 64, 1)',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 4,
                        tension: 0.3,
                    },
                ],
            },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { stacked: true },
                    y: { beginAtZero: true, ticks: { callback: v => '$' + v } },
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(ctx) {
                                return ctx.dataset.label + ': $' + Math.abs(ctx.parsed.y).toFixed(2);
                            },
                        },
                    },
                },
            },
        });
    }

    // 产品分布饼图
    const productData = @json($byProduct ?? []);
    if (productData.length > 0) {
        const productCtx = document.getElementById('productChart').getContext('2d');
        const colors = [
            '#36A2EB', '#4BC0C0', '#FFCE56', '#FF6384', '#9966FF',
            '#FF9F40', '#C9CBCF', '#7BC8A4', '#E7E9ED', '#70CAD1',
        ];
        new Chart(productCtx, {
            type: 'doughnut',
            data: {
                labels: productData.map(p => p.product_name),
                datasets: [{
                    data: productData.map(p => p.total_revenue),
                    backgroundColor: colors.slice(0, productData.length),
                }],
            },
            options: {
                responsive: true,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(ctx) {
                                return ctx.label + ': $' + ctx.parsed.toFixed(2);
                            },
                        },
                    },
                },
            },
        });
    }
});
</script>
@endpush
@endsection
