import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const coreRequire = createRequire(require.resolve('@blaxel/core'));
const expressRequire = createRequire(coreRequire.resolve('express'));
const Ajv = coreRequire('ajv');
const toml = coreRequire('toml');
const qs = expressRequire('qs');

describe('security regressions through SDK dependency resolution', () => {
  it('rejects malformed hosts and ports through the actual Ajv resolver', () => {
    const resolver = new Ajv().opts.uriResolver;
    expect(resolver.parse('https://user@[@127.0.0.1/schema').error).toMatch(/host is malformed/i);
    expect(() => resolver.serialize({
      scheme: 'https', host: 'trusted.example', port: '@127.0.0.1:8124', path: '/schema',
    })).toThrow(/port is malformed/i);
    expect(resolver.resolve('https://example.com/', 'schema')).toBe('https://example.com/schema');
  });

  it('rejects deep TOML with a catchable parser error', () => {
    expect(() => toml.parse(`x = ${'['.repeat(600)}0${']'.repeat(600)}`))
      .toThrow(/maximum nesting depth/i);
    expect(toml.parse('answer = 42').answer).toBe(42);
  });

  it('enforces comma array limits through Express-resolved qs', () => {
    const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true };
    expect(() => qs.parse('a[]=1,2,3,4', options)).toThrow(/array limit exceeded/i);
    expect(qs.parse('a[]=1,2,3', options).a).toEqual([['1', '2', '3']]);
  });
});
