// .env.local (written by the Clerk CLI) takes priority; .env fills the rest.
// dotenv does not overwrite already-set vars, so load .env.local first.
require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

const env = {
  port: Number(process.env.PORT || 4000),
  // PostgreSQL. En Render: la "Internal Database URL" de la base.
  databaseUrl: process.env.DATABASE_URL,
  // Conexiones máximas del pool (los planes pequeños de Postgres admiten pocas).
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX || 5),
  // URL del calc-service. En Render, el Blueprint inyecta CALC_SERVICE_HOSTPORT
  // ("host:puerto" del servicio privado, sin esquema); CALC_SERVICE_URL manda si existe.
  calcServiceUrl:
    process.env.CALC_SERVICE_URL ||
    (process.env.CALC_SERVICE_HOSTPORT
      ? `http://${process.env.CALC_SERVICE_HOSTPORT}`
      : "http://localhost:8000"),
  // Orígenes permitidos para CORS. Acepta una lista separada por comas.
  // Por defecto, la app de producción (app.structunex.com). localhost se permite
  // aparte en app.js para desarrollo.
  clientOrigins: (
    process.env.CLIENT_ORIGIN ||
    "https://app.structunex.com"
  )
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  clerkSecretKey: process.env.CLERK_SECRET_KEY,
  // Svix signing secret for the Clerk webhook (Dashboard → Webhooks → endpoint).
  clerkWebhookSigningSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,

  // Mailchimp: registered users are pushed into the audience by the Clerk webhook.
  mailchimpApiKey: process.env.MAILCHIMP_API_KEY,
  // Data-center region for our Mailchimp account (matches the API-key suffix and
  // the us20.admin.mailchimp.com dashboard URL). Fixed — not an env var.
  mailchimpServerPrefix: "us20",
  mailchimpAudienceId: process.env.MAILCHIMP_AUDIENCE_ID,

  // Almacenamiento de resultados. El calc-service escribe el Parquet en este mismo
  // bucket/prefijo; aquí solo se leen (URL prefirmadas) y se borran. Ojo: las
  // credenciales de este servicio deberían poder GetObject/DeleteObject/ListBucket,
  // y las del calc-service solo PutObject.
  awsRegion: process.env.AWS_REGION || "eu-west-1",
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  s3Bucket: process.env.AWS_S3_BUCKET || "",
  s3Prefix: (process.env.AWS_S3_PREFIX || "analysis").replace(/^\/+|\/+$/g, ""),
  // Vida de las URL prefirmadas. Corta a propósito: la descarga tarda segundos y una
  // URL que se quede pegada en el historial no debe seguir sirviendo resultados.
  s3UrlTtlS: Number(process.env.S3_URL_TTL_S || 300),

  // Asistente IA: Claude en Amazon Bedrock (endpoint Mantle). Usa las mismas
  // credenciales AWS de arriba; el usuario de IAM necesita permiso de invocación de
  // Bedrock y s3:PutObject/GetObject sobre `${AWS_S3_BUCKET}/chat/*` (adjuntos).
  bedrockModelId: process.env.BEDROCK_MODEL_ID || "anthropic.claude-opus-5-5",
  bedrockRegion: process.env.BEDROCK_REGION || process.env.AWS_REGION || "eu-west-1",
  // Esfuerzo de razonamiento: low | medium | high | xhigh | max.
  aiEffort: process.env.AI_EFFORT || "medium",
  aiMaxUploadMb: Number(process.env.AI_MAX_UPLOAD_MB || 20),
  aiS3Prefix: (process.env.AI_S3_PREFIX || "chat").replace(/^\/+|\/+$/g, ""),

  // Reporting: PDFs exportados y logos de proyecto en `${AWS_S3_BUCKET}/reports/*`
  // (Put/Get/Delete). El PDF lo produce el servicio privado report-renderer.
  reportsS3Prefix: (process.env.REPORTS_S3_PREFIX || "reports").replace(/^\/+|\/+$/g, ""),
  rendererUrl:
    process.env.RENDERER_URL ||
    (process.env.RENDERER_HOSTPORT ? `http://${process.env.RENDERER_HOSTPORT}` : "http://localhost:8090"),
  rendererToken: process.env.RENDERER_TOKEN || "",
  logoMaxBytes: Number(process.env.LOGO_MAX_BYTES || 1024 * 1024),
};

if (!env.databaseUrl) {
  console.warn(
    "[env] DATABASE_URL is not set — the server cannot reach PostgreSQL. " +
      "Set it in .env (local) or in the Render service environment."
  );
}

if (!env.clerkSecretKey) {
  console.warn(
    "[env] CLERK_SECRET_KEY is not set — auth will reject all requests. " +
      "Check .env.local (run `clerk init`)."
  );
}

if (!env.s3Bucket) {
  console.warn(
    "[env] AWS_S3_BUCKET is not set — analysis results cannot be stored or served. " +
      "Set AWS_S3_BUCKET (and AWS credentials) to run analyses."
  );
}

if (!env.clerkWebhookSigningSecret) {
  console.warn(
    "[env] CLERK_WEBHOOK_SIGNING_SECRET is not set — the Clerk webhook will reject " +
      "all deliveries. Set it from the Clerk Dashboard webhook endpoint."
  );
}

if (!env.mailchimpApiKey || !env.mailchimpAudienceId) {
  console.warn(
    "[env] MAILCHIMP_API_KEY / MAILCHIMP_AUDIENCE_ID not set — new users will be " +
      "saved to the DB but not synced to the Mailchimp audience."
  );
}

module.exports = { env };
