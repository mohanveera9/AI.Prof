import { Injectable } from "@nestjs/common";
import { ExternalEntityType } from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class IdentifierMappingService {
  constructor(private readonly prisma: PrismaService) {}

  async getByInternal(hospitalId: string, entityType: ExternalEntityType, internalId: string) {
    return this.prisma.externalIdentifierMapping.findUnique({
      where: { hospitalId_entityType_internalId: { hospitalId, entityType, internalId } },
    });
  }

  async getByExternal(hospitalId: string, entityType: ExternalEntityType, externalId: string) {
    return this.prisma.externalIdentifierMapping.findUnique({
      where: { hospitalId_entityType_externalId: { hospitalId, entityType, externalId } },
    });
  }

  async upsert(hospitalId: string, entityType: ExternalEntityType, internalId: string, externalId: string) {
    return this.prisma.externalIdentifierMapping.upsert({
      where: { hospitalId_entityType_internalId: { hospitalId, entityType, internalId } },
      create: { hospitalId, entityType, internalId, externalId },
      update: { externalId },
    });
  }

  /**
   * Returns the existing external id, or creates the external entity via
   * `createExternal` and stores the mapping. Hospital-scoped uniqueness is
   * enforced by the DB unique constraints.
   */
  async getOrCreate(
    hospitalId: string,
    entityType: ExternalEntityType,
    internalId: string,
    createExternal: () => Promise<string>,
  ): Promise<string> {
    const existing = await this.getByInternal(hospitalId, entityType, internalId);
    if (existing) return existing.externalId;
    const externalId = await createExternal();
    await this.upsert(hospitalId, entityType, internalId, externalId);
    return externalId;
  }
}
