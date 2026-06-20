import { LOW_COST_NODE_MATCHER, HIGH_COST_NODE_MATCHER, countriesMeta } from "./constants";
import type { ProxyNode } from "./types";

/**
 * 根据节点数量阈值，将国家地区列表拆分为"小地区"（节点数 ≤ threshold）和"常规地区"（节点数 > threshold）。
 * @param countryNodes - 由 `parseCountries` 返回的地区节点映射
 * @param threshold - 节点数阈值
 * @returns 拆分后的小地区映射和常规地区映射
 */
export function parseSmallCountries(
    countryNodes: Record<string, ProxyNode[]>,
    threshold: number
): { small: Record<string, ProxyNode[]>; regular: Record<string, ProxyNode[]> } {
    const small: Record<string, ProxyNode[]> = {};
    const regular: Record<string, ProxyNode[]> = {};

    for (const [country, nodes] of Object.entries(countryNodes)) {
        if (nodes.length <= threshold) {
            small[country] = nodes;
        } else {
            regular[country] = nodes;
        }
    }

    return { small, regular };
}

const COUNTRY_REGEX_MAP = Object.fromEntries(
    Object.entries(countriesMeta).map(([country, meta]) => {
        return [country, new RegExp(meta.pattern.replace(/^\(\?i\)/, ""))];
    })
) as Record<string, RegExp>;

/**
 * 筛选出所有低价节点。
 * @param nodes - 节点数组，当链式代理激活时为 nonLandingNodes，否则为全部节点
 * @returns 匹配低价节点正则的节点数组
 */
export function parseLowCost(nodes: ProxyNode[]): ProxyNode[] {
    return (nodes || []).filter((proxy) => LOW_COST_NODE_MATCHER.regex.test(proxy.name || ""));
}

/**
 * 筛选出所有高倍率节点。
 * 高倍率匹配优先级低于低倍率：已匹配低倍率的节点不会进入高倍率列表。
 * @param nodes - 节点数组，当链式代理激活时为 nonLandingNodes，否则为全部节点
 * @param excludeNodes - 需要跳过的节点数组（通常传入低倍率节点列表）
 * @returns 匹配高倍率节点正则的节点数组
 */
export function parseHighCost(nodes: ProxyNode[], excludeNodes: ProxyNode[] = []): ProxyNode[] {
    const excludeSet = new Set(excludeNodes.map((n) => n.name));
    return (nodes || []).filter((proxy) => {
        const name = proxy.name || "";
        return HIGH_COST_NODE_MATCHER.regex.test(name) && !excludeSet.has(name);
    });
}

/**
 * 根据 dialer-proxy 字段将节点分为落地节点和非落地节点。
 * 在 Mihomo 链式代理中，`dialer-proxy` 表示当前节点通过指定代理拨号。
 * 因此带 `dialer-proxy: "前置代理"` 的节点是落地节点（目标节点），其余为非落地节点。
 * @param nodes - 节点数组，一般是 `config.proxies` 列表
 * @returns 包含 `landingNodes`（带 dialer-proxy 的落地节点）和 `nonLandingNodes`（普通/中继节点）
 */
export function parseNodesByLanding(nodes: ProxyNode[]): {
    landingNodes: ProxyNode[];
    nonLandingNodes: ProxyNode[];
} {
    const landingNodes: ProxyNode[] = [];
    const nonLandingNodes: ProxyNode[] = [];

    for (const node of nodes || []) {
        const name = node.name;
        if (!name) continue;

        if (node["dialer-proxy"] === "前置代理") {
            landingNodes.push(node);
        } else {
            nonLandingNodes.push(node);
        }
    }

    return { landingNodes, nonLandingNodes };
}

/**
 * 遍历节点数组，按 `countriesMeta` 中定义的地区进行归类。
 * @param nodes - 节点数组，当链式代理激活时为 nonLandingNodes，否则为全部节点
 * @returns 地区名到节点数组的映射 Record
 */
export function parseCountries(nodes: ProxyNode[]): Record<string, ProxyNode[]> {
    const countryNodes: Record<string, ProxyNode[]> = Object.create(null);

    for (const node of nodes) {
        const name = node.name || "";

        for (const [country, regex] of Object.entries(COUNTRY_REGEX_MAP)) {
            if (!regex.test(name)) continue;

            if (!countryNodes[country]) {
                countryNodes[country] = [];
            }
            countryNodes[country].push(node);
            break;
        }
    }

    return countryNodes;
}

/**
 * 根据最小节点数量阈值过滤地区，并按权重排序后返回地区名称列表。
 * @param countryNodes - 由 `parseCountries` 返回的地区名到节点数组的映射
 * @param minCount - 地区节点数量的最小阈值，节点数不足该值的地区将被过滤掉
 * @returns 按权重排序的地区名数组（不含后缀）
 */
export function getActiveCountryNames(
    countryNodes: Record<string, ProxyNode[]>,
    minCount: number
): string[] {
    const filtered = Object.entries(countryNodes).filter(([, nodes]) => nodes.length >= minCount);

    filtered.sort(([a], [b]) => {
        const wa = countriesMeta[a]?.weight ?? Infinity;
        const wb = countriesMeta[b]?.weight ?? Infinity;
        return wa - wb;
    });

    return filtered.map(([country]) => country);
}
