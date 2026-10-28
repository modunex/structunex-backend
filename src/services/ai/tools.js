// Herramientas del asistente IA. Las de lectura devuelven SIEMPRE valores en las
// unidades de display del usuario (con su etiqueta); la de escritura
// (propose_changes) delega en changeset.js, que convierte a base kN·m.

const { searchShapes } = require("../../lib/aiscShapes");
const { UNIT_SYSTEM_IDS, disp, unitLabels } = require("./units");

const DIM_KEYS = ["b", "h", "d", "t", "tw", "tf", "bf", "bfTop", "tfTop", "bfBot", "tfBot"];
const LIST_NODES_MAX = 150;
const LIST_ELEMENTS_MAX = 200;
const QUERY_MAX = 400;

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

const TOOLS = [
  {
    name: "get_model_summary",
    description:
      "Resumen del modelo estructural actual: conteos, extensión, rejilla, patrones de carga, " +
      "secciones usadas, apoyos y (si el modelo es pequeño) la lista de nudos y barras. " +
      "Úsala antes de proponer cambios sobre un modelo existente.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "query_model",
    description:
      "Consulta nudos y barras concretos: por ids o dentro de una caja [min, max]. Devuelve " +
      "coordenadas, conectividad, sección, apoyos y cargas.",
    input_schema: {
      type: "object",
      properties: {
        nodeIds: { type: "array", items: { type: "string" } },
        elementIds: { type: "array", items: { type: "string" } },
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
      "Busca perfiles del catálogo AISC (W, HSS, PIPE, C, MC, L, WT, 2L…) por texto en la etiqueta, " +
      'p. ej. "W14X" o "HSS6X6". Devuelve hasta 20 perfiles con sus propiedades.',
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        family: { type: "string", description: 'Familia opcional: "W", "HSS", "PIPE"…' },
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
      "- add_frame_loads: elements [ids], loadPattern, kind (distributed|point), dir (gravity|gx|gy|gz|local1|local2|local3), value, dist? (0..1, obligatorio en point). gravity = hacia −Z con value positivo.\n" +
      "- assign_section: elements [ids], section (id, tempId o nombre).\n" +
      "- delete_elements: elements [ids], deleteOrphanNodes?.",
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
                  "assign_section",
                  "delete_elements",
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
              section: { type: "string" },
              loadPattern: { type: "string" },
              kind: { type: "string", enum: ["distributed", "point"] },
              dir: { type: "string" },
              value: { type: "number" },
              dist: { type: "number" },
              deleteOrphanNodes: { type: "boolean" },
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
    },
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
        dist: l.dist,
      })),
    truncated: nodeSet.size > QUERY_MAX || elemSet.size > QUERY_MAX,
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
