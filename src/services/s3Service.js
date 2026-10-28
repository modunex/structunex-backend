// S3 access for analysis results.
//
// This service NEVER reads Parquet. The calc-service writes the files and the browser
// reads them directly from a presigned URL; all Node does is sign those URLs and clean
// up when a run or a project goes away. That keeps megabytes of results off this
// server and off any proxy timeout between it and the browser.

const {
  S3Client,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { env } = require("../config/env");
const { AppError } = require("../middleware/errorHandler");

let client = null;

function s3() {
  if (!env.s3Bucket) {
    throw new AppError(
      503,
      "El almacenamiento de resultados no está configurado (falta S3_BUCKET)."
    );
  }
  if (!client) {
    client = new S3Client({
      region: env.awsRegion,
      // Sin credenciales explícitas, el SDK usa su cadena habitual (perfil, rol…),
      // que es lo que querría un despliegue con roles de IAM.
      ...(env.awsAccessKeyId && env.awsSecretAccessKey
        ? {
            credentials: {
              accessKeyId: env.awsAccessKeyId,
              secretAccessKey: env.awsSecretAccessKey,
            },
          }
        : {}),
    });
  }
  return client;
}

/** Prefijo de una ejecución dentro del bucket: "analysis/{projectId}/{runId}". */
function runPrefix(projectId, runId) {
  return [env.s3Prefix, String(projectId), String(runId)]
    .filter(Boolean)
    .join("/");
}

/** Prefijo de todas las ejecuciones de un proyecto. */
function projectPrefix(projectId) {
  return [env.s3Prefix, String(projectId)].filter(Boolean).join("/");
}

/** URL prefirmada de lectura para una clave concreta. */
async function signGet(key) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }),
    { expiresIn: env.s3UrlTtlS }
  );
}

/**
 * Firma varias claves de una tacada. El visor necesita 4-6 objetos para pintar un caso
 * de carga (desplazamientos, esfuerzos, contornos… más la malla), así que pedirlos uno
 * a uno sería una conversación absurda.
 *
 * `paths` es { nombreLógico: rutaRelativaAlPrefijo }.
 */
async function signRunPaths(projectId, runId, paths) {
  const prefix = runPrefix(projectId, runId);
  const entries = await Promise.all(
    Object.entries(paths).map(async ([name, relative]) => [
      name,
      await signGet(`${prefix}/${relative}`),
    ])
  );
  return Object.fromEntries(entries);
}

/**
 * Borra todo lo que cuelgue de un prefijo. Se usa al podar ejecuciones antiguas y al
 * borrar un proyecto; en ambos casos va FUERA de la transacción de la base (S3 no
 * participa en ella), así que es best-effort y la regla de ciclo de vida del bucket es
 * la red de seguridad de lo que falle.
 */
async function deletePrefix(prefix) {
  if (!env.s3Bucket) return 0;
  const cli = s3();
  let token;
  let deleted = 0;
  do {
    const listed = await cli.send(
      new ListObjectsV2Command({
        Bucket: env.s3Bucket,
        Prefix: `${prefix}/`,
        ContinuationToken: token,
      })
    );
    const objects = (listed.Contents || []).map((o) => ({ Key: o.Key }));
    if (objects.length > 0) {
      // DeleteObjects admite 1000 claves por llamada, que es justo el tope de página
      // que devuelve ListObjectsV2.
      await cli.send(
        new DeleteObjectsCommand({
          Bucket: env.s3Bucket,
          Delete: { Objects: objects, Quiet: true },
        })
      );
      deleted += objects.length;
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

const deleteRun = (projectId, runId) => deletePrefix(runPrefix(projectId, runId));
const deleteProjectResults = (projectId) => deletePrefix(projectPrefix(projectId));

module.exports = {
  runPrefix,
  projectPrefix,
  signGet,
  signRunPaths,
  deletePrefix,
  deleteRun,
  deleteProjectResults,
};
