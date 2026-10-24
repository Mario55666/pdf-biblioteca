// Biblioteca local de documentos convertidos.
// Cada PDF se guarda en su propia carpeta dentro de biblioteca/:
//
//   biblioteca/<id>/
//     ficha.json      metadatos (nombre, título, páginas, tamaños, opciones del XML...)
//     original.pdf    el PDF tal como se subió
//     documento.json  el JSON que extrae pdf2json
//     documento.xml   ese JSON convertido a XML
//     texto.txt       el texto plano del PDF
//     campos.json     los campos de formulario (si el PDF es un formulario)
//     paginas/        un JSON y un XML por página: pagina-001.json, pagina-001.xml...

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extraerJson } from "./pdfAJson.js";
import { jsonAXml } from "./jsonAXml.js";

const RAIZ_PROYECTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CARPETA_POR_DEFECTO = process.env.BIBLIOTECA_DIR || path.join(RAIZ_PROYECTO, "biblioteca");

export const OPCIONES_XML_POR_DEFECTO = Object.freeze({ raiz: "PDF", sangria: 3, atributos: [], contenido: [] });

export const ARCHIVOS = Object.freeze({
	pdf: { nombre: "original.pdf", tipo: "application/pdf", extension: "pdf" },
	json: { nombre: "documento.json", tipo: "application/json; charset=utf-8", extension: "json" },
	xml: { nombre: "documento.xml", tipo: "application/xml; charset=utf-8", extension: "xml" },
	texto: { nombre: "texto.txt", tipo: "text/plain; charset=utf-8", extension: "txt" },
	campos: { nombre: "campos.json", tipo: "application/json; charset=utf-8", extension: "campos.json" },
});

export const TIPOS_PAGINA = Object.freeze({ json: ARCHIVOS.json.tipo, xml: ARCHIVOS.xml.tipo });

const ID_VALIDO = /^[a-z0-9][a-z0-9-]{0,80}$/;
const CARPETA_PAGINAS = "paginas";

export class Biblioteca {
	constructor(carpeta = CARPETA_POR_DEFECTO) {
		this.carpeta = carpeta;
	}

	/**
	 * Extrae el JSON del PDF, genera el XML y guarda todo en la biblioteca.
	 * Si el mismo PDF (mismo contenido) ya estaba, devuelve la ficha existente.
	 * @param {Buffer} contenido bytes del PDF
	 * @param {string} nombreArchivo nombre original del archivo
	 * @param {object} [opcionesXml] ver OPCIONES_XML_POR_DEFECTO
	 * @returns {Promise<{ficha: object, duplicado: boolean}>}
	 */
	async agregar(contenido, nombreArchivo, opcionesXml = {}) {
		if (!contenido?.length || contenido.subarray(0, 1024).indexOf("%PDF-") === -1) {
			throw new ErrorBiblioteca(`"${nombreArchivo}" no parece un PDF`, 400);
		}
		const hash = createHash("sha256").update(contenido).digest("hex");
		const existente = (await this.listar()).find((ficha) => ficha.hash === hash);
		if (existente) return { ficha: existente, duplicado: true };

		const opciones = normalizarOpcionesXml(opcionesXml);
		const { json, texto, campos } = await extraerJson(contenido).catch((error) => {
			throw new ErrorBiblioteca(error.message, 422);
		});
		const textoJson = JSON.stringify(json, null, 2);
		const xml = jsonAXml(json, opciones);

		const id = `${slug(nombreArchivo)}-${hash.slice(0, 8)}`;
		const meta = json.Meta ?? {};
		const ficha = {
			id,
			nombre: path.basename(nombreArchivo),
			titulo: textoMeta(meta.Title),
			autor: textoMeta(meta.Author),
			asunto: textoMeta(meta.Subject),
			creador: textoMeta(meta.Creator),
			productor: textoMeta(meta.Producer),
			versionPdf: meta.PDFFormatVersion ?? "",
			esFormulario: Boolean(meta.IsAcroFormPresent),
			paginas: json.Pages?.length ?? 0,
			campos: campos.length,
			caracteres: texto.length,
			bytes: { pdf: contenido.length, json: Buffer.byteLength(textoJson), xml: Buffer.byteLength(xml) },
			transcoder: json.Transcoder ?? "",
			hash,
			agregado: new Date().toISOString(),
			opcionesXml: opciones,
		};

		// Se escribe en una carpeta temporal y se renombra al final, así nunca queda una entrada a medias.
		await mkdir(this.carpeta, { recursive: true });
		const temporal = path.join(this.carpeta, `.${id}.tmp`);
		await rm(temporal, { recursive: true, force: true });
		await mkdir(temporal);
		await Promise.all([
			writeFile(path.join(temporal, ARCHIVOS.pdf.nombre), contenido),
			writeFile(path.join(temporal, ARCHIVOS.json.nombre), textoJson),
			writeFile(path.join(temporal, ARCHIVOS.xml.nombre), xml),
			writeFile(path.join(temporal, ARCHIVOS.texto.nombre), texto),
			writeFile(path.join(temporal, ARCHIVOS.campos.nombre), JSON.stringify(campos, null, 2)),
			writeFile(path.join(temporal, "ficha.json"), JSON.stringify(ficha, null, 2)),
			escribirPaginas(temporal, json, opciones),
		]);
		await rename(temporal, path.join(this.carpeta, id));
		return { ficha, duplicado: false };
	}

	/**
	 * Lista los documentos, del más reciente al más antiguo.
	 * @param {string} [busqueda] filtra por nombre, título, autor o texto del PDF
	 */
	async listar(busqueda = "") {
		if (!existsSync(this.carpeta)) return [];
		const entradas = await readdir(this.carpeta, { withFileTypes: true });
		const fichas = [];
		for (const entrada of entradas) {
			if (!entrada.isDirectory() || !ID_VALIDO.test(entrada.name)) continue;
			const ficha = await this.obtener(entrada.name);
			if (ficha) fichas.push(ficha);
		}
		fichas.sort((a, b) => b.agregado.localeCompare(a.agregado));

		// Un documento coincide si contiene todas las palabras buscadas, en sus datos o en su texto.
		const palabras = normalizar(busqueda).split(/\s+/).filter(Boolean);
		if (!palabras.length) return fichas;
		const resultados = [];
		for (const ficha of fichas) {
			const datos = normalizar(`${ficha.nombre} ${ficha.titulo} ${ficha.autor} ${ficha.asunto}`);
			const texto = await readFile(this.ruta(ficha.id, "texto"), "utf8").catch(() => "");
			const textoNormalizado = normalizar(texto);
			if (!palabras.every((palabra) => datos.includes(palabra) || textoNormalizado.includes(palabra))) continue;
			const palabraEnTexto = palabras.find((palabra) => textoNormalizado.includes(palabra));
			resultados.push(
				palabraEnTexto ? { ...ficha, fragmento: fragmento(texto, textoNormalizado.indexOf(palabraEnTexto), palabraEnTexto.length) } : ficha,
			);
		}
		return resultados;
	}

	/** @returns {Promise<object|null>} la ficha del documento, o null si no existe */
	async obtener(id) {
		if (!ID_VALIDO.test(id)) return null;
		try {
			return JSON.parse(await readFile(path.join(this.carpeta, id, "ficha.json"), "utf8"));
		} catch {
			return null;
		}
	}

	/** Ruta en disco de uno de los archivos del documento (pdf, json, xml, texto, campos). */
	ruta(id, tipo) {
		if (!ID_VALIDO.test(id) || !ARCHIVOS[tipo]) throw new ErrorBiblioteca("Documento o archivo no válido", 400);
		return path.join(this.carpeta, id, ARCHIVOS[tipo].nombre);
	}

	/**
	 * Ruta en disco del JSON o el XML de una página. Si el documento se agregó antes de que
	 * existiera la separación por páginas, la genera en ese momento.
	 * @param {number|string} numero página, desde 1
	 * @param {"json"|"xml"} tipo
	 */
	async rutaPagina(id, numero, tipo) {
		const ficha = await this.obtener(id);
		if (!ficha) throw new ErrorBiblioteca("Documento no encontrado", 404);
		if (!TIPOS_PAGINA[tipo]) throw new ErrorBiblioteca("Las páginas solo están en JSON o XML", 400);
		const pagina = Number(numero);
		if (!Number.isInteger(pagina) || pagina < 1 || pagina > ficha.paginas) {
			throw new ErrorBiblioteca(`La página ${numero} no existe; el documento tiene ${ficha.paginas}`, 404);
		}
		const ruta = path.join(this.carpeta, id, CARPETA_PAGINAS, nombrePagina(pagina, tipo));
		if (!existsSync(ruta)) await this.separarPaginas(id);
		return ruta;
	}

	/** Vuelve a escribir el JSON y el XML de cada página a partir del JSON completo. */
	async separarPaginas(id) {
		const ficha = await this.obtener(id);
		if (!ficha) throw new ErrorBiblioteca("Documento no encontrado", 404);
		const json = JSON.parse(await readFile(this.ruta(id, "json"), "utf8"));
		await escribirPaginas(path.join(this.carpeta, id), json, ficha.opcionesXml);
		return path.join(this.carpeta, id, CARPETA_PAGINAS);
	}

	/**
	 * Lee los archivos de todas las páginas, por ejemplo para empaquetarlos en un ZIP.
	 * @param {Array<"json"|"xml">} tipos
	 * @returns {Promise<Array<{nombre: string, contenido: Buffer}>>}
	 */
	async archivosPaginas(id, tipos = ["json", "xml"]) {
		const ficha = await this.obtener(id);
		if (!ficha) throw new ErrorBiblioteca("Documento no encontrado", 404);
		const carpeta = path.join(this.carpeta, id, CARPETA_PAGINAS);
		const nombres = [];
		for (let pagina = 1; pagina <= ficha.paginas; pagina++) {
			for (const tipo of tipos) nombres.push(nombrePagina(pagina, tipo));
		}
		if (nombres.some((nombre) => !existsSync(path.join(carpeta, nombre)))) await this.separarPaginas(id);
		return Promise.all(nombres.map(async (nombre) => ({ nombre, contenido: await readFile(path.join(carpeta, nombre)) })));
	}

	/**
	 * Vuelve a convertir el JSON guardado a XML con otras opciones,
	 * tanto el documento completo como cada página.
	 * @returns {Promise<{ficha: object, xml: string}>}
	 */
	async regenerarXml(id, opcionesXml) {
		const ficha = await this.obtener(id);
		if (!ficha) throw new ErrorBiblioteca("Documento no encontrado", 404);
		const opciones = normalizarOpcionesXml(opcionesXml);
		const json = JSON.parse(await readFile(this.ruta(id, "json"), "utf8"));
		const xml = jsonAXml(json, opciones);
		await writeFile(this.ruta(id, "xml"), xml);
		await escribirPaginas(path.join(this.carpeta, id), json, opciones);
		const actualizada = { ...ficha, opcionesXml: opciones, bytes: { ...ficha.bytes, xml: Buffer.byteLength(xml) } };
		await writeFile(path.join(this.carpeta, id, "ficha.json"), JSON.stringify(actualizada, null, 2));
		return { ficha: actualizada, xml };
	}

	/** Borra el documento y todos sus archivos de la biblioteca. */
	async eliminar(id) {
		if (!(await this.obtener(id))) return false;
		await rm(path.join(this.carpeta, id), { recursive: true, force: true });
		return true;
	}
}

export class ErrorBiblioteca extends Error {
	constructor(mensaje, estado = 500) {
		super(mensaje);
		this.estado = estado;
	}
}

/**
 * Divide la salida de pdf2json en un documento por página. Cada uno conserva la forma del
 * original (Transcoder, Meta, Pages con una sola página), así las rutas de forceAttribute y
 * forceContent, como /PDF/Pages/Texts/x, sirven igual para el documento completo y sus páginas.
 */
export function dividirEnPaginas(json) {
	const paginas = json.Pages ?? [];
	return paginas.map((pagina, indice) => ({
		Transcoder: json.Transcoder,
		Meta: json.Meta,
		Pagina: indice + 1,
		TotalPaginas: paginas.length,
		Pages: [pagina],
	}));
}

function nombrePagina(numero, extension) {
	return `pagina-${String(numero).padStart(3, "0")}.${extension}`;
}

async function escribirPaginas(carpetaDocumento, json, opcionesXml) {
	const carpeta = path.join(carpetaDocumento, CARPETA_PAGINAS);
	await mkdir(carpeta, { recursive: true });
	for (const pagina of dividirEnPaginas(json)) {
		await Promise.all([
			writeFile(path.join(carpeta, nombrePagina(pagina.Pagina, "json")), JSON.stringify(pagina, null, 2)),
			writeFile(path.join(carpeta, nombrePagina(pagina.Pagina, "xml")), jsonAXml(pagina, opcionesXml)),
		]);
	}
}

/** Valida las opciones del XML y completa las que falten con los valores por defecto. */
export function normalizarOpcionesXml(opciones = {}) {
	const raiz = String(opciones.raiz ?? OPCIONES_XML_POR_DEFECTO.raiz).trim() || OPCIONES_XML_POR_DEFECTO.raiz;
	let sangria = opciones.sangria === undefined ? OPCIONES_XML_POR_DEFECTO.sangria : opciones.sangria;
	if (sangria !== null) {
		sangria = Number(sangria);
		if (!Number.isInteger(sangria) || sangria < 0 || sangria > 8) throw new ErrorBiblioteca("La sangría debe ser un entero de 0 a 8, o null", 400);
	}
	return { raiz, sangria, atributos: rutas(opciones.atributos), contenido: rutas(opciones.contenido) };
}

function rutas(lista = []) {
	if (!Array.isArray(lista)) throw new ErrorBiblioteca("Las rutas deben ser una lista", 400);
	// La "/" inicial es opcional: Git Bash convierte "/owner/id" en una ruta de Windows, así que ahí conviene escribir "owner/id".
	const limpias = lista.map((ruta) => String(ruta).trim()).filter(Boolean);
	return [...new Set(limpias.map((ruta) => (ruta.startsWith("/") ? ruta : `/${ruta}`)))];
}

function slug(nombreArchivo) {
	const base = path.basename(nombreArchivo).replace(/\.pdf$/i, "");
	const limpio = normalizar(base).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/, "");
	return limpio || "documento";
}

function normalizar(texto) {
	return String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function textoMeta(valor) {
	return typeof valor === "string" ? valor.trim() : "";
}

// La búsqueda se hace sobre el texto normalizado (sin tildes), así que primero se traduce
// la posición encontrada a la posición equivalente en el texto original.
function fragmento(texto, posicionNormalizada, largo) {
	const original = [];
	for (let i = 0; i < texto.length && original.length < posicionNormalizada + largo; i++) {
		for (let j = 0; j < normalizar(texto[i]).length; j++) original.push(i);
	}
	const inicio = original[posicionNormalizada] ?? 0;
	const fin = original[posicionNormalizada + largo - 1] ?? inicio;
	const desde = Math.max(0, inicio - 60);
	const hasta = Math.min(texto.length, fin + 61);
	return `${desde > 0 ? "…" : ""}${texto.slice(desde, hasta).replace(/\s+/g, " ").trim()}${hasta < texto.length ? "…" : ""}`;
}
