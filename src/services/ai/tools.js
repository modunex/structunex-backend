// Herramientas del asistente IA. Las de lectura devuelven SIEMPRE valores en las
// unidades de display del usuario (con su etiqueta); la de escritura
// (propose_changes) delega en changeset.js, que convierte a base kN·m.

const { searchShapes } = require("../../lib/aiscShapes");
const { UNIT_SYSTEM_IDS, disp, unitLabels } = require("./units");
const { ribDirection } = require("./slabAxes");

const DIM_KEYS = ["b", "h", "d", "t", "tw", "tf", "bf", "bfTop", "tfTop", "bfBot", "tfBot"];
const LIST_NODES_MAX = 150;
const LIST_ELEMENTS_MAX = 200;
const QUERY_MAX = 400;
const LIST_AREAS_MAX = 300;

// ─── Definiciones (lo que ve el modelo) ───

const nodeRefSchema = {
  description:
    'Nudo: id existente ("N3") o coordenadas [x, y, z] en las unidades de longitud de inputUnits. ' +
    "Si hay un nudo en esas coordenadas se reutiliza; si no, se crea.",
  anyOf: [
    { type: "string" },
    { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
  ],
};

const gridLineSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: 'Etiqueta del eje o nivel ("A", "1", "P1").' },
    at: { type: "number", description: "Ordenada en las unidades de longitud de inputUnits." },
  },
  required: ["id", "at"],
};

const TOOLS = [
  {
    name: "get_model_summary",
    description:
      "Resumen del modelo estructural actual: conteos, extensión, rejilla, patrones de carga, " +
      "cargas por patrón, secciones usadas, apoyos, áreas (losas/muros) agrupadas por nivel y (si el " +
      "modelo es pequeño) la lista de nudos, barras y áreas. " +
      "Úsala antes de proponer cambios sobre un modelo existente.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "query_model",
    description:
      "Consulta nudos, barras y áreas concretos: por ids o dentro de una caja [min, max]. Devuelve " +
      "coordenadas, conectividad, sección, apoyos y cargas (de nudo, de barra y de área).",
    input_schema: {
      type: "object",
      properties: {
        nodeIds: { type: "array", items: { type: "string" } },
        elementIds: { type: "array", items: { type: "string" } },
        areaIds: { type: "array", items: { type: "string" } },
        box: {
          type: "object",
          description: "Caja en unidades de display del usuario.",
          properties: {
            min: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
            max: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          },
          required: ["min", "max"],
        },
      },
    },
  },
  {
    name: "list_materials",
    description: "Materiales del catálogo del usuario (id, nombre, tipo y propiedades).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_sections",
    description: "Secciones de barra del catálogo del usuario (id, nombre, material, forma, cotas y propiedades).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_aisc_shapes",
    description:
      "Busca perfiles de acero del catálogo del sistema por texto en la etiqueta: AISC (W, HSS, PIPE, C, MC, " +
      'L, WT, 2L…) y europeos EN 10365 (IPE, HEA, HEB, HEM), p. ej. "W14X", "HSS6X6", "HEB3" o "IPE". ' +
      "Devuelve hasta 20 perfiles con sus propiedades.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        family: { type: "string", description: 'Familia opcional: "W", "HSS", "PIPE", "IPE", "HEB"…' },
      },
      required: ["query"],
    },
  },
  {
    name: "check_model",
    description:
      "Ejecuta la validación del modelo (la misma que el botón Check Model) y devuelve los " +
      "problemas encontrados con sus nudos/barras implicados.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "propose_changes",
    description:
      "Propone cambios al modelo. NO los aplica: el usuario verá una vista previa y decidirá. " +
      "Las operaciones se ejecutan en orden; las de una misma llamada pueden referirse entre " +
      "sí (p. ej. create_material con tempId 'h28' y luego create_section con material 'h28'). " +
      "Si alguna operación es inválida se rechaza la llamada entera y recibirás los errores. " +
      "Valores en las unidades de inputUnits (por defecto, las del usuario).\n\n" +
      "Operaciones (campo type):\n" +
      "- create_material: tempId, name, materialType (concrete|steel|rebar|other), E?, nu?, density?, fc? (hormigón), Fy?, Fu? (acero). Lo omitido toma valores típicos (E del hormigón = 4700·√f'c).\n" +
      "- create_section: tempId, name, material (id, tempId o nombre), shape (rectangular b,h | circular d | pipe d,t | box b,h,t | ishape d,bfTop,tfTop,tw,bfBot,tfBot | channel d,bf,tf,tw | tee d,bf,tf,tw | angle d,b,t | aisc catalogLabel | general A,I33,I22?,J?). Hormigón: designRole (beam|column) y cover opcionales. El hormigón solo admite rectangular, circular, tee o general.\n" +
      "- add_nodes: nodes [[x,y,z], …].\n" +
      "- add_frames: frames [{i, j, section?}] con i/j = id de nudo o [x,y,z]. Los nudos se crean o reutilizan solos.\n" +
      "- set_supports: nodes [ref…], restraint (fixed|pinned|rollerZ|free|custom), custom {dx,dy,dz,rx,ry,rz}.\n" +
      "- add_load_patterns: patterns [{name, patternType (dead|superDead|live|roofLive|wind|snow|rain|quake|other), selfWeightMultiplier?}].\n" +
      "- add_nodal_loads: loads [{node, loadPattern, fx?, fy?, fz?, mx?, my?, mz?}] (ejes globales).\n" +
      "- add_frame_loads: elements [ids], loadPattern, kind (distributed|point), dir (gravity|gx|gy|gz|local1|local2|local3), value, dist? (obligatorio en point). Distribuida: value al inicio y value2? al final (trapezoidal; sin value2 = uniforme) entre dist? y dist2? (sin ellas = barra completa). Distancias relativas 0..1, o en longitud de inputUnits con distAbsolute true. gravity = hacia −Z con value positivo; local1/2/3 = ejes locales (SAP2000: 2 hacia arriba en una viga horizontal).\n" +
      "- add_area_loads: areas [ids], loadPattern, dir (gravity|gx|gy|gz), value (fuerza/superficie = unidad modulus de inputUnits). Carga uniforme de superficie sobre losas o muros; gravity = hacia −Z con value positivo. Sustituye la carga que ya tuviera esa área en ese patrón (como Assign ▸ Area Loads).\n" +
      "- set_area_local_axes: areas [ids] y UNO de: ribDirection (x|y) = deja los nervios del deck en esa dirección global (solo losas horizontales con sección deck; el sistema calcula el ángulo con el ribAngle de la sección), o angle = ángulo local absoluto en grados alrededor del eje 3 (como Assign ▸ Area ▸ Local Axes).\n" +
      "- update_load_patterns: patterns [{name, patternType?, selfWeightMultiplier?}]. Cambia el tipo o el multiplicador de peso propio de patrones existentes (0 = sin peso propio).\n" +
      "- delete_loads: borra cargas ya asignadas. Filtros (se combinan con Y): loadPattern? (nombre), elements? (barras), nodes? (ids de nudo), areas? (ids de área), loadTypes? [nodal|frame|area]. " +
      "Sin elements/nodes/areas afecta a todo el modelo; sin loadTypes afecta a los tipos con filtro de ubicación o, si no hay, a los tres. Para borrar TODAS las cargas sin filtrar, all: true. " +
      "No borra el patrón ni su peso propio (eso es update_load_patterns con selfWeightMultiplier 0).\n" +
      "- assign_section: elements [ids], section (id, tempId o nombre).\n" +
      "- delete_elements: elements [ids], deleteOrphanNodes?.\n" +
      "- set_grid: x?, y?, z? = [{id, at}] (z = niveles de planta). Cada eje indicado sustituye al actual; los omitidos se conservan. " +
      "Úsala para nombrar ejes y plantas (A, B…, 1, 2…, PB, P1…), fijar ejes sin elementos o QUITAR ejes: los ejes que indiques quedan exactamente así aunque haya nudos en otras coordenadas. " +
      "Al aplicar, la rejilla solo crece hacia fuera (vanos o plantas nuevos) con los nudos nuevos; los nudos intermedios (correas, subdivisiones) no crean ejes. En un proyecto vacío se genera entera a partir de los nudos.\n" +
      "- set_active_dofs: dofs [UX|UY|UZ|RX|RY|RZ] o null (automático). Solo dentro de los GDL de la formulación del proyecto.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Resumen breve, en el idioma del usuario, de lo que hace la propuesta.",
        },
        inputUnits: {
          type: "string",
          enum: UNIT_SYSTEM_IDS,
          description:
            "Sistema de unidades de los valores. Omítelo para usar el del usuario. Úsalo cuando " +
            "copies valores de un documento en otras unidades, en lugar de convertirlos tú.",
        },
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "create_material",
                  "create_section",
                  "add_nodes",
                  "add_frames",
                  "set_supports",
                  "add_load_patterns",
                  "add_nodal_loads",
                  "add_frame_loads",
                  "add_area_loads",
                  "set_area_local_axes",
                  "update_load_patterns",
                  "delete_loads",
                  "assign_section",
                  "delete_elements",
                  "set_grid",
                  "set_active_dofs",
                ],
              },
              tempId: { type: "string" },
              name: { type: "string" },
              materialType: { type: "string", enum: ["concrete", "steel", "rebar", "other"] },
              material: { type: "string" },
              shape: { type: "string" },
              catalogLabel: { type: "string" },
              designRole: { type: "string", enum: ["beam", "column"] },
              nodes: { type: "array", items: nodeRefSchema },
              frames: {
                type: "array",
                items: {
                  type: "object",
                  properties: { i: nodeRefSchema, j: nodeRefSchema, section: { type: "string" } },
                  required: ["i", "j"],
                },
              },
              restraint: { type: "string", enum: ["fixed", "pinned", "rollerZ", "free", "custom"] },
              custom: { type: "object" },
              patterns: { type: "array", items: { type: "object" } },
              loads: { type: "array", items: { type: "object" } },
              elements: { type: "array", items: { type: "string" } },
              areas: { type: "array", items: { type: "string" } },
              ribDirection: { type: "string", enum: ["x", "y"] },
              angle: { type: "number" },
              loadTypes: { type: "array", items: { type: "string", enum: ["nodal", "frame", "area"] } },
              all: { type: "boolean" },
              section: { type: "string" },
              loadPattern: { type: "string" },
              kind: { type: "string", enum: ["distributed", "point"] },
              dir: { type: "string" },
              value: { type: "number" },
              value2: { type: "number" },
              dist: { type: "number" },
              dist2: { type: "number" },
              distAbsolute: { type: "boolean" },
              deleteOrphanNodes: { type: "boolean" },
              x: { type: "array", items: gridLineSchema },
              y: { type: "array", items: gridLineSchema },
              z: { type: "array", items: gridLineSchema },
              dofs: {
                anyOf: [
                  { type: "array", items: { type: "string", enum: ["UX", "UY", "UZ", "RX", "RY", "RZ"] } },
                  { type: "null" },
                ],
              },
            },
            required: ["type"],
          },
        },
      },
      required: ["summary", "operations"],
    },
  },
];

// ─── Ejecutores de lectura ───

function nodeOut(n, sys) {
  return { id: n.id, x: disp(n.x, sys, "length"), y: disp(n.y, sys, "length"), z: disp(n.z ?? 0, sys, "length") };
}

function supportLabel(s) {
  const t = ["dx", "dy", "dz"].every((k) => s[k]);
  const r = ["rx", "ry", "rz"].every((k) => s[k]);
  if (t && r) return "fixed";
  if (t && !["rx", "ry", "rz"].some((k) => s[k])) return "pinned";
  return ["dx", "dy", "dz", "rx", "ry", "rz"].filter((k) => s[k]).join("+") || "free";
}

function sectionNames(catalog) {
  return new Map((catalog.sections || []).map((s) => [s.id, s.name]));
}

function elementOut(e, names) {
  return {
    id: e.id,
    i: e.nodeA,
    j: e.nodeB,
    section: e.frameSectionId ? names.get(e.frameSectionId) || e.frameSectionId : null,
  };
}

// Cuántas cargas de cada tipo tiene cada patrón.
function loadsByPattern(snapshot) {
  const out = {};
  const add = (list, kind) => {
    for (const l of list || []) {
      const k = l.loadPattern || "(sin patrón)";
      out[k] = out[k] || { nodal: 0, frame: 0, area: 0 };
      out[k][kind]++;
    }
  };
  add(snapshot.loads, "nodal");
  add(snapshot.frameLoads, "frame");
  add(snapshot.areaLoads, "area");
  return out;
}

// Geometría de un área: centroide, rango Z, superficie y si es horizontal (losa).
function areaGeom(a, nodeById) {
  const pts = (a.nodeIds || []).map((id) => nodeById.get(id)).filter(Boolean).map((n) => [n.x, n.y, n.z ?? 0]);
  if (pts.length < 3) return null;
  const c = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
  const zs = pts.map((p) => p[2]);
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1, z1] = pts[i];
    const [x2, y2, z2] = pts[(i + 1) % pts.length];
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  const area = Math.hypot(nx, ny, nz) / 2;
  return { c, zMin: Math.min(...zs), zMax: Math.max(...zs), area, horizontal: Math.max(...zs) - Math.min(...zs) < 1e-4 };
}

function areaOut(a, ctx, nodeById) {
  const { sys, catalog } = ctx;
  const g = areaGeom(a, nodeById);
  const sec = (catalog.areaSections || []).find((s) => s.id === a.areaSectionId);
  return {
    id: a.id,
    nodes: a.nodeIds,
    section: sec ? `${sec.name} (${sec.kind}${sec.shellType ? `, ${sec.shellType}` : ""})` : a.areaSectionId ? a.areaSectionId : null,
    kind: g ? (g.horizontal ? "slab" : "wall/inclined") : "invalid",
    z: g ? disp(g.c[2], sys, "length") : undefined,
    surface: g ? disp(g.area, sys, "area") : undefined,
    diaphragm: a.diaphragm || undefined,
    localAxisAngle: a.localAxisAngle ?? 0,
    // Solo en losas deck horizontales: hacia dónde van los nervios (vano del deck).
    ribDirection: ribDirection(a, nodeById, sec) ?? undefined,
  };
}

// Losas (áreas horizontales) agrupadas por cota.
function slabsByLevel(snapshot, sys) {
  const nodeById = new Map((snapshot.nodes || []).map((n) => [n.id, n]));
  const levels = new Map();
  let other = 0;
  for (const a of snapshot.areas || []) {
    const g = areaGeom(a, nodeById);
    if (!g || !g.horizontal) {
      other++;
      continue;
    }
    const key = Math.round(g.zMin * 1e4) / 1e4;
    if (!levels.has(key)) levels.set(key, { ids: [], surface: 0 });
    const l = levels.get(key);
    l.ids.push(a.id);
    l.surface += g.area;
  }
  return {
    levels: [...levels.entries()]
      .sort((p, q) => p[0] - q[0])
      .map(([z, l]) => ({ z: disp(z, sys, "length"), count: l.ids.length, surface: disp(l.surface, sys, "area"), ids: l.ids })),
    nonHorizontalAreas: other,
  };
}

function getModelSummary(ctx) {
  const { snapshot, sys, catalog } = ctx;
  const nodes = snapshot.nodes || [];
  const elements = snapshot.elements || [];
  const cfg = snapshot.configuration || {};
  const names = sectionNames(catalog);
  const L = (v) => disp(v, sys, "length");

  let extent = null;
  if (nodes.length) {
    const ax = (k) => nodes.map((n) => n[k] ?? 0);
    extent = {
      min: [Math.min(...ax("x")), Math.min(...ax("y")), Math.min(...ax("z"))].map(L),
      max: [Math.max(...ax("x")), Math.max(...ax("y")), Math.max(...ax("z"))].map(L),
    };
  }
  const usage = {};
  let withoutSection = 0;
  for (const e of elements) {
    if (!e.frameSectionId) withoutSection++;
    else {
      const n = names.get(e.frameSectionId) || e.frameSectionId;
      usage[n] = (usage[n] || 0) + 1;
    }
  }
  const grid = cfg.gridSystem
    ? Object.fromEntries(
        ["x", "y", "z"].map((a) => [a, (cfg.gridSystem[a] || []).map((g) => ({ id: g.id, at: L(g.ordinate) }))])
      )
    : null;

  return {
    units: unitLabels(sys),
    dimension: snapshot.dim,
    analysisType: snapshot.analysisType,
    activeDofs: snapshot.activeDofs,
    counts: {
      nodes: nodes.length,
      frames: elements.length,
      areas: (snapshot.areas || []).length,
      supports: (snapshot.supports || []).length,
      nodalLoads: (snapshot.loads || []).length,
      frameLoads: (snapshot.frameLoads || []).length,
      areaLoads: (snapshot.areaLoads || []).length,
    },
    loadsByPattern: loadsByPattern(snapshot),
    slabs: (snapshot.areas || []).length ? slabsByLevel(snapshot, sys) : undefined,
    extent,
    grid,
    loadPatterns: cfg.loadPatterns || [],
    loadCombinations: (cfg.loadCombinations || []).map((c) => c.name),
    defaultFrameSection: cfg.defaultFrameSectionId ? names.get(cfg.defaultFrameSectionId) || null : null,
    sectionsInUse: usage,
    framesWithoutSection: withoutSection,
    supports: (snapshot.supports || []).map((s) => ({ node: s.nodeId, type: supportLabel(s) })),
    nodes: nodes.length <= LIST_NODES_MAX ? nodes.map((n) => nodeOut(n, sys)) : "demasiados: usa query_model",
    frames:
      elements.length <= LIST_ELEMENTS_MAX
        ? elements.map((e) => elementOut(e, names))
        : "demasiados: usa query_model",
    areas:
      (snapshot.areas || []).length === 0
        ? undefined
        : snapshot.areas.length <= LIST_AREAS_MAX
          ? snapshot.areas.map((a) => areaOut(a, ctx, new Map(nodes.map((n) => [n.id, n]))))
          : "demasiadas: usa query_model con areaIds o box",
  };
}

function queryModel(ctx, input) {
  const { snapshot, sys, catalog } = ctx;
  const names = sectionNames(catalog);
  const nodes = snapshot.nodes || [];
  const elements = snapshot.elements || [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const nodeSet = new Set(input.nodeIds || []);
  const elemSet = new Set(input.elementIds || []);
  const areas = snapshot.areas || [];
  const areaSet = new Set(input.areaIds || []);
  if (input.box) {
    const lo = input.box.min.map((v, k) => Math.min(v, input.box.max[k]));
    const hi = input.box.min.map((v, k) => Math.max(v, input.box.max[k]));
    const inside = (n) => {
      const p = nodeOut(n, sys);
      return [p.x, p.y, p.z].every((v, k) => v >= lo[k] - 1e-9 && v <= hi[k] + 1e-9);
    };
    for (const n of nodes) if (inside(n)) nodeSet.add(n.id);
    for (const e of elements) {
      const a = nodeById.get(e.nodeA);
      const b = nodeById.get(e.nodeB);
      if (a && b && inside(a) && inside(b)) elemSet.add(e.id);
    }
    for (const ar of areas) {
      const ns = (ar.nodeIds || []).map((id) => nodeById.get(id));
      if (ns.length && ns.every((n) => n && inside(n))) areaSet.add(ar.id);
    }
  }
  for (const id of elemSet) {
    const e = elements.find((x) => x.id === id);
    if (e) {
      nodeSet.add(e.nodeA);
      nodeSet.add(e.nodeB);
    }
  }

  const outNodes = [...nodeSet].map((id) => nodeById.get(id)).filter(Boolean).slice(0, QUERY_MAX);
  const outElems = elements.filter((e) => elemSet.has(e.id)).slice(0, QUERY_MAX);
  const F = (v) => disp(v, sys, "force");
  const M = (v) => disp(v, sys, "moment");

  return {
    units: unitLabels(sys),
    nodes: outNodes.map((n) => nodeOut(n, sys)),
    frames: outElems.map((e) => elementOut(e, names)),
    supports: (snapshot.supports || [])
      .filter((s) => nodeSet.has(s.nodeId))
      .map((s) => ({ node: s.nodeId, type: supportLabel(s) })),
    nodalLoads: (snapshot.loads || [])
      .filter((l) => nodeSet.has(l.nodeId))
      .map((l) => ({
        node: l.nodeId,
        loadPattern: l.loadPattern,
        fx: F(l.fx), fy: F(l.fy), fz: F(l.fz), mx: M(l.mx), my: M(l.my), mz: M(l.mz),
      })),
    frameLoads: (snapshot.frameLoads || [])
      .filter((l) => elemSet.has(l.elementId))
      .map((l) => ({
        element: l.elementId,
        loadPattern: l.loadPattern,
        kind: l.kind,
        dir: l.dir,
        value: disp(l.value, sys, l.kind === "point" ? "force" : "lineweight"),
        value2: l.value2 == null ? undefined : disp(l.value2, sys, "lineweight"),
        dist: l.distAbsolute ? disp(l.dist, sys, "length") : l.dist,
        dist2: l.distAbsolute ? disp(l.dist2, sys, "length") : l.dist2,
        distAbsolute: l.distAbsolute || undefined,
      })),
    areas: areas.filter((a) => areaSet.has(a.id)).slice(0, QUERY_MAX).map((a) => areaOut(a, ctx, nodeById)),
    areaLoads: (snapshot.areaLoads || [])
      .filter((l) => areaSet.has(l.areaId))
      .map((l) => ({ area: l.areaId, loadPattern: l.loadPattern, dir: l.dir, value: disp(l.value, sys, "modulus") })),
    truncated: nodeSet.size > QUERY_MAX || elemSet.size > QUERY_MAX || areaSet.size > QUERY_MAX,
  };
}

function listMaterials(ctx) {
  const { catalog, sys } = ctx;
  const S = (v) => disp(v ?? undefined, sys, "modulus");
  return {
    units: { modulus: unitLabels(sys).modulus, density: unitLabels(sys).density },
    materials: (catalog.materials || []).map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      E: S(m.E),
      nu: m.nu,
      density: disp(m.density ?? undefined, sys, "density"),
      fc: S(m.fc),
      Fy: S(m.Fy),
      Fu: S(m.Fu),
    })),
  };
}

function listSections(ctx) {
  const { catalog, sys } = ctx;
  const matNames = new Map((catalog.materials || []).map((m) => [m.id, m.name]));
  const labels = unitLabels(sys);
  return {
    units: { length: labels.length, area: labels.area, inertia: labels.inertia },
    sections: (catalog.sections || []).map((s) => {
      const dims = {};
      for (const k of DIM_KEYS) if (s[k] != null) dims[k] = disp(s[k], sys, "length");
      const p = s.props || {};
      return {
        id: s.id,
        name: s.name,
        material: matNames.get(s.materialId) || s.materialId,
        propertyType: s.propertyType,
        source: s.source,
        shape: s.shape || undefined,
        catalogLabel: s.catalogLabel || undefined,
        dims,
        designRole: s.reinforcement?.designRole,
        A: disp(p.A, sys, "area"),
        I33: disp(p.I33, sys, "inertia"),
        I22: disp(p.I22, sys, "inertia"),
      };
    }),
  };
}

function searchAisc(ctx, input) {
  const { sys } = ctx;
  const { items, total } = searchShapes({ q: input.query, type: input.family, limit: 20 });
  const labels = unitLabels(sys);
  return {
    units: { length: labels.length, area: labels.area, inertia: labels.inertia },
    total,
    shapes: items.map((s) => ({
      label: s.label,
      family: s.type,
      d: disp(s.d, sys, "length"),
      bf: disp(s.bf, sys, "length"),
      A: disp(s.A, sys, "area"),
      I33: disp(s.I33, sys, "inertia"),
      I22: disp(s.I22, sys, "inertia"),
    })),
  };
}

function checkModel(ctx) {
  const report = ctx.checkReport;
  if (!report) return { error: "El cliente no envió el informe de validación." };
  return {
    ok: report.ok,
    errors: report.errors,
    warnings: report.warnings,
    issues: (report.issues || []).map((i) => ({
      code: i.code,
      severity: i.severity,
      params: i.params,
      nodes: i.nodeIds?.slice(0, 50),
      frames: i.elementIds?.slice(0, 50),
      areas: i.areaIds?.slice(0, 50),
    })),
  };
}

/**
 * Ejecuta una herramienta. Devuelve { content, isError } listo para un tool_result.
 * `ctx` = { snapshot, catalog, sys, checkReport, changeset }.
 */
function runTool(name, input, ctx) {
  try {
    switch (name) {
      case "get_model_summary":
        return { content: getModelSummary(ctx) };
      case "query_model":
        return { content: queryModel(ctx, input || {}) };
      case "list_materials":
        return { content: listMaterials(ctx) };
      case "list_sections":
        return { content: listSections(ctx) };
      case "search_aisc_shapes":
        return { content: searchAisc(ctx, input || {}) };
      case "check_model":
        return { content: checkModel(ctx) };
      case "propose_changes": {
        const res = ctx.changeset.apply(input);
        return res.ok
          ? { content: res.result }
          : { content: { status: "rejected", errors: res.errors }, isError: true };
      }
      default:
        return { content: { error: `Herramienta desconocida: ${name}` }, isError: true };
    }
  } catch (err) {
    console.error("[ai] tool error", name, err);
    return { content: { error: `Error interno en ${name}: ${err.message}` }, isError: true };
  }
}

module.exports = { TOOLS, runTool };
