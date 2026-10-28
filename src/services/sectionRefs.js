const { isUuid } = require("../lib/ids");

// Barras y áreas apuntan a una sección del catálogo con una clave foránea. Si el
// frontend manda un id que ya no existe (la sección se borró) o que no es del usuario,
// la FK tumbaría el guardado entero. Esas referencias se quitan antes de escribir: la
// barra o el área queda sin sección, que es lo mismo que veía el solver antes con un id
// colgado (la ignoraba).
const REFS = {
  modelElement: { field: "frameSectionId", catalog: "catalogFrameSection" },
  modelArea: { field: "areaSectionId", catalog: "catalogAreaSection" },
};

/** Devuelve `rows` con las referencias inválidas a null. `db` = prisma o tx. */
async function sanitizeSectionRefs(db, ownerId, name, rows) {
  const ref = REFS[name];
  if (!ref || !Array.isArray(rows) || rows.length === 0) return rows;
  const ids = [...new Set(rows.map((r) => r[ref.field]).filter(isUuid))];
  const found = ids.length
    ? await db[ref.catalog].findMany({
        where: { id: { in: ids }, ownerId },
        select: { id: true },
      })
    : [];
  const valid = new Set(found.map((r) => r.id));
  return rows.map((row) => {
    const value = row[ref.field];
    if (value === undefined || value === null || valid.has(value)) return row;
    return { ...row, [ref.field]: null };
  });
}

module.exports = { sanitizeSectionRefs };
