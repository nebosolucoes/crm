import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError: typeof Sentry.captureRequestError = async (err, request, context) => {
  Sentry.captureRequestError(err, request, context);
  // Também no banco (`api_error_log`), pelo digest que a tela mostra. Import
  // tardio: este arquivo roda no edge também, e o registro usa o admin client.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registrarExcecaoDeRequest } = await import("@/lib/api/registro-de-erro");
    await registrarExcecaoDeRequest(err, request);
  }
};
