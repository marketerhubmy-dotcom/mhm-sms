/**
 * Pages Function: hantar semua /api/* ke Worker backend melalui Service Binding "API".
 * Ini mengekalkan cookie sesi sebagai same-origin (sms.mhmacademy.site) tanpa CORS.
 */
interface Env {
  API: Fetcher;
}

export const onRequest: PagesFunction<Env> = (ctx) => ctx.env.API.fetch(ctx.request);
