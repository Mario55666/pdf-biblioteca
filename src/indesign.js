// Paquete para reconstruir en Adobe InDesign un documento de la biblioteca.
//
// Reparte la información en dos instrumentos:
//   - plan.json (JSON): geometría y formato. Dónde va cada marco, en puntos, con su capa,
//     color y estilo de párrafo. Responde a "dónde" y "cómo".
//   - documento.xml (XML): contenido y estructura. Un elemento por marco, con el texto y los
//     atributos aid:pstyle que InDesign usa para aplicar estilos al importar. Responde a "qué".
// El script reconstruir.jsx (porky + lib/atlas-porky.jsx) crea los marcos con el JSON, importa el
// XML y coloca cada elemento en su marco.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// pdf2json mide en "unidades de página" de 1/4 de pulgada sobre una vista a escala 1,5:
// 1 unidad = 24 px / 1,5 = 16 pt. Comprobado con pdf.js: 38,25 unidades = 612 pt (carta).
export const PT_POR_UNIDAD = 16;
// El texto se guarda con el origen desplazado (x - 0,25; y - 0,75 unidades, ver pdffont.js de
// pdf2json): x + 0,25 es el inicio del texto y y + 0,75 su línea base.
const AJUSTE_TEXTO_X = 0.25;
const AJUSTE_TEXTO_Y = 0.75;
// El cuerpo de TS está en píxeles a 96 ppp; en puntos es 0,75 veces ese valor.
const PT_POR_PX = 0.75;

// Diccionario de colores de pdf2json (kColors en pdfconst.js); clr es un índice de esta lista.
const COLORES_PDF2JSON = [
	"#000000", "#ffffff", "#4c4c4c", "#808080", "#999999", "#c0c0c0", "#cccccc", "#e5e5e5", "#f2f2f2",
	"#008000", "#00ff00", "#bfffa0", "#ffd629", "#ff99cc", "#004080", "#9fc0e1", "#5580ff", "#a9c9fa",
	"#ff0080", "#800080", "#ffbfff", "#e45b21", "#ffbfaa", "#008080", "#ff0000", "#fdc59f", "#808000",
	"#bfbf00", "#824100", "#007256", "#008000", "#000080", "#008080", "#800080", "#ff0000", "#0000ff",
	"#008000", "#000000",
];
// pdf2json no conserva el nombre de la fuente, solo una familia genérica (kFontFaces).
// Estas son las fuentes de InDesign que mejor la representan; son el respaldo cuando la fuente
// original no está instalada. La familia "Pi" de pdf2json también recoge texto normal, así que
// va a Arial: con Symbol las letras latinas saldrían como griegas.
const FUENTES = ["Arial", "Arial Narrow", "Arial", "Courier New", "OCR A Extended", "Courier New"];

export const CAPAS = Object.freeze(["Original PDF", "Rellenos", "Líneas", "Campos", "Texto", "OCR"]);
const ESTILO_OCR = "OCR";
const ESPACIO_AID = "http://ns.adobe.com/AdobeInDesign/4.0/";
const SCRIPT_SINCRONIZACION = "sync/texto.jsx";

const RAIZ_PROYECTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA_SCRIPTS = path.join(RAIZ_PROYECTO, "indesign");
// Archivos de la carpeta indesign/ que van en el paquete (scripts, adaptación y porky).
const ARCHIVOS_SCRIPTS = [
	"reconstruir.jsx",
	"sincronizar.jsx",
	"sync/texto.jsx",
	"lib/atlas-porky.jsx",
	"porky/bin/porky.jsx",
	"porky/lib/json-js/json2.js",
	"porky/lib/base64/base64-encode-decode.js",
	"porky/LICENSE",
	"porky/VERSION",
];

/**
 * Crea el plan de reconstrucción (geometría y formato en puntos) a partir del JSON de pdf2json.
 * @param {object} json salida de pdf2json
 * @param {object} [opciones]
 * @param {object|null} [opciones.ocr] contenido de ocr.json
 * @param {number[]|null} [opciones.paginas] páginas a incluir (todas si es null)
 * @param {object} [opciones.documento] id, titulo y nombre del archivo
 * @param {Map|null} [opciones.metricas] medidas de pdf.js por texto (ver metricas.js); sin ellas
 *   el cuerpo se estima con TS × 0,75 y no hay fuente original ni ancho de referencia
 */
export function crearPlan(json, { ocr = null, paginas = null, documento = {}, metricas = null } = {}) {
	const total = json.Pages?.length ?? 0;
	const numeros = paginas ?? Array.from({ length: total }, (_, indice) => indice + 1);
	const estilos = new Map();
	const colores = new Set();
	const usarColor = (hex) => (colores.add(hex), hex);

	const planPaginas = numeros.map((numero) => {
		const pagina = json.Pages[numero - 1];
		const prefijo = `p${numero}`;
		const medidas = metricas?.get(numero) ?? [];
		const textos = (pagina.Texts ?? []).map((texto, indice) => {
			const [cara = 0, cuerpoPx = 12, negrita = 0, cursiva = 0] = texto.R?.[0]?.TS ?? [];
			const medida = medidas[indice];
			const estilo = medida
				? definirEstilo(estilos, FUENTES[cara] ?? "Arial", medida.negrita, medida.cursiva, medida.cuerpo, medida.fuente)
				: definirEstilo(estilos, FUENTES[cara] ?? "Arial", negrita, cursiva, cuerpoPx * PT_POR_PX);
			const rotacion = texto.R?.[0]?.RA ?? 0;
			return {
				id: `${prefijo}-t${indice + 1}`,
				x: pt(texto.x + AJUSTE_TEXTO_X),
				lineaBase: pt(texto.y + AJUSTE_TEXTO_Y),
				cuerpo: estilo.cuerpo,
				estilo: estilo.nombre,
				color: usarColor(colorDe(texto)),
				// Ancho que ocupa en el original: InDesign ajusta la escala horizontal para igualarlo.
				...(medida?.ancho ? { ancho: medida.ancho } : {}),
				...(rotacion ? { rotacion } : {}),
			};
		});
		const rellenos = (pagina.Fills ?? []).map((relleno, indice) => ({
			id: `${prefijo}-r${indice + 1}`,
			x: pt(relleno.x),
			y: pt(relleno.y),
			ancho: pt(relleno.w),
			alto: pt(relleno.h),
			color: usarColor(colorDe(relleno)),
		}));
		const lineas = [
			...(pagina.HLines ?? []).map((linea) => ({ linea, horizontal: true })),
			...(pagina.VLines ?? []).map((linea) => ({ linea, horizontal: false })),
		].map(({ linea, horizontal }, indice) => {
			const x1 = pt(linea.x);
			const y1 = pt(linea.y);
			const largo = pt(linea.l);
			return {
				id: `${prefijo}-l${indice + 1}`,
				x1,
				y1,
				x2: horizontal ? redondear(x1 + largo) : x1,
				y2: horizontal ? y1 : redondear(y1 + largo),
				// El grosor viene en píxeles de la vista a escala 1,5.
				grosor: redondear(Math.max(0.25, (linea.w ?? 1) / 1.5)),
				color: usarColor(colorDe(linea)),
				...(linea.dsh ? { discontinua: true } : {}),
			};
		});
		const campos = (pagina.Fields ?? []).map((campo, indice) => ({
			id: `${prefijo}-c${indice + 1}`,
			x: pt(campo.x),
			y: pt(campo.y),
			ancho: pt(campo.w),
			alto: pt(campo.h),
		}));
		const lineasOcr = (ocr?.paginas?.[numero]?.lineas ?? []).map((linea, indice) => ({
			id: `${prefijo}-o${indice + 1}`,
			x: pt(linea.x),
			y: pt(linea.y),
			ancho: pt(linea.w),
			alto: pt(linea.h),
			// La caja de una línea de OCR va de las ascendentes a las descendentes: el cuerpo ronda el 75 %.
			cuerpo: redondear(Math.max(4, pt(linea.h) * 0.75), 1),
			confianza: linea.confianza,
		}));
		return {
			numero,
			ancho: pt(pagina.Width),
			alto: pt(pagina.Height),
			original: { pagina: numero },
			rellenos,
			lineas,
			campos,
			textos,
			ocr: lineasOcr,
		};
	});

	if (planPaginas.some((pagina) => pagina.ocr.length)) {
		estilos.set(ESTILO_OCR, { nombre: ESTILO_OCR, fuente: "Arial", estilo: "Regular", cuerpo: 10, interlineado: 12 });
		colores.add("#000000");
	}

	return {
		formato: "atlas-indesign-plan",
		version: "1.0",
		documento: {
			id: documento.id ?? "",
			titulo: documento.titulo ?? "",
			archivoPdf: "original.pdf",
			archivoXml: "documento.xml",
			paginasTotales: total,
			paginas: numeros,
			unidades: "pt",
			origen: json.Transcoder ?? "pdf2json",
			ocr: ocr ? { motor: ocr.motor, idiomas: ocr.idiomas } : null,
		},
		capas: CAPAS,
		colores: [...colores],
		estilos: [...estilos.values()],
		paginas: planPaginas,
	};
}

/**
 * XML para InDesign: un elemento por marco del plan, con el texto y los atributos que usa
 * InDesign al importar (aid:pstyle) y los que usa porky para sincronizar (syncScript, syncIdentifier).
 * @param {object} json salida de pdf2json (de aquí sale el texto)
 * @param {object} plan resultado de crearPlan
 * @param {object|null} [ocr] contenido de ocr.json
 */
export function crearXmlIndesign(json, plan, ocr = null) {
	const partes = [
		'<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
		'<!DOCTYPE Documento SYSTEM "atlas-indesign.dtd">',
		`<Documento xmlns:aid="${ESPACIO_AID}" id="${attr(plan.documento.id)}" titulo="${attr(plan.documento.titulo)}" origen="${attr(plan.documento.origen)}" paginas="${plan.documento.paginasTotales}">`,
	];
	for (const pagina of plan.paginas) {
		const origen = json.Pages[pagina.numero - 1];
		partes.push(`  <Pagina numero="${pagina.numero}">`);
		partes.push(`    <Original id="p${pagina.numero}-original" pagina="${pagina.numero}"/>`);
		for (const relleno of pagina.rellenos) partes.push(`    <Relleno id="${relleno.id}"/>`);
		for (const linea of pagina.lineas) partes.push(`    <Linea id="${linea.id}"/>`);
		pagina.campos.forEach((campo, indice) => {
			const nombre = origen.Fields?.[indice]?.id?.Id ?? origen.Fields?.[indice]?.T?.Name ?? "";
			partes.push(`    <Campo id="${campo.id}" nombre="${attr(nombre)}"/>`);
		});
		pagina.textos.forEach((texto, indice) => {
			const contenido = (origen.Texts[indice].R ?? []).map((tramo) => tramo.T).join("");
			partes.push(`    <Texto id="${texto.id}" aid:pstyle="${attr(texto.estilo)}" syncScript="${SCRIPT_SINCRONIZACION}" syncIdentifier="${texto.id}">${texto_(contenido)}</Texto>`);
		});
		const lineasOcr = ocr?.paginas?.[pagina.numero]?.lineas ?? [];
		pagina.ocr.forEach((linea, indice) => {
			partes.push(
				`    <OCR id="${linea.id}" aid:pstyle="${ESTILO_OCR}" confianza="${linea.confianza}" syncScript="${SCRIPT_SINCRONIZACION}" syncIdentifier="${linea.id}">${texto_(lineasOcr[indice].texto)}</OCR>`,
			);
		});
		partes.push("  </Pagina>");
	}
	partes.push("</Documento>", "");
	return partes.join("\n");
}

/** DTD con la que InDesign valida la estructura importada (Estructura > Validar). */
export const DTD_INDESIGN = `<!-- Estructura del XML de reconstrucción (Biblioteca PDF · Atlas de la diagramación) -->
<!ELEMENT Documento (Pagina+)>
<!ATTLIST Documento
	xmlns:aid CDATA #FIXED "${ESPACIO_AID}"
	id CDATA #IMPLIED
	titulo CDATA #IMPLIED
	origen CDATA #IMPLIED
	paginas CDATA #REQUIRED>
<!ELEMENT Pagina (Original, Relleno*, Linea*, Campo*, Texto*, OCR*)>
<!ATTLIST Pagina numero CDATA #REQUIRED>
<!ELEMENT Original EMPTY>
<!ATTLIST Original id ID #REQUIRED pagina CDATA #REQUIRED>
<!ELEMENT Relleno EMPTY>
<!ATTLIST Relleno id ID #REQUIRED>
<!ELEMENT Linea EMPTY>
<!ATTLIST Linea id ID #REQUIRED>
<!ELEMENT Campo EMPTY>
<!ATTLIST Campo id ID #REQUIRED nombre CDATA #IMPLIED>
<!ELEMENT Texto (#PCDATA)>
<!ATTLIST Texto
	id ID #REQUIRED
	aid:pstyle CDATA #IMPLIED
	syncScript CDATA #IMPLIED
	syncIdentifier CDATA #IMPLIED>
<!ELEMENT OCR (#PCDATA)>
<!ATTLIST OCR
	id ID #REQUIRED
	aid:pstyle CDATA #IMPLIED
	confianza CDATA #IMPLIED
	syncScript CDATA #IMPLIED
	syncIdentifier CDATA #IMPLIED>
`;

/**
 * Archivos del paquete InDesign de un documento, listos para un ZIP o para escribir en disco.
 * @param {import("./biblioteca.js").Biblioteca} biblioteca
 * @param {string} id
 * @param {object} [opciones]
 * @param {number[]|null} [opciones.paginas] páginas a reconstruir (todas si es null)
 * @returns {Promise<{carpeta: string, archivos: Array<{nombre: string, contenido: Buffer}>}>}
 */
export async function crearPaqueteIndesign(biblioteca, id, { paginas = null } = {}) {
	const ficha = await biblioteca.obtener(id);
	if (!ficha) throw new Error("Documento no encontrado");
	if (paginas?.some((numero) => !Number.isInteger(numero) || numero < 1 || numero > ficha.paginas)) {
		throw new Error(`Las páginas deben estar entre 1 y ${ficha.paginas}`);
	}
	const json = JSON.parse(await readFile(biblioteca.ruta(id, "json"), "utf8"));
	const pdf = await readFile(biblioteca.ruta(id, "pdf"));
	const ocr = await biblioteca.leerOcr(id);
	const documento = { id, titulo: ficha.titulo || ficha.nombre.replace(/\.pdf$/i, "") };
	// Calibración con pdf.js de todas las páginas (el perfil del Atlas mide el documento entero).
	// Si pdf.js no está instalado, el plan sigue con las estimaciones de pdf2json.
	const metricas = await import("./metricas.js")
		.then(({ medirTextos }) => medirTextos(pdf, json, json.Pages.map((_, indice) => indice + 1)))
		.catch((error) => {
			console.warn(`Sin calibración con pdf.js: ${error.message}`);
			return null;
		});
	const plan = crearPlan(json, { ocr, paginas, documento, metricas });
	const perfil = crearPerfilAtlas(json, ficha, ocr, metricas);

	const archivos = [
		{ nombre: "LEEME.txt", contenido: Buffer.from(leeme(ficha, plan)) },
		{ nombre: "datos/plan.json", contenido: Buffer.from(JSON.stringify(plan, null, 2)) },
		{ nombre: "datos/documento.xml", contenido: Buffer.from(crearXmlIndesign(json, plan, ocr)) },
		{ nombre: "datos/atlas-indesign.dtd", contenido: Buffer.from(DTD_INDESIGN) },
		{ nombre: "datos/original.pdf", contenido: pdf },
		{ nombre: "atlas/perfil.json", contenido: Buffer.from(JSON.stringify(perfil, null, 2)) },
	];
	for (const nombre of ARCHIVOS_SCRIPTS) {
		archivos.push({ nombre, contenido: await readFile(path.join(CARPETA_SCRIPTS, nombre)) });
	}
	return { carpeta: `${id}-indesign`, archivos };
}

/** Convierte "1-3,7" en [1, 2, 3, 7]. */
export function leerRangoPaginas(texto, total) {
	if (!texto || texto === "todo") return null;
	const paginas = new Set();
	for (const parte of String(texto).split(",")) {
		const [desde, hasta = desde] = parte.split("-").map((numero) => Number(numero.trim()));
		if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde < 1 || hasta > total || desde > hasta) {
			throw new Error(`Rango de páginas no válido: "${parte}" (el documento tiene ${total})`);
		}
		for (let numero = desde; numero <= hasta; numero++) paginas.add(numero);
	}
	return [...paginas].sort((a, b) => a - b);
}

/**
 * Perfil de diagramación medido desde el JSON de pdf2json (y el OCR), con la forma de los
 * perfiles del corpus del Atlas (revistas/*.json → perfil). Son mediciones automáticas: no
 * incluye tipos de página ni formas, que en el Atlas se interpretan a mano.
 * Con las métricas de pdf.js los cuerpos y los anchos son los reales; sin ellas, estimados.
 */
export function crearPerfilAtlas(json, ficha, ocr = null, metricas = null) {
	const paginas = json.Pages ?? [];
	const primera = paginas[0] ?? { Width: 0, Height: 0 };
	const anchoPt = pt(primera.Width);
	const altoPt = pt(primera.Height);
	const mm = (puntos) => Math.round((puntos * 25.4) / 72);

	// Cuerpos ponderados por número de caracteres.
	const caracteresPorCuerpo = new Map();
	for (const [indicePagina, pagina] of paginas.entries()) {
		const medidas = metricas?.get(indicePagina + 1) ?? [];
		for (const [indice, texto] of (pagina.Texts ?? []).entries()) {
			const cuerpo = cuerpoDe(texto, medidas[indice]);
			const caracteres = (texto.R ?? []).reduce((suma, tramo) => suma + tramo.T.trim().length, 0);
			caracteresPorCuerpo.set(cuerpo, (caracteresPorCuerpo.get(cuerpo) ?? 0) + caracteres);
		}
	}
	const cuerpoBase = [...caracteresPorCuerpo].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
	const medianaEntre = (minimo, maximo) => medianaPonderada([...caracteresPorCuerpo].filter(([cuerpo]) => cuerpo >= minimo && cuerpo < maximo));

	const porPagina = paginas.map((pagina, indice) => medirPagina(pagina, indice + 1, cuerpoBase, ocr, metricas?.get(indice + 1) ?? []));
	const conCuerpo = porPagina.filter((medida) => medida.margenes);
	const mediana = (valores) => (valores.length ? redondear(medianaSimple(valores), 2) : null);
	const conOcr = Object.entries(ocr?.paginas ?? {}).filter(([, pagina]) => pagina.lineas.length).map(([numero]) => Number(numero));
	const sinTexto = paginas.filter((pagina) => !pagina.Texts?.length).length;

	return {
		version: "1.0",
		fecha: new Date().toISOString().slice(0, 10),
		revista: { id: ficha.id, titulo: ficha.titulo || ficha.nombre.replace(/\.pdf$/i, ""), archivo: ficha.nombre },
		metodo:
			"Perfil medido automáticamente desde el JSON de pdf2json (capa de texto) y el OCR de las páginas sin texto, " +
			"con el paquete de reconstrucción en InDesign de la Biblioteca PDF. " +
			(metricas ? "Cuerpos y anchos calibrados con pdf.js. " : "Cuerpos estimados (TS × 0,75) y anchos aproximados. ") +
			"Los márgenes y las columnas se estiman con el texto de cuerpo; los tipos de página y las formas no se interpretaron.",
		perfil: {
			formato_mm: `${mm(anchoPt)} × ${mm(altoPt)}`,
			ratio: altoPt ? redondear(anchoPt / altoPt, 2) : null,
			paginas_totales: paginas.length,
			muestra: paginas.length,
			via_de_lectura: conOcr.length ? `capa de texto + OCR en ${conOcr.length} páginas sin texto` : "capa de texto",
			paginas_sin_texto: paginas.length ? redondear(sinTexto / paginas.length, 2) : 0,
			paginas_con_ocr: conOcr,
			cuerpo_base_pt: cuerpoBase,
			columnas_texto: conCuerpo.length ? moda(conCuerpo.map((medida) => medida.columnas)) : null,
			margenes_pct: conCuerpo.length
				? {
						izquierdo: mediana(conCuerpo.map((medida) => medida.margenes.izquierdo)),
						derecho: mediana(conCuerpo.map((medida) => medida.margenes.derecho)),
						superior: mediana(conCuerpo.map((medida) => medida.margenes.superior)),
						inferior: mediana(conCuerpo.map((medida) => medida.margenes.inferior)),
					}
				: null,
			escala_pt: cuerpoBase
				? limpiar({
						titular: medianaEntre(cuerpoBase * 2, Infinity),
						subtitulo: medianaEntre(cuerpoBase * 1.25, cuerpoBase * 2),
						cuerpo: cuerpoBase,
						pie: medianaEntre(cuerpoBase * 0.6, cuerpoBase * 0.95),
					})
				: {},
		},
		paginas: porPagina.map(({ margenes, ...medida }) => ({ ...medida, ...(margenes ? { margenes_pct: margenes } : {}) })),
	};
}

function medirPagina(pagina, numero, cuerpoBase, ocr, medidas) {
	const anchoPt = pt(pagina.Width);
	const altoPt = pt(pagina.Height);
	const textos = (pagina.Texts ?? []).map((texto, indice) => ({ texto, medida: medidas[indice], cuerpo: cuerpoDe(texto, medidas[indice]) }));
	const medida = { pagina: numero, textos: textos.length, ocr: Boolean(ocr?.paginas?.[numero]?.lineas?.length) };
	if (textos.length) medida.cuerpo_pt = moda(textos.map((t) => t.cuerpo));
	// Márgenes y columnas solo con páginas que tienen texto de cuerpo suficiente.
	const cuerpo = cuerpoBase ? textos.filter((t) => Math.abs(t.cuerpo - cuerpoBase) <= cuerpoBase * 0.15) : [];
	if (cuerpo.length < 12) return { ...medida, margenes: null, columnas: null };

	const inicios = cuerpo.map(({ texto }) => pt(texto.x + AJUSTE_TEXTO_X));
	const bases = cuerpo.map(({ texto }) => pt(texto.y + AJUSTE_TEXTO_Y));
	// Ancho medido por pdf.js o, sin métricas, medio cuerpo por carácter (la media de una fuente de texto).
	const finales = cuerpo.map(
		({ texto, medida: m }, indice) => inicios[indice] + (m?.ancho ?? texto.R.map((tramo) => tramo.T).join("").length * cuerpoBase * 0.5),
	);
	const percentil = (valores, p) => [...valores].sort((a, b) => a - b)[Math.min(valores.length - 1, Math.floor(valores.length * p))];
	const margenes = {
		izquierdo: redondear((percentil(inicios, 0.02) / anchoPt) * 100, 2),
		derecho: redondear(Math.max(0, ((anchoPt - percentil(finales, 0.98)) / anchoPt) * 100), 2),
		superior: redondear(Math.max(0, ((percentil(bases, 0.02) - cuerpoBase) / altoPt) * 100), 2),
		inferior: redondear(Math.max(0, ((altoPt - percentil(bases, 0.98)) / altoPt) * 100), 2),
	};
	// Columnas: inicios de línea agrupados en franjas del 4 % del ancho; cuenta las que reúnen
	// al menos el 12 % de las líneas de cuerpo.
	const franjas = new Map();
	for (const inicio of inicios) {
		const franja = Math.floor((inicio / anchoPt) * 25);
		franjas.set(franja, (franjas.get(franja) ?? 0) + 1);
	}
	const columnas = [...franjas.values()].filter((lineas) => lineas >= cuerpo.length * 0.12).length || 1;
	return { ...medida, margenes, columnas };
}

// Un estilo de párrafo por fuente y cuerpo. Con la fuente original (nombre PostScript de pdf.js)
// InDesign la usa si está instalada; si no, usa la familia de respaldo de pdf2json.
function definirEstilo(estilos, fuente, negrita, cursiva, cuerpoPt, fuentePS = "") {
	const estilo = negrita && cursiva ? "Bold Italic" : negrita ? "Bold" : cursiva ? "Italic" : "Regular";
	const cuerpo = Math.max(1, Math.round(cuerpoPt * 2) / 2);
	const nombre = `${fuentePS || `${fuente} ${estilo}`} ${String(cuerpo).replace(".", ",")} pt`;
	if (!estilos.has(nombre)) {
		estilos.set(nombre, { nombre, fuente, estilo, ...(fuentePS ? { fuentePS } : {}), cuerpo, interlineado: redondear(cuerpo * 1.2, 1) });
	}
	return estilos.get(nombre);
}

function cuerpoDe(texto, medida = null) {
	return Math.round((medida?.cuerpo ?? (texto.R?.[0]?.TS?.[1] ?? 12) * PT_POR_PX) * 2) / 2;
}

function colorDe(objeto) {
	if (typeof objeto.oc === "string") return normalizarColor(objeto.oc);
	if (Number.isInteger(objeto.clr)) return COLORES_PDF2JSON[objeto.clr] ?? "#000000";
	return "#000000";
}

function normalizarColor(hex) {
	const limpio = hex.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(limpio)) return limpio;
	if (/^#[0-9a-f]{3}$/.test(limpio)) return `#${[...limpio.slice(1)].map((c) => c + c).join("")}`;
	return "#000000";
}

function pt(unidades) {
	return redondear((unidades ?? 0) * PT_POR_UNIDAD);
}

function redondear(valor, decimales = 3) {
	return Number(valor.toFixed(decimales));
}

function moda(valores) {
	const cuentas = new Map();
	for (const valor of valores) cuentas.set(valor, (cuentas.get(valor) ?? 0) + 1);
	return [...cuentas].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function medianaSimple(valores) {
	const ordenados = [...valores].sort((a, b) => a - b);
	const mitad = Math.floor(ordenados.length / 2);
	return ordenados.length % 2 ? ordenados[mitad] : (ordenados[mitad - 1] + ordenados[mitad]) / 2;
}

function medianaPonderada(pares) {
	const total = pares.reduce((suma, [, peso]) => suma + peso, 0);
	if (!total) return null;
	let acumulado = 0;
	for (const [valor, peso] of [...pares].sort((a, b) => a[0] - b[0])) {
		acumulado += peso;
		if (acumulado >= total / 2) return valor;
	}
	return null;
}

function limpiar(objeto) {
	return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== null && valor !== undefined));
}

const CARACTERES_INVALIDOS = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;

function texto_(valor) {
	return String(valor ?? "").replace(CARACTERES_INVALIDOS, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attr(valor) {
	return texto_(valor).replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
}

function leeme(ficha, plan) {
	const paginas = plan.documento.paginas;
	const rango = paginas.length === plan.documento.paginasTotales ? `las ${paginas.length} páginas` : `las páginas ${paginas.join(", ")}`;
	return `RECONSTRUCCIÓN EN INDESIGN · ${ficha.titulo || ficha.nombre}
Paquete generado por la Biblioteca PDF el ${new Date().toLocaleString("es-PE")} con ${rango}.

QUÉ HAY AQUÍ
  reconstruir.jsx         Script principal: crea el documento a partir de datos/.
  sincronizar.jsx         Actualiza un documento ya reconstruido si corriges datos/documento.xml (porky).
  sync/texto.jsx          Script de sincronización de porky: devuelve el texto de cada elemento.
  lib/atlas-porky.jsx     Capa de adaptación entre porky y el formato de la Biblioteca PDF.
  porky/                  Librería porky (Schreiber & Freunde, licencia MIT).
  datos/plan.json         JSON: geometría y formato de cada marco, en puntos.
  datos/documento.xml     XML: contenido y estructura, con aid:pstyle para los estilos.
  datos/atlas-indesign.dtd  DTD para validar la estructura en InDesign.
  datos/original.pdf      El PDF original: se coloca en la capa "Original PDF".
  atlas/perfil.json       Perfil de diagramación para incorporar al Atlas.

CÓMO SE USA
  1. Descomprime esta carpeta en un lugar fijo (no la muevas mientras InDesign trabaja).
  2. En InDesign: Ventana > Utilidades > Scripts. Clic derecho en "Usuario" > Mostrar en el Explorador
     y copia ahí esta carpeta completa (o usa el atajo: Archivo > Scripts > Examinar, si tu versión lo tiene).
  3. En el panel Scripts, doble clic en reconstruir.jsx.
  4. Al terminar, la carpeta salida/ contiene el .indd, el .idml, el XML exportado, las vistas JPG
     y informe.json con lo que se hizo y lo que hay que revisar.

PARA ACTUALIZAR EL ATLAS
  En la Biblioteca PDF:  npm run cli -- atlas ${ficha.id} --atlas "<carpeta del Atlas>" --informe "<esta carpeta>/salida/informe.json"
`;
}
