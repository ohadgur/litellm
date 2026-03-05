import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as chokidar from 'chokidar';
import * as path from 'path';

import { Deployment } from '../shared/types/deployment';
import { RoutingStrategy } from '../shared/types/routing';
import { PrismaService } from '../prisma/prisma.service';
import { RawYamlConfig, FallbackConfig } from './types/config';
import { parseModelList, parseModelListEntry } from './model-list.parser';

const DEFAULT_CONFIG_PATH = 'service-config.yaml';

@Injectable()
export class ConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConfigService.name);

  private deployments: Deployment[] = [];
  /** Index from modelName to deployments for O(1) lookup on the request hot path. */
  private deploymentsByModel = new Map<string, Deployment[]>();
  private fallbacks: FallbackConfig[] = [];
  private routingStrategy: RoutingStrategy = RoutingStrategy.SimpleShuffle;
  private watcher: chokidar.FSWatcher | null = null;
  private readonly resolvedConfigPath: string;

  constructor(private readonly prisma: PrismaService) {
    const configPath = process.env['LITELLM_CONFIG_PATH'] ?? DEFAULT_CONFIG_PATH;
    this.resolvedConfigPath = path.resolve(configPath);
  }

  async onModuleInit(): Promise<void> {
    await this.loadConfig();
    this.startWatching();
  }

  onModuleDestroy(): void {
    this.stopWatching();
  }

  // ── Public API ─────────────────────────────────────────────────────

  getDeployments(modelName: string): Deployment[] {
    return this.deploymentsByModel.get(modelName) ?? [];
  }

  getAllModelNames(): string[] {
    return [...this.deploymentsByModel.keys()];
  }

  getAllDeployments(): Deployment[] {
    return [...this.deployments];
  }

  getFallbacks(modelName: string): string[] {
    for (const fb of this.fallbacks) {
      if (modelName in fb) {
        return fb[modelName];
      }
    }
    return [];
  }

  getRoutingStrategy(): RoutingStrategy {
    return this.routingStrategy;
  }

  // ── Loading ────────────────────────────────────────────────────────

  async loadConfig(): Promise<void> {
    const yamlDeployments = this.loadFromYaml();
    const dbDeployments = await this.loadFromDatabase();
    this.deployments = [...yamlDeployments, ...dbDeployments];
    this.rebuildIndex();
    this.logger.log(
      `Loaded ${this.deployments.length} deployments ` +
        `(${yamlDeployments.length} YAML, ${dbDeployments.length} DB)`,
    );
  }

  private loadFromYaml(): Deployment[] {
    let content: string;
    try {
      content = fs.readFileSync(this.resolvedConfigPath, 'utf-8');
    } catch {
      this.logger.warn(`Config file not found: ${this.resolvedConfigPath}`);
      return [];
    }

    const raw = yaml.load(content) as RawYamlConfig | null;
    if (!raw) {
      return [];
    }

    // Routing strategy
    const strategyString = raw.router_settings?.routing_strategy;
    if (strategyString && Object.values(RoutingStrategy).includes(strategyString as RoutingStrategy)) {
      this.routingStrategy = strategyString as RoutingStrategy;
    }

    // Fallbacks
    this.fallbacks = raw.fallbacks ?? [];

    // Model list
    return parseModelList(raw.model_list ?? []);
  }

  private async loadFromDatabase(): Promise<Deployment[]> {
    try {
      const rows = await this.prisma.getProxyModelTableEntries();
      return rows.map((row) =>
        parseModelListEntry({
          model_name: row.model_name,
          litellm_params: row.litellm_params,
          model_info: row.model_info,
        }),
      );
    } catch (error) {
      this.logger.warn('Could not load models from database', error);
      return [];
    }
  }

  private rebuildIndex(): void {
    this.deploymentsByModel = new Map<string, Deployment[]>();
    for (const d of this.deployments) {
      const existing = this.deploymentsByModel.get(d.modelName);
      if (existing) {
        existing.push(d);
      } else {
        this.deploymentsByModel.set(d.modelName, [d]);
      }
    }
  }

  // ── File watching ──────────────────────────────────────────────────

  private startWatching(): void {
    this.watcher = chokidar.watch(this.resolvedConfigPath, { persistent: false });
    this.watcher.on('change', () => {
      this.logger.log('Config file changed, reloading...');
      this.loadConfig().catch((err) =>
        this.logger.error('Failed to reload config', err),
      );
    });
  }

  private stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
