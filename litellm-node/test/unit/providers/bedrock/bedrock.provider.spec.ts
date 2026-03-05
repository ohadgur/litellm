import { BedrockProvider } from '../../../../src/providers/bedrock/bedrock.provider';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  const mockSend = jest.fn();
  return {
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    ConverseCommand: jest.fn().mockImplementation((input) => ({ input })),
    ConverseStreamCommand: jest.fn().mockImplementation((input) => ({ input })),
    __mockSend: mockSend,
  };
});

function getMockSend(): jest.Mock {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@aws-sdk/client-bedrock-runtime').__mockSend;
}

describe('BedrockProvider', () => {
  let provider: BedrockProvider;

  beforeEach(() => {
    provider = new BedrockProvider();
    jest.clearAllMocks();
  });

  describe('createClient', () => {
    it('creates client with region from litellmParams', () => {
      provider.createClient({ aws_region_name: 'eu-west-1' });

      expect(BedrockRuntimeClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'eu-west-1' }),
      );
    });

    it('creates client with camelCase region param', () => {
      provider.createClient({ awsRegionName: 'ap-southeast-1' });

      expect(BedrockRuntimeClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'ap-southeast-1' }),
      );
    });

    it('falls back to AWS_REGION env var', () => {
      const original = process.env['AWS_REGION'];
      process.env['AWS_REGION'] = 'us-west-2';
      try {
        provider.createClient({});
        expect(BedrockRuntimeClient).toHaveBeenCalledWith(
          expect.objectContaining({ region: 'us-west-2' }),
        );
      } finally {
        if (original !== undefined) {
          process.env['AWS_REGION'] = original;
        } else {
          delete process.env['AWS_REGION'];
        }
      }
    });

    it('defaults to us-east-1 when no region specified', () => {
      const original = process.env['AWS_REGION'];
      delete process.env['AWS_REGION'];
      try {
        provider.createClient({});
        expect(BedrockRuntimeClient).toHaveBeenCalledWith(
          expect.objectContaining({ region: 'us-east-1' }),
        );
      } finally {
        if (original !== undefined) {
          process.env['AWS_REGION'] = original;
        }
      }
    });

    it('passes explicit credentials when api_key and secret provided', () => {
      provider.createClient({
        api_key: 'AKID',
        aws_secret_access_key: 'SECRET',
        aws_region_name: 'us-east-1',
      });

      expect(BedrockRuntimeClient).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: {
            accessKeyId: 'AKID',
            secretAccessKey: 'SECRET',
          },
        }),
      );
    });

    it('uses default credentials when no api_key', () => {
      provider.createClient({ aws_region_name: 'us-east-1' });

      const callArgs = (BedrockRuntimeClient as unknown as jest.Mock).mock.calls[0][0];
      expect(callArgs.credentials).toBeUndefined();
    });
  });

  describe('chatCompletion', () => {
    it('strips bedrock/ prefix from model', async () => {
      const mockSend = getMockSend();
      mockSend.mockResolvedValueOnce({
        output: {
          message: { role: 'assistant', content: [{ text: 'Hi' }] },
        },
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 3 },
      });

      const result = await provider.chatCompletion({
        deployment: {
          modelName: 'claude',
          apiKey: 'key',
          provider: 'bedrock',
          litellmParams: { aws_region_name: 'us-east-1' },
        },
        body: {
          model: 'bedrock/anthropic.claude-v2',
          messages: [{ role: 'user', content: 'Hi' }],
        },
      });

      expect(result.model).toBe('anthropic.claude-v2');
      expect(result.choices[0].message.content).toBe('Hi');
    });
  });

  describe('chatCompletionStream', () => {
    it('yields chunks from stream events', async () => {
      const mockSend = getMockSend();
      const events = [
        { messageStart: { role: 'assistant' } },
        { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'Hello' } } },
        { messageStop: { stopReason: 'end_turn' } },
      ];

      mockSend.mockResolvedValueOnce({
        stream: (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
      });

      const chunks: unknown[] = [];
      for await (const chunk of provider.chatCompletionStream({
        deployment: {
          modelName: 'claude',
          apiKey: 'key',
          provider: 'bedrock',
          litellmParams: { aws_region_name: 'us-east-1' },
        },
        body: {
          model: 'bedrock/anthropic.claude-v2',
          messages: [{ role: 'user', content: 'Hi' }],
        },
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(3);
    });
  });

  describe('providerName', () => {
    it('returns bedrock', () => {
      expect(provider.providerName).toBe('bedrock');
    });
  });
});
