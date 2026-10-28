import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ruleSets } from "../../src/catalog/rule-sets";
import { validateRuleProviderContent } from "../../src/catalog/rule-provider-format";
import type { RuleProvider } from "../../src/types/clash";

const SAMPLES: Record<string, string> = {
    ADBlock: "payload:\n  - '+.example.com'\n",
    QiufengADBlock: "# comment\npayload:\n  - 'example.com'\n",
    SogouInput: "DOMAIN-SUFFIX,example.com\nPROCESS-NAME,Example\n",
    StaticResources: "example.com\n+.example.net\n",
    CDNResources: "DOMAIN,example.com\n",
    TikTok: "DOMAIN-SUFFIX,example.com\n",
    EHentai: "DOMAIN-SUFFIX,example.com\n",
    SteamFix: "DOMAIN-SUFFIX,example.com\n",
    GoogleFCM: "DOMAIN,example.com\n",
    AdditionalFilter: "DOMAIN,example.com\n",
    AdditionalCDNResources: "DOMAIN,example.com\n",
    Weibo: "DOMAIN-SUFFIX,example.com\n",
    GFWList: "payload:\n  - '+.example.com'\n",
};

describe("rule provider contracts", () => {
    for (const [name, provider] of Object.entries(ruleSets)) {
        it(`${name} 的声明格式可解析对应内容`, () => {
            assert.doesNotThrow(() =>
                validateRuleProviderContent(name, provider as RuleProvider, SAMPLES[name])
            );
        });
    }

    it("拒绝 yaml 声明却使用 classical 文本的 provider", () => {
        assert.throws(
            () =>
                validateRuleProviderContent(
                    "Broken",
                    { ...ruleSets.ADBlock, behavior: "domain", format: "yaml" },
                    "DOMAIN,example.com\n"
                ),
            /payload/
        );
    });

    it("拒绝 domain 规则集中混入 classical 规则", () => {
        assert.throws(
            () =>
                validateRuleProviderContent(
                    "Broken",
                    { ...ruleSets.StaticResources, behavior: "domain" },
                    "DOMAIN,example.com\n"
                ),
            /domain/
        );
    });
});
