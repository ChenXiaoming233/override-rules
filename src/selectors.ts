import { NODE_SUFFIX, PROXY_GROUPS } from "./constants";
import { buildList } from "./utils";
import type { BaseLists, BuildBaseListsInput } from "./types";

/**
 * 根据当前功能开关和节点信息，构建各代理组所需的基础代理列表。
 * @param input - 构建基础列表所需的输入参数
 * @param input.landing - 是否存在落地节点
 * @param input.lowCostNodes - 低价节点列表
 * @param input.countryNames - 纯地区名数组（不含后缀）
 * @param input.nonLandingNodes - 非落地节点列表（仅在非正则过滤模式下使用）
 * @param input.regexFilter - 是否使用正则过滤模式
 * @returns 包含各场景下代理列表的 `BaseLists` 对象
 */
export function buildBaseLists({
    landing,
    lowCostNodes,
    highCostNodes,
    countryNames,
    nonLandingNodes,
    regexFilter,
    countryLowCostGroupNames,
}: BuildBaseListsInput): BaseLists {
    const suffixedCountryNames = countryNames.map((c) => c + NODE_SUFFIX);
    const lowCost = lowCostNodes.length > 0 || regexFilter;
    const highCost = highCostNodes.length > 0 || regexFilter;

    // 落地节点、地区分组、全局低/高倍率组 — defaultSelector / defaultProxies /
    // defaultProxiesDirect 共享此尾部，staticResourcesProxies 不适用。
    const commonGroups = [
        landing && PROXY_GROUPS.LANDING,
        suffixedCountryNames,
        lowCost && PROXY_GROUPS.LOW_COST,
        highCost && PROXY_GROUPS.HIGH_COST,
    ];

    const defaultSelector = buildList(
        PROXY_GROUPS.AUTO,
        PROXY_GROUPS.FALLBACK,
        ...commonGroups,
        PROXY_GROUPS.MANUAL,
        "DIRECT"
    );

    const defaultProxies = buildList(
        PROXY_GROUPS.SELECT,
        ...commonGroups,
        PROXY_GROUPS.MANUAL,
        "DIRECT"
    );

    const defaultProxiesDirect = buildList(
        "DIRECT",
        ...commonGroups,
        PROXY_GROUPS.SELECT,
        PROXY_GROUPS.MANUAL
    );

    const defaultFallback = buildList(landing && PROXY_GROUPS.LANDING, suffixedCountryNames);

    const frontProxySelector = buildList(
        suffixedCountryNames,
        "DIRECT",
        !regexFilter && nonLandingNodes.map((node) => node.name).filter(Boolean)
    );

    const staticResourcesProxies = buildList(
        PROXY_GROUPS.SELECT,
        countryLowCostGroupNames,
        ...[
            landing && PROXY_GROUPS.LANDING,
            suffixedCountryNames,
            lowCost && PROXY_GROUPS.LOW_COST,
            highCost && PROXY_GROUPS.HIGH_COST,
        ],
        PROXY_GROUPS.MANUAL,
        "DIRECT"
    );

    return {
        defaultProxies,
        defaultProxiesDirect,
        defaultSelector,
        defaultFallback,
        frontProxySelector,
        staticResourcesProxies,
    };
}
