import { RoutingStrategy } from '../../shared/types/routing';

export interface ModelListEntry {
  model_name: string;
  litellm_params: Record<string, unknown>;
  model_info?: Record<string, unknown>;
  tpm?: number;
  rpm?: number;
}

export interface FallbackConfig {
  [modelName: string]: string[];
}

export interface GeneralSettings {
  masterKey?: string;
  maxBudget?: number;
  cacheResponses?: boolean;
}

export interface RouterSettings {
  routing_strategy?: string;
}

export interface GatewayConfig {
  routingStrategy: RoutingStrategy;
  modelList: ModelListEntry[];
  fallbacks?: FallbackConfig[];
  generalSettings?: GeneralSettings;
}

/**
 * Raw shape of the YAML config file after parsing.
 */
export interface RawYamlConfig {
  model_list?: ModelListEntry[];
  general_settings?: Record<string, unknown>;
  router_settings?: RouterSettings;
  litellm_settings?: Record<string, unknown>;
  environment_variables?: Record<string, string>;
  fallbacks?: FallbackConfig[];
}
