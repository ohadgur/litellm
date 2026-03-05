import { CostCalculatorService } from '../../../src/spend-tracking/cost-calculator.service';

describe('CostCalculatorService', () => {
  let service: CostCalculatorService;

  beforeEach(() => {
    service = new CostCalculatorService();
  });

  it('calculates cost for a known model', () => {
    const cost = service.calculateCost('gpt-4o', {
      prompt_tokens: 1000,
      completion_tokens: 500,
    });

    // gpt-4o: input=0.0000025, output=0.00001
    // 1000 * 0.0000025 + 500 * 0.00001 = 0.0025 + 0.005 = 0.0075
    expect(cost).toBeCloseTo(0.0075, 8);
  });

  it('calculates cost for an Anthropic model', () => {
    const cost = service.calculateCost('claude-sonnet-4-20250514', {
      prompt_tokens: 2000,
      completion_tokens: 1000,
    });

    // claude-sonnet-4: input=0.000003, output=0.000015
    // 2000 * 0.000003 + 1000 * 0.000015 = 0.006 + 0.015 = 0.021
    expect(cost).toBeCloseTo(0.021, 8);
  });

  it('calculates cost for an embedding model (no output cost)', () => {
    const cost = service.calculateCost('text-embedding-3-small', {
      prompt_tokens: 500,
      completion_tokens: 0,
    });

    // text-embedding-3-small: input=0.00000002, output=0.0
    // 500 * 0.00000002 + 0 * 0.0 = 0.00001
    expect(cost).toBeCloseTo(0.00001, 10);
  });

  it('returns 0 for an unknown model', () => {
    const cost = service.calculateCost('unknown-model-xyz', {
      prompt_tokens: 1000,
      completion_tokens: 500,
    });

    expect(cost).toBe(0);
  });

  it('handles zero token counts', () => {
    const cost = service.calculateCost('gpt-4o', {
      prompt_tokens: 0,
      completion_tokens: 0,
    });

    expect(cost).toBe(0);
  });

  it('calculates cost for Azure model', () => {
    const cost = service.calculateCost('azure/gpt-4o', {
      prompt_tokens: 1000,
      completion_tokens: 500,
    });

    // azure/gpt-4o: input=0.0000025, output=0.00001
    expect(cost).toBeCloseTo(0.0075, 8);
  });

  it('calculates cost for Bedrock model', () => {
    const cost = service.calculateCost('anthropic.claude-3-5-sonnet-20241022-v2:0', {
      prompt_tokens: 1000,
      completion_tokens: 500,
    });

    // input=0.000003, output=0.000015
    // 1000 * 0.000003 + 500 * 0.000015 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 8);
  });

  describe('hasModel', () => {
    it('returns true for a known model', () => {
      expect(service.hasModel('gpt-4o')).toBe(true);
    });

    it('returns false for an unknown model', () => {
      expect(service.hasModel('nonexistent')).toBe(false);
    });
  });
});
