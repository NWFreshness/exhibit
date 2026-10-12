// Operator script: create a district and invite its first owner.
//   npm run district:create -- "Cedar Ridge School District" director@cedarridge.example [WA]
import { PrismaClient } from "@prisma/client";
import { createDistrict } from "../lib/districts";

const [name, ownerEmail, state] = process.argv.slice(2);
if (!name || !ownerEmail) {
  console.error('Usage: npm run district:create -- "<district name>" <owner email> [WA]');
  process.exit(1);
}
const db = new PrismaClient();
createDistrict(db, { name, ownerEmail, state })
  .then((r) => console.log(`Created district ${r.districtId}. Login domain: ${r.domain}. ${ownerEmail} becomes owner at first sign-in.`))
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
