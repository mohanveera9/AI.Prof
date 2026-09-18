import { classifyHttpStatus, classifyThrown, assertCompleteAppointment } from "./failure-classifier";
import { ConnectorError, ConnectorConfig } from "./connector.types";

export async function requestJson<T>(
  config: ConnectorConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        authorization: `Bearer ${config.apiKey}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let parsed: unknown = undefined;
    const text = await response.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    if (!response.ok) {
      throw new ConnectorError(classifyHttpStatus(response.status, parsed), `EHR ${method} ${path} failed with ${response.status}`, {
        statusCode: response.status,
        body: parsed,
      });
    }

    return parsed as T;
  } catch (err) {
    throw classifyThrown(err);
  } finally {
    clearTimeout(timer);
  }
}

export { assertCompleteAppointment };
