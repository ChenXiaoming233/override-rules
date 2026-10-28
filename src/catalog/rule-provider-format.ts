import { parse } from "yaml";

import type { RuleProvider } from "../types/clash";

const CLASSICAL_RULE_TYPES = new Set([
    "DOMAIN",
    "DOMAIN-SUFFIX",
    "DOMAIN-KEYWORD",
    "DOMAIN-REGEX",
    "DOMAIN-WILDCARD",
    "GEOSITE",
    "IP-CIDR",
    "IP-CIDR6",
    "IP-SUFFIX",
    "SRC-IP-CIDR",
    "SRC-IP-SUFFIX",
    "DST-PORT",
    "SRC-PORT",
    "PROCESS-NAME",
    "PROCESS-PATH",
    "PROCESS-NAME-REGEX",
    "PROCESS-PATH-REGEX",
]);

function getRuleLines(content: string): string[] {
    return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith(";"));
}

function parseYamlPayload(providerName: string, content: string): string[] {
    const document = parse(content) as unknown;
    if (typeof document !== "object" || document === null || Array.isArray(document)) {
        throw new Error(`${providerName}: yaml provider 必须是包含 payload 数组的映射`);
    }

    const payload = (document as Record<string, unknown>).payload;
    if (!Array.isArray(payload) || payload.some((item) => typeof item !== "string")) {
        throw new Error(`${providerName}: yaml provider 缺少字符串 payload 数组`);
    }
    return payload as string[];
}

function validateDomainEntry(providerName: string, entry: string): void {
    const domain = entry.trim().replace(/^\+\./, "");
    if (domain.length === 0 || domain.includes(",") || /\s/.test(domain) || domain === "+.") {
        throw new Error(`${providerName}: domain provider 包含非法条目: ${entry}`);
    }
}

function validateClassicalEntry(providerName: string, entry: string): void {
    const [type] = entry.split(",");
    if (!CLASSICAL_RULE_TYPES.has(type)) {
        throw new Error(`${providerName}: classical provider 包含未知规则类型: ${type}`);
    }
}

/**
 * 校验 Rule Provider 的声明格式与内容契约。
 *
 * 该函数不访问网络，供测试和 CI 对下载后的样本或 fixture 复用。
 * @param providerName - provider 名称，用于错误定位
 * @param provider - provider 声明
 * @param content - provider 的实际文本内容
 */
export function validateRuleProviderContent(
    providerName: string,
    provider: RuleProvider,
    content: string | undefined
): void {
    if (content === undefined) {
        throw new Error(`${providerName}: 缺少校验样本`);
    }

    const lines = getRuleLines(content);
    if (lines.length === 0) {
        throw new Error(`${providerName}: provider 内容为空`);
    }

    if (provider.format === "yaml") {
        const payload = parseYamlPayload(providerName, content);
        if (payload.length === 0) {
            throw new Error(`${providerName}: yaml payload 不能为空`);
        }
        if (provider.behavior === "domain") {
            for (const entry of payload) validateDomainEntry(providerName, entry);
        } else if (provider.behavior === "classical") {
            for (const entry of payload) validateClassicalEntry(providerName, entry);
        }
        return;
    }

    if (provider.format === "text") {
        if (provider.behavior === "domain") {
            for (const entry of lines) validateDomainEntry(providerName, entry);
        } else if (provider.behavior === "classical") {
            for (const entry of lines) validateClassicalEntry(providerName, entry);
        }
        return;
    }

    if (provider.format === "mrs") {
        throw new Error(`${providerName}: mrs provider 不能使用文本校验`);
    }
}
