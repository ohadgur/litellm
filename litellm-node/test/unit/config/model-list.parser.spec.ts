import {
  substituteEnvVars,
  extractProviderAndModel,
  parseModelListEntry,
  parseModelList,
} from '../../../src/config/model-list.parser';
import { ModelListEntry } from '../../../src/config/types/config';

describe('model-list.parser', () => {
  // ── substituteEnvVars ────────────────────────────────────────────

  describe('substituteEnvVars', () => {
    it('substitutes os.environ/VAR format', () => {
      process.env['TEST_KEY_ABC'] = 'my-secret';
      expect(substituteEnvVars('os.environ/TEST_KEY_ABC')).toBe('my-secret');
      delete process.env['TEST_KEY_ABC'];
    });

    it('substitutes ${VAR} format', () => {
      process.env['TEST_KEY_DEF'] = 'hello';
      expect(substituteEnvVars('prefix-${TEST_KEY_DEF}-suffix')).toBe('prefix-hello-suffix');
      delete process.env['TEST_KEY_DEF'];
    });

    it('returns original string when os.environ var is not set', () => {
      delete process.env['NONEXISTENT_VAR_XYZ'];
      expect(substituteEnvVars('os.environ/NONEXISTENT_VAR_XYZ')).toBe(
        'os.environ/NONEXISTENT_VAR_XYZ',
      );
    });

    it('replaces ${VAR} with empty string when var is not set', () => {
      delete process.env['NONEXISTENT_VAR_XYZ'];
      expect(substituteEnvVars('key-${NONEXISTENT_VAR_XYZ}')).toBe('key-');
    });

    it('recursively substitutes in objects', () => {
      process.env['TEST_OBJ_VAR'] = 'resolved';
      const input = { key: 'os.environ/TEST_OBJ_VAR', nested: { inner: '${TEST_OBJ_VAR}' } };
      expect(substituteEnvVars(input)).toEqual({
        key: 'resolved',
        nested: { inner: 'resolved' },
      });
      delete process.env['TEST_OBJ_VAR'];
    });

    it('recursively substitutes in arrays', () => {
      process.env['TEST_ARR_VAR'] = 'val';
      expect(substituteEnvVars(['os.environ/TEST_ARR_VAR', 'plain'])).toEqual(['val', 'plain']);
      delete process.env['TEST_ARR_VAR'];
    });

    it('passes through non-string primitives', () => {
      expect(substituteEnvVars(42)).toBe(42);
      expect(substituteEnvVars(true)).toBe(true);
      expect(substituteEnvVars(null)).toBeNull();
    });
  });

  // ── extractProviderAndModel ──────────────────────────────────────

  describe('extractProviderAndModel', () => {
    it('extracts openai provider', () => {
      expect(extractProviderAndModel('openai/gpt-4o')).toEqual({
        provider: 'openai',
        model: 'gpt-4o',
      });
    });

    it('extracts anthropic provider', () => {
      expect(extractProviderAndModel('anthropic/claude-sonnet-4-20250514')).toEqual({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      });
    });

    it('extracts bedrock provider with complex model id', () => {
      expect(
        extractProviderAndModel('bedrock/us.anthropic.claude-3-5-sonnet-20240620-v1:0'),
      ).toEqual({
        provider: 'bedrock',
        model: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0',
      });
    });

    it('extracts azure provider', () => {
      expect(extractProviderAndModel('azure/my-deployment')).toEqual({
        provider: 'azure',
        model: 'my-deployment',
      });
    });

    it('defaults to openai when no provider prefix', () => {
      expect(extractProviderAndModel('gpt-3.5-turbo')).toEqual({
        provider: 'openai',
        model: 'gpt-3.5-turbo',
      });
    });

    it('handles model strings with multiple slashes', () => {
      expect(
        extractProviderAndModel('fireworks_ai/accounts/fireworks/models/llama-v3p1-405b'),
      ).toEqual({
        provider: 'fireworks_ai',
        model: 'accounts/fireworks/models/llama-v3p1-405b',
      });
    });
  });

  // ── parseModelListEntry ──────────────────────────────────────────

  describe('parseModelListEntry', () => {
    it('parses a basic entry', () => {
      const entry: ModelListEntry = {
        model_name: 'gpt-4o',
        litellm_params: { model: 'openai/gpt-4o', api_key: 'sk-test' },
      };
      const deployment = parseModelListEntry(entry);
      expect(deployment.modelName).toBe('gpt-4o');
      expect(deployment.provider).toBe('openai');
      expect(deployment.model).toBe('gpt-4o');
      expect(deployment.litellmParams['api_key']).toBe('sk-test');
    });

    it('parses entry with model_info', () => {
      const entry: ModelListEntry = {
        model_name: 'test-model',
        litellm_params: { model: 'openai/gpt-4o' },
        model_info: { max_tokens: 4096, mode: 'chat' },
      };
      const deployment = parseModelListEntry(entry);
      expect(deployment.modelInfo).toEqual({ max_tokens: 4096, mode: 'chat' });
    });

    it('handles missing optional fields', () => {
      const entry: ModelListEntry = {
        model_name: 'minimal',
        litellm_params: { model: 'openai/gpt-4o' },
      };
      const deployment = parseModelListEntry(entry);
      expect(deployment.modelInfo).toBeUndefined();
      expect(deployment.tpm).toBeUndefined();
      expect(deployment.rpm).toBeUndefined();
    });

    it('preserves tpm and rpm', () => {
      const entry: ModelListEntry = {
        model_name: 'rate-limited',
        litellm_params: { model: 'openai/gpt-4o' },
        tpm: 20000,
        rpm: 3,
      };
      const deployment = parseModelListEntry(entry);
      expect(deployment.tpm).toBe(20000);
      expect(deployment.rpm).toBe(3);
    });

    it('substitutes env vars in litellm_params', () => {
      process.env['TEST_PARSE_KEY'] = 'secret-key';
      const entry: ModelListEntry = {
        model_name: 'env-test',
        litellm_params: { model: 'openai/gpt-4o', api_key: 'os.environ/TEST_PARSE_KEY' },
      };
      const deployment = parseModelListEntry(entry);
      expect(deployment.litellmParams['api_key']).toBe('secret-key');
      delete process.env['TEST_PARSE_KEY'];
    });
  });

  // ── parseModelList ───────────────────────────────────────────────

  describe('parseModelList', () => {
    it('parses multiple entries', () => {
      const entries: ModelListEntry[] = [
        { model_name: 'a', litellm_params: { model: 'openai/gpt-4o' } },
        { model_name: 'b', litellm_params: { model: 'anthropic/claude-3' } },
      ];
      const deployments = parseModelList(entries);
      expect(deployments).toHaveLength(2);
      expect(deployments[0].provider).toBe('openai');
      expect(deployments[1].provider).toBe('anthropic');
    });

    it('returns empty array for empty input', () => {
      expect(parseModelList([])).toEqual([]);
    });
  });
});
