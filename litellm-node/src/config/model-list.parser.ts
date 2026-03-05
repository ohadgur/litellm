import { Deployment } from '../shared/types/deployment';
import { ModelListEntry } from './types/config';

/**
 * Substitutes environment variable placeholders in a value.
 *
 * Supported formats:
 *  - `os.environ/VAR_NAME`
 *  - `${VAR_NAME}`
 */
export function substituteEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    // os.environ/VAR_NAME  (full-string match)
    const osEnvMatch = value.match(/^os\.environ\/(.+)$/);
    if (osEnvMatch) {
      return process.env[osEnvMatch[1]] ?? value;
    }

    // ${VAR_NAME} substitution (can appear anywhere in the string)
    const interpolated = value.replace(/\$\{([^}]+)}/g, (_match, varName: string) => {
      return process.env[varName] ?? '';
    });
    return interpolated;
  }

  if (Array.isArray(value)) {
    return value.map(substituteEnvVars);
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = substituteEnvVars(v);
    }
    return result;
  }

  return value;
}

/**
 * Extracts provider and model id from a model string.
 *
 * Examples:
 *  - "openai/gpt-4o"            -> { provider: "openai",    model: "gpt-4o" }
 *  - "anthropic/claude-3"       -> { provider: "anthropic", model: "claude-3" }
 *  - "bedrock/us.anthro..."     -> { provider: "bedrock",   model: "us.anthro..." }
 *  - "azure/my-deployment"      -> { provider: "azure",     model: "my-deployment" }
 *  - "gpt-3.5-turbo" (no slash) -> { provider: "openai",    model: "gpt-3.5-turbo" }
 */
export function extractProviderAndModel(modelString: string): {
  provider: string;
  model: string;
} {
  const slashIndex = modelString.indexOf('/');
  if (slashIndex === -1) {
    return { provider: 'openai', model: modelString };
  }
  return {
    provider: modelString.substring(0, slashIndex),
    model: modelString.substring(slashIndex + 1),
  };
}

/**
 * Converts a raw YAML model_list entry into a typed Deployment.
 */
export function parseModelListEntry(entry: ModelListEntry): Deployment {
  const resolvedParams = substituteEnvVars(entry.litellm_params) as Record<string, unknown>;
  const modelString = String(resolvedParams['model'] ?? '');
  const { provider, model } = extractProviderAndModel(modelString);

  return {
    modelName: entry.model_name,
    provider,
    model,
    litellmParams: resolvedParams,
    modelInfo: entry.model_info
      ? (substituteEnvVars(entry.model_info) as Record<string, unknown>)
      : undefined,
    tpm: entry.tpm,
    rpm: entry.rpm,
  };
}

/**
 * Parses an entire model_list array into Deployment objects.
 */
export function parseModelList(entries: ModelListEntry[]): Deployment[] {
  return entries.map(parseModelListEntry);
}
