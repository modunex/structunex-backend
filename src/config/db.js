const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { env } = require("./env");

// Un único PrismaClient para todo el proceso. Usa el driver `pg` a través de
// @prisma/adapter-pg (engineType = "client" en schema.prisma), así que en tiempo de
// ejecución no hace falta ningún binario nativo de Prisma.
//
// `max` limita el pool: los planes pequeños de Postgres admiten pocas conexiones.
const adapter = new PrismaPg({
  connectionString: env.databaseUrl,
  max: env.databasePoolMax,
});

const prisma = new PrismaClient({ adapter });

async function connectDb() {
  await prisma.$connect();
  // Una consulta real: $connect con adaptador no abre conexión por sí solo, y queremos
  // que un DATABASE_URL malo tumbe el arranque, no la primera petición.
  await prisma.$queryRaw`SELECT 1`;
  console.log("[db] Connected to PostgreSQL");
}

async function disconnectDb() {
  await prisma.$disconnect();
}

module.exports = { prisma, connectDb, disconnectDb };
