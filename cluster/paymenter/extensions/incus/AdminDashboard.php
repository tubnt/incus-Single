<?php

namespace Extensions\Incus;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * 管理后台 — 客户搜索、VM 全局视图、IP 池可视化、收入报表
 */
class AdminDashboard
{
    private IncusClient $incusClient;

    public function __construct(IncusClient $incusClient)
    {
        $this->incusClient = $incusClient;
    }

    // =========================================================================
    // 概览数据
    // =========================================================================

    /**
     * 获取仪表盘概览数据
     *
     * @return array 概览统计
     */
    public function getOverview(): array
    {
        return [
            'users'   => $this->getUserStats(),
            'vms'     => $this->getVmStats(),
            'ips'     => $this->getIpOverview(),
            'revenue' => $this->getRevenueOverview(),
        ];
    }

    private function getUserStats(): array
    {
        return [
            'total'      => DB::table('users')->count(),
            'active'     => DB::table('users')
                ->where('last_login_at', '>=', now()->subDays(30))
                ->count(),
            'new_today'  => DB::table('users')
                ->whereDate('created_at', today())
                ->count(),
            'new_month'  => DB::table('users')
                ->where('created_at', '>=', now()->startOfMonth())
                ->count(),
        ];
    }

    private function getVmStats(): array
    {
        return [
            'total'     => DB::table('orders')->where('status', 'active')->count(),
            'running'   => DB::table('orders')
                ->where('status', 'active')
                ->whereNotNull('vm_name')
                ->count(),
            'suspended' => DB::table('orders')->where('status', 'suspended')->count(),
            'expiring'  => DB::table('orders')
                ->where('status', 'active')
                ->where('expires_at', '<=', now()->addDays(7))
                ->count(),
        ];
    }

    private function getIpOverview(): array
    {
        $stats = DB::table('ip_addresses')
            ->selectRaw("
                COUNT(*) as total,
                SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN status = 'allocated' THEN 1 ELSE 0 END) as allocated,
                SUM(CASE WHEN status = 'cooldown' THEN 1 ELSE 0 END) as cooldown,
                SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved
            ")
            ->first();

        return (array) $stats;
    }

    private function getRevenueOverview(): array
    {
        $currentMonth = now()->startOfMonth();
        $lastMonth = now()->subMonth()->startOfMonth();

        return [
            'this_month' => DB::table('payment_logs')
                ->where('event', 'payment_success')
                ->where('created_at', '>=', $currentMonth)
                ->sum('amount'),
            'last_month' => DB::table('payment_logs')
                ->where('event', 'payment_success')
                ->where('created_at', '>=', $lastMonth)
                ->where('created_at', '<', $currentMonth)
                ->sum('amount'),
            'renewals_this_month' => DB::table('payment_logs')
                ->where('event', 'auto_renewal')
                ->where('created_at', '>=', $currentMonth)
                ->sum('amount'),
        ];
    }

    // =========================================================================
    // 客户搜索
    // =========================================================================

    /**
     * 搜索客户
     *
     * 支持按邮箱、用户名、VM 名称、IP 地址模糊搜索
     *
     * @param string $query   搜索关键词
     * @param int    $page    页码
     * @param int    $perPage 每页数量
     * @return array{data: array, total: int, page: int, per_page: int}
     */
    public function searchCustomers(string $query, int $page = 1, int $perPage = 20): array
    {
        $query = trim($query);
        if ($query === '') {
            return ['data' => [], 'total' => 0, 'page' => $page, 'per_page' => $perPage];
        }

        $likeQuery = '%' . $query . '%';

        // 搜索用户表 + 关联 IP/VM 名
        $baseQuery = DB::table('users')
            ->leftJoin('orders', 'users.id', '=', 'orders.user_id')
            ->leftJoin('ip_addresses', 'orders.id', '=', 'ip_addresses.order_id')
            ->where(function ($q) use ($likeQuery) {
                $q->where('users.email', 'LIKE', $likeQuery)
                  ->orWhere('users.name', 'LIKE', $likeQuery)
                  ->orWhere('orders.vm_name', 'LIKE', $likeQuery)
                  ->orWhere('ip_addresses.ip', 'LIKE', $likeQuery);
            })
            ->select(
                'users.id',
                'users.name',
                'users.email',
                'users.balance',
                'users.created_at',
                'users.last_login_at',
                DB::raw('COUNT(DISTINCT orders.id) as order_count'),
                DB::raw("GROUP_CONCAT(DISTINCT orders.vm_name SEPARATOR ', ') as vm_names"),
                DB::raw("GROUP_CONCAT(DISTINCT ip_addresses.ip SEPARATOR ', ') as ips")
            )
            ->groupBy('users.id', 'users.name', 'users.email', 'users.balance', 'users.created_at', 'users.last_login_at');

        $total = DB::table(DB::raw("({$baseQuery->toSql()}) as sub"))
            ->mergeBindings($baseQuery)
            ->count();

        $data = $baseQuery
            ->orderBy('users.created_at', 'desc')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get()
            ->toArray();

        return [
            'data'     => $data,
            'total'    => $total,
            'page'     => $page,
            'per_page' => $perPage,
        ];
    }

    // =========================================================================
    // VM 全局视图
    // =========================================================================

    /**
     * 获取所有节点所有 VM 的全局视图
     *
     * 合并 Incus API 实时状态 + 数据库订单信息
     *
     * @param array  $filters 过滤条件 ['status', 'node', 'user_id']
     * @param int    $page
     * @param int    $perPage
     * @return array
     */
    public function getGlobalVmView(array $filters = [], int $page = 1, int $perPage = 50): array
    {
        // 从 Incus API 获取所有实例
        try {
            $response = $this->incusClient->request('GET', '/1.0/instances?recursion=2&project=customers');
            $instances = $response['metadata'] ?? [];
        } catch (\Throwable $e) {
            Log::error('[管理后台] Incus API 查询失败', ['error' => $e->getMessage()]);
            $instances = [];
        }

        // 从数据库获取订单信息，建立 vm_name → 订单的映射
        $orders = DB::table('orders')
            ->whereNotNull('vm_name')
            ->join('users', 'orders.user_id', '=', 'users.id')
            ->join('products', 'orders.product_id', '=', 'products.id')
            ->select(
                'orders.vm_name',
                'orders.id as order_id',
                'orders.status as order_status',
                'orders.expires_at',
                'orders.auto_renew',
                'users.id as user_id',
                'users.name as user_name',
                'users.email as user_email',
                'products.name as product_name'
            )
            ->get()
            ->keyBy('vm_name');

        // 合并数据
        $vms = [];
        foreach ($instances as $instance) {
            $name = $instance['name'] ?? '';
            $order = $orders->get($name);

            $vm = [
                'name'         => $name,
                'status'       => $instance['status'] ?? 'unknown',
                'node'         => $instance['location'] ?? 'unknown',
                'type'         => $instance['type'] ?? 'virtual-machine',
                'cpu'          => $instance['config']['limits.cpu'] ?? '-',
                'memory'       => $instance['config']['limits.memory'] ?? '-',
                'created_at'   => $instance['created_at'] ?? null,
                'order_id'     => $order->order_id ?? null,
                'order_status' => $order->order_status ?? 'orphan',
                'expires_at'   => $order->expires_at ?? null,
                'auto_renew'   => $order->auto_renew ?? false,
                'user_id'      => $order->user_id ?? null,
                'user_name'    => $order->user_name ?? '无关联用户',
                'user_email'   => $order->user_email ?? '',
                'product'      => $order->product_name ?? '未知规格',
            ];

            // 应用过滤
            if (!empty($filters['status']) && $vm['status'] !== $filters['status']) {
                continue;
            }
            if (!empty($filters['node']) && $vm['node'] !== $filters['node']) {
                continue;
            }
            if (!empty($filters['user_id']) && $vm['user_id'] != $filters['user_id']) {
                continue;
            }

            $vms[] = $vm;
        }

        // 检测孤儿 VM（数据库有记录但 Incus 中不存在）
        $incusVmNames = array_column($instances, 'name');
        foreach ($orders as $vmName => $order) {
            if (!in_array($vmName, $incusVmNames) && $order->order_status === 'active') {
                $vms[] = [
                    'name'         => $vmName,
                    'status'       => 'missing',
                    'node'         => 'unknown',
                    'type'         => 'virtual-machine',
                    'cpu'          => '-',
                    'memory'       => '-',
                    'created_at'   => null,
                    'order_id'     => $order->order_id,
                    'order_status' => 'inconsistent',
                    'expires_at'   => $order->expires_at,
                    'auto_renew'   => $order->auto_renew,
                    'user_id'      => $order->user_id,
                    'user_name'    => $order->user_name,
                    'user_email'   => $order->user_email,
                    'product'      => $order->product_name,
                ];
            }
        }

        $total = count($vms);
        $paged = array_slice($vms, ($page - 1) * $perPage, $perPage);

        return [
            'data'     => $paged,
            'total'    => $total,
            'page'     => $page,
            'per_page' => $perPage,
            'nodes'    => $this->getNodeSummary($instances),
        ];
    }

    /**
     * 获取节点汇总信息
     */
    private function getNodeSummary(array $instances): array
    {
        $nodes = [];
        foreach ($instances as $instance) {
            $node = $instance['location'] ?? 'unknown';
            if (!isset($nodes[$node])) {
                $nodes[$node] = ['name' => $node, 'vm_count' => 0, 'running' => 0, 'stopped' => 0];
            }
            $nodes[$node]['vm_count']++;
            if (($instance['status'] ?? '') === 'Running') {
                $nodes[$node]['running']++;
            } else {
                $nodes[$node]['stopped']++;
            }
        }
        return array_values($nodes);
    }

    // =========================================================================
    // IP 池可视化
    // =========================================================================

    /**
     * 获取 IP 池详细信息
     *
     * @param int|null $poolId 指定池 ID，null 返回所有
     * @return array
     */
    public function getIpPools(?int $poolId = null): array
    {
        $poolQuery = DB::table('ip_pools');
        if ($poolId) {
            $poolQuery->where('id', $poolId);
        }
        $pools = $poolQuery->get();

        $result = [];
        foreach ($pools as $pool) {
            $addresses = DB::table('ip_addresses')
                ->where('pool_id', $pool->id)
                ->orderByRaw('INET_ATON(ip)')
                ->get();

            $stats = [
                'available' => 0,
                'allocated' => 0,
                'cooldown'  => 0,
                'reserved'  => 0,
            ];

            $addressList = [];
            foreach ($addresses as $addr) {
                $stats[$addr->status]++;
                $addressList[] = [
                    'ip'             => $addr->ip,
                    'status'         => $addr->status,
                    'vm_name'        => $addr->vm_name,
                    'order_id'       => $addr->order_id,
                    'allocated_at'   => $addr->allocated_at,
                    'cooldown_until' => $addr->cooldown_until,
                ];
            }

            $total = count($addressList);
            $utilization = $total > 0 ? round($stats['allocated'] / $total * 100, 1) : 0;

            $result[] = [
                'id'          => $pool->id,
                'name'        => $pool->name,
                'subnet'      => $pool->subnet,
                'gateway'     => $pool->gateway,
                'stats'       => $stats,
                'total'       => $total,
                'utilization' => $utilization,
                'low_warning' => $total > 0 && ($stats['available'] / $total) < 0.1,
                'addresses'   => $addressList,
            ];
        }

        return $result;
    }

    // =========================================================================
    // 收入报表
    // =========================================================================

    /**
     * 获取月度收入报表
     *
     * @param int $months 回溯月数
     * @return array
     */
    public function getRevenueReport(int $months = 12): array
    {
        $startDate = now()->subMonths($months)->startOfMonth();

        // 月度汇总
        $monthly = DB::table('payment_logs')
            ->whereIn('event', ['payment_success', 'auto_renewal'])
            ->where('created_at', '>=', $startDate)
            ->selectRaw("
                DATE_FORMAT(created_at, '%Y-%m') as month,
                event,
                COUNT(*) as count,
                SUM(amount) as total
            ")
            ->groupBy('month', 'event')
            ->orderBy('month')
            ->get();

        // 整理为月度视图
        $report = [];
        foreach ($monthly as $row) {
            if (!isset($report[$row->month])) {
                $report[$row->month] = [
                    'month'            => $row->month,
                    'new_orders'       => 0,
                    'new_revenue'      => 0,
                    'renewals'         => 0,
                    'renewal_revenue'  => 0,
                    'total_revenue'    => 0,
                ];
            }

            if ($row->event === 'payment_success') {
                $report[$row->month]['new_orders'] = $row->count;
                $report[$row->month]['new_revenue'] = round($row->total, 2);
            } elseif ($row->event === 'auto_renewal') {
                $report[$row->month]['renewals'] = $row->count;
                $report[$row->month]['renewal_revenue'] = round($row->total, 2);
            }

            $report[$row->month]['total_revenue'] =
                $report[$row->month]['new_revenue'] + $report[$row->month]['renewal_revenue'];
        }

        // 退款汇总
        $refunds = DB::table('payment_logs')
            ->whereIn('event', ['refund_prorated', 'create_failed_refund'])
            ->where('created_at', '>=', $startDate)
            ->selectRaw("
                DATE_FORMAT(created_at, '%Y-%m') as month,
                COUNT(*) as count,
                SUM(amount) as total
            ")
            ->groupBy('month')
            ->get()
            ->keyBy('month');

        foreach ($report as $month => &$data) {
            $refund = $refunds->get($month);
            $data['refunds'] = $refund ? $refund->count : 0;
            $data['refund_amount'] = $refund ? round($refund->total, 2) : 0;
            $data['net_revenue'] = round($data['total_revenue'] - $data['refund_amount'], 2);
        }
        unset($data);

        // 汇总
        $summary = [
            'total_revenue'     => array_sum(array_column($report, 'total_revenue')),
            'total_refunds'     => array_sum(array_column($report, 'refund_amount')),
            'total_net'         => array_sum(array_column($report, 'net_revenue')),
            'total_orders'      => array_sum(array_column($report, 'new_orders')),
            'total_renewals'    => array_sum(array_column($report, 'renewals')),
            'avg_monthly'       => count($report) > 0
                ? round(array_sum(array_column($report, 'net_revenue')) / count($report), 2)
                : 0,
        ];

        return [
            'monthly' => array_values($report),
            'summary' => $summary,
        ];
    }

    /**
     * 获取产品收入分布
     *
     * @return array
     */
    public function getRevenueByProduct(): array
    {
        return DB::table('orders')
            ->join('products', 'orders.product_id', '=', 'products.id')
            ->join('payment_logs', function ($join) {
                $join->on('orders.id', '=', 'payment_logs.order_id')
                     ->whereIn('payment_logs.event', ['payment_success', 'auto_renewal']);
            })
            ->selectRaw("
                products.name as product_name,
                COUNT(DISTINCT orders.id) as order_count,
                SUM(payment_logs.amount) as total_revenue
            ")
            ->groupBy('products.name')
            ->orderByDesc('total_revenue')
            ->get()
            ->toArray();
    }
}
