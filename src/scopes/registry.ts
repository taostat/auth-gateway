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

const nonNegativeInt = z.number().int().nonnegative();
const positiveAmount = z.number().positive();
const optionalPositiveAmount = z.number().positive().optional();

export interface ScopeDefinition {
  id: string;
  name: string;
  description: string;
  /** Human-readable format pattern (e.g. 'subnet:{netuid}:{role}') */
  format: string;
  /** OIDC scopes_supported templates (e.g. 'subnet:*:miner'). Derived params use * for numeric, {name} for string. */
  templates: string[];
  regex: RegExp;
  /** Zod schema for JSON Schema generation and front-end validation metadata. Not used for runtime validation. */
  params: z.ZodObject<z.ZodRawShape>;
  parse: (match: RegExpMatchArray) => ParsedScope;
  handlers: Record<string, ScopeHandler>;
  sign_methods: SignMethod[];
  testnet_supported: boolean;
}

const AMT = '\\d+(?:\\.\\d+)?';

function optionalAmount(raw: string | undefined): bigint | undefined {
  return raw !== undefined ? taoStringToRao(raw) : undefined;
}

export const SCOPE_REGISTRY: ScopeDefinition[] = [
  {
    id: 'subnet_role',
    name: 'Subnet Role',
    description: 'Require the user to be a miner, validator, or subnet owner',
    format: 'subnet:{netuid}:{role}',
    templates: ['subnet:*:miner', 'subnet:*:validator', 'subnet:*:owner'],
    regex: /^subnet:(\d+):(miner|owner|validator)$/,
    params: z.object({
      netuid: nonNegativeInt.describe('Subnet ID'),
      role: z.enum(['miner', 'validator', 'owner']).describe('Role on the subnet'),
    }).meta({
      examples: [{ netuid: 1, role: 'miner' }, { netuid: 1, role: 'validator' }],
    }),
    parse: (m) => ({
      type: 'subnet',
      netuid: parseInt(m[1]!, 10),
      role: m[2]!,
    }),
    handlers: { miner: minerHandler, validator: validatorHandler, owner: ownerHandler },
    sign_methods: ['sr25519'],
    testnet_supported: true,
  },
  {
    id: 'subnet_holder',
    name: 'Subnet Token Holder',
    description: 'Require the user to hold alpha tokens on a subnet',
    format: 'subnet:{netuid}:holder[:{amount}]',
    templates: ['subnet:*:holder', 'subnet:*:holder:{min_alpha}'],
    regex: new RegExp(`^subnet:(\\d+):holder(?::(${AMT}))?$`),
    params: z.object({
      netuid: nonNegativeInt.describe('Subnet ID'),
      amount: optionalPositiveAmount.describe('Minimum alpha balance (leave empty for any amount)'),
    }).meta({
      examples: [{ netuid: 1 }, { netuid: 1, amount: 100 }],
    }),
    parse: (m) => ({
      type: 'subnet',
      netuid: parseInt(m[1]!, 10),
      role: 'holder',
      minAmount: optionalAmount(m[2]),
    }),
    handlers: { holder: holderHandler },
    sign_methods: ['sr25519'],
    testnet_supported: true,
  },
  {
    id: 'tao_holder',
    name: 'TAO Holder',
    description: 'Require the user to hold a minimum TAO balance',
    format: 'tao:holder[:{amount}]',
    templates: ['tao:holder', 'tao:holder:{min_tao}'],
    regex: new RegExp(`^tao:holder(?::(${AMT}))?$`),
    params: z.object({
      amount: optionalPositiveAmount.describe('Minimum TAO balance (leave empty for any amount)'),
    }).meta({
      examples: [{}, { amount: 100 }],
    }),
    parse: (m) => ({
      type: 'tao',
      netuid: 0,
      role: 'holder',
      minAmount: optionalAmount(m[1]),
    }),
    handlers: { holder: taoHolderHandler },
    sign_methods: ['sr25519'],
    testnet_supported: true,
  },
  {
    id: 'delegator',
    name: 'Delegator',
    description: 'Require the user to be delegating to a specific validator',
    format: 'delegate:{hotkey}[:{amount}]',
    templates: ['delegate:{hotkey}', 'delegate:{hotkey}:{min_tao}'],
    regex: new RegExp(`^delegate:(5[1-9A-HJ-NP-Za-km-z]{47})(?::(${AMT}))?$`),
    params: z.object({
      hotkey: ss58Address.describe('Validator hotkey (SS58 address starting with 5, 48 characters)'),
      amount: optionalPositiveAmount.describe('Minimum delegated TAO'),
    }).meta({
      examples: [{ hotkey: '5FHneW46...' }, { hotkey: '5FHneW46...', amount: 100 }],
    }),
    parse: (m) => ({
      type: 'delegate',
      netuid: 0,
      role: 'delegate',
      hotkey: m[1]!,
      minAmount: optionalAmount(m[2]),
    }),
    handlers: { delegate: delegateHandler },
    sign_methods: ['sr25519'],
    testnet_supported: false,
  },
  {
    id: 'staker',
    name: 'Staker',
    description: 'Require total staked TAO across all subnets',
    format: 'staker:{amount}',
    templates: ['staker:{min_tao}'],
    regex: new RegExp(`^staker:(${AMT})$`),
    params: z.object({
      amount: positiveAmount.describe('Minimum total staked TAO'),
    }).meta({
      examples: [{ amount: 100 }, { amount: 1000 }],
    }),
    parse: (m) => ({
      type: 'staker',
      netuid: 0,
      role: 'staker',
      minAmount: taoStringToRao(m[1]!),
    }),
    handlers: { staker: stakerHandler },
    sign_methods: ['sr25519'],
    testnet_supported: false,
  },
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
    parameters: Record<string, unknown>;
    sign_methods: string[];
    testnet_supported: boolean;
  }>;
  grant_types: typeof GRANT_TYPES;
  sign_methods: typeof SIGN_METHODS;
  evm_scope_restriction: string;
}

let cachedScopeConfig: ScopeConfig | null = null;

export function getScopeConfig(): ScopeConfig {
  if (!cachedScopeConfig) {
    cachedScopeConfig = {
      scope_categories: SCOPE_REGISTRY.map((def) => ({
        id: def.id,
        name: def.name,
        description: def.description,
        format: def.format,
        parameters: toJSONSchema(def.params),
        sign_methods: def.sign_methods,
        testnet_supported: def.testnet_supported,
      })),
      grant_types: GRANT_TYPES,
      sign_methods: SIGN_METHODS,
      evm_scope_restriction:
        'EVM clients support identity verification only. Scopes are automatically set to openid.',
    };
  }
  return cachedScopeConfig;
}
