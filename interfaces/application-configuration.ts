/**
 * @file interfaces/application-configuration.ts
 * @description Application configuration service interfaces
 * These interfaces define the structure for application initialization and configuration
 */

/**
 * Super user configuration for application initialization
 */
export interface IAppConfigSuperUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Parameters for application initialization
 */
export interface IAppConfigInitializeParams {
  environmentName: string;
  superUser: IAppConfigSuperUser;
}

/**
 * Result of application initialization
 */
export interface IAppConfigInitializeResult {
  environmentId: string;
  userId: string;
}
