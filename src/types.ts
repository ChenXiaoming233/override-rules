export interface ScriptArgs {
    grouptype?: string;
    loadbalance?: string;
    landing?: string;
    ipv6?: string;
    full?: string;
    keepalive?: string;
    fakeip?: string;
    quic?: string;
    regex?: string;
    threshold?: string;
    "lowcost-split"?: string;
    "highcost-split"?: string;
    "auto-split"?: string;
    tun?: string;
    "lite-combine"?: string;
}

export type GroupType = 0 | 1 | 2;

export interface FeatureFlags {
    groupType: GroupType;
    landing: boolean;
    ipv6Enabled: boolean;
    fullConfig: boolean;
    keepAliveEnabled: boolean;
    fakeIPEnabled: boolean;
    quicEnabled: boolean;
    regexFilter: boolean;
    countryThreshold: number;
    splitLowCost: boolean;
    splitHighCost: boolean;
    autoSplit: boolean;
    tunEnabled: boolean;
    liteCombine: number;
}

export interface ProxyNode {
    name: string;
    type?: string;
    server?: string;
    port?: number;
    [key: string]: unknown;
}

export type ProxyGroupType = "select" | "url-test" | "load-balance" | "fallback";

export type LoadBalanceStrategy = "sticky-sessions" | "consistent-hashing" | "round-robin";

export interface BaseProxyGroup {
    name: string;
    icon?: string;
    proxies?: string[];
    "include-all"?: boolean;
    filter?: string;
    "exclude-filter"?: string;
}

export interface SelectProxyGroup extends BaseProxyGroup {
    type: "select";
}

export interface UrlTestProxyGroup extends BaseProxyGroup {
    type: "url-test";
    url: string;
    interval: number;
    tolerance: number;
}

export interface LoadBalanceProxyGroup extends BaseProxyGroup {
    type: "load-balance";
    url: string;
    interval: number;
    tolerance: number;
    strategy: LoadBalanceStrategy;
}

export interface FallbackProxyGroup extends BaseProxyGroup {
    type: "fallback";
    url: string;
    interval: number;
    tolerance: number;
}

export type ProxyGroup =
    | SelectProxyGroup
    | UrlTestProxyGroup
    | LoadBalanceProxyGroup
    | FallbackProxyGroup;

export interface SnifferProtocolConfig {
    ports: number[];
}

export interface SnifferConfig {
    sniff: {
        TLS?: SnifferProtocolConfig;
        HTTP?: SnifferProtocolConfig;
        QUIC?: SnifferProtocolConfig;
    };
    "override-destination": boolean;
    enable: boolean;
    "force-dns-mapping": boolean;
    "skip-domain": string[];
}

export interface TunConfig {
    enable: boolean;
    stack: "gvisor" | "system" | "mixed";
    device: string;
    "route-exclude-address": string[];
    "dns-hijack": string[];
    mtu: number;
}

export interface DnsConfig {
    enable: boolean;
    ipv6: boolean;
    "prefer-h3": boolean;
    "enhanced-mode": "redir-host" | "fake-ip";
    "default-nameserver": string[];
    nameserver: string[];
    fallback: string[];
    "proxy-server-nameserver": string[];
    "fake-ip-filter"?: string[];
}

export type RuleProviderType = "http" | "file";
export type RuleProviderBehavior = "domain" | "classical" | "ipcidr";
export type RuleProviderFormat = "mrs" | "text" | "yaml";

export interface RuleProvider {
    type: RuleProviderType;
    behavior: RuleProviderBehavior;
    format: RuleProviderFormat;
    interval: number;
    url: string;
    path: string;
}

export interface GeoxUrl {
    geoip?: string;
    geosite?: string;
    mmdb?: string;
    asn?: string;
}

export interface ClashProfile {
    "store-selected"?: boolean;
    "store-fake-ip"?: boolean;
}

export interface ClashConfig {
    proxies?: ProxyNode[];
    "proxy-groups"?: ProxyGroup[];
    rules?: string[];
    "rule-providers"?: Record<string, RuleProvider>;
    dns?: DnsConfig;
    sniffer?: SnifferConfig;
    tun?: TunConfig;
    "geodata-mode"?: boolean;
    "geox-url"?: GeoxUrl;
    "mixed-port"?: number;
    "redir-port"?: number;
    "tproxy-port"?: number;
    "routing-mark"?: number;
    "allow-lan"?: boolean;
    "bind-address"?: string;
    ipv6?: boolean;
    mode?: "rule" | "global" | "direct";
    "unified-delay"?: boolean;
    "tcp-concurrent"?: boolean;
    "find-process-mode"?: "off" | "strict" | "always";
    "log-level"?: "info" | "warning" | "error" | "debug" | "silent";
    "geodata-loader"?: "standard" | "memconservative";
    "external-controller"?: string;
    "disable-keep-alive"?: boolean;
    profile?: ClashProfile;
}

export interface CountryMeta {
    weight?: number;
    pattern: string;
    icon: string;
}

export interface CountryInfoItem {
    country: string;
    nodes: string[];
}

export interface CaseInsensitiveNodeMatcher {
    source: string;
    regex: RegExp;
    pattern: string;
}

export interface BaseLists {
    defaultProxies: string[];
    defaultProxiesDirect: string[];
    defaultSelector: string[];
    defaultFallback: string[];
    frontProxySelector: string[];
    staticResourcesProxies: string[];
}

export interface BuildBaseListsInput {
    landing: boolean;
    lowCostNodes: string[];
    highCostNodes: string[];
    countryGroupNames: string[];
    nonLandingNodes: string[];
    regexFilter: boolean;
    countryLowCostGroupNames?: string[];
}

export interface BuildCountryProxyGroupsInput {
    countries: string[];
    landing: boolean;
    groupType: GroupType;
    regexFilter: boolean;
    countryInfo: CountryInfoItem[];
    splitLowCost: boolean;
    lowCostNodes: string[];
    splitHighCost: boolean;
    highCostNodes: string[];
    autoSplit: boolean;
}

export interface BuildProxyGroupsInput {
    landing: boolean;
    regexFilter: boolean;
    groupType: GroupType;
    countries: string[];
    countryProxyGroups: ProxyGroup[];
    countryLowCostGroups: ProxyGroup[];
    countryHighCostGroups: ProxyGroup[];
    countryAutoGroups: ProxyGroup[];
    smallCountryGroup?: ProxyGroup | null;
    lowCostNodes: string[];
    highCostNodes: string[];
    landingNodes: string[];
    defaultProxies: string[];
    defaultProxiesDirect: string[];
    defaultSelector: string[];
    defaultFallback: string[];
    frontProxySelector: string[];
    staticResourcesProxies: string[];
}
