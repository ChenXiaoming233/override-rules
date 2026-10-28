import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRules } from "../../src/builders/rules";
import { ruleSets } from "../../src/catalog/rule-sets";

describe("buildRules", () => {
    it("未启用 quic 时插入 UDP 443 拦截规则", () => {
        const rules = buildRules({ quicEnabled: false, hasTailscale: false });
        assert.equal(rules[0], "AND,((DST-PORT,443),(NETWORK,UDP)),REJECT");
    });

    it("启用 quic 时不插入拦截规则", () => {
        const rules = buildRules({ quicEnabled: true, hasTailscale: false });
        assert.ok(!rules.includes("AND,((DST-PORT,443),(NETWORK,UDP)),REJECT"));
    });

    it("包含 fork 的广告与国内 CDN 直连规则", () => {
        const rules = buildRules({ quicEnabled: true, hasTailscale: false });
        assert.ok(rules.includes("RULE-SET,QiufengADBlock,广告拦截"));
        assert.ok(rules.includes("AND,((RULE-SET,StaticResources),(GEOSITE,cn)),DIRECT"));
        assert.ok(rules.includes("AND,((RULE-SET,StaticResources),(GEOIP,cn,no-resolve)),DIRECT"));
        assert.ok(rules.includes("AND,((RULE-SET,CDNResources),(GEOSITE,cn)),DIRECT"));
        assert.ok(rules.includes("AND,((RULE-SET,CDNResources),(GEOIP,cn,no-resolve)),DIRECT"));
        assert.ok(rules.includes("AND,((RULE-SET,AdditionalCDNResources),(GEOSITE,cn)),DIRECT"));
        assert.ok(
            rules.includes("AND,((RULE-SET,AdditionalCDNResources),(GEOIP,cn,no-resolve)),DIRECT")
        );
        assert.ok(rules.includes("GEOSITE,cn,DIRECT"));
    });

    it("SogouInput 优先于广告规则，避免放行域名被广告规则拦截", () => {
        const rules = buildRules({ quicEnabled: true, hasTailscale: false });
        const sogouIndex = rules.indexOf("RULE-SET,SogouInput,搜狗输入法");
        const adIndexes = [
            "RULE-SET,ADBlock,广告拦截",
            "RULE-SET,QiufengADBlock,广告拦截",
            "RULE-SET,AdditionalFilter,广告拦截",
        ].map((rule) => rules.indexOf(rule));

        assert.notEqual(sogouIndex, -1);
        for (const adIndex of adIndexes) {
            assert.notEqual(adIndex, -1);
            assert.ok(sogouIndex < adIndex, "SogouInput 必须先于所有广告规则");
        }
    });

    it("Tailscale 存在时生成对应分流规则", () => {
        const rules = buildRules({ quicEnabled: true, hasTailscale: true });
        assert.ok(rules.includes("IP-CIDR,100.64.0.0/10,Tailscale,no-resolve"));
        assert.ok(rules.includes("DOMAIN-SUFFIX,ts.net,Tailscale"));
    });

    it("Tailscale 不存在时不生成对应分流规则", () => {
        const rules = buildRules({ quicEnabled: true, hasTailscale: false });
        assert.ok(!rules.some((rule) => rule.includes("Tailscale")));
    });

    it("所有引用的规则集均已注册", () => {
        const rules = buildRules({ quicEnabled: true, hasTailscale: true });
        for (const rule of rules) {
            if (!rule.startsWith("RULE-SET,")) continue;
            const key = rule.split(",")[1];
            assert.ok(key in ruleSets, `未注册的规则集: ${key}`);
        }
    });

    it("以 MATCH 收尾", () => {
        const rules = buildRules({ quicEnabled: true, hasTailscale: false });
        assert.equal(rules.at(-1), "MATCH,Final");
    });
});
