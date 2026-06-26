/**
 * @file services/public-access/resource-manager.ts
 * @description Unified manager for resource configurations and strategies
 */

import type { ResourceAccessStrategy, ResourceConfig, ResourceType } from "@interfaces/public-access.ts";

/**
 * Unified manager for resource configurations and strategies
 * Combines the functionality of ResourceConfigFactory and ResourceStrategyFactory
 */
export class ResourceManager {
  private static configs = new Map<ResourceType, ResourceConfig>();
  private static strategies = new Map<ResourceType, () => ResourceAccessStrategy>();

  /**
   * Registers a configuration for a specific resource type
   * @param resourceType - Type of resource
   * @param config - Configuration for the resource type
   */
  static registerConfig(resourceType: ResourceType, config: ResourceConfig): void {
    this.configs.set(resourceType, config);
  }

  /**
   * Gets configuration for a specified resource type
   * @param resourceType - Type of resource
   * @returns Configuration for the resource type
   * @throws Error if no configuration is registered for the resource type
   */
  static getConfig(resourceType: ResourceType): ResourceConfig {
    const config = this.configs.get(resourceType);
    if (!config) {
      throw new Error(`No configuration registered for resource type: ${resourceType}`);
    }
    return config;
  }

  /**
   * Registers a strategy for a specific resource type
   * @param resourceType - Type of resource
   * @param strategyFactory - Factory function that creates strategy instance
   */
  static registerStrategy(
    resourceType: ResourceType,
    strategyFactory: () => ResourceAccessStrategy,
  ): void {
    this.strategies.set(resourceType, strategyFactory);
  }

  /**
   * Gets a strategy instance for the specified resource type
   * @param resourceType - Type of resource
   * @returns Strategy instance for the resource type
   * @throws Error if no strategy is registered for the resource type
   */
  static getStrategy(resourceType: ResourceType): ResourceAccessStrategy {
    const factory = this.strategies.get(resourceType);
    if (!factory) {
      throw new Error(`No strategy registered for resource type: ${resourceType}`);
    }
    return factory();
  }

  /**
   * Registers both configuration and strategy for a resource type
   * @param resourceType - Type of resource
   * @param config - Configuration for the resource type
   * @param strategyFactory - Factory function that creates strategy instance
   */
  static registerResource(
    resourceType: ResourceType,
    config: ResourceConfig,
    strategyFactory: () => ResourceAccessStrategy,
  ): void {
    this.registerConfig(resourceType, config);
    this.registerStrategy(resourceType, strategyFactory);
  }

  /**
   * Gets all registered resource types that have both config and strategy
   * @returns Array of fully registered resource types
   */
  static getFullyRegisteredTypes(): ResourceType[] {
    const configTypes = Array.from(this.configs.keys());
    const strategyTypes = Array.from(this.strategies.keys());

    // Return only resource types that have both config and strategy
    return configTypes.filter((type) => strategyTypes.includes(type));
  }

  /**
   * Gets all registered resource types
   * @returns Array of registered resource types
   */
  static getRegisteredTypes(): ResourceType[] {
    const configTypes = Array.from(this.configs.keys());
    const strategyTypes = Array.from(this.strategies.keys());

    // Return all unique resource types
    return [...new Set([...configTypes, ...strategyTypes])];
  }

  /**
   * Checks if a configuration is registered for a resource type
   * @param resourceType - Type of resource to check
   * @returns True if configuration is registered
   */
  static hasConfig(resourceType: ResourceType): boolean {
    return this.configs.has(resourceType);
  }

  /**
   * Checks if a strategy is registered for a resource type
   * @param resourceType - Type of resource to check
   * @returns True if strategy is registered
   */
  static hasStrategy(resourceType: ResourceType): boolean {
    return this.strategies.has(resourceType);
  }

  /**
   * Checks if both configuration and strategy are registered for a resource type
   * @param resourceType - Type of resource to check
   * @returns True if both are registered
   */
  static isFullyRegistered(resourceType: ResourceType): boolean {
    return this.hasConfig(resourceType) && this.hasStrategy(resourceType);
  }

  /**
   * Unregisters a configuration for a resource type
   * @param resourceType - Type of resource to unregister
   * @returns True if configuration was unregistered
   */
  static unregisterConfig(resourceType: ResourceType): boolean {
    return this.configs.delete(resourceType);
  }

  /**
   * Unregisters a strategy for a resource type
   * @param resourceType - Type of resource to unregister
   * @returns True if strategy was unregistered
   */
  static unregisterStrategy(resourceType: ResourceType): boolean {
    return this.strategies.delete(resourceType);
  }

  /**
   * Unregisters both configuration and strategy for a resource type
   * @param resourceType - Type of resource to unregister
   * @returns Object indicating what was unregistered
   */
  static unregisterResource(resourceType: ResourceType): { config: boolean; strategy: boolean } {
    return {
      config: this.unregisterConfig(resourceType),
      strategy: this.unregisterStrategy(resourceType),
    };
  }

  /**
   * Updates specific fields in a resource configuration
   * @param resourceType - Type of resource
   * @param updates - Partial configuration to merge
   */
  static updateConfig(
    resourceType: ResourceType,
    updates: Partial<ResourceConfig>,
  ): void {
    const existingConfig = this.getConfig(resourceType);
    const updatedConfig = { ...existingConfig, ...updates };
    this.configs.set(resourceType, updatedConfig);
  }
}
