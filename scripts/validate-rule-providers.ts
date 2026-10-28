/**
 * 下载并校验所有 Rule Provider 的声明格式与内容契约。
 *
 * 该脚本在 CI 中运行，防止上游把 yaml 规则改为纯文本后直到运行时才暴露。
 */

import { ruleSets } from "../src/catalog/rule-sets";
import { validateRuleProviderContent } from "../src/catalog/rule-provider-format";
import type { RuleProvider } from "../src/types/clash";

const TIMEOUT_MS = 30_000;

async function download(url: string): Promise<string> {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "override-rules-provider-validator" },
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return response.text();
}

async function main(): Promise<void> {
    const entries = Object.entries(ruleSets) as Array<[string, RuleProvider]>;
    const results = await Promise.allSettled(
        entries.map(async ([name, provider]) => {
            const content = await download(provider.url);
            validateRuleProviderContent(name, provider, content);
            return name;
        })
    );

    let failed = 0;
    results.forEach((result, index) => {
        const name = entries[index][0];
        if (result.status === "fulfilled") {
            console.log(`ok ${name}`);
        } else {
            failed += 1;
            console.error(
                `fail ${name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
            );
        }
    });

    if (failed > 0) {
        throw new Error(`${failed}/${entries.length} rule providers failed validation`);
    }
    console.log(`validated ${entries.length} rule providers`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
