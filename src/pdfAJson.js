// Extracción de PDF a JSON con pdf2json (fork https://github.com/Mario55666/pdf2json),
// compilado en vendor/pdf2json por `npm run preparar`.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.PDF2JSON_DISABLE_LOGS ??= "1";

const RUTA_PDF2JSON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor", "pdf2json", "dist", "pdfparser.js");

let PDFParser = null;

async function cargarPdf2json() {
	if (PDFParser) return PDFParser;
	if (!existsSync(RUTA_PDF2JSON)) {
		throw new Error("No se encontró pdf2json compilado. Ejecuta primero: npm run preparar");
	}
	PDFParser = (await import(pathToFileURL(RUTA_PDF2JSON).href)).default;
	return PDFParser;
}

/**
 * Extrae el JSON de un PDF.
 * @param {Buffer} contenido bytes del PDF
 * @returns {Promise<{json: object, texto: string, campos: object[]}>}
 *   json: salida de pdf2json (Transcoder, Meta, Pages)
 *   texto: texto plano de todas las páginas
 *   campos: campos de formulario (vacío si el PDF no es un formulario)
 */
export async function extraerJson(contenido) {
	const Parser = await cargarPdf2json();
	return new Promise((resolver, rechazar) => {
		const parser = new Parser(null, true);
		parser.on("pdfParser_dataError", (error) => {
			const causa = error?.parserError ?? error;
			rechazar(new Error(`pdf2json no pudo leer el PDF: ${causa?.message ?? causa}`));
		});
		parser.on("pdfParser_dataReady", (json) => {
			resolver({
				json,
				texto: parser.getRawTextContent(),
				campos: parser.getAllFieldsTypes(),
			});
		});
		parser.parseBuffer(contenido, 0);
	});
}
