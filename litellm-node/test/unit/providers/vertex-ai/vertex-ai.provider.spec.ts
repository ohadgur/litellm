import { VertexAIProvider } from '../../../../src/providers/vertex-ai/vertex-ai.provider';
import {
  Deployment,
  ProviderRequest,
  ChatCompletionChunk,
} from '../../../../src/shared/types';
import { ProviderError, ProviderErrorType } from '../../../../src/shared/types/errors';

// ---------------------------------------------------------------------------
// Mock the @google-cloud/vertexai SDK
// ---------------------------------------------------------------------------

const mockGenerateContent = jest.fn();
const mockGenerateContentStream = jest.fn();
const mockGetGenerativeModel = jest.fn().mockReturnValue({
  generateContent: mockGenerateContent,
  generateContentStream: mockGenerateContentStream,
});

jest.mock('@google-cloud/vertexai', () => ({
  VertexAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

// Re-import after mock is set up
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { VertexAI: MockedVertexAI } = require('@google-cloud/vertexai');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeDeployment = (overrides: Partial<Deployment> = {}): Deployment => ({
  modelName: 'vertex_ai/gemini-1.5-pro',
  apiKey: '',
  provider: 'vertex_ai',
  vertexProject: 'my-project',
  vertexLocation: 'us-central1',
  ...overrides,
});

const makeRequest = (
  overrides: Partial<ProviderRequest> = {},
): ProviderRequest => ({
  deployment: makeDeployment(),
  body: {
    model: 'vertex_ai/gemini-1.5-pro',
    messages: [{ role: 'user', content: 'Hello' }],
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VertexAIProvider', () => {
  let provider: VertexAIProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new VertexAIProvider();
  });

  describe('client creation', () => {
    it('creates VertexAI client with project and location', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            { content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
          },
        },
      });

      await provider.chatCompletion(makeRequest());

      expect(MockedVertexAI).toHaveBeenCalledWith({
        project: 'my-project',
        location: 'us-central1',
      });
    });

    it('uses default location when not specified', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            { content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' },
          ],
        },
      });

      await provider.chatCompletion(
        makeRequest({
          deployment: makeDeployment({ vertexLocation: undefined }),
        }),
      );

      expect(MockedVertexAI).toHaveBeenCalledWith(
        expect.objectContaining({ location: 'us-central1' }),
      );
    });

    it('uses custom location when specified', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            { content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' },
          ],
        },
      });

      await provider.chatCompletion(
        makeRequest({
          deployment: makeDeployment({ vertexLocation: 'europe-west1' }),
        }),
      );

      expect(MockedVertexAI).toHaveBeenCalledWith(
        expect.objectContaining({ location: 'europe-west1' }),
      );
    });

    it('strips vertex_ai/ prefix from model name', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            { content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' },
          ],
        },
      });

      await provider.chatCompletion(makeRequest());

      expect(mockGetGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-1.5-pro',
      });
    });

    it('works with model name without prefix', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            { content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' },
          ],
        },
      });

      await provider.chatCompletion(
        makeRequest({
          deployment: makeDeployment({ modelName: 'gemini-1.5-flash' }),
        }),
      );

      expect(mockGetGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-1.5-flash',
      });
    });

    it('throws when vertexProject is missing', async () => {
      await expect(
        provider.chatCompletion(
          makeRequest({
            deployment: makeDeployment({ vertexProject: undefined }),
          }),
        ),
      ).rejects.toThrow(ProviderError);

      try {
        await provider.chatCompletion(
          makeRequest({
            deployment: makeDeployment({ vertexProject: undefined }),
          }),
        );
      } catch (e) {
        const err = e as ProviderError;
        expect(err.errorType).toBe(ProviderErrorType.InvalidRequestError);
        expect(err.message).toContain('vertexProject');
      }
    });
  });

  describe('chatCompletion', () => {
    it('returns transformed response', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            {
              content: { parts: [{ text: 'Hello there!' }], role: 'model' },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 3,
            totalTokenCount: 8,
          },
        },
      });

      const result = await provider.chatCompletion(makeRequest());

      expect(result.choices[0].message.content).toBe('Hello there!');
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].finish_reason).toBe('stop');
      expect(result.usage?.prompt_tokens).toBe(5);
      expect(result.usage?.completion_tokens).toBe(3);
      expect(result.model).toBe('gemini-1.5-pro');
    });

    it('maps SDK errors to ProviderError', async () => {
      mockGenerateContent.mockRejectedValue({
        status: 429,
        message: 'Rate limited',
      });

      try {
        await provider.chatCompletion(makeRequest());
      } catch (e) {
        const err = e as ProviderError;
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.statusCode).toBe(429);
        expect(err.errorType).toBe(ProviderErrorType.RateLimitError);
      }
    });
  });

  describe('chatCompletionStream', () => {
    it('yields transformed stream chunks', async () => {
      const chunks = [
        {
          candidates: [
            {
              content: { parts: [{ text: 'Hello' }] },
              finishReason: undefined,
            },
          ],
        },
        {
          candidates: [
            {
              content: { parts: [{ text: ' world' }] },
              finishReason: 'STOP',
            },
          ],
        },
      ];

      async function* fakeStream() {
        for (const c of chunks) {
          yield c;
        }
      }

      mockGenerateContentStream.mockResolvedValue({
        stream: fakeStream(),
      });

      const collected: ChatCompletionChunk[] = [];
      for await (const chunk of provider.chatCompletionStream(makeRequest())) {
        collected.push(chunk);
      }

      expect(collected).toHaveLength(2);
      expect(collected[0].choices[0].delta.role).toBe('assistant');
      expect(collected[0].choices[0].delta.content).toBe('Hello');
      expect(collected[1].choices[0].delta.content).toBe(' world');
      expect(collected[1].choices[0].finish_reason).toBe('stop');
    });

    it('maps stream errors to ProviderError', async () => {
      mockGenerateContentStream.mockRejectedValue({
        status: 500,
        message: 'Internal error',
      });

      const iter = provider.chatCompletionStream(makeRequest());
      await expect(
        (async () => {
          for await (const _ of iter) {
            // drain
          }
        })(),
      ).rejects.toThrow(ProviderError);
    });
  });

  describe('providerName', () => {
    it('returns vertex_ai', () => {
      expect(provider.providerName).toBe('vertex_ai');
    });
  });
});
