/*!
powerfullz 的 Substore 订阅转换脚本
https://github.com/powerfullz/override-rules

支持的传入参数：
- grouptype: 地区代理组类型（0=select 手动选择, 1=url-test 自动测速, 2=load-balance 负载均衡，默认 0）
  - 向后兼容：若未传 grouptype 但传了 loadbalance，则 loadbalance=true 映射为 grouptype=2，loadbalance=false 映射为 grouptype=1
- landing: auto-detected from nodes with `dialer-proxy` field; no user parameter needed
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
import { buildCountryProxyGroups, buildProxyGroups, buildGroupByType } from "./proxy_groups";
import {
    getActiveCountryNames,
    parseCountries,
    parseLowCost,
    parseHighCost,
    parseNodesByLanding,
    parseSmallCountries,
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
    if (!config.proxies || !Array.isArray(config.proxies)) {
        throw new Error("[powerfullz 的覆写脚本] 错误：Clash 配置中缺少有效的 proxies 字段");
    }

    // 自动检测落地节点：当订阅中同时存在带 dialer-proxy 和不带的节点时激活
    const { landingNodes, nonLandingNodes } = parseNodesByLanding(config.proxies);
    const landing = landingNodes.length > 0 && nonLandingNodes.length > 0;

    // 根据落地状态选择解析节点范围：激活时只对非落地节点分组
    const nodesToParse = landing ? nonLandingNodes : config.proxies;
    const countryNodes = parseCountries(nodesToParse);
    const lowCostNodes = parseLowCost(nodesToParse);
    const highCostNodes = parseHighCost(nodesToParse, lowCostNodes);

    // lite-combine: 拆分小地区节点
    let smallCountryNodes: ProxyGroup["proxies"] = [];
    let smallCountryPatterns: string[] = [];
    let filteredCountryNodes = countryNodes;

    if (liteCombine > 0) {
        const { small, regular } = parseSmallCountries(countryNodes, liteCombine);
        smallCountryNodes = Object.values(small)
            .flat()
            .map((n) => n.name)
            .filter(Boolean) as string[];
        smallCountryPatterns = Object.keys(small)
            .map((c) => countriesMeta[c]?.pattern)
            .filter(Boolean) as string[];
        filteredCountryNodes = regular;
    }

    const countryNames = getActiveCountryNames(filteredCountryNodes, countryThreshold);

    // 构建"其他节点"合并代理组
    let smallCountryGroup: ProxyGroup | null = null;
    const smallCountryGroupName = smallCountryNodes.length > 0 ? PROXY_GROUPS.OTHER : undefined;

    if (smallCountryGroupName) {
        const smallCountryNodeSource = !regexFilter
            ? { proxies: smallCountryNodes }
            : { "include-all": true as const, filter: "(?i)" + smallCountryPatterns.join("|") };

        smallCountryGroup = buildGroupByType({
            name: smallCountryGroupName,
            icon: OTHER_ICON,
            groupType,
            nodeSource: smallCountryNodeSource,
        });
    }

    const {
        groups: countryProxyGroups,
        lowCostSubGroups: countryLowCostGroups,
        highCostSubGroups: countryHighCostGroups,
        autoSubGroups: countryAutoGroups,
    } = buildCountryProxyGroups({
        countries: countryNames,
        landing,
        groupType,
        regexFilter,
        countryNodes: filteredCountryNodes,
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
        countryNames,
        nonLandingNodes,
        regexFilter,
        countryLowCostGroupNames,
    });

    const proxyGroups = buildProxyGroups({
        landing,
        regexFilter,
        groupType,
        countries: countryNames,
        countryNodes: filteredCountryNodes,
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
