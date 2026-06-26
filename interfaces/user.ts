/**
 * @file interfaces/user.ts
 * @description User service interfaces
 * These interfaces define the structure for user-related operations and data
 */

/**
 * User environment information
 */
export interface IUserEnvironment {
  userId: string;
  isTwoFactorEnabled: boolean;
  environmentId: string;
  environmentName: string;
  environmentHasSubDomain: boolean;
  environmentHasCustomDomain: boolean;
  firstName: string;
  lastName: string;
}

/**
 * User lookup result containing identity and associated users
 */
export interface IUserLookupResult {
  userId: string;
  password: string | null;
  users: IUserEnvironment[];
}

/**
 * Two-factor authentication user information
 */
export interface IUserTwoFactor {
  userId: string;
  environmentId: string;
  environmentName: string;
  isTwoFactorEnabled: boolean;
  twoFactorSecret: Uint8Array | null;
  twoFactorSecretId: string | null;
  firstName: string;
  lastName: string;
}

/**
 * User with environment context information
 */
export interface IUserWithEnvironment {
  id: string;
  firstName: string;
  lastName: string;
  isAdmin: boolean;
  environmentId: string;
  environmentName: string;
  customDomain: string | null;
  isTwoFactorEnabled: boolean;
  isActive: boolean;
}
