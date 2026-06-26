/**
 * @file services/notes-versions/singletons.ts
 * @description Lazy singletons for notes versions services
 */
import { VersionCreateService } from "./version-create.service.ts";

let versionCreateService: VersionCreateService;
export function getVersionCreateService(): VersionCreateService {
  if (!versionCreateService) versionCreateService = new VersionCreateService();
  return versionCreateService;
}

import { VersionListService } from "./version-list.service.ts";
let versionListService: VersionListService;
export function getVersionListService(): VersionListService {
  if (!versionListService) versionListService = new VersionListService();
  return versionListService;
}

import { VersionReadService } from "./version-read.service.ts";
let versionReadService: VersionReadService;
export function getVersionReadService(): VersionReadService {
  if (!versionReadService) versionReadService = new VersionReadService();
  return versionReadService;
}
