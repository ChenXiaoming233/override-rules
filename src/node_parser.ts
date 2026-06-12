import {
    LANDING_NODE_MATCHER,
    NODE_SUFFIX,
    LOW_COST_NODE_MATCHER,
    HIGH_COST_NODE_MATCHER,
    countriesMeta,
} from "./constants";
import type { ClashConfig, CountryInfoItem } from "./types";

/**
 * 根据节点数量阈值，将国家地区列表拆分为“小地区”（节点数 ≤ threshold）和“常规地区”（节点数 > threshold）。
 * @param countryInfo - 由 `parseCountries` 返回的地区节点信息数组
 * @param threshold - 节点数阈值
 * @returns 拆分后的小地区列表和常规地区列表
 */
export function parseSmallCountries(
  countryInfo: CountryInfoItem[],
  threshold: number
): { small: CountryInfoItem[]; regular: CountryInfoItem[] } {
  const small: CountryInfoItem[] = [];
  const regular: CountryInfoItem[] = [];

  for (const item of countryInfo) {
    if (item.nodes.length <= threshold) {
      small.push(item);
    } else {
      regular.push(item);
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
 * 从 Clash 配置中筛选出所有低价节点的名称。
 * @param config - 当前的 Clash 配置对象，需包含 `proxies` 字段
 * @returns 匹配低价节点正则的节点名称数组
 */
export function parseLowCost(config: ClashConfig): string[] {
    return (config.proxies || [])
        .filter((proxy) => LOW_COST_NODE_MATCHER.regex.test(proxy.name || ""))
        .map((proxy) => proxy.name)
        .filter((name): name is string => Boolean(name));
}

/**
 * 从 Clash 配置中筛选出所有高倍率节点的名称。
 * 高倍率匹配优先级低于低倍率：已匹配低倍率的节点不会进入高倍率列表。
 * @param config - 当前的 Clash 配置对象，需包含 `proxies` 字段
 * @param excludeNodes - 需要跳过的节点名称列表（通常传入低倍率节点列表）
 * @returns 匹配高倍率节点正则的节点名称数组
 */
export function parseHighCost(config: ClashConfig, excludeNodes: string[] = []): string[] {
    const excludeSet = new Set(excludeNodes);
    return (config.proxies || [])
        .filter((proxy) => {
            const name = proxy.name || "";
            return HIGH_COST_NODE_MATCHER.regex.test(name) && !excludeSet.has(name);
        })
        .map((proxy) => proxy.name)
        .filter((name): name is string => Boolean(name));
}

/**
 * 将订阅中的所有节点按是否为落地节点进行分类。
 * @param config - 当前的 Clash 配置对象，需包含 `proxies` 字段
 * @returns 包含 `landingNodes`（落地节点名称列表）和 `nonLandingNodes`（非落地节点名称列表）的对象
 */
export function parseNodesByLanding(config: ClashConfig): {
    landingNodes: string[];
    nonLandingNodes: string[];
} {
    const landingNodes: string[] = [];
    const nonLandingNodes: string[] = [];

    for (const proxy of config.proxies || []) {
        const name = proxy.name;
        if (!name) continue;

        if (LANDING_NODE_MATCHER.regex.test(name)) {
            landingNodes.push(name);
            continue;
        }

        nonLandingNodes.push(name);
    }

    return { landingNodes, nonLandingNodes };
}

/**
 * 遍历订阅中的所有节点，按 `countriesMeta` 中定义的地区进行归类。
 * @param config - 当前的 Clash 配置对象，需包含 `proxies` 字段
 * @param landing - 是否启用落地节点模式；为 `true` 时将跳过落地节点，默认为 `false`
 * @returns 按地区归类后的节点信息数组，每项包含 `country`（地区名）和 `nodes`（节点名称列表）
 */
export function parseCountries(config: ClashConfig, landing = false): CountryInfoItem[] {
    const proxies = config.proxies || [];
    const countryNodes: Record<string, string[]> = Object.create(null);

    for (const proxy of proxies) {
        const name = proxy.name || "";

        if (landing && LANDING_NODE_MATCHER.regex.test(name)) continue;

        for (const [country, regex] of Object.entries(COUNTRY_REGEX_MAP)) {
            if (!regex.test(name)) continue;

            if (!countryNodes[country]) {
                countryNodes[country] = [];
            }
            countryNodes[country].push(name);
            break;
        }
    }

    return Object.entries(countryNodes).map(([country, nodes]) => ({ country, nodes }));
}

/**
 * 根据最小节点数量阈值过滤地区，并按权重排序后返回带后缀的地区分组名称列表。
 * @param countryInfo - 由 `parseCountries` 返回的地区节点信息数组
 * @param minCount - 地区节点数量的最小阈值，节点数不足该值的地区将被过滤掉
 * @returns 按权重升序排列、附加了节点后缀（`NODE_SUFFIX`）的地区分组名称数组
 */
export function getCountryGroupNames(countryInfo: CountryInfoItem[], minCount: number): string[] {
    const filtered = countryInfo.filter((item) => item.nodes.length >= minCount);

    filtered.sort((a, b) => {
        const wa = countriesMeta[a.country]?.weight ?? Infinity;
        const wb = countriesMeta[b.country]?.weight ?? Infinity;
        return wa - wb;
    });

    return filtered.map((item) => item.country + NODE_SUFFIX);
}

/**
 * 移除分组名称末尾的节点后缀（`NODE_SUFFIX`），还原为纯地区名称。
 * @param groupNames - 带节点后缀的分组名称数组，通常来自 `getCountryGroupNames`
 * @returns 去除后缀后的地区名称数组
 */
export function stripNodeSuffix(groupNames: string[]): string[] {
    const suffixPattern = new RegExp(`${NODE_SUFFIX}$`);
    return groupNames.map((name) => name.replace(suffixPattern, ""));
}
