import { getPasswordResetService } from "@services/auth/index.ts";

const userId = "1EGwJ3X91gs3mjB4";

console.log(await getPasswordResetService().generatePasswordResetToken(userId));

Deno.exit();
