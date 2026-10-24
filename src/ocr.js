// OCR sin conexión para las páginas que no tienen texto (portadas o anuncios que son una imagen):
// pdf.js dibuja la página como imagen y tesseract.js (Tesseract compilado a WebAssembly) la lee.
// Los idiomas salen de los paquetes @tesseract.js-data instalados con npm, así que no se descarga nada.

import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker, OEM, PSM } from "tesseract.js";

const require = createRequire(import.meta.url);
const CARPETA_IDIOMAS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor", "tessdata");

export const IDIOMAS_POR_DEFECTO = process.env.OCR_IDIOMAS || "spa+eng";
// Lado mayor de la imagen que se lee. Con portadas de revista, 3200 px dio más líneas correctas
// que 2400 (pierde letra pequeña) o 4000 (Tesseract parte los titulares grandes).
const LADO_IMAGEN = 3200;
// Tesseract también "lee" texturas de las fotos; esas líneas salen con poca confianza o sin letras.
const CONFIANZA_MINIMA = 60;

// pdf.js exige que estas rutas terminen en "/", también en Windows.
const CARPETA_PDFJS = path.dirname(path.dirname(path.dirname(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")))).replaceAll("\\", "/");
const VERSION_TESSERACT = require("tesseract.js/package.json").version;

/**
 * Lee con OCR las páginas indicadas de un PDF.
 * @param {Buffer} pdf bytes del PDF
 * @param {number[]} paginas números de página (desde 1)
 * @param {object} [opciones]
 * @param {string} [opciones.idiomas] códigos de Tesseract unidos con "+", ej. "spa+eng"
 * @param {(hechas: number, total: number) => void|Promise<void>} [opciones.alProgresar] se espera antes de seguir
 * @returns {Promise<Array<{pagina: number, confianza: number, texto: string, lineas: Array<{texto: string, confianza: number, x: number, y: number, w: number, h: number}>}>>}
 *   Las coordenadas de cada línea son fracciones (0 a 1) del ancho y alto de la página.
 */
export async function leerPaginas(pdf, paginas, { idiomas = IDIOMAS_POR_DEFECTO, alProgresar = () => {} } = {}) {
	if (!paginas.length) return [];
	const carga = getDocument({
		data: new Uint8Array(pdf),
		standardFontDataUrl: `${CARPETA_PDFJS}/standard_fonts/`,
		cMapUrl: `${CARPETA_PDFJS}/cmaps/`,
		cMapPacked: true,
		isEvalSupported: false,
		verbosity: 0,
	});
	const documento = await carga.promise;
	await prepararIdiomas(idiomas);
	const lector = await createWorker(idiomas, OEM.LSTM_ONLY, { langPath: CARPETA_IDIOMAS, cacheMethod: "none" });
	// tesseract.js trata por defecto la imagen como un solo bloque de texto y mezcla las columnas;
	// el modo automático (el del Tesseract de consola) separa titulares, columnas y recuadros.
	// debug_file: los avisos internos de Tesseract ("Image too small to scale!!"...) no aportan nada aquí.
	await lector.setParameters({ tessedit_pageseg_mode: PSM.AUTO, debug_file: "/dev/null" });

	try {
		const resultados = [];
		for (const numero of paginas) {
			const { imagen, ancho, alto } = await dibujarPagina(documento, numero);
			const { data } = await lector.recognize(imagen, {}, { blocks: true });
			resultados.push({ pagina: numero, ...resumir(data, ancho, alto) });
			await alProgresar(resultados.length, paginas.length);
		}
		return resultados;
	} finally {
		await lector.terminate();
		await carga.destroy();
	}
}

/** Descripción del motor para guardarla junto al resultado. */
export function descripcionMotor(idiomas = IDIOMAS_POR_DEFECTO) {
	return { motor: `tesseract.js ${VERSION_TESSERACT}`, idiomas, ladoImagen: LADO_IMAGEN, confianzaMinima: CONFIANZA_MINIMA };
}

// tesseract.js lee todos los idiomas de una sola carpeta (langPath), pero cada idioma viene en su
// propio paquete de npm; por eso se copian una vez a vendor/tessdata. (Pasarle los datos en memoria
// no sirve: tesseract.js 7 usa los datos como si fueran el nombre del idioma.)
async function prepararIdiomas(idiomas) {
	await mkdir(CARPETA_IDIOMAS, { recursive: true });
	for (const codigo of idiomas.split("+")) {
		const destino = path.join(CARPETA_IDIOMAS, `${codigo}.traineddata.gz`);
		if (existsSync(destino)) continue;
		let paquete;
		try {
			paquete = path.dirname(require.resolve(`@tesseract.js-data/${codigo}`));
		} catch {
			throw new Error(`Falta el idioma "${codigo}" para el OCR. Instálalo con: npm install @tesseract.js-data/${codigo}`);
		}
		// best_int: modelo LSTM preciso y compacto (el mismo que tesseract.js descargaría por defecto).
		await copyFile(path.join(paquete, "4.0.0_best_int", `${codigo}.traineddata.gz`), destino);
	}
}

async function dibujarPagina(documento, numero) {
	const pagina = await documento.getPage(numero);
	const base = pagina.getViewport({ scale: 1 });
	const vista = pagina.getViewport({ scale: LADO_IMAGEN / Math.max(base.width, base.height) });
	const { canvas, context } = documento.canvasFactory.create(Math.ceil(vista.width), Math.ceil(vista.height));
	await pagina.render({ canvas, canvasContext: context, viewport: vista }).promise;
	pagina.cleanup();
	return { imagen: canvas.toBuffer("image/png"), ancho: canvas.width, alto: canvas.height };
}

function resumir(data, ancho, alto) {
	const parrafos = [];
	const lineas = [];
	for (const bloque of data.blocks ?? []) {
		for (const parrafo of bloque.paragraphs) {
			const textos = [];
			for (const linea of parrafo.lines) {
				const texto = linea.text.trim();
				if (linea.confidence < CONFIANZA_MINIMA || !/[\p{L}\p{N}]{2,}/u.test(texto)) continue;
				const { x0, y0, x1, y1 } = linea.bbox;
				lineas.push({
					texto,
					confianza: Math.round(linea.confidence),
					x: redondear(x0 / ancho, 5),
					y: redondear(y0 / alto, 5),
					w: redondear((x1 - x0) / ancho, 5),
					h: redondear((y1 - y0) / alto, 5),
				});
				textos.push(texto);
			}
			if (textos.length) parrafos.push(textos.join("\n"));
		}
	}
	const confianza = lineas.length ? lineas.reduce((suma, linea) => suma + linea.confianza, 0) / lineas.length : 0;
	return { confianza: Math.round(confianza), texto: parrafos.join("\n\n"), lineas };
}

function redondear(valor, decimales) {
	return Number(valor.toFixed(decimales));
}
