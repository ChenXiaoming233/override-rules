/**
 * 节点多维度分类。
 *
 * 将上游订阅的原始节点列表一次性归类为：落地/非落地、国家/地区、低倍率、Tailscale，
 * 作为配置构建阶段唯一的数据来源。
 */

import { countryExcludeRegexMap, countryRegexMap } from "../catalog/countries";
import { PROXY_GROUPS } from "../catalog/group-names";
import { HIGH_COST_NODE_MATCHER, LOW_COST_NODE_MATCHER } from "../catalog/low-cost";
import { getSortedCountryNames } from "./active-countries";
import type { NodeAnalysis, ProxyNode, RegionLayout } from "../types/proxy";

/** 生成常规地区组所需的最少地区数；不足且没有小地区时展平到上层代理组。 */
const MIN_REGION_GROUPS = 2;

/**
 * 按 `dialer-proxy` 字段将节点分为落地节点与非落地节点。
 *
 * 在 Clash 链式代理中，`dialer-proxy` 表示当前节点通过指定代理拨号，
 * 因此带 `dialer-proxy: "前置代理"` 的节点是落地节点（目标节点），其余为非落地节点。
 */
function splitByLanding(nodes: ProxyNode[]): {
    landingNodes: ProxyNode[];
    nonLandingNodes: ProxyNode[];
} {
    const landingNodes: ProxyNode[] = [];
    const nonLandingNodes: ProxyNode[] = [];

    for (const node of nodes) {
        if (!node.name) continue;

        if (node["dialer-proxy"] === PROXY_GROUPS.FRONT_PROXY) {
            landingNodes.push(node);
        } else {
            nonLandingNodes.push(node);
        }
    }

    return { landingNodes, nonLandingNodes };
}

/**
 * 按 `countriesMeta` 中定义的地区归类节点，命中首个地区即停止，并排除误匹配。
 */
function collectCountries(nodes: ProxyNode[]): Record<string, ProxyNode[]> {
    const countryNodes: Record<string, ProxyNode[]> = Object.create(null);

    for (const node of nodes) {
        const name = node.name || "";

        for (const [country, regex] of Object.entries(countryRegexMap)) {
            if (!regex.test(name)) continue;
            if (countryExcludeRegexMap[country]?.test(name)) continue;

            (countryNodes[country] ??= []).push(node);
            break;
        }
    }

    return countryNodes;
}

/** 筛选出所有匹配低倍率正则的节点。 */
function collectLowCost(nodes: ProxyNode[]): ProxyNode[] {
    return nodes.filter((node) => LOW_COST_NODE_MATCHER.regex.test(node.name || ""));
}

/** 筛选高倍率节点；低倍率节点优先，避免同一节点同时进入两类。 */
function collectHighCost(nodes: ProxyNode[], lowCostNodes: ProxyNode[]): ProxyNode[] {
    const lowCostNames = new Set(lowCostNodes.map((node) => node.name));
    return nodes.filter(
        (node) => !lowCostNames.has(node.name) && HIGH_COST_NODE_MATCHER.regex.test(node.name || "")
    );
}

/** 筛选出所有 Tailscale 节点。 */
function collectTailscale(nodes: ProxyNode[]): ProxyNode[] {
    return nodes.filter((node) => node.type === "tailscale");
}

/**
 * 对节点列表执行全部分类。
 * @param nodes - 上游订阅的节点列表（`config.proxies`）
 */
export function analyzeNodes(nodes: ProxyNode[], liteCombine = 1): NodeAnalysis {
    const { landingNodes, nonLandingNodes } = splitByLanding(nodes);
    // 只要出现落地节点就启用落地相关代理组；全落地时非落地候选自然为空。
    const landing = landingNodes.length > 0;

    // 链式代理激活时，国家/低倍率分类只扫描非落地节点。
    const scopedNodes = landing ? nonLandingNodes : nodes;
    const countryNodes = collectCountries(scopedNodes);
    const countryNames = getSortedCountryNames(countryNodes);
    const lowCostNodes = collectLowCost(scopedNodes);
    const highCostNodes = collectHighCost(scopedNodes, lowCostNodes);
    const tailscaleNodes = collectTailscale(nodes);

    const smallCountries =
        liteCombine > 0
            ? countryNames.filter((country) => countryNodes[country].length <= liteCombine)
            : [];
    const smallCountrySet = new Set(smallCountries);
    const regularCountryNames = countryNames.filter((country) => !smallCountrySet.has(country));
    const regularCountryNodes = Object.fromEntries(
        regularCountryNames.map((country) => [country, countryNodes[country]])
    );
    const smallCountryNodes = smallCountries.flatMap((country) => countryNodes[country]);
    const lowCostNames = new Set(lowCostNodes.map((node) => node.name));
    const highCostNames = new Set(highCostNodes.map((node) => node.name));
    const countryLowCostNodes: Record<string, ProxyNode[]> = {};
    const countryHighCostNodes: Record<string, ProxyNode[]> = {};
    const countryRegularNodes: Record<string, ProxyNode[]> = {};

    for (const [country, nodesInCountry] of Object.entries(regularCountryNodes)) {
        countryLowCostNodes[country] = nodesInCountry.filter((node) => lowCostNames.has(node.name));
        countryHighCostNodes[country] = nodesInCountry.filter((node) =>
            highCostNames.has(node.name)
        );
        countryRegularNodes[country] = nodesInCountry.filter(
            (node) => !lowCostNames.has(node.name) && !highCostNames.has(node.name)
        );
    }

    const regionLayout: RegionLayout =
        regularCountryNames.length >= MIN_REGION_GROUPS || smallCountryNodes.length > 0
            ? { mode: "grouped", groupedCountries: regularCountryNames, flattenedNodes: [] }
            : { mode: "flattened", groupedCountries: [], flattenedNodes: nonLandingNodes };

    return {
        allNodes: nodes,
        allNames: nodes.map((node) => node.name),
        landingNodes,
        nonLandingNodes,
        landing,
        countryNodes,
        countryNames,
        regionLayout,
        lowCostNodes,
        highCostNodes,
        smallCountries,
        smallCountryNodes,
        regularCountryNodes,
        regularCountryNames,
        countryLowCostNodes,
        countryHighCostNodes,
        countryRegularNodes,
        tailscaleNodes,
        hasTailscale: tailscaleNodes.length > 0,
    };
}
