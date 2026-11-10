// Plantillas de los correos transaccionales (Resend), en español e inglés.
//
// HTML de tablas con estilos en línea: es lo único que los clientes de correo (Outlook,
// Gmail) muestran igual. Sin imágenes remotas: el logotipo es texto, así nada depende de
// que el cliente cargue imágenes. Cada correo lleva también su versión en texto plano.
const { PLANS } = require("../lib/billingPlans");

const BRAND = {
  emerald: "#16856B",
  active: "#006B53",
  ink: "#172522",
  muted: "#4B5C56",
  border: "#E2E9E6",
  ground: "#F4F7F9",
};

const LANGS = ["es", "en"];
const langOf = (lang) => (LANGS.includes(lang) ? lang : "es");

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const n = (v, lang) => Number(v).toLocaleString(lang === "en" ? "en-US" : "es-ES");

/** Marco común: cabecera con la marca, cuerpo, botón y pie. */
function layout({ lang, preheader, heading, paragraphs, list, after, cta, footer }) {
  const p = (html) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${BRAND.ink};">${html}</p>`;
  const items = (list || [])
    .map(
      (item) =>
        `<tr><td style="padding:4px 10px 4px 0;vertical-align:top;color:${BRAND.emerald};font-size:15px;">&#10003;</td>` +
        `<td style="padding:4px 0;font-size:15px;line-height:22px;color:${BRAND.ink};">${item}</td></tr>`
    )
    .join("");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.ground};font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.ground};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${BRAND.border};border-radius:12px;">
<tr><td style="padding:22px 32px;border-bottom:1px solid ${BRAND.border};font-size:18px;font-weight:bold;letter-spacing:1px;color:${BRAND.ink};">STRUCTU<span style="color:${BRAND.emerald};">NEX</span></td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 20px;font-size:22px;line-height:30px;color:${BRAND.ink};">${heading}</h1>
${paragraphs.map(p).join("\n")}
${items ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${items}</table>` : ""}
${(after || []).map(p).join("\n")}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px;"><tr><td style="background:${BRAND.active};border-radius:8px;">
<a href="${cta.href}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${cta.label}</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid ${BRAND.border};font-size:12px;line-height:18px;color:${BRAND.muted};">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Versión en texto plano de los mismos bloques. */
function plain({ heading, paragraphs, list, after, cta, footer }) {
  const strip = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return [
    strip(heading),
    "",
    ...paragraphs.map(strip).flatMap((x) => [x, ""]),
    ...(list || []).map((x) => `- ${strip(x)}`),
    list?.length ? "" : null,
    ...(after || []).map(strip).flatMap((x) => [x, ""]),
    `${strip(cta.label)}: ${cta.href}`,
    "",
    "--",
    strip(footer),
  ]
    .filter((x) => x !== null)
    .join("\n");
}

function render(blocks) {
  return { subject: blocks.subject, html: layout(blocks), text: plain(blocks) };
}

const COPY = {
  es: {
    hello: (name) => (name ? `Hola, ${name}:` : "Hola:"),
    footer:
      "Recibes este correo porque tienes una cuenta en Structunex. Structunex es una herramienta de cálculo: los resultados deben ser revisados por un ingeniero responsable.",
    welcome: {
      subject: "Bienvenido a Structunex",
      preheader: "Modelado, análisis y diseño estructural en tu navegador.",
      heading: "Te damos la bienvenida a Structunex",
      intro: "Gracias por crear tu cuenta. Puedes modelar, analizar y diseñar estructuras completas desde el navegador, sobre un único modelo.",
      steps: "Para empezar:",
      list: [
        "Abre un <strong>modelo de ejemplo</strong> desde Proyectos para ver el flujo completo.",
        "Analiza: estático, modal, espectro de respuesta y derivas de entrepiso.",
        "Diseña los miembros con AISC 360 y ACI 318, y documenta en Report Studio.",
      ],
      plan: (p) =>
        `Tu plan <strong>Free</strong> incluye modelos de hasta ${p.maxElements} barras y áreas, ${p.maxProjects} proyectos y ${p.credits} créditos de IA al mes.`,
      cta: "Abrir Structunex",
    },
    planActivated: {
      subject: (plan) => `Tu plan ${plan} está activo`,
      preheader: "Ya puedes usar todo lo que incluye tu plan.",
      heading: (plan) => `Tu plan ${plan} está activo`,
      intro: "Gracias por confiar en Structunex. Esto es lo que tienes disponible desde ahora:",
      receipt: "El recibo y la factura del pago te llegan por separado de Stripe (Link), nuestro procesador de pagos.",
      manage: "Puedes ver tu plan, tus créditos y gestionar la suscripción en <strong>Cuenta → Plan</strong>.",
      list: {
        student: (p) => [
          `Modelos de hasta ${p.maxElements} barras y áreas y proyectos ilimitados`,
          "Conexiones Shear Tab y End Plate extendida precalificada",
          "Verificaciones sísmicas AISC 341",
          "Reportes con marca académica",
          `${p.credits} créditos de IA al mes`,
        ],
        principal: (p) => [
          "Modelos sin límite práctico y proyectos ilimitados",
          "Conexiones Shear Tab y End Plate extendida precalificada",
          "Verificaciones sísmicas AISC 341",
          "Reportes sin marca de agua, con tu logo",
          `${p.credits} créditos de IA al mes y todos los modelos del asistente`,
        ],
      },
      cta: "Ir a mis proyectos",
    },
  },
  en: {
    hello: (name) => (name ? `Hi ${name},` : "Hi,"),
    footer:
      "You're receiving this email because you have a Structunex account. Structunex is a calculation tool: results must be reviewed by a responsible engineer.",
    welcome: {
      subject: "Welcome to Structunex",
      preheader: "Structural modeling, analysis and design in your browser.",
      heading: "Welcome to Structunex",
      intro: "Thanks for creating your account. You can model, analyze and design complete structures in your browser, on a single model.",
      steps: "To get started:",
      list: [
        "Open an <strong>example model</strong> from Projects to see the full workflow.",
        "Analyze: linear static, modal, response spectrum and story drift.",
        "Design members with AISC 360 and ACI 318, and document them in Report Studio.",
      ],
      plan: (p) =>
        `Your <strong>Free</strong> plan includes models of up to ${p.maxElements} frames and areas, ${p.maxProjects} projects and ${p.credits} AI credits per month.`,
      cta: "Open Structunex",
    },
    planActivated: {
      subject: (plan) => `Your ${plan} plan is active`,
      preheader: "You can now use everything your plan includes.",
      heading: (plan) => `Your ${plan} plan is active`,
      intro: "Thanks for choosing Structunex. Here's what you have from now on:",
      receipt: "Your payment receipt and invoice arrive separately from Stripe (Link), our payment processor.",
      manage: "You can see your plan and credits and manage your subscription in <strong>Account → Plan</strong>.",
      list: {
        student: (p) => [
          `Models of up to ${p.maxElements} frames and areas, unlimited projects`,
          "Shear Tab and prequalified extended End Plate connections",
          "AISC 341 seismic checks",
          "Reports with an academic watermark",
          `${p.credits} AI credits per month`,
        ],
        principal: (p) => [
          "Models with no practical limit, unlimited projects",
          "Shear Tab and prequalified extended End Plate connections",
          "AISC 341 seismic checks",
          "Reports without a watermark, with your logo",
          `${p.credits} AI credits per month and every assistant model`,
        ],
      },
      cta: "Go to my projects",
    },
  },
};

const PLAN_NAMES = { free: "Free", student: "Student", principal: "Principal" };

function welcomeEmail({ firstName, lang, appUrl }) {
  const l = langOf(lang);
  const c = COPY[l];
  const free = PLANS.free;
  return render({
    lang: l,
    subject: c.welcome.subject,
    preheader: c.welcome.preheader,
    heading: c.welcome.heading,
    paragraphs: [
      escapeHtml(c.hello(firstName)),
      c.welcome.intro,
      c.welcome.plan({
        maxElements: n(free.maxElements, l),
        maxProjects: n(free.maxProjects, l),
        credits: n(free.aiCreditsMonthly, l),
      }),
      c.welcome.steps,
    ],
    list: c.welcome.list,
    cta: { label: c.welcome.cta, href: `${appUrl}/projects` },
    footer: c.footer,
  });
}

function planActivatedEmail({ firstName, lang, plan, appUrl }) {
  const l = langOf(lang);
  const c = COPY[l];
  const listFor = c.planActivated.list[plan];
  if (!listFor) throw new Error(`No hay correo de plan activado para "${plan}"`);
  const p = PLANS[plan];
  const name = PLAN_NAMES[plan];
  return render({
    lang: l,
    subject: c.planActivated.subject(name),
    preheader: c.planActivated.preheader,
    heading: c.planActivated.heading(name),
    paragraphs: [
      escapeHtml(c.hello(firstName)),
      c.planActivated.intro,
    ],
    list: listFor({
      maxElements: Number.isFinite(p.maxElements) ? n(p.maxElements, l) : "",
      credits: n(p.aiCreditsMonthly, l),
    }),
    after: [c.planActivated.manage, c.planActivated.receipt],
    cta: { label: c.planActivated.cta, href: `${appUrl}/projects` },
    footer: c.footer,
  });
}

module.exports = { welcomeEmail, planActivatedEmail, escapeHtml };
