// Changeset del asistente IA.
//
// El LLM nunca toca el modelo: propone operaciones declarativas (herramienta
// `propose_changes`) en las unidades de display del usuario. Aquí se convierten a
// base kN·m, se validan contra una copia de trabajo del modelo (snapshot + lo ya
// propuesto en este turno) y se traducen a operaciones primitivas que el frontend
// reproduce tal cual al pulsar "Aplicar" (src/utils/applyChangeset.ts).
//
// Cada llamada a propose_changes es atómica: si una operación falla, se descarta
// la llamada entera y el LLM recibe los errores para corregir.

const { z } = require("zod");
const { createCatalogMaterial } = require("../../schemas/catalogMaterialSchema");
const { createCatalogFrameSection } = require("../../schemas/catalogFrameSectionSchema");
const { getShape } = require("../../lib/aiscShapes");
const { UNIT_SYSTEM_IDS, unitSystemById, toBase, round } = require("./units");

// Misma tolerancia que checkModel/removeDuplicates del frontend (m).
const COINCIDENT_TOL = 1e-4;
const DEFAULT_COVER_M = 0.04;

// Valores típicos por tipo de material, en base (mismos que material-form.tsx).
const MATERIAL_DEFAULTS = {
  steel: { E: 210e6, nu: 0.3, density: 76.97, Fy: 275000, Fu: 430000 },
  rebar: { E: 210e6, nu: 0.3, density: 76.97, Fy: 420000, Fu: 550000 },
  concrete: { nu: 0.2, density: 24, fc: 25000 },
  other: { nu: 0.3 },
};
// E = 4700·√f'c (MPa), con f'c y E en kPa (concreteE del frontend).
const concreteE = (fcKpa) => 4700 * Math.sqrt(fcKpa / 1000) * 1000;

// GDL de cada formulación. Debe concordar con ANALYSIS_TYPE_DOFS del frontend
// (src/utils/dofs.ts): los modelos planos viven en XZ.
const DOF_KEYS = ["UX", "UY", "UZ", "RX", "RY", "RZ"];
const ANALYSIS_TYPE_DOFS = {
  beam: ["UZ", "RY"],
  plane_truss: ["UX", "UZ"],
  plane_frame: ["UX", "UZ", "RY"],
  space_truss: ["UX", "UY", "UZ"],
  space_frame: DOF_KEYS,
};
const LOAD_COMPONENT_DOF = { fx: "UX", fy: "UY", fz: "UZ", mx: "RX", my: "RY", mz: "RZ" };

// ─── Esquema de entrada (lo que escribe el LLM, en unidades de display) ───

const xyz = z.tuple([z.number(), z.number(), z.number()]);
const nodeRef = z.union([z.string().min(1), xyz]);
const num = z.number();
const pos = z.number().positive();

const restraintFlags = z.object({
  dx: z.boolean().optional(),
  dy: z.boolean().optional(),
  dz: z.boolean().optional(),
  rx: z.boolean().optional(),
  ry: z.boolean().optional(),
  rz: z.boolean().optional(),
});

const SECTION_SHAPES = [
  "rectangular",
  "circular",
  "pipe",
  "box",
  "ishape",
  "channel",
  "tee",
  "angle",
  "aisc",
  "general",
];
const DIM_KEYS = ["b", "h", "d", "t", "tw", "tf", "bf", "bfTop", "tfTop", "bfBot", "tfBot"];
const GRID_AXES = ["x", "y", "z"];
const gridAxis = z.array(z.object({ id: z.string().min(1), at: num })).optional();

const operation = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_material"),
    tempId: z.string().min(1),
    name: z.string().min(1),
    materialType: z.enum(["concrete", "steel", "rebar", "other"]),
    E: pos.optional(),
    nu: z.number().min(0).max(0.5).optional(),
    density: pos.optional(),
    fc: pos.optional(),
    Fy: pos.optional(),
    Fu: pos.optional(),
  }),
  z.object({
    type: z.literal("create_section"),
    tempId: z.string().min(1),
    name: z.string().min(1),
    material: z.string().min(1),
    shape: z.enum(SECTION_SHAPES),
    catalogLabel: z.string().optional(),
    ...Object.fromEntries(DIM_KEYS.map((k) => [k, pos.optional()])),
    A: pos.optional(),
    I33: pos.optional(),
    I22: pos.optional(),
    J: pos.optional(),
    designRole: z.enum(["beam", "column"]).optional(),
    cover: pos.optional(),
  }),
  z.object({ type: z.literal("add_nodes"), nodes: z.array(xyz).min(1) }),
  z.object({
    type: z.literal("add_frames"),
    frames: z
      .array(z.object({ i: nodeRef, j: nodeRef, section: z.string().optional() }))
      .min(1),
  }),
  z.object({
    type: z.literal("set_supports"),
    nodes: z.array(nodeRef).min(1),
    restraint: z.enum(["fixed", "pinned", "rollerZ", "free", "custom"]),
    custom: restraintFlags.optional(),
  }),
  z.object({
    type: z.literal("add_load_patterns"),
    patterns: z
      .array(
        z.object({
          name: z.string().min(1),
          patternType: z
            .enum(["dead", "superDead", "live", "roofLive", "wind", "snow", "rain", "quake", "other"])
            .optional(),
          selfWeightMultiplier: z.number().optional(),
        })
      )
      .min(1),
  }),
  z.object({
    type: z.literal("add_nodal_loads"),
    loads: z
      .array(
        z.object({
          node: nodeRef,
          loadPattern: z.string().min(1),
          fx: num.optional(),
          fy: num.optional(),
          fz: num.optional(),
          mx: num.optional(),
          my: num.optional(),
          mz: num.optional(),
        })
      )
      .min(1),
  }),
  z.object({
    type: z.literal("add_frame_loads"),
    elements: z.array(z.string().min(1)).min(1),
    loadPattern: z.string().min(1),
    kind: z.enum(["distributed", "point"]),
    dir: z.enum(["gravity", "gx", "gy", "gz", "local1", "local2", "local3"]),
    value: num,
    value2: num.optional(),
    dist: z.number().min(0).optional(),
    dist2: z.number().min(0).optional(),
    distAbsolute: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("assign_section"),
    elements: z.array(z.string().min(1)).min(1),
    section: z.string().min(1),
  }),
  z.object({
    type: z.literal("delete_elements"),
    elements: z.array(z.string().min(1)).min(1),
    deleteOrphanNodes: z.boolean().optional(),
  }),
  z.object({ type: z.literal("set_grid"), x: gridAxis, y: gridAxis, z: gridAxis }),
  z.object({ type: z.literal("set_active_dofs"), dofs: z.array(z.enum(DOF_KEYS)).min(1).nullable() }),
]);

const proposeInput = z.object({
  summary: z.string().min(1),
  inputUnits: z.enum(UNIT_SYSTEM_IDS).optional(),
  operations: z.array(operation).min(1),
});

// ─── Utilidades ───

function nextFreeId(taken, prefix) {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const id of taken) {
    const m = re.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  let n = max + 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clone = (v) => JSON.parse(JSON.stringify(v));

function formatZodError(err, prefix) {
  return err.issues.map((i) => `${prefix}${i.path.join(".") || "(raíz)"}: ${i.message}`);
}

// ─── Builder ───

/**
 * Copia de trabajo del modelo para un turno de conversación. Acumula las
 * operaciones de todas las llamadas a propose_changes del turno.
 *
 * @param snapshot  { nodes, elements, supports, loads, frameLoads, configuration,
 *                  dim, analysisType, activeDofs } tal como lo manda el frontend
 *                  (base kN·m).
 * @param catalog   { materials, sections } del usuario (filas de Prisma).
 * @param unitSystemId  sistema de display activo del usuario.
 */
function createChangesetBuilder({ snapshot, catalog, unitSystemId }) {
  // Tipo de modelo: fijo para el proyecto. En un modelo plano todo vive en Y = 0.
  const typeDofs = ANALYSIS_TYPE_DOFS[snapshot.analysisType] || null;
  const plane =
    snapshot.dim === "2D" || ["beam", "plane_truss", "plane_frame"].includes(snapshot.analysisType);
  const state = {
    nodes: clone(snapshot.nodes || []),
    elements: clone(snapshot.elements || []),
    supports: clone(snapshot.supports || []),
    loadPatterns: (snapshot.configuration?.loadPatterns || []).map((p) => p.name),
    activeDofs: snapshot.activeDofs?.length ? [...snapshot.activeDofs] : null,
    // Catálogo: filas reales + temporales creadas en este turno.
    materials: (catalog.materials || []).map((m) => ({ ref: m.id, name: m.name, type: m.type })),
    sections: (catalog.sections || []).map((s) => ({
      ref: s.id,
      name: s.name,
      propertyType: s.propertyType,
    })),
    ops: [],
    summaries: [],
  };

  const activeSys = unitSystemById(unitSystemId);

  function findMaterial(ref) {
    const lower = ref.toLowerCase();
    return (
      state.materials.find((m) => m.ref === ref || m.ref === `tmp:${ref}`) ||
      state.materials.find((m) => m.name.toLowerCase() === lower)
    );
  }
  function findSection(ref) {
    const lower = ref.toLowerCase();
    return (
      state.sections.find((s) => s.ref === ref || s.ref === `tmp:${ref}`) ||
      state.sections.find((s) => s.name.toLowerCase() === lower)
    );
  }

  /** Aplica una llamada a propose_changes. Devuelve { ok, result | errors }. */
  function apply(rawInput) {
    const parsed = proposeInput.safeParse(rawInput);
    if (!parsed.success) {
      return { ok: false, errors: formatZodError(parsed.error, "") };
    }
    const input = parsed.data;
    const sys = input.inputUnits ? unitSystemById(input.inputUnits) : activeSys;
    const L = (v) => (v == null ? v : round(toBase(v, sys, "length"), 9));
    const Q = (v, q) => (v == null ? v : round(toBase(v, sys, q), 9));

    // Atomicidad: se trabaja sobre una copia y solo se confirma si todo va bien.
    const { ops: _ops, summaries: _summaries, ...rollbackable } = state;
    const saved = clone(rollbackable);
    const opsStart = state.ops.length;
    const errors = [];
    const warnings = [];
    const created = { nodes: [], elements: [], materials: [], sections: [] };

    const nodeIds = () => new Set(state.nodes.map((n) => n.id));
    const elementIds = () => new Set(state.elements.map((e) => e.id));

    function resolveNode(ref, where) {
      if (typeof ref === "string") {
        const n = state.nodes.find((x) => x.id === ref);
        if (!n) errors.push(`${where}: el nudo "${ref}" no existe`);
        return n ? n.id : null;
      }
      const p = { x: L(ref[0]), y: L(ref[1]), z: L(ref[2]) };
      const hit = state.nodes.find((n) => dist3(n, p) < COINCIDENT_TOL);
      if (hit) return hit.id;
      if (plane && Math.abs(p.y) > COINCIDENT_TOL) {
        errors.push(
          `${where}: el modelo es plano (${snapshot.analysisType || "2D"}, plano XZ) y el nudo ` +
            `[${ref.join(", ")}] tiene Y ≠ 0. Usa Y = 0; el tipo de modelo no se puede cambiar.`
        );
        return null;
      }
      const node = { id: nextFreeId(nodeIds(), "N"), ...p };
      state.nodes.push(node);
      state.ops.push({ op: "addNode", node });
      created.nodes.push(node.id);
      return node.id;
    }

    function resolveSectionRef(ref, where) {
      const s = findSection(ref);
      if (!s) errors.push(`${where}: la sección "${ref}" no existe (usa list_sections o créala)`);
      return s ? s.ref : null;
    }

    function requireElements(ids, where) {
      const all = elementIds();
      const missing = ids.filter((id) => !all.has(id));
      if (missing.length) errors.push(`${where}: barras inexistentes: ${missing.join(", ")}`);
      return missing.length === 0;
    }

    function requirePattern(name, where) {
      if (!state.loadPatterns.includes(name)) {
        errors.push(
          `${where}: el patrón de carga "${name}" no existe. Existentes: ${
            state.loadPatterns.join(", ") || "(ninguno)"
          }. Créalo antes con add_load_patterns.`
        );
        return false;
      }
      return true;
    }

    input.operations.forEach((op, idx) => {
      const where = `operations[${idx}] (${op.type})`;
      switch (op.type) {
        case "create_material": {
          if (state.materials.some((m) => m.ref === `tmp:${op.tempId}`)) {
            errors.push(`${where}: el tempId "${op.tempId}" ya está en uso`);
            break;
          }
          const d = MATERIAL_DEFAULTS[op.materialType];
          const fc = Q(op.fc, "modulus") ?? d.fc;
          const data = {
            type: op.materialType,
            name: op.name,
            E: Q(op.E, "modulus") ?? (op.materialType === "concrete" ? Math.round(concreteE(fc)) : d.E),
            nu: op.nu ?? d.nu,
            density: Q(op.density, "density") ?? d.density,
          };
          if (op.materialType === "concrete") {
            data.fc = fc;
            data.lightweight = false;
          }
          if (op.materialType === "steel" || op.materialType === "rebar") {
            data.Fy = Q(op.Fy, "modulus") ?? d.Fy;
            data.Fu = Q(op.Fu, "modulus") ?? d.Fu;
          }
          if (data.E == null) {
            errors.push(`${where}: falta E (módulo de elasticidad) para un material "other"`);
            break;
          }
          const check = createCatalogMaterial.safeParse(data);
          if (!check.success) {
            errors.push(...formatZodError(check.error, `${where}: `));
            break;
          }
          const ref = `tmp:${op.tempId}`;
          state.materials.push({ ref, name: op.name, type: op.materialType });
          state.ops.push({ op: "createMaterial", tempId: ref, data: check.data });
          created.materials.push(ref);
          break;
        }

        case "create_section": {
          if (state.sections.some((s) => s.ref === `tmp:${op.tempId}`)) {
            errors.push(`${where}: el tempId "${op.tempId}" ya está en uso`);
            break;
          }
          const mat = findMaterial(op.material);
          if (!mat) {
            errors.push(`${where}: el material "${op.material}" no existe (usa list_materials o créalo)`);
            break;
          }
          const propertyType =
            mat.type === "concrete" ? "concrete" : mat.type === "steel" ? "steel" : "other";
          if (mat.type === "rebar") {
            errors.push(`${where}: un material de armadura (rebar) no puede formar una sección`);
            break;
          }
          const data = { name: op.name, materialId: mat.ref, propertyType };
          if (op.shape === "aisc") {
            const shape = getShape(op.catalogLabel);
            if (!shape) {
              errors.push(`${where}: el perfil AISC "${op.catalogLabel}" no existe (usa search_aisc_shapes)`);
              break;
            }
            data.source = "catalog";
            data.catalogLabel = shape.label;
          } else if (op.shape === "general") {
            data.source = "general";
            data.A = Q(op.A, "area");
            data.I33 = Q(op.I33, "inertia");
            if (op.I22 != null) data.I22 = Q(op.I22, "inertia");
            if (op.J != null) data.J = Q(op.J, "inertia");
          } else {
            data.source = "parametric";
            data.shape = op.shape;
            for (const k of DIM_KEYS) if (op[k] != null) data[k] = L(op[k]);
          }
          if (propertyType === "concrete") {
            data.reinforcement = {
              designRole: op.designRole || "beam",
              cover: op.cover != null ? L(op.cover) : DEFAULT_COVER_M,
            };
          }
          const check = createCatalogFrameSection.safeParse(data);
          if (!check.success) {
            errors.push(...formatZodError(check.error, `${where}: `));
            break;
          }
          const ref = `tmp:${op.tempId}`;
          state.sections.push({ ref, name: op.name, propertyType });
          state.ops.push({ op: "createSection", tempId: ref, data: check.data });
          created.sections.push(ref);
          break;
        }

        case "add_nodes":
          op.nodes.forEach((p, k) => resolveNode(p, `${where}.nodes[${k}]`));
          break;

        case "add_frames":
          op.frames.forEach((f, k) => {
            const w = `${where}.frames[${k}]`;
            const a = resolveNode(f.i, w);
            const b = resolveNode(f.j, w);
            const sectionRef = f.section ? resolveSectionRef(f.section, w) : null;
            if (!a || !b) return;
            if (a === b) {
              errors.push(`${w}: los dos extremos son el mismo nudo (${a}); barra de longitud cero`);
              return;
            }
            const dup = state.elements.find(
              (e) => (e.nodeA === a && e.nodeB === b) || (e.nodeA === b && e.nodeB === a)
            );
            if (dup) {
              warnings.push(`${w}: ya existe la barra ${dup.id} entre ${a} y ${b}; se omite`);
              return;
            }
            const element = { id: nextFreeId(elementIds(), "E"), nodeA: a, nodeB: b };
            if (sectionRef) element.frameSectionId = sectionRef;
            state.elements.push(element);
            state.ops.push({ op: "addElement", element });
            created.elements.push(element.id);
          });
          break;

        case "set_supports": {
          const preset = {
            fixed: { dx: true, dy: true, dz: true, rx: true, ry: true, rz: true },
            pinned: { dx: true, dy: true, dz: true, rx: false, ry: false, rz: false },
            rollerZ: { dx: false, dy: false, dz: true, rx: false, ry: false, rz: false },
            free: { dx: false, dy: false, dz: false, rx: false, ry: false, rz: false },
          };
          let flags = preset[op.restraint];
          if (op.restraint === "custom") {
            if (!op.custom) {
              errors.push(`${where}: restraint "custom" requiere el objeto custom`);
              break;
            }
            flags = { ...preset.free, ...op.custom };
          }
          op.nodes.forEach((ref, k) => {
            const id = resolveNode(ref, `${where}.nodes[${k}]`);
            if (!id) return;
            const support = { nodeId: id, ...flags };
            state.supports = state.supports.filter((s) => s.nodeId !== id);
            state.supports.push(support);
            state.ops.push({ op: "setSupport", support });
          });
          break;
        }

        case "add_load_patterns":
          op.patterns.forEach((p) => {
            if (state.loadPatterns.includes(p.name)) {
              warnings.push(`${where}: el patrón "${p.name}" ya existe; se reutiliza`);
              return;
            }
            const pattern = { name: p.name };
            if (p.patternType) pattern.type = p.patternType;
            if (p.selfWeightMultiplier != null) pattern.selfWeightMultiplier = p.selfWeightMultiplier;
            state.loadPatterns.push(p.name);
            state.ops.push({ op: "addLoadPattern", pattern });
          });
          break;

        case "add_nodal_loads":
          op.loads.forEach((l, k) => {
            const w = `${where}.loads[${k}]`;
            if (!requirePattern(l.loadPattern, w)) return;
            const id = resolveNode(l.node, w);
            if (!id) return;
            const inactive = Object.keys(LOAD_COMPONENT_DOF).filter(
              (c) => l[c] && state.activeDofs && !state.activeDofs.includes(LOAD_COMPONENT_DOF[c])
            );
            if (inactive.length) {
              errors.push(
                `${w}: ${inactive.join(", ")} actúan sobre GDL inactivos (activos: ${state.activeDofs.join(", ")}); el análisis los ignoraría`
              );
              return;
            }
            const load = { nodeId: id, loadPattern: l.loadPattern };
            for (const c of ["fx", "fy", "fz"]) if (l[c] != null) load[c] = Q(l[c], "force");
            for (const c of ["mx", "my", "mz"]) if (l[c] != null) load[c] = Q(l[c], "moment");
            state.ops.push({ op: "addNodalLoad", load });
          });
          break;

        case "add_frame_loads": {
          if (!requirePattern(op.loadPattern, where)) break;
          if (!requireElements(op.elements, where)) break;
          const point = op.kind === "point";
          if (point && op.dist == null) {
            errors.push(`${where}: una carga puntual necesita dist`);
            break;
          }
          if (point && (op.value2 != null || op.dist2 != null)) {
            errors.push(`${where}: una carga puntual no lleva value2 ni dist2`);
            break;
          }
          if (!op.distAbsolute && [op.dist, op.dist2].some((d) => d != null && d > 1)) {
            errors.push(`${where}: distancias relativas fuera de 0..1 (usa distAbsolute para longitudes)`);
            break;
          }
          if (op.dist != null && op.dist2 != null && op.dist2 < op.dist) {
            errors.push(`${where}: dist2 debe ser mayor o igual que dist`);
            break;
          }
          const q = point ? "force" : "lineweight";
          const value = Q(op.value, q);
          // Las distancias absolutas van en longitud de inputUnits; se guardan en m.
          const pos = (d) => (d == null ? d : op.distAbsolute ? L(d) : d);
          const dist = pos(op.dist);
          const dist2 = pos(op.dist2);
          for (const elementId of op.elements) {
            if (op.distAbsolute) {
              const e = state.elements.find((x) => x.id === elementId);
              const [a, b] = [e.nodeA, e.nodeB].map((id) => state.nodes.find((n) => n.id === id));
              const len = a && b ? dist3(a, b) : Infinity;
              const reach = Math.max(dist ?? 0, dist2 ?? 0);
              if (reach > len + COINCIDENT_TOL) {
                errors.push(`${where}: la carga sobre ${elementId} llega más allá de la barra`);
                continue;
              }
            }
            const frameLoad = { elementId, loadPattern: op.loadPattern, kind: op.kind, dir: op.dir, value };
            if (op.value2 != null) frameLoad.value2 = Q(op.value2, q);
            if (dist != null) frameLoad.dist = dist;
            if (dist2 != null) frameLoad.dist2 = dist2;
            if (op.distAbsolute) frameLoad.distAbsolute = true;
            state.ops.push({ op: "addFrameLoad", frameLoad });
          }
          break;
        }

        case "assign_section": {
          if (!requireElements(op.elements, where)) break;
          const ref = resolveSectionRef(op.section, where);
          if (!ref) break;
          for (const elementId of op.elements) {
            const e = state.elements.find((x) => x.id === elementId);
            e.frameSectionId = ref;
            state.ops.push({ op: "assignSection", elementId, frameSectionId: ref });
          }
          break;
        }

        case "delete_elements": {
          if (!requireElements(op.elements, where)) break;
          const gone = new Set(op.elements);
          const removed = state.elements.filter((e) => gone.has(e.id));
          state.elements = state.elements.filter((e) => !gone.has(e.id));
          for (const elementId of op.elements) state.ops.push({ op: "deleteElement", elementId });
          if (op.deleteOrphanNodes) {
            const used = new Set(state.elements.flatMap((e) => [e.nodeA, e.nodeB]));
            const candidates = new Set(removed.flatMap((e) => [e.nodeA, e.nodeB]));
            for (const nodeId of candidates) {
              if (used.has(nodeId)) continue;
              state.nodes = state.nodes.filter((n) => n.id !== nodeId);
              state.supports = state.supports.filter((s) => s.nodeId !== nodeId);
              state.ops.push({ op: "deleteNode", nodeId });
            }
          }
          break;
        }

        case "set_grid": {
          const grid = {};
          for (const a of GRID_AXES) {
            if (!op[a]) continue;
            const ids = op[a].map((g) => g.id);
            const dupId = ids.find((id, k) => ids.indexOf(id) !== k);
            if (dupId) errors.push(`${where}.${a}: el id de eje "${dupId}" está repetido`);
            const lines = op[a].map((g) => ({ id: g.id, ordinate: L(g.at) })).sort((p, q) => p.ordinate - q.ordinate);
            if (lines.some((g, k) => k > 0 && g.ordinate - lines[k - 1].ordinate < COINCIDENT_TOL)) {
              errors.push(`${where}.${a}: hay dos ejes en la misma posición`);
            }
            grid[a] = lines;
          }
          if (plane && grid.y?.some((g) => Math.abs(g.ordinate) > COINCIDENT_TOL)) {
            errors.push(`${where}.y: el modelo es plano (XZ); no admite ejes Y fuera de Y = 0. Omite y.`);
          }
          if (!Object.keys(grid).length) {
            errors.push(`${where}: indica al menos un eje (x, y o z)`);
            break;
          }
          state.ops.push({ op: "setGrid", grid });
          break;
        }

        case "set_active_dofs": {
          if (op.dofs && typeDofs) {
            const extra = op.dofs.filter((d) => !typeDofs.includes(d));
            if (extra.length) {
              errors.push(
                `${where}: la formulación ${snapshot.analysisType} solo resuelve ${typeDofs.join(", ")}; ` +
                  `${extra.join(", ")} no son posibles (el tipo de análisis no se puede cambiar)`
              );
              break;
            }
          }
          state.activeDofs = op.dofs ? [...op.dofs] : typeDofs;
          state.ops.push({ op: "setActiveDofs", dofs: op.dofs });
          break;
        }
      }
    });

    if (errors.length) {
      Object.assign(state, saved);
      state.ops.length = opsStart;
      return { ok: false, errors };
    }

    state.summaries.push(input.summary);
    const newOps = state.ops.slice(opsStart);
    const count = (name) => newOps.filter((o) => o.op === name).length;
    return {
      ok: true,
      result: {
        status: "proposed",
        note:
          "Propuesta registrada. El usuario la verá como vista previa y decidirá si la aplica; " +
          "no está aplicada todavía. Al aplicarla, la rejilla se amplía sola con los ejes y niveles " +
          "que necesiten los nudos nuevos.",
        created,
        counts: {
          materials: count("createMaterial"),
          sections: count("createSection"),
          nodes: count("addNode"),
          frames: count("addElement"),
          supports: count("setSupport"),
          loadPatterns: count("addLoadPattern"),
          nodalLoads: count("addNodalLoad"),
          frameLoads: count("addFrameLoad"),
          sectionAssignments: count("assignSection"),
          deletedElements: count("deleteElement"),
          deletedNodes: count("deleteNode"),
          gridChanges: count("setGrid"),
          activeDofsChanges: count("setActiveDofs"),
        },
        warnings,
      },
    };
  }

  /** Changeset final del turno (o null si no se propuso nada). Siempre en base kN·m. */
  function finish() {
    if (state.ops.length === 0) return null;
    return { summary: state.summaries.join("\n"), ops: state.ops };
  }

  return { apply, finish };
}

module.exports = { createChangesetBuilder, proposeInput, COINCIDENT_TOL };
