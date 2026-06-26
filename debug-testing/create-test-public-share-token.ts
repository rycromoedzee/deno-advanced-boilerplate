import { getTimeNow } from "@utils/shared/index.ts";
import { getSecureLinkGeneratorService } from "@services/public-sharing/index.ts";

const volumeContext = {
  environmentId: "your-environment-id-here",
  userId: "JfcQFb453CGlNbDX",
  resourceId: "uYGmzEaTvalbBFMo",
  timestamp: getTimeNow(),
};

console.log(getSecureLinkGeneratorService().createSecurePublicUri(volumeContext));

Deno.exit();
