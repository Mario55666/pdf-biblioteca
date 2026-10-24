// Calibración tipográfica del JSON de pdf2json con pdf.js.
//
// pdf2json da la posición de cada texto con precisión, pero su cuerpo (TS) y su ancho (w)
// dependen de cómo el PDF escala la fuente: en unos archivos TS son píxeles y en otros puntos,
// y w a veces son puntos y a veces fracciones del cuerpo. Tampoco conserva el nombre de la fuente.
// pdf.js lee el mismo PDF y sí da el cuerpo real, el ancho real, la negrita y la cursiva (y el
// nombre de las fuentes no incrustadas); aquí se empareja cada texto de pdf2json con el de pdf.js
// que empieza en el mismo punto de su línea base.

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const PT_POR_UNIDAD = 16;
const TOLERANCIA_PT = 1.5;

/**
 * @param {Buffer} pdf bytes del PDF
 * @param {object} json salida de pdf2json del mismo PDF
 * @param {number[]} paginas números de página a medir
 * @returns {Promise<Map<number, Array<{cuerpo: number, ancho: number, fuente: string, negrita: boolean, cursiva: boolean}|null>>>}
 *   por página, una medida por cada elemento de Texts (null si no se pudo emparejar)
 */
export async function medirTextos(pdf, json, paginas) {
	const carga = getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, verbosity: 0, disableFontFace: true });
	const documento = await carga.promise;
	const medidas = new Map();
	try {
		for (const numero of paginas) {
			const pagina = await documento.getPage(numero);
			const alto = pagina.getViewport({ scale: 1 }).height;
			// getOperatorList carga las fuentes en commonObjs, de donde sale su nombre real.
			await pagina.getOperatorList();
			const fuentes = new Map();
			const items = (await pagina.getTextContent()).items
				.filter((item) => item.str && item.str.trim())
				.map((item) => {
					const [, , c, d, e, f] = item.transform;
					if (!fuentes.has(item.fontName)) fuentes.set(item.fontName, datosFuente(pagina, item.fontName));
					return { x: e, base: alto - f, cuerpo: Math.hypot(c, d), ancho: item.width, largo: item.str.length, ...fuentes.get(item.fontName) };
				});

			medidas.set(
				numero,
				(json.Pages[numero - 1].Texts ?? []).map((texto) => {
					const x = (texto.x + 0.25) * PT_POR_UNIDAD;
					const base = (texto.y + 0.75) * PT_POR_UNIDAD;
					const caracteres = texto.R.map((tramo) => tramo.T).join("").length;
					// El texto de pdf2json puede ser un trozo de una línea de pdf.js: vale cualquier línea de
					// la misma base que lo contenga; se prefiere la que empieza en el mismo punto.
					let mejor = null;
					for (const item of items) {
						if (Math.abs(item.base - base) > Math.max(TOLERANCIA_PT, item.cuerpo * 0.2)) continue;
						if (x < item.x - TOLERANCIA_PT || x > item.x + item.ancho + TOLERANCIA_PT) continue;
						const distancia = Math.abs(item.x - x);
						if (!mejor || distancia < mejor.distancia) mejor = { item, distancia };
					}
					if (!mejor) return null;
					const { item } = mejor;
					const mismoInicio = mejor.distancia <= TOLERANCIA_PT && Math.abs(item.largo - caracteres) <= 1;
					return {
						cuerpo: redondear(item.cuerpo, 2),
						// Si el trozo no es la línea entera, el ancho se reparte por caracteres.
						ancho: redondear(mismoInicio ? item.ancho : (item.ancho * caracteres) / Math.max(1, item.largo), 2),
						fuente: item.fuente,
						negrita: item.negrita,
						cursiva: item.cursiva,
					};
				}),
			);
			pagina.cleanup();
		}
	} finally {
		await carga.destroy();
	}
	return medidas;
}

// pdf.js 6 solo entrega el nombre de las fuentes no incrustadas (las del sistema, como Helvetica);
// de las incrustadas da un nombre interno (g_d0_f3), que no sirve. Negrita y cursiva sí llegan siempre.
function datosFuente(pagina, id) {
	try {
		const fuente = pagina.commonObjs.get(id);
		const candidato = fuente?.systemFontInfo?.baseFontName ?? fuente?.loadedName ?? "";
		// Las fuentes incrustadas como subconjunto llevan un prefijo de 6 letras: ABCDEF+Minion-Regular.
		const nombre = /^g_d\d+_f\d+$/.test(candidato) ? "" : String(candidato).replace(/^[A-Z]{6}\+/, "");
		return { fuente: nombre, negrita: Boolean(fuente?.bold) || /bold|black|heavy/i.test(nombre), cursiva: Boolean(fuente?.italic) || /italic|oblique/i.test(nombre) };
	} catch {
		return { fuente: "", negrita: false, cursiva: false };
	}
}

function redondear(valor, decimales) {
	return Number(valor.toFixed(decimales));
}
