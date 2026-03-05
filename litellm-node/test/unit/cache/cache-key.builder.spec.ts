import { CacheKeyBuilder, Message } from '../../../src/cache/cache-key.builder';

describe('CacheKeyBuilder', () => {
  let builder: CacheKeyBuilder;

  beforeEach(() => {
    builder = new CacheKeyBuilder();
  });

  describe('buildResponseCacheKey', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];

    it('should produce the same key for identical inputs', () => {
      const key1 = builder.buildResponseCacheKey('gpt-4', messages, { temperature: 0.7 });
      const key2 = builder.buildResponseCacheKey('gpt-4', messages, { temperature: 0.7 });
      expect(key1).toBe(key2);
    });

    it('should produce different keys for different models', () => {
      const key1 = builder.buildResponseCacheKey('gpt-4', messages, {});
      const key2 = builder.buildResponseCacheKey('gpt-3.5-turbo', messages, {});
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different messages', () => {
      const otherMessages: Message[] = [{ role: 'user', content: 'Goodbye' }];
      const key1 = builder.buildResponseCacheKey('gpt-4', messages, {});
      const key2 = builder.buildResponseCacheKey('gpt-4', otherMessages, {});
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different params', () => {
      const key1 = builder.buildResponseCacheKey('gpt-4', messages, { temperature: 0.7 });
      const key2 = builder.buildResponseCacheKey('gpt-4', messages, { temperature: 0.9 });
      expect(key1).not.toBe(key2);
    });

    it('should produce the same key regardless of parameter order', () => {
      const key1 = builder.buildResponseCacheKey('gpt-4', messages, {
        temperature: 0.7,
        max_tokens: 100,
        top_p: 0.9,
      });
      const key2 = builder.buildResponseCacheKey('gpt-4', messages, {
        top_p: 0.9,
        temperature: 0.7,
        max_tokens: 100,
      });
      expect(key1).toBe(key2);
    });

    it('should handle nested params with different key order', () => {
      const key1 = builder.buildResponseCacheKey('gpt-4', messages, {
        options: { a: 1, b: 2 },
      });
      const key2 = builder.buildResponseCacheKey('gpt-4', messages, {
        options: { b: 2, a: 1 },
      });
      expect(key1).toBe(key2);
    });

    it('should prefix keys with litellm:response:', () => {
      const key = builder.buildResponseCacheKey('gpt-4', messages, {});
      expect(key).toMatch(/^litellm:response:[a-f0-9]{64}$/);
    });
  });

  describe('buildRpmCounterKey', () => {
    it('should produce a deterministic key', () => {
      const key = builder.buildRpmCounterKey('deploy-1', 12345);
      expect(key).toBe('litellm:rpm:deploy-1:12345');
    });

    it('should produce different keys for different deployments', () => {
      const key1 = builder.buildRpmCounterKey('deploy-1', 12345);
      const key2 = builder.buildRpmCounterKey('deploy-2', 12345);
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different minutes', () => {
      const key1 = builder.buildRpmCounterKey('deploy-1', 12345);
      const key2 = builder.buildRpmCounterKey('deploy-1', 12346);
      expect(key1).not.toBe(key2);
    });
  });

  describe('buildTpmCounterKey', () => {
    it('should produce a deterministic key', () => {
      const key = builder.buildTpmCounterKey('deploy-1', 12345);
      expect(key).toBe('litellm:tpm:deploy-1:12345');
    });

    it('should differ from RPM key for the same inputs', () => {
      const rpm = builder.buildRpmCounterKey('deploy-1', 12345);
      const tpm = builder.buildTpmCounterKey('deploy-1', 12345);
      expect(rpm).not.toBe(tpm);
    });
  });
});
