import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { UserRole } from "@ai-prof/shared";

const prisma = new PrismaClient();

async function main() {
  const platformAdminEmail = "admin@ai-prof.dev";
  const existing = await prisma.user.findUnique({ where: { email: platformAdminEmail } });
  if (existing) {
    console.log(`Platform admin already exists: ${platformAdminEmail}`);
    return;
  }

  const passwordHash = await bcrypt.hash("PlatformAdmin123!", 10);
  await prisma.user.create({
    data: {
      email: platformAdminEmail,
      passwordHash,
      role: UserRole.PLATFORM_ADMIN,
    },
  });

  console.log("Seeded platform admin:");
  console.log(`  email:    ${platformAdminEmail}`);
  console.log(`  password: PlatformAdmin123!`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
