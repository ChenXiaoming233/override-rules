/**
 * 代理组组装：将前置组、服务组、尾部固定组、地区组按既定顺序拼接为完整的代理组列表。
 *
 * 各类代理组的定义分别位于：
 * - 服务组：`catalog/service-groups.ts`
 * - 地区元数据：`catalog/countries.ts`
 * - 构造工厂：`domain/proxy-group.ts`
 */

import { countriesMeta } from "../catalog/countries";
import {
    AUTO_SUFFIX,
    countryGroupName,
    HIGH_COST_SUFFIX,
    LOW_COST_SUFFIX,
    PROXY_GROUPS,
} from "../catalog/group-names";
import { ICONS } from "../catalog/icons";
import { HIGH_COST_NODE_MATCHER, LOW_COST_NODE_MATCHER } from "../catalog/low-cost";
import { serviceGroups } from "../catalog/service-groups";
import {
    buildGroupByType,
    excludeNodeNames,
    fallbackGroup,
    selectAllGroup,
    selectGroup,
    urlTestGroupWithProxies,
    urlTestGroup,
} from "../domain/proxy-group";
import { isNotNull } from "../utils/primitives";
import type { GroupBuildContext, ProxyGroup } from "../types/proxy";

interface CountryGroupBuildResult {
    groups: ProxyGroup[];
    lowCostGroups: ProxyGroup[];
    highCostGroups: ProxyGroup[];
    autoGroups: ProxyGroup[];
}

/**
 * 组合两个节点名正则，仅保留同时满足两者的节点。
 * Mihomo 的 `filter` 基于 regexp2，支持正向先行断言。
 */
function combineNodeFilters(...patterns: string[]): string {
    const body = patterns.map((pattern) => `(?=.*(?:${pattern}))`).join("");
    return `(?i)^${body}.*$`;
}

/**
 * 构建地区组及 fork 的低/高倍率、自动测速子组。
 *
 * 子组使用独立的 `select`/`url-test` 类型，主地区组保持用户配置的 `grouptype`。
 * 非 regex 模式直接枚举节点；regex 模式通过 `include-all` + `filter` 动态筛选。
 */
function buildCountryGroups(ctx: GroupBuildContext): CountryGroupBuildResult {
    const { flags, nodes } = ctx;
    const result: CountryGroupBuildResult = {
        groups: [],
        lowCostGroups: [],
        highCostGroups: [],
        autoGroups: [],
    };
    const hasAutoSplit = flags.autoSplit && flags.groupType === 0;

    for (const country of nodes.regionLayout.groupedCountries) {
        const meta = countriesMeta[country];
        if (!meta) continue;

        const lowCostNodes = nodes.countryLowCostNodes[country] ?? [];
        const highCostNodes = nodes.countryHighCostNodes[country] ?? [];
        const regularNodes = nodes.countryRegularNodes[country] ?? [];
        const lowCostNames = lowCostNodes.map((node) => node.name);
        const highCostNames = highCostNodes.map((node) => node.name);
        const regularNames = regularNodes.map((node) => node.name);
        const hasLowCost = flags.splitLowCost && lowCostNames.length > 0;
        const hasHighCost = flags.splitHighCost && highCostNames.length > 0;
        const hasAuto = hasAutoSplit && regularNames.length > 0;

        if (!hasLowCost && !hasHighCost && !hasAuto) {
            result.groups.push(
                buildGroupByType({
                    name: countryGroupName(country),
                    icon: meta.icon,
                    groupType: flags.groupType,
                    nodeSource: flags.regexFilter
                        ? {
                              "include-all": true as const,
                              filter: meta.pattern,
                              ...(meta.excludePattern
                                  ? { "exclude-filter": meta.excludePattern }
                                  : {}),
                          }
                        : { proxies: nodes.countryNodes[country]?.map((node) => node.name) },
                })
            );
            continue;
        }

        const childNames: string[] = [];
        if (hasLowCost) {
            const name = `${country}${LOW_COST_SUFFIX}`;
            result.lowCostGroups.push(
                flags.regexFilter
                    ? selectGroup(
                          name,
                          meta.icon,
                          [
                              {
                                  "include-all": true,
                                  filter: combineNodeFilters(
                                      meta.pattern,
                                      LOW_COST_NODE_MATCHER.pattern
                                  ),
                              },
                          ],
                          true
                      )
                    : selectGroup(name, meta.icon, lowCostNames)
            );
            childNames.push(name);
        }
        if (hasHighCost) {
            const name = `${country}${HIGH_COST_SUFFIX}`;
            result.highCostGroups.push(
                flags.regexFilter
                    ? selectGroup(
                          name,
                          meta.icon,
                          [
                              {
                                  "include-all": true,
                                  filter: combineNodeFilters(
                                      meta.pattern,
                                      HIGH_COST_NODE_MATCHER.pattern
                                  ),
                              },
                          ],
                          true
                      )
                    : selectGroup(name, meta.icon, highCostNames)
            );
            childNames.push(name);
        }
        if (hasAuto) {
            const name = `${country}${AUTO_SUFFIX}`;
            if (flags.regexFilter) {
                result.autoGroups.push(
                    urlTestGroup(name, meta.icon, [
                        {
                            "include-all": true,
                            filter: meta.pattern,
                            "exclude-filter": `(?:${LOW_COST_NODE_MATCHER.source})|(?:${HIGH_COST_NODE_MATCHER.source})`,
                        },
                    ])
                );
            } else {
                result.autoGroups.push(urlTestGroupWithProxies(name, meta.icon, regularNames));
            }
            childNames.push(name);
        }

        const explicitProxies = [
            ...childNames,
            ...regularNames,
            ...(flags.splitLowCost ? [] : lowCostNames),
            ...(flags.splitHighCost ? [] : highCostNames),
        ];
        const regexNodeSource = excludeNodeNames(
            {
                "include-all": true as const,
                filter: meta.pattern,
                ...(meta.excludePattern ? { "exclude-filter": meta.excludePattern } : {}),
            },
            [...(hasLowCost ? lowCostNodes : []), ...(hasHighCost ? highCostNodes : [])]
        );

        result.groups.push(
            buildGroupByType({
                name: countryGroupName(country),
                icon: meta.icon,
                groupType: flags.groupType,
                nodeSource: flags.regexFilter ? regexNodeSource : { proxies: explicitProxies },
            })
        );
    }

    return result;
}

/** 顶层选择类代理组：选择代理、手动选择、以及链式代理相关组。 */
function buildFrontGroups(ctx: GroupBuildContext): Array<ProxyGroup | null> {
    // regex 模式沿用主线决策：静态配置无法预知真实节点名称，交给内核动态填充。
    // 非 regex 模式按上游顺序枚举；空候选由代理组工厂统一回退到 DIRECT。
    const manualGroup = ctx.flags.regexFilter
        ? selectAllGroup(PROXY_GROUPS.MANUAL, ICONS.manual)
        : selectGroup(PROXY_GROUPS.MANUAL, ICONS.manual, ctx.nodes.allNames);

    return [
        selectGroup(PROXY_GROUPS.SELECT, ICONS.select, ctx.lists.defaultSelector),
        manualGroup,
        ctx.nodes.landing
            ? selectGroup(PROXY_GROUPS.FRONT_PROXY, ICONS.frontProxy, ctx.lists.frontProxySelector)
            : null,
        ctx.nodes.landing
            ? selectGroup(
                  PROXY_GROUPS.LANDING,
                  ICONS.landing,
                  ctx.nodes.landingNodes.map((node) => node.name)
              )
            : null,
    ];
}

/** 由声明式目录生成的服务代理组。 */
function buildServiceGroups(ctx: GroupBuildContext): ProxyGroup[] {
    return serviceGroups.map((def) =>
        selectGroup(def.name, def.icon, def.proxies(ctx), def.includeAll)
    );
}

/** 尾部固定代理组：Tailscale、广告拦截、Final、自动选择、故障转移。 */
function buildTailGroups(ctx: GroupBuildContext): Array<ProxyGroup | null> {
    return [
        ctx.nodes.hasTailscale
            ? selectGroup(
                  PROXY_GROUPS.TAILSCALE,
                  ICONS.tailscale,
                  ctx.nodes.tailscaleNodes.map((node) => node.name)
              )
            : null,
        selectGroup(PROXY_GROUPS.AD_BLOCK, ICONS.adBlock, ["REJECT", "REJECT-DROP", "DIRECT"]),
        selectGroup(PROXY_GROUPS.FINAL, ICONS.final, [PROXY_GROUPS.SELECT, "DIRECT"]),
        urlTestGroup(PROXY_GROUPS.AUTO, ICONS.auto, ctx.lists.defaultFallback),
        fallbackGroup(PROXY_GROUPS.FALLBACK, ICONS.fallback, ctx.lists.defaultFallback),
    ];
}

/** 低倍率组与各地区组。 */
function buildRegionGroups(ctx: GroupBuildContext): Array<ProxyGroup | null> {
    const { flags, nodes } = ctx;
    const hasLowCost = nodes.lowCostNodes.length > 0 || flags.regexFilter;
    const hasHighCost = nodes.highCostNodes.length > 0 || flags.regexFilter;
    const countryGroups = buildCountryGroups(ctx);

    const lowCostGroup = hasLowCost
        ? buildGroupByType({
              name: PROXY_GROUPS.LOW_COST,
              icon: ICONS.lowCost,
              groupType: flags.groupType,
              nodeSource: !flags.regexFilter
                  ? { proxies: nodes.lowCostNodes.map((node) => node.name) }
                  : { "include-all": true as const, filter: LOW_COST_NODE_MATCHER.pattern },
          })
        : null;

    const highCostGroup = hasHighCost
        ? buildGroupByType({
              name: PROXY_GROUPS.HIGH_COST,
              icon: ICONS.highCost,
              groupType: flags.groupType,
              nodeSource: !flags.regexFilter
                  ? { proxies: nodes.highCostNodes.map((node) => node.name) }
                  : { "include-all": true as const, filter: HIGH_COST_NODE_MATCHER.pattern },
          })
        : null;

    const otherGroup =
        nodes.smallCountryNodes.length > 0
            ? buildGroupByType({
                  name: PROXY_GROUPS.OTHER,
                  icon: ICONS.other,
                  groupType: flags.groupType,
                  nodeSource: flags.regexFilter
                      ? {
                            "include-all": true as const,
                            filter: nodes.smallCountries
                                .map((country) => countriesMeta[country]?.pattern)
                                .filter(Boolean)
                                .join("|"),
                        }
                      : { proxies: nodes.smallCountryNodes.map((node) => node.name) },
              })
            : null;

    return [
        lowCostGroup,
        highCostGroup,
        ...countryGroups.groups,
        ...countryGroups.lowCostGroups,
        ...countryGroups.highCostGroups,
        ...countryGroups.autoGroups,
        otherGroup,
    ];
}

/**
 * 组装完整的代理组列表。
 * @param ctx - 代理组构建上下文
 * @returns 代理组数组（不含 GLOBAL，GLOBAL 由 `builders/config.ts` 追加）
 */
export function buildProxyGroups(ctx: GroupBuildContext): ProxyGroup[] {
    const groups: Array<ProxyGroup | null> = [
        ...buildFrontGroups(ctx),
        ...buildServiceGroups(ctx),
        ...buildTailGroups(ctx),
        ...buildRegionGroups(ctx),
    ];

    return groups.filter(isNotNull);
}
