import { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { ExternalEntityType, HospitalStatus } from "@ai-prof/shared";
import { IdentifierMappingService } from "./identifier-mapping.service";

describe("IdentifierMappingService", () => {
  const prisma = new PrismaClient();
  const mapping = new IdentifierMappingService(prisma as any);
  const suffix = nanoid(8);
  let hospitalA: string;
  let hospitalB: string;

  beforeAll(async () => {
    hospitalA = (
      await prisma.hospital.create({
        data: { name: `Map A ${suffix}`, slug: `map-a-${suffix}`, status: HospitalStatus.APPROVED },
      })
    ).id;
    hospitalB = (
      await prisma.hospital.create({
        data: { name: `Map B ${suffix}`, slug: `map-b-${suffix}`, status: HospitalStatus.APPROVED },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.externalIdentifierMapping.deleteMany({ where: { hospitalId: { in: [hospitalA, hospitalB] } } });
    await prisma.hospital.deleteMany({ where: { id: { in: [hospitalA, hospitalB] } } });
    await prisma.$disconnect();
  });

  it("creates a mapping once and returns the same external id afterwards", async () => {
    let created = 0;
    const first = await mapping.getOrCreate(hospitalA, ExternalEntityType.PATIENT, `pat-${suffix}`, async () => {
      created += 1;
      return `ext-pat-${suffix}`;
    });
    const second = await mapping.getOrCreate(hospitalA, ExternalEntityType.PATIENT, `pat-${suffix}`, async () => {
      created += 1;
      return "should-not-run";
    });
    expect(first).toBe(`ext-pat-${suffix}`);
    expect(second).toBe(first);
    expect(created).toBe(1);
  });

  it("scopes mappings per hospital so the same internal id can map differently across tenants", async () => {
    await mapping.upsert(hospitalA, ExternalEntityType.DOCTOR, `doc-${suffix}`, "ext-a");
    await mapping.upsert(hospitalB, ExternalEntityType.DOCTOR, `doc-${suffix}`, "ext-b");
    const a = await mapping.getByInternal(hospitalA, ExternalEntityType.DOCTOR, `doc-${suffix}`);
    const b = await mapping.getByInternal(hospitalB, ExternalEntityType.DOCTOR, `doc-${suffix}`);
    expect(a?.externalId).toBe("ext-a");
    expect(b?.externalId).toBe("ext-b");
  });

  it("looks up by external id within a hospital", async () => {
    await mapping.upsert(hospitalA, ExternalEntityType.APPOINTMENT, `apt-${suffix}`, `ext-apt-${suffix}`);
    const found = await mapping.getByExternal(hospitalA, ExternalEntityType.APPOINTMENT, `ext-apt-${suffix}`);
    expect(found?.internalId).toBe(`apt-${suffix}`);
  });
});
