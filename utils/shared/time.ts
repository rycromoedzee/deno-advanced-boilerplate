/**
 * @file utils/shared/time.ts
 * @description Time/date helper utilities
 */
export const getTimeNowForStorage = () => Math.floor(Date.now() / 1000);
export const getTimeNow = () => Date.now();
