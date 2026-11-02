// Cambia el rol de un perfil de la Comunidad. La persona debe haber entrado antes
// en la Comunidad y aceptado las normas, porque eso crea su perfil.
//
//   npm run community:role -- correo@empresa.com admin
//
// Roles: member, moderator, admin. Usa DATABASE_URL del entorno.
const { prisma } = require("../src/config/db");

const ROLES = new Set(["member", "moderator", "admin"]);

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !ROLES.has(role)) {
    throw new Error("Uso: npm run community:role -- correo@empresa.com member|moderator|admin");
  }
  const profiles = await prisma.forumProfile.findMany({
    where: { user: { email: { equals: email, mode: "insensitive" } } },
  });
  if (profiles.length === 0) throw new Error(`No hay un perfil de la Comunidad con el correo ${email}`);
  if (profiles.length > 1) throw new Error(`Hay ${profiles.length} perfiles con el correo ${email}`);
  await prisma.$transaction([
    prisma.forumProfile.update({ where: { id: profiles[0].id }, data: { role } }),
    prisma.forumModerationLog.create({
      data: {
        actorId: profiles[0].id,
        action: "profile.role",
        targetType: "profile",
        targetId: profiles[0].handle,
        reason: `Rol ${role} asignado por script`,
      },
    }),
  ]);
  console.log(`${profiles[0].handle} ahora tiene el rol ${role}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
