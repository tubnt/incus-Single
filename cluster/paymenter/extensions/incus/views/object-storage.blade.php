{{-- 对象存储管理面板 --}}
@extends('layouts.app')

@section('title', '对象存储 (S3)')

@section('content')
<div class="container mx-auto px-4 py-6">

    {{-- 页面标题 --}}
    <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold text-gray-800">对象存储管理</h1>
        <a href="{{ route('object-storage.create-bucket') }}"
           class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
            + 新建 Bucket
        </a>
    </div>

    {{-- 用量概览卡片 --}}
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div class="bg-white rounded-lg shadow p-5">
            <div class="text-sm text-gray-500 mb-1">已用空间</div>
            <div class="text-2xl font-semibold text-gray-800">
                {{ number_format($usage['size_gb'] ?? 0, 2) }} GB
            </div>
            @if(($quota ?? 0) > 0)
                <div class="mt-2 w-full bg-gray-200 rounded-full h-2">
                    @php $pct = min(100, (($usage['size_gb'] ?? 0) / $quota) * 100); @endphp
                    <div class="bg-blue-600 h-2 rounded-full" style="width: {{ $pct }}%"></div>
                </div>
                <div class="text-xs text-gray-400 mt-1">配额：{{ $quota }} GB</div>
            @endif
        </div>

        <div class="bg-white rounded-lg shadow p-5">
            <div class="text-sm text-gray-500 mb-1">对象数量</div>
            <div class="text-2xl font-semibold text-gray-800">
                {{ number_format($usage['num_objects'] ?? 0) }}
            </div>
        </div>

        <div class="bg-white rounded-lg shadow p-5">
            <div class="text-sm text-gray-500 mb-1">Bucket 数量</div>
            <div class="text-2xl font-semibold text-gray-800">
                {{ count($buckets ?? []) }}
            </div>
        </div>
    </div>

    {{-- S3 连接信息 --}}
    <div class="bg-white rounded-lg shadow p-5 mb-8">
        <h2 class="text-lg font-semibold text-gray-700 mb-3">S3 连接信息</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
                <span class="text-gray-500">Endpoint:</span>
                <code class="ml-2 bg-gray-100 px-2 py-1 rounded">{{ $s3Endpoint ?? '-' }}</code>
            </div>
            <div>
                <span class="text-gray-500">Access Key:</span>
                <code class="ml-2 bg-gray-100 px-2 py-1 rounded">{{ $credentials['access_key'] ?? '-' }}</code>
            </div>
            <div>
                <span class="text-gray-500">Region:</span>
                <code class="ml-2 bg-gray-100 px-2 py-1 rounded">{{ $region ?? 'default' }}</code>
            </div>
            <div>
                <span class="text-gray-500">Secret Key:</span>
                <button onclick="toggleSecret(this)" data-secret="{{ $credentials['secret_key'] ?? '' }}"
                        class="ml-2 text-blue-600 hover:underline text-sm">
                    点击显示
                </button>
            </div>
        </div>
    </div>

    {{-- Bucket 列表 --}}
    <div class="bg-white rounded-lg shadow overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-200">
            <h2 class="text-lg font-semibold text-gray-700">Bucket 列表</h2>
        </div>

        @if(empty($buckets))
            <div class="px-5 py-12 text-center text-gray-400">
                暂无 Bucket，点击右上角按钮创建
            </div>
        @else
            <table class="w-full text-sm text-left">
                <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
                    <tr>
                        <th class="px-5 py-3">名称</th>
                        <th class="px-5 py-3">创建时间</th>
                        <th class="px-5 py-3">对象数</th>
                        <th class="px-5 py-3">大小</th>
                        <th class="px-5 py-3 text-right">操作</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                    @foreach($buckets as $bucket)
                        <tr class="hover:bg-gray-50">
                            <td class="px-5 py-3 font-medium text-gray-800">
                                {{ $bucket['name'] ?? $bucket }}
                            </td>
                            <td class="px-5 py-3 text-gray-500">
                                {{ $bucket['creation_date'] ?? '-' }}
                            </td>
                            <td class="px-5 py-3 text-gray-500">
                                {{ number_format($bucket['num_objects'] ?? 0) }}
                            </td>
                            <td class="px-5 py-3 text-gray-500">
                                {{ isset($bucket['size_kb']) ? number_format($bucket['size_kb'] / 1024, 2) . ' MB' : '-' }}
                            </td>
                            <td class="px-5 py-3 text-right">
                                <form method="POST"
                                      action="{{ route('object-storage.delete-bucket', ['name' => $bucket['name'] ?? $bucket]) }}"
                                      onsubmit="return confirm('确定要删除此 Bucket 吗？所有数据将被清除！')">
                                    @csrf
                                    @method('DELETE')
                                    <button type="submit"
                                            class="text-red-600 hover:text-red-800 hover:underline text-sm">
                                        删除
                                    </button>
                                </form>
                            </td>
                        </tr>
                    @endforeach
                </tbody>
            </table>
        @endif
    </div>
</div>

@push('scripts')
<script>
    // 切换显示/隐藏 Secret Key
    function toggleSecret(btn) {
        const secret = btn.dataset.secret;
        if (btn.textContent === '点击显示') {
            btn.textContent = secret;
            btn.classList.add('bg-gray-100', 'px-2', 'py-1', 'rounded', 'font-mono');
        } else {
            btn.textContent = '点击显示';
            btn.classList.remove('bg-gray-100', 'px-2', 'py-1', 'rounded', 'font-mono');
        }
    }
</script>
@endpush
@endsection
