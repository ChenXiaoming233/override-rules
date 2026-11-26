import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDns } from "../../src/builders/dns";
import { buildTunConfig } from "../../src/builders/tun";

describe("buildDns", () => {
    it("fake-ip 模式输出预设的地址范围、过滤规则与解析器", () => {
        const dns = buildDns({ fakeIPEnabled: true, ipv6Enabled: false });
        assert.equal(dns["enhanced-mode"], "fake-ip");
        assert.equal(Object.hasOwn(dns, "listen"), false);
        assert.equal(dns["fake-ip-range"], "198.18.0.1/16");
        assert.equal(dns["fake-ip-range6"], "fdfe:dcba:9876::1/64");
        assert.equal(dns["fake-ip-filter-mode"], "blacklist");
        assert.deepEqual(dns["fake-ip-filter"], [
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
        ]);
        assert.equal(dns["respect-rules"], true);
        assert.deepEqual(dns.nameserver, [
            "https://cloudflare-dns.com/dns-query",
            "https://dns.google/dns-query",
        ]);
        assert.deepEqual(dns["proxy-server-nameserver"], [
            "https://dns.alidns.com/dns-query",
            "https://doh.pub/dns-query",
        ]);
    });

    it("redir-host 模式不含 fake-ip-filter", () => {
        const dns = buildDns({ fakeIPEnabled: false, ipv6Enabled: false });
        assert.equal(dns["enhanced-mode"], "redir-host");
        assert.equal(dns["fake-ip-filter"], undefined);
    });

    it("两种 DNS 模式下均通过直连 MagicDNS 解析 ts.net", () => {
        for (const fakeIPEnabled of [true, false]) {
            const dns = buildDns({ fakeIPEnabled, ipv6Enabled: false });
            assert.equal(dns["nameserver-policy"]?.["+.ts.net"], "udp://100.100.100.100#DIRECT");
            assert.equal(dns["direct-nameserver-follow-policy"], true);
        }
    });

    it("继承其他上游 DNS 策略与 fake-ip-filter，不覆盖内置的同名策略", () => {
        const dns = buildDns({
            fakeIPEnabled: true,
            ipv6Enabled: false,
            upstreamDns: {
                enable: true,
                ipv6: false,
                "prefer-h3": true,
                "enhanced-mode": "fake-ip",
                nameserver: [],
                fallback: [],
                "nameserver-policy": {
                    "geosite:cn": ["223.5.5.5"],
                    "+.ts.net": "8.8.8.8",
                },
                "proxy-server-nameserver-policy": { "node.example.org": "1.1.1.1" },
                "fake-ip-filter": ["+.example.org"],
            },
        });
        assert.deepEqual(Object.entries(dns["nameserver-policy"] ?? {}), [
            ["+.ts.net", "udp://100.100.100.100#DIRECT"],
            ["geosite:cn", ["223.5.5.5"]],
        ]);
        assert.deepEqual(dns["proxy-server-nameserver-policy"], { "node.example.org": "1.1.1.1" });
        assert.ok(dns["fake-ip-filter"]?.includes("+.example.org"));
    });

    it("脚本控制字段优先级高于上游", () => {
        const dns = buildDns({
            fakeIPEnabled: false,
            ipv6Enabled: true,
            upstreamDns: {
                enable: true,
                listen: ":53",
                ipv6: false,
                "prefer-h3": true,
                "enhanced-mode": "fake-ip",
                nameserver: [],
                fallback: [],
            },
        });
        assert.equal(dns["enhanced-mode"], "redir-host");
        assert.equal(dns.ipv6, true);
        assert.equal(Object.hasOwn(dns, "listen"), false);
    });
});

describe("buildTunConfig", () => {
    it("无 Tailscale 时排除 Tailscale、ULA 与本地网络地址段", () => {
        const tun = buildTunConfig(true, false);
        assert.deepEqual(tun["route-exclude-address"], [
            "100.64.0.0/10",
            "fd7a:115c:a1e0::/48",
            "fc00::/7",
            "10.0.0.0/8",
            "172.16.0.0/12",
            "192.168.0.0/16",
            "169.254.0.0/16",
            "224.0.0.0/4",
            "255.255.255.255/32",
            "fe80::/10",
            "ff00::/8",
        ]);
    });

    it("有 Tailscale 时保留其地址段并排除通用本地网络地址段", () => {
        const tun = buildTunConfig(true, true);
        assert.deepEqual(tun["route-exclude-address"], [
            "10.0.0.0/8",
            "172.16.0.0/12",
            "192.168.0.0/16",
            "169.254.0.0/16",
            "224.0.0.0/4",
            "255.255.255.255/32",
            "fe80::/10",
            "ff00::/8",
        ]);
    });

    it("始终排除 IPv4 与 IPv6 本地发现地址", () => {
        const addresses = buildTunConfig(true, false)["route-exclude-address"];
        for (const address of [
            "169.254.0.0/16",
            "224.0.0.0/4",
            "255.255.255.255/32",
            "fe80::/10",
            "ff00::/8",
        ]) {
            assert.ok(addresses.includes(address), `缺少本地网络地址段 ${address}`);
        }
    });

    it("保留设备名与 MTU", () => {
        const tun = buildTunConfig(false, false);
        assert.equal(tun.device, "mihomo");
        assert.equal(tun.mtu, 1500);
        assert.equal(tun.enable, false);
    });
});
