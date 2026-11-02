/** Slug legible de un título: sin acentos, en minúsculas y con longitud acotada. */
function slugify(title) {
  const slug = String(title)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "post";
}

module.exports = { slugify };
