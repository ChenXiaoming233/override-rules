/**
 * 地区名称排序：按配置权重返回已识别的地区。
 */

import { countriesMeta } from "../catalog/countries";
import type { ProxyNode } from "../types/proxy";

/**
 * 按权重排序后返回全部已识别地区名称。
 * @param countryNodes - 地区名 → 节点数组 的映射
 * @returns 按权重排序的地区名数组（不含后缀）
 */
export function getSortedCountryNames(countryNodes: Record<string, ProxyNode[]>): string[] {
    return Object.entries(countryNodes)
        .sort(([a], [b]) => {
            const wa = countriesMeta[a]?.weight ?? Infinity;
            const wb = countriesMeta[b]?.weight ?? Infinity;
            return wa - wb;
        })
        .map(([country]) => country);
}
