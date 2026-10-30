const { AppError } = require("../middleware/errorHandler");

// Normas que el motor de diseño sabe aplicar (calc-service app/design/codes). Una que no
// conoce se rechaza aquí con un 400 en vez de hacer fallar la ejecución en el motor.
const STEEL_CODES = ["AISC360-16", "AISC360-22"];
const CONCRETE_CODES = ["ACI318-19", "EC2-2004"];

function checkCodes(requested) {
  if (requested?.steelCode !== undefined && !STEEL_CODES.includes(requested.steelCode)) {
    throw new AppError(400, `Norma de acero desconocida: ${requested.steelCode}.`, {
      error: "design.steelCodeUnknown",
    });
  }
  if (requested?.code !== undefined && !CONCRETE_CODES.includes(requested.code)) {
    throw new AppError(400, `Norma de hormigón desconocida: ${requested.code}.`, {
      error: "design.concreteCodeUnknown",
    });
  }
}

module.exports = { checkCodes, STEEL_CODES, CONCRETE_CODES };
