// Cliente de Claude en Amazon Bedrock (endpoint Mantle, API de Messages).
//
// Mismas credenciales que s3Service: si hay claves estáticas en el entorno se usan;
// si no, el SDK recorre su cadena habitual (perfil, rol de IAM…).

const { AnthropicBedrockMantle } = require("@anthropic-ai/bedrock-sdk");
const { env } = require("../config/env");
const { AppError } = require("../middleware/errorHandler");

let client = null;

function bedrock() {
  if (!env.bedrockModelId) {
    throw new AppError(503, "El asistente IA no está configurado (falta BEDROCK_MODEL_ID).");
  }
  if (!client) {
    client = new AnthropicBedrockMantle({
      awsRegion: env.bedrockRegion,
      ...(env.awsAccessKeyId && env.awsSecretAccessKey
        ? {
            awsAccessKey: env.awsAccessKeyId,
            awsSecretAccessKey: env.awsSecretAccessKey,
          }
        : {}),
      // Los turnos con PDFs grandes y varias herramientas pueden tardar; el stream
      // mantiene viva la conexión, pero el timeout del SDK cuenta por petición.
      timeout: 10 * 60 * 1000,
      maxRetries: 2,
    });
  }
  return client;
}

module.exports = { bedrock };
