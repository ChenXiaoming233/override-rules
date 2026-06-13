/*!
powerfullz 的 Substore 订阅转换脚本
https://github.com/powerfullz/override-rules

支持的传入参数：
- grouptype: 地区代理组类型（0=select 手动选择, 1=url-test 自动测速, 2=load-balance 负载均衡，默认 0）
  - 向后兼容：若未传 grouptype 但传了 loadbalance，则 loadbalance=true 映射为 grouptype=2，loadbalance=false 映射为 grouptype=1
- landing: 启用落地节点功能（如机场家宽/星链/落地分组，默认 false）
- ipv6: 启用 IPv6 支持（默认 false）
- tun: 启用 TUN 模式（默认 false）
- full: 输出完整配置（适合纯内核启动，默认 false）
- keepalive: 启用 tcp-keep-alive（默认 false）
- fakeip: DNS 使用 FakeIP 模式（默认 true；传 false 时为 RedirHost）
- quic: 允许 QUIC 流量（UDP 443，默认 false）
- lite-combine: 将节点数不超过该值的地区合并到统一的"其他节点"代理组中，放置在地区节点组的最后。设为 0 禁用此功能 (默认 1)
- threshold: 地区节点数量小于该值时不显示分组 (默认 0)
- regex: 使用正则过滤模式（include-all + filter）写入各地区代理组，而非直接枚举节点名称（默认 false）

源码已迁移至 `src/*.ts`。
*/

import { CDN_URL, OTHER_ICON, PROXY_GROUPS, countriesMeta } from "./constants";
import { buildFeatureFlags } from "./args";
import { buildCountryProxyGroups, buildProxyGroups } from "./proxy_groups";
import {
    getCountryGroupNames,
    parseCountries,
    parseLowCost,
    parseHighCost,
    parseNodesByLanding,
    parseSmallCountries,
    stripNodeSuffix,
} from "./node_parser";
import { buildRules } from "./rules";
import { ruleProviders } from "./rule_providers";
import { buildDns, snifferConfig } from "./dns";
import { buildTunConfig } from "./tun";
import { buildBaseLists } from "./selectors";
import type { ClashConfig, ProxyGroup, ScriptArgs } from "./types";

const geoxURL = {
    geoip: `${CDN_URL}/gh/MetaCubeX/meta-rules-dat@release/geoip.dat`,
    geosite: `${CDN_URL}/gh/MetaCubeX/meta-rules-dat@release/geosite.dat`,
    mmdb: `${CDN_URL}/gh/MetaCubeX/meta-rules-dat@release/country.mmdb`,
    asn: `${CDN_URL}/gh/MetaCubeX/meta-rules-dat@release/GeoLite2-ASN.mmdb`,
};

declare const $arguments: ScriptArgs;

function getRawArgs(): ScriptArgs {
    try {
        return $arguments;
    } catch {
        console.log("[powerfullz 的覆写脚本] 未检测到传入参数，使用默认参数。", {});
        return {};
    }
}

const rawArgs = getRawArgs();
const {
    groupType,
    landing,
    ipv6Enabled,
    fullConfig,
    keepAliveEnabled,
    fakeIPEnabled,
    quicEnabled,
    regexFilter,
    splitLowCost,
    splitHighCost,
    autoSplit,
    tunEnabled,
    countryThreshold,
    liteCombine,
} = buildFeatureFlags(rawArgs);

function main(config: ClashConfig): ClashConfig {
    const countryInfo = parseCountries(config, landing);
    const lowCostNodes = parseLowCost(config);
    const highCostNodes = parseHighCost(config, lowCostNodes);

    // Split off small countries if liteCombine is enabled
    let smallCountryNodes: string[] = [];
    let smallCountryPatterns: string[] = [];
    let filteredCountryInfo = countryInfo;

    if (liteCombine > 0) {
        const { small, regular } = parseSmallCountries(countryInfo, liteCombine);
        smallCountryNodes = small.flatMap((item) => item.nodes);
        smallCountryPatterns = small
            .map((item) => countriesMeta[item.country]?.pattern)
            .filter(Boolean) as string[];
        filteredCountryInfo = regular;
    }

    const countryGroupNames = getCountryGroupNames(filteredCountryInfo, countryThreshold);
    const countries = stripNodeSuffix(countryGroupNames);

    const { landingNodes, nonLandingNodes } = landing
        ? parseNodesByLanding(config)
        : { landingNodes: [], nonLandingNodes: [] };

    // Build the merged "\u5176\u4ed6\u8282\u70b9" proxy group from small countries
    let smallCountryGroup: ProxyGroup | null = null;
    const smallCountryGroupName = smallCountryNodes.length > 0 ? PROXY_GROUPS.OTHER : undefined;

    if (smallCountryGroupName) {
        const smallCountryNodeSource = !regexFilter
            ? { proxies: smallCountryNodes }
            : { "include-all": true as const, filter: "(?i)" + smallCountryPatterns.join("|") };

        switch (groupType) {
            case 0:
                smallCountryGroup = {
                    name: smallCountryGroupName,
                    icon: OTHER_ICON,
                    type: "select",
                    ...smallCountryNodeSource,
                };
                break;
            case 1:
                smallCountryGroup = {
                    name: smallCountryGroupName,
                    icon: OTHER_ICON,
                    type: "url-test",
                    url: "https://cp.cloudflare.com/generate_204",
                    interval: 60,
                    tolerance: 20,
                    ...smallCountryNodeSource,
                };
                break;
            case 2:
                smallCountryGroup = {
                    name: smallCountryGroupName,
                    icon: OTHER_ICON,
                    type: "load-balance",
                    strategy: "sticky-sessions",
                    url: "https://cp.cloudflare.com/generate_204",
                    interval: 60,
                    tolerance: 20,
                    ...smallCountryNodeSource,
                };
                break;
        }
    }

    const allCountryGroupNames = smallCountryGroupName
        ? [...countryGroupNames, smallCountryGroupName]
        : countryGroupNames;

    const {
        groups: countryProxyGroups,
        lowCostSubGroups: countryLowCostGroups,
        highCostSubGroups: countryHighCostGroups,
        autoSubGroups: countryAutoGroups,
    } = buildCountryProxyGroups({
        countries,
        landing,
        groupType,
        regexFilter,
        countryInfo: filteredCountryInfo,
        splitLowCost,
        lowCostNodes,
        splitHighCost,
        highCostNodes,
        autoSplit,
    });

    const countryLowCostGroupNames = countryLowCostGroups.map((g) => g.name);

    const {
        defaultProxies,
        defaultProxiesDirect,
        defaultSelector,
        defaultFallback,
        frontProxySelector,
        staticResourcesProxies,
    } = buildBaseLists({
        landing,
        lowCostNodes,
        highCostNodes,
        countryGroupNames: allCountryGroupNames,
        nonLandingNodes,
        regexFilter,
        countryLowCostGroupNames,
    });

    const proxyGroups = buildProxyGroups({
        landing,
        regexFilter,
        groupType,
        countries,
        countryProxyGroups,
        countryLowCostGroups,
        countryHighCostGroups,
        countryAutoGroups,
        smallCountryGroup,
        lowCostNodes,
        highCostNodes,
        landingNodes,
        defaultProxies,
        defaultProxiesDirect,
        defaultSelector,
        defaultFallback,
        frontProxySelector,
        staticResourcesProxies,
    });

    const globalProxies = proxyGroups.map((item) => String(item.name));
    proxyGroups.push({
        name: PROXY_GROUPS.GLOBAL,
        icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Global.png`,
        "include-all": true,
        type: "select",
        proxies: globalProxies,
    });

    const finalRules = buildRules({ quicEnabled });

    return {
        proxies: config.proxies,
        ...(fullConfig && {
            "mixed-port": 7890,
            "redir-port": 7892,
            "tproxy-port": 7893,
            "routing-mark": 7894,
            "allow-lan": true,
            "bind-address": "*",
            ipv6: ipv6Enabled,
            mode: "rule",
            "unified-delay": true,
            "tcp-concurrent": true,
            "find-process-mode": "off",
            "log-level": "info",
            "geodata-loader": "standard",
            "external-controller": ":9999",
            "disable-keep-alive": !keepAliveEnabled,
            profile: { "store-selected": true },
        }),
        "proxy-groups": proxyGroups,
        "rule-providers": ruleProviders,
        rules: finalRules,
        sniffer: snifferConfig,
        dns: buildDns({ fakeIPEnabled, ipv6Enabled }),
        tun: buildTunConfig(tunEnabled),
        "geodata-mode": true,
        "geox-url": geoxURL,
    };
}

(globalThis as Record<string, unknown>).main = main;
