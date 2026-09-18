import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import type { IntegrationConnector } from "./connector.interface";
import { MockEhrConnector } from "./mock-ehr.connector";

const DEFAULT_CONNECTOR_TYPE = "MOCK_EHR";

@Injectable()
export class ConnectorFactory {
  private readonly logger = new Logger(ConnectorFactory.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  timeoutMs(): number {
    return Number(this.config.get("MOCK_EHR_TIMEOUT_MS") ?? 2500);
  }

  async ensureConnection(hospitalId: string) {
    const existing = await this.prisma.healthcareSystemConnection.findUnique({
      where: { hospitalId_connectorType: { hospitalId, connectorType: DEFAULT_CONNECTOR_TYPE } },
    });
    if (existing) return existing;

    return this.prisma.healthcareSystemConnection.create({
      data: {
        hospitalId,
        connectorType: DEFAULT_CONNECTOR_TYPE,
        baseUrl: this.config.get<string>("MOCK_EHR_BASE_URL") ?? "http://localhost:4100",
        apiKeyRef: "MOCK_EHR_API_KEY",
        isEnabled: true,
      },
    });
  }

  resolveApiKey(apiKeyRef: string): string {
    const value = this.config.get<string>(apiKeyRef) ?? process.env[apiKeyRef];
    if (!value) {
      this.logger.warn(`Secret ref ${apiKeyRef} is empty — mock EHR calls will 401`);
      return "";
    }
    return value;
  }

  async forHospital(hospitalId: string): Promise<{ connector: IntegrationConnector; connectionId: string; baseUrl: string }> {
    const connection = await this.ensureConnection(hospitalId);
    if (!connection.isEnabled) {
      throw new Error(`Healthcare system connection for hospital ${hospitalId} is disabled`);
    }
    const connector = this.create(connection.baseUrl, this.resolveApiKey(connection.apiKeyRef));
    return { connector, connectionId: connection.id, baseUrl: connection.baseUrl };
  }

  create(baseUrl: string, apiKey: string, timeoutMs?: number): MockEhrConnector {
    return new MockEhrConnector({
      baseUrl,
      apiKey,
      timeoutMs: timeoutMs ?? this.timeoutMs(),
    });
  }

  async adminConnector(): Promise<MockEhrConnector> {
    return this.create(
      this.config.get<string>("MOCK_EHR_BASE_URL") ?? "http://localhost:4100",
      this.config.get<string>("MOCK_EHR_API_KEY") ?? process.env.MOCK_EHR_API_KEY ?? "",
    );
  }
}
