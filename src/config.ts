import { createHash } from 'node:crypto';
import { VERSION } from './domain';
export interface Config {
  mode: 'live' | 'mock'; host: string; port: number; db: string; epoch: string;
  jevBase: string; jevModel: string; jevKey: string;
  base: string; model: string; key: string;
  jsonMode: 'json_object' | 'json_schema' | 'off'; thinking: 'omit' | 'disabled' | 'enabled';
  maxTokens: number; timeout: number;
}
function endpoint(s: string): string {
  const u = new URL(s);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('Invalid provider base URL');
  return u.href.replace(/\/$/, '');
}
function enumValue<T extends string>(value: string, options: readonly T[]): T {
  if (!options.includes(value as T)) throw new Error(`Expected one of: ${options.join(', ')}`);
  return value as T;
}
function integer(value: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('Invalid numeric configuration');
  return n;
}
export function loadConfig(e: NodeJS.ProcessEnv = process.env): Config {
  const mode = enumValue(e.APP_MODE || 'live', ['live', 'mock']);
  const c: Config = {
    mode, host: e.HOST || '127.0.0.1', port: integer(e.PORT || '3000', 0, 65535),
    db: e.WORLD_DB || 'data/world.sqlite', epoch: e.WORLD_EPOCH || 'mvp-1',
    jevBase: endpoint(e.JEV_BASE_URL || 'https://api.typesafe.ai/v1'), jevModel: e.JEV_MODEL || 'jev-latest',
    jevKey: e.JEV_API_KEY || e.TYPESAFE_API_KEY || '',
    base: endpoint(e.OPENAI_BASE_URL || 'https://api.deepseek.com/v1'), model: e.OPENAI_MODEL || 'deepseek-flash',
    key: e.OPENAI_API_KEY || '',
    jsonMode: enumValue(e.OPENAI_JSON_MODE || 'json_object', ['json_object', 'json_schema', 'off']),
    thinking: enumValue(e.OPENAI_THINKING || 'omit', ['omit', 'disabled', 'enabled']),
    maxTokens: integer(e.OPENAI_MAX_TOKENS || '4096', 512, 32768),
    timeout: integer(e.REQUEST_TIMEOUT_MS || '120000', 50, 300000),
  };
  if (mode === 'live' && !c.jevKey) throw new Error('Live mode requires JEV_API_KEY (or TYPESAFE_API_KEY)');
  return c;
}
export function namespace(c: Config): string {
  // Separate fixture worlds, model/prompt versions and provider configuration.
  // Credentials never enter the cache, UI, or diagnostics.
  return createHash('sha256').update(JSON.stringify([VERSION, c.epoch, c.mode, c.base, c.model,
    c.jevBase, c.jevModel, c.jsonMode, c.thinking, c.maxTokens])).digest('hex').slice(0, 24);
}
