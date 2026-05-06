import { z } from 'zod';
import { toJSONSchema } from 'zod/v4/core';
import { ScopeHandler, ParsedScope } from './types';
import { minerHandler } from './miner';
import { validatorHandler } from './validator';
import { ownerHandler } from './owner';
import { holderHandler } from './holder';
import { taoHolderHandler } from './taoHolder';
import { delegateHandler } from './delegate';
import { stakerHandler } from './staker';
import { SignMethod } from '../crypto/address';
import { taoStringToRao } from '../taostats/client';

const ss58Address = z
  .string()
  .regex(/^5[1-9A-HJ-NP-Za-km-z]{47}$/, 'Must be a valid SS58 address (starts with 5, 48 characters)');

const netuid = z.number().int().nonnegative().max(32768);
const positiveAmount = z.number().positive();
const optionalPositiveAmount = z.number().positive().optional();

/**
 * Segment ADT — describes one position in a scope tuple. Three kinds:
 *   - literal:        fixed string at this position; cannot be wildcarded
 *   - param + pattern: typed value matched by `pattern`; templates use `templatePlaceholder` (default `*`)
 *   - param + enum:    fixed set of values; templates expand into one entry per value
 *
 * `optional: true` is only valid on trailing segments and produces both
 * with-and-without templates.
 */
export type Segment =
  | { literal: string }
  | { param: string; pattern: string; templatePlaceholder?: string; optional?: boolean }
  | { param: string; enum: string[]; optional?: boolean };

const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;
const escapeLiteral = (s: string): string => s.replace(REGEX_ESCAPE, '\\$&');
const isOptional = (s: Segment): boolean => 'param' in s && s.optional === true;

function segPattern(seg: Segment): string {
  if ('literal' in seg) return escapeLiteral(seg.literal);
  if ('enum' in seg) return seg.enum.map(escapeLiteral).join('|');
  return seg.pattern;
}

function segTemplateValues(seg: Segment): string[] {
  if ('literal' in seg) return [seg.literal];
  if ('enum' in seg) return seg.enum;
  return [seg.templatePlaceholder ?? '*'];
}

function deriveRegex(segments: Segment[]): RegExp {
  const required = segments.filter((s) => !isOptional(s));
  const optional = segments.filter(isOptional);

  const renderRequired = (seg: Segment): string => {
    if ('literal' in seg) return escapeLiteral(seg.literal);
    return `(?<${seg.param}>${segPattern(seg)})`;
  };
  const renderOptional = (seg: Segment): string => {
    if ('literal' in seg) return `(?::${escapeLiteral(seg.literal)})?`;
    return `(?::(?<${seg.param}>${segPattern(seg)}))?`;
  };

  const head = required.map(renderRequired).join(':');
  const tail = optional.map(renderOptional).join('');
  return new RegExp(`^${head}${tail}$`);
}

function deriveAllowedEntryRegex(segments: Segment[]): RegExp {
  const required = segments.filter((s) => !isOptional(s));
  const optional = segments.filter(isOptional);

  const renderRequired = (seg: Segment): string => {
    if ('literal' in seg) return escapeLiteral(seg.literal);
    return `(?:\\*|${segPattern(seg)})`;
  };
  const renderOptional = (seg: Segment): string => {
    if ('literal' in seg) return `(?::${escapeLiteral(seg.literal)})?`;
    return `(?::(?:\\*|${segPattern(seg)}))?`;
  };

  const head = required.map(renderRequired).join(':');
  const tail = optional.map(renderOptional).join('');
  return new RegExp(`^${head}${tail}$`);
}

function deriveFormat(segments: Segment[]): string {
  const renderRequired = (seg: Segment): string => ('literal' in seg ? seg.literal : `{${seg.param}}`);
  const renderOptional = (seg: Segment): string =>
    'literal' in seg ? `[:${seg.literal}]` : `[:{${seg.param}}]`;

  const head = segments.filter((s) => !isOptional(s)).map(renderRequired).join(':');
  const tail = segments.filter(isOptional).map(renderOptional).join('');
  return head + tail;
}

function deriveTemplates(segments: Segment[]): string[] {
  const required = segments.filter((s) => !isOptional(s));
  const optional = segments.filter(isOptional);

  let current: string[] = [''];
  for (const seg of required) {
    const values = segTemplateValues(seg);
    current = current.flatMap((c) => values.map((v) => (c === '' ? v : `${c}:${v}`)));
  }

  const result: string[] = [...current];
  for (const seg of optional) {
    const values = segTemplateValues(seg);
    current = current.flatMap((c) => values.map((v) => `${c}:${v}`));
    result.push(...current);
  }
  return result;
}

const AMT = '\\d+(?:\\.\\d+)?';
const SS58 = '5[1-9A-HJ-NP-Za-km-z]{47}';
const RAO_PER_UNIT = BigInt(1e9);

function optionalAmount(raw: string | undefined): bigint | undefined {
  return raw !== undefined ? taoStringToRao(raw) : undefined;
}

function raoToDisplay(rao: bigint): string {
  const whole = rao / RAO_PER_UNIT;
  const frac = rao % RAO_PER_UNIT;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

const SUBNET_ROLE_LABEL: Record<string, string> = {
  miner: 'Miner',
  validator: 'Validator',
  owner: 'Owner',
  holder: 'Token Holder',
};

export type ParseGroups = Record<string, string | undefined>;

export interface ScopeDefinition {
  id: string;
  name: string;
  description: string;
  /** Source of truth for the scope's tuple structure. All four derived fields below are computed from this by `defineScope`. */
  segments: Segment[];
  /** Human-readable format pattern (e.g. 'subnet:{netuid}:{role}') — derived from segments. */
  format: string;
  /** OIDC scopes_supported templates (e.g. 'subnet:*:miner') — derived from segments. */
  templates: string[];
  /** Concrete-scope regex with named captures — derived from segments. */
  regex: RegExp;
  /**
   * Wildcard-aware regex matching valid `allowed_scopes` entries — derived from segments.
   *
   * `*` may replace parameter segments, including enum parameters (so
   * `subnet:1:*` is a valid `subnet_role` entry that matches any role), but
   * never literal segments. Runtime authorization is additionally gated by
   * the requesting scope's `allowedEntryRegex`, so wildcards cannot
   * authorize a different scope category with a similar tuple shape.
   */
  allowedEntryRegex: RegExp;
  /** Zod schema for JSON Schema generation and front-end validation metadata. Not used for runtime validation. */
  params: z.ZodObject<z.ZodRawShape>;
  parse: (groups: ParseGroups) => ParsedScope;
  handlers: Record<string, ScopeHandler>;
  sign_methods: SignMethod[];
  testnet_supported: boolean;
  /** Marks scopes that are identity-only (e.g. `openid`) — skipped by on-chain verification and excluded from JSON Schema discovery. */
  isMetadata?: boolean;
  /** Human-readable description used by the consent screen and event log. */
  describe(parsed: ParsedScope): string;
  /** Amount-stripped form of an amount-bearing scope (e.g. `subnet:1:holder` for `subnet:1:holder:100`), or undefined when the scope has no base form. */
  baseScope(parsed: ParsedScope): string | undefined;
  /** Override sign-method support. Defaults to `sign_methods.includes(method)` when omitted. */
  supportsSignMethod?(method: SignMethod): boolean;
}

type ScopeBuilderInput = Omit<
  ScopeDefinition,
  'format' | 'templates' | 'regex' | 'allowedEntryRegex'
>;

function assertOptionalSegmentsAreTrailing(id: string, segments: Segment[]): void {
  const firstOptional = segments.findIndex(isOptional);
  if (firstOptional === -1) return;
  const hasRequiredAfter = segments.slice(firstOptional + 1).some((s) => !isOptional(s));
  if (hasRequiredAfter) {
    throw new Error(`Scope "${id}": optional segments must be trailing`);
  }
}

function defineScope(input: ScopeBuilderInput): ScopeDefinition {
  assertOptionalSegmentsAreTrailing(input.id, input.segments);
  return {
    ...input,
    format: deriveFormat(input.segments),
    templates: deriveTemplates(input.segments),
    regex: deriveRegex(input.segments),
    allowedEntryRegex: deriveAllowedEntryRegex(input.segments),
  };
}

export const SCOPE_REGISTRY: ScopeDefinition[] = [
  defineScope({
    id: 'openid',
    name: 'OpenID',
    description: 'Standard OIDC identity scope — issued without on-chain verification.',
    segments: [{ literal: 'openid' }],
    params: z.object({}).meta({ examples: [{}] }),
    parse: () => ({ type: 'metadata', role: 'openid', netuid: 0 }),
    handlers: {},
    sign_methods: ['sr25519', 'evm'],
    testnet_supported: true,
    isMetadata: true,
    describe: () => 'openid',
    baseScope: () => undefined,
  }),
  defineScope({
    id: 'subnet_role',
    name: 'Subnet Role',
    description: 'Require the user to be a miner, validator, or subnet owner',
    segments: [
      { literal: 'subnet' },
      { param: 'netuid', pattern: '\\d+' },
      { param: 'role', enum: ['miner', 'validator', 'owner'] },
    ],
    params: z.object({
      netuid: netuid.describe('Subnet ID'),
      role: z.enum(['miner', 'validator', 'owner']).describe('Role on the subnet'),
    }).meta({
      examples: [{ netuid: 1, role: 'miner' }, { netuid: 1, role: 'validator' }],
    }),
    parse: (g) => ({
      type: 'subnet',
      netuid: parseInt(g['netuid']!, 10),
      role: g['role']!,
    }),
    handlers: { miner: minerHandler, validator: validatorHandler, owner: ownerHandler },
    sign_methods: ['sr25519'],
    testnet_supported: true,
    describe: (p) => `${SUBNET_ROLE_LABEL[p.role] ?? p.role} on Subnet ${p.netuid}`,
    baseScope: () => undefined,
  }),
  defineScope({
    id: 'subnet_holder',
    name: 'Subnet Token Holder',
    description: 'Require the user to hold alpha tokens on a subnet',
    segments: [
      { literal: 'subnet' },
      { param: 'netuid', pattern: '\\d+' },
      { literal: 'holder' },
      { param: 'amount', pattern: AMT, templatePlaceholder: '{min_alpha}', optional: true },
    ],
    params: z.object({
      netuid: netuid.describe('Subnet ID'),
      amount: optionalPositiveAmount.describe('Minimum alpha balance (leave empty for any amount)'),
    }).meta({
      examples: [{ netuid: 1 }, { netuid: 1, amount: 100 }],
    }),
    parse: (g) => ({
      type: 'subnet',
      netuid: parseInt(g['netuid']!, 10),
      role: 'holder',
      minAmount: optionalAmount(g['amount']),
    }),
    handlers: { holder: holderHandler },
    sign_methods: ['sr25519'],
    testnet_supported: true,
    describe: (p) => {
      const suffix = p.minAmount !== undefined ? ` (min ${raoToDisplay(p.minAmount)} alpha)` : '';
      return `${SUBNET_ROLE_LABEL['holder']} on Subnet ${p.netuid}${suffix}`;
    },
    baseScope: (p) => `subnet:${p.netuid}:holder`,
  }),
  defineScope({
    id: 'tao_holder',
    name: 'TAO Holder',
    description: 'Require the user to hold a minimum TAO balance',
    segments: [
      { literal: 'tao' },
      { literal: 'holder' },
      { param: 'amount', pattern: AMT, templatePlaceholder: '{min_tao}', optional: true },
    ],
    params: z.object({
      amount: optionalPositiveAmount.describe('Minimum TAO balance (leave empty for any amount)'),
    }).meta({
      examples: [{}, { amount: 100 }],
    }),
    parse: (g) => ({
      type: 'tao',
      netuid: 0,
      role: 'holder',
      minAmount: optionalAmount(g['amount']),
    }),
    handlers: { holder: taoHolderHandler },
    sign_methods: ['sr25519'],
    testnet_supported: true,
    describe: (p) => {
      const suffix = p.minAmount !== undefined ? ` (min ${raoToDisplay(p.minAmount)} TAO)` : '';
      return `TAO Holder${suffix}`;
    },
    baseScope: () => 'tao:holder',
  }),
  defineScope({
    id: 'delegator',
    name: 'Delegator',
    description: 'Require the user to be delegating to a specific validator',
    segments: [
      { literal: 'delegate' },
      { param: 'hotkey', pattern: SS58, templatePlaceholder: '{hotkey}' },
      { param: 'amount', pattern: AMT, templatePlaceholder: '{min_tao}', optional: true },
    ],
    params: z.object({
      hotkey: ss58Address.describe('Validator hotkey (SS58 address starting with 5, 48 characters)'),
      amount: optionalPositiveAmount.describe('Minimum delegated TAO'),
    }).meta({
      examples: [{ hotkey: '5FHneW46...' }, { hotkey: '5FHneW46...', amount: 100 }],
    }),
    parse: (g) => ({
      type: 'delegate',
      netuid: 0,
      role: 'delegate',
      hotkey: g['hotkey']!,
      minAmount: optionalAmount(g['amount']),
    }),
    handlers: { delegate: delegateHandler },
    sign_methods: ['sr25519'],
    testnet_supported: false,
    describe: (p) => {
      if (!p.hotkey) return 'Delegator';
      const short = `${p.hotkey.slice(0, 8)}...${p.hotkey.slice(-6)}`;
      const suffix = p.minAmount !== undefined ? ` (min ${raoToDisplay(p.minAmount)} TAO)` : '';
      return `Delegator to ${short}${suffix}`;
    },
    baseScope: (p) => (p.hotkey ? `delegate:${p.hotkey}` : undefined),
  }),
  defineScope({
    id: 'staker',
    name: 'Staker',
    description: 'Require total staked TAO across all subnets',
    segments: [
      { literal: 'staker' },
      { param: 'amount', pattern: AMT, templatePlaceholder: '{min_tao}' },
    ],
    params: z.object({
      amount: positiveAmount.describe('Minimum total staked TAO'),
    }).meta({
      examples: [{ amount: 100 }, { amount: 1000 }],
    }),
    parse: (g) => ({
      type: 'staker',
      netuid: 0,
      role: 'staker',
      minAmount: taoStringToRao(g['amount']!),
    }),
    handlers: { staker: stakerHandler },
    sign_methods: ['sr25519'],
    testnet_supported: false,
    describe: (p) =>
      p.minAmount !== undefined ? `Staker (min ${raoToDisplay(p.minAmount)} TAO total)` : 'Staker',
    baseScope: () => undefined,
  }),
];

export const GRANT_TYPES = [
  {
    id: 'authorization_code',
    name: 'Authorization Code',
    description: 'Standard browser redirect flow',
    requires_redirect_uri: true,
  },
  {
    id: 'refresh_token',
    name: 'Refresh Token',
    description: 'Allow token renewal without re-authentication',
    requires_redirect_uri: false,
  },
  {
    id: 'urn:ietf:params:oauth:grant-type:device_code',
    name: 'Device Code',
    description: 'For headless/CLI apps, users approve on a separate device',
    requires_redirect_uri: false,
  },
];

export const SIGN_METHODS = [
  {
    id: 'sr25519' as SignMethod,
    name: 'Bittensor (Polkadot)',
    description: 'Substrate sr25519 wallet authentication. Supports all scope types.',
  },
  {
    id: 'evm' as SignMethod,
    name: 'Ethereum (EVM)',
    description: 'EVM wallet authentication (MetaMask, etc.). Identity only — scopes limited to openid.',
  },
];

export interface ScopeConfig {
  scope_categories: Array<{
    id: string;
    name: string;
    description: string;
    format: string;
    /** JSON Schema describing the params of a *concrete* scope (e.g. requested at challenge or authorize time). Strict — `*` is not accepted. */
    parameters: Record<string, unknown>;
    /** JSON Schema describing the params of an `allowed_scopes` *entry*. Each property accepts either `*` or the original concrete-param schema, so the form builder can render a wildcard toggle per param. */
    allowed_entry_parameters: Record<string, unknown>;
    sign_methods: string[];
    testnet_supported: boolean;
  }>;
  grant_types: typeof GRANT_TYPES;
  sign_methods: typeof SIGN_METHODS;
  evm_scope_restriction: string;
}

/**
 * Mechanically derives the `allowed_entry_parameters` JSON Schema from the
 * concrete-scope `parameters` schema by wrapping each property in
 * `oneOf: [{ const: '*' }, <original> ]`. `required` and other top-level
 * keywords are preserved unchanged.
 */
function deriveAllowedEntryParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const props = parameters['properties'] as Record<string, unknown> | undefined;
  if (!props) return parameters;
  const wrapped: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(props)) {
    wrapped[name] = { oneOf: [{ const: '*' }, prop] };
  }
  return { ...parameters, properties: wrapped };
}

let cachedScopeConfig: ScopeConfig | null = null;

export function getScopeConfig(): ScopeConfig {
  if (!cachedScopeConfig) {
    cachedScopeConfig = {
      scope_categories: SCOPE_REGISTRY.filter((def) => !def.isMetadata).map((def) => {
        const parameters = toJSONSchema(def.params);
        return {
          id: def.id,
          name: def.name,
          description: def.description,
          format: def.format,
          parameters,
          allowed_entry_parameters: deriveAllowedEntryParameters(parameters),
          sign_methods: def.sign_methods,
          testnet_supported: def.testnet_supported,
        };
      }),
      grant_types: GRANT_TYPES,
      sign_methods: SIGN_METHODS,
      evm_scope_restriction:
        'EVM clients support identity verification only. Scopes are automatically set to openid.',
    };
  }
  return cachedScopeConfig;
}
