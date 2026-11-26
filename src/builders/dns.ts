/**
 * DNS 配置构建，包含 fake-ip 过滤列表与上游 DNS 字段继承。
 */

import type { DnsConfig, DnsPolicyValue } from "../types/clash";

/**
 * 默认的 fake-ip 过滤域名列表：这些域名不会被 fake-ip 机制代理。
 */
const FAKE_IP_FILTER = [
    "*.lan",
    "*.local",
    "*.arpa",
    "+.ts.net",
    "time.*.com",
    "ntp.*.com",
    "+.market.xiaomi.com",
    "localhost.ptlogin2.qq.com",
    "*.msftncsi.com",
    "www.msftconnecttest.com",
];

/** 支持从上游配置继承的 DNS Policy 字段。 */
const DNS_POLICY_FIELDS = ["nameserver-policy", "proxy-server-nameserver-policy"] as const;

/** 判断值是否为非数组对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取仅包含字符串的数组，过滤格式错误的上游字段。 */
function getStringList(value: unknown): string[] | undefined {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? value
        : undefined;
}

/** 合并两个字符串列表并移除重复值，保留当前配置的优先顺序。 */
function mergeStringLists(current: string[] | undefined, upstream: unknown): string[] | undefined {
    const upstreamList = getStringList(upstream);
    if (!current && !upstreamList) return undefined;

    return [...new Set([...(current ?? []), ...(upstreamList ?? [])])];
}

/** 合并合法的上游 DNS Policy，保留已有策略及其优先顺序。 */
function mergeDnsPolicies(
    current: Record<string, DnsPolicyValue> | undefined,
    upstream: unknown
): Record<string, DnsPolicyValue> | undefined {
    if (!isRecord(upstream)) return current;

    const policy = { ...current };
    for (const [key, value] of Object.entries(upstream)) {
        if (Object.hasOwn(policy, key)) continue;
        if (typeof value === "string") {
            policy[key] = value;
        } else {
            const servers = getStringList(value);
            if (servers) policy[key] = servers;
        }
    }

    return policy;
}

/** 仅合并允许继承的上游 DNS 字段，同时保留脚本控制字段的优先级。 */
function inheritDnsFields(generated: DnsConfig, upstream?: DnsConfig): DnsConfig {
    if (!isRecord(upstream)) return generated;

    const merged = { ...generated };

    for (const field of DNS_POLICY_FIELDS) {
        const policy = mergeDnsPolicies(merged[field], upstream[field]);
        if (policy) merged[field] = policy;
    }

    const fakeIpFilter = mergeStringLists(merged["fake-ip-filter"], upstream["fake-ip-filter"]);
    if (fakeIpFilter) merged["fake-ip-filter"] = fakeIpFilter;

    return merged;
}

/** 构建 DNS 配置的输入参数。 */
export interface BuildDnsInput {
    fakeIPEnabled: boolean;
    ipv6Enabled: boolean;
    /** 上游订阅提供的 DNS 配置，将按字段规则继承或融合。 */
    upstreamDns?: DnsConfig;
}

/**
 * 根据 fakeIP 与 IPv6 开关生成最终 DNS 配置，并合并上游允许继承的字段。
 * @param input - 详见 `BuildDnsInput`
 */
export function buildDns({ fakeIPEnabled, ipv6Enabled, upstreamDns }: BuildDnsInput): DnsConfig {
    const generated: DnsConfig = {
        enable: true,
        "enhanced-mode": fakeIPEnabled ? "fake-ip" : "redir-host",
        ...(fakeIPEnabled && {
            "fake-ip-range": "198.18.0.1/16",
            "fake-ip-range6": "fdfe:dcba:9876::1/64",
            "fake-ip-filter-mode": "blacklist",
            "fake-ip-filter": [...FAKE_IP_FILTER],
        }),
        "prefer-h3": false,
        "respect-rules": true,
        "use-hosts": false,
        "use-system-hosts": false,
        ipv6: ipv6Enabled,
        "default-nameserver": ["tls://223.5.5.5", "tls://223.6.6.6"],
        nameserver: ["https://cloudflare-dns.com/dns-query", "https://dns.google/dns-query"],
        "nameserver-policy": { "+.ts.net": "udp://100.100.100.100#DIRECT" },
        "direct-nameserver-follow-policy": true,
        "fallback-filter": {
            geoip: true,
            "geoip-code": "CN",
            ipcidr: ["240.0.0.0/4", "0.0.0.0/32"],
            domain: ["+.google.com", "+.facebook.com", "+.youtube.com"],
        },
        fallback: ["tls://8.8.4.4", "tls://1.1.1.1"],
        "proxy-server-nameserver": [
            "https://dns.alidns.com/dns-query",
            "https://doh.pub/dns-query",
        ],
        "direct-nameserver": ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
    };

    return inheritDnsFields(generated, upstreamDns);
}
