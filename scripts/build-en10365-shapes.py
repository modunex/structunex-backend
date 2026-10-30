"""Genera src/data/en10365_shapes_si.json: perfiles IPE, HEA, HEB y HEM (EN 10365:2017).

Solo se transcriben las dimensiones nominales (h, b, tw, tf, r en mm). Todas las
propiedades se CALCULAN aquí con la geometría del perfil laminado, incluidos los
cuatro acuerdos de radio r, y se escriben con el mismo esquema y unidades SI que
aisc_shapes_v16_si.json, para que análisis y diseño los traten igual que a un W.

    python3 scripts/build-en10365-shapes.py
"""
import json, math, os

# label: (h, b, tw, tf, r)  [mm]
DIMS = {
 "IPE": {80:(80,46,3.8,5.2,5),100:(100,55,4.1,5.7,7),120:(120,64,4.4,6.3,7),140:(140,73,4.7,6.9,7),
         160:(160,82,5.0,7.4,9),180:(180,91,5.3,8.0,9),200:(200,100,5.6,8.5,12),220:(220,110,5.9,9.2,12),
         240:(240,120,6.2,9.8,15),270:(270,135,6.6,10.2,15),300:(300,150,7.1,10.7,15),330:(330,160,7.5,11.5,18),
         360:(360,170,8.0,12.7,18),400:(400,180,8.6,13.5,21),450:(450,190,9.4,14.6,21),500:(500,200,10.2,16.0,21),
         550:(550,210,11.1,17.2,24),600:(600,220,12.0,19.0,24)},
 "HEA": {100:(96,100,5,8,12),120:(114,120,5,8,12),140:(133,140,5.5,8.5,12),160:(152,160,6,9,15),
         180:(171,180,6,9.5,15),200:(190,200,6.5,10,18),220:(210,220,7,11,18),240:(230,240,7.5,12,21),
         260:(250,260,7.5,12.5,24),280:(270,280,8,13,24),300:(290,300,8.5,14,27),320:(310,300,9,15.5,27),
         340:(330,300,9.5,16.5,27),360:(350,300,10,17.5,27),400:(390,300,11,19,27),450:(440,300,11.5,21,27),
         500:(490,300,12,23,27),550:(540,300,12.5,24,27),600:(590,300,13,25,27),650:(640,300,13.5,26,27),
         700:(690,300,14.5,27,27),800:(790,300,15,28,30),900:(890,300,16,30,30),1000:(990,300,16.5,31,30)},
 "HEB": {100:(100,100,6,10,12),120:(120,120,6.5,11,12),140:(140,140,7,12,12),160:(160,160,8,13,15),
         180:(180,180,8.5,14,15),200:(200,200,9,15,18),220:(220,220,9.5,16,18),240:(240,240,10,17,21),
         260:(260,260,10,17.5,24),280:(280,280,10.5,18,24),300:(300,300,11,19,27),320:(320,300,11.5,20.5,27),
         340:(340,300,12,21.5,27),360:(360,300,12.5,22.5,27),400:(400,300,13.5,24,27),450:(450,300,14,26,27),
         500:(500,300,14.5,28,27),550:(550,300,15,29,27),600:(600,300,15.5,30,27),650:(650,300,16,31,27),
         700:(700,300,17,32,27),800:(800,300,17.5,33,30),900:(900,300,18.5,35,30),1000:(1000,300,19,36,30)},
 "HEM": {100:(120,106,12,20,12),120:(140,126,12.5,21,12),140:(160,146,13,22,12),160:(180,166,14,23,15),
         180:(200,186,14.5,24,15),200:(220,206,15,25,18),220:(240,226,15.5,26,18),240:(270,248,18,32,21),
         260:(290,268,18,32.5,24),280:(310,288,18.5,33,24),300:(340,310,21,39,27),320:(359,309,21,40,27),
         340:(377,309,21,40,27),360:(395,308,21,40,27),400:(432,307,21,40,27),450:(478,307,21,40,27),
         500:(524,306,21,40,27),550:(572,306,21,40,27),600:(620,305,21,40,27),650:(668,305,21,40,27),
         700:(716,304,21,40,27),800:(814,303,21,40,30),900:(910,302,21,40,30),1000:(1008,302,21,40,30)},
}

RHO_STEEL = 7850.0   # kg/m³
G = 9.80665          # m/s²

def fillet(r):
    """Acuerdo (cuadrado r×r menos cuarto de círculo). Devuelve área, distancia de su
    centroide a cada una de las dos caras rectas e inercia respecto de su centroide."""
    a_sq, a_c = r * r, math.pi * r * r / 4
    A = a_sq - a_c
    # distancias desde la cara recta (el cuarto de círculo está centrado en la esquina opuesta)
    y_sq, y_c = r / 2, r - 4 * r / (3 * math.pi)
    y = (a_sq * y_sq - a_c * y_c) / A
    I_face = r**4 / 3 - ((math.pi / 16 - 4 / (9 * math.pi)) * r**4 + a_c * y_c**2)
    return A, y, I_face - A * y * y

def props(h, b, tw, tf, r):
    hw = h - 2 * tf
    Af, yf, If = fillet(r)
    A = 2 * b * tf + hw * tw + 4 * Af
    # eje fuerte
    dy = hw / 2 - yf                      # centroide del acuerdo al eje y-y
    Iy = (b * h**3 - (b - tw) * hw**3) / 12 + 4 * (If + Af * dy**2)
    Wpl_y = b * tf * (h - tf) + tw * hw**2 / 4 + 4 * Af * dy
    # eje débil
    dz = tw / 2 + yf
    Iz = (2 * tf * b**3 + hw * tw**3) / 12 + 4 * (If + Af * dz**2)
    Wpl_z = tf * b**2 / 2 + hw * tw**2 / 4 + 4 * Af * dz
    # torsión uniforme: alas y alma como rectángulos delgados + nudo alma-ala con acuerdos
    # (Trahair/EN: término α1·D1⁴ de las uniones, igual al que usan las tablas de catálogo)
    a1 = -0.042 + 0.2204 * tw / tf + 0.1355 * r / tf - 0.0865 * r * tw / tf**2 - 0.0725 * tw**2 / tf**2
    D1 = ((tf + r)**2 + tw * (r + tw / 4)) / (2 * r + tf)
    It = 2 / 3 * b * tf**3 + 1 / 3 * (h - 2 * tf) * tw**3 + 2 * a1 * D1**4 - 0.420 * tf**4
    Iw = Iz * (h - tf)**2 / 4
    return dict(A=A, Iy=Iy, Iz=Iz, Wel_y=2 * Iy / h, Wel_z=2 * Iz / b,
                Wpl_y=Wpl_y, Wpl_z=Wpl_z, It=It, Iw=Iw)

def build():
    sections, types = [], {}
    for fam, rows in DIMS.items():
        for size, (h, b, tw, tf, r) in sorted(rows.items()):
            p = props(h, b, tw, tf, r)
            mm = 1e-3
            A = p["A"] * mm**2
            sections.append({
                "label": f"{fam}{size}", "type": fam, "standard": "EN 10365:2017",
                # Familia AISC equivalente para el motor de diseño: perfil I laminado
                # doblemente simétrico, igual que un W (capítulos F2/E3 de AISC 360).
                "aiscType": "W",
                "weight": A * RHO_STEEL * G / 1000,          # kN/m
                "A": A, "d": h * mm, "bf": b * mm, "tw": tw * mm, "tf": tf * mm, "r": r * mm,
                "I33": p["Iy"] * mm**4, "I22": p["Iz"] * mm**4,
                "J": p["It"] * mm**4, "Cw": p["Iw"] * mm**6,
                "rx": math.sqrt(p["Iy"] / p["A"]) * mm, "ry": math.sqrt(p["Iz"] / p["A"]) * mm,
                "Sx": p["Wel_y"] * mm**3, "Sy": p["Wel_z"] * mm**3,
                "Zx": p["Wpl_y"] * mm**3, "Zy": p["Wpl_z"] * mm**3,
            })
            types[fam] = types.get(fam, 0) + 1
    meta = {
        "source": "EN 10365:2017 (dimensiones nominales); propiedades calculadas por structunex",
        "note": "Propiedades derivadas de h, b, tw, tf y r con los cuatro acuerdos. Acero ρ = 7850 kg/m³.",
        "units": {"length": "m", "area": "m^2", "inertia": "m^4", "section_modulus": "m^3",
                  "warping": "m^6", "weight": "kN/m"},
        "convention": "I33 = Iy (eje fuerte), I22 = Iz (eje debil); J = It; Cw = Iw",
        "count": len(sections), "types": types,
    }
    return {"meta": meta, "sections": sections}

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "..", "src", "data", "en10365_shapes_si.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(build(), f, ensure_ascii=False, indent=1)
    print("escrito", os.path.normpath(out))
