/**
 * TanStack Start instance — global middleware.
 *
 * Every server function and every document request passes through here.
 * The two middlewares are the single place server-side failures are
 * captured (app/server/report-error.ts): the error is recorded, then
 * rethrown so callers behave exactly as before.
 *
 * `report-error` is imported lazily inside the `.server()` handlers so the
 * client bundle never pulls in the Supabase service client.
 */
import { createMiddleware, createStart } from "@tanstack/react-start";

const captureFunctionErrors = createMiddleware({ type: "function" }).server(
  async ({ next, serverFnMeta }) => {
    const { captureErrors } = await import("./server/report-error");
    return captureErrors(`fn:${serverFnMeta.name}`, async () => next(), {
      file: serverFnMeta.filename,
    });
  },
);

const captureRequestErrors = createMiddleware({ type: "request" }).server(
  async ({ next, request, pathname, handlerType }) => {
    // Server-function requests are already covered (and rethrown) above.
    if (handlerType === "serverFn") return next();
    const { captureErrors } = await import("./server/report-error");
    return captureErrors("request", async () => next(), {
      requestUrl: pathname,
      method: request.method,
    });
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [captureRequestErrors],
  functionMiddleware: [captureFunctionErrors],
}));
