// Servidor web local: interfaz en public/ y API REST de la biblioteca.
// Solo escucha en 127.0.0.1, así que no es accesible desde otros equipos.
//
//   GET    /api/documentos?q=texto          lista (y busca) documentos
//   POST   /api/documentos                  cuerpo = bytes del PDF, cabecera X-Nombre-Archivo
//   GET    /api/documentos/:id              ficha del documento
//   DELETE /api/documentos/:id              elimina el documento
//   GET    /api/documentos/:id/:archivo     archivo pdf | json | xml | texto | campos
//                                          ?descargar=1 para descargarlo, ?limite=N para los primeros N bytes
//   PUT    /api/documentos/:id/xml          cuerpo = opciones del XML; vuelve a generar el XML (completo y por página)
//   GET    /api/documentos/:id/paginas/:n/:tipo
//                                          JSON o XML de la página n (admite ?descargar=1 y ?limite=N)
//   GET    /api/documentos/:id/paginas/zip?tipo=json|xml|todo
//                                          todas las páginas en un ZIP
//   POST   /api/documentos/:id/ocr          (re)aplica el OCR a las páginas sin texto, en segundo plano
//   GET    /api/documentos/:id/ocr          resultado del OCR (ocr.json); el avance está en la ficha (ocr.estado)

import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHIVOS, Biblioteca, ErrorBiblioteca, OPCIONES_XML_POR_DEFECTO, TIPOS_PAGINA } from "./biblioteca.js";
import { presetCompactoPdf2json } from "./presets.js";
import { crearZip } from "./zip.js";

const RAIZ_PROYECTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLICO = path.join(RAIZ_PROYECTO, "public");
const PUERTO = Number(process.env.PUERTO || 8780);
const MAXIMO_PDF = 200 * 1024 * 1024;

// Módulos de src/ que también usa el navegador (el conversor JSON → XML corre allí sin servidor).
const MODULOS_COMPARTIDOS = { "/lib/jsonAXml.js": "jsonAXml.js", "/lib/presets.js": "presets.js" };

const TIPOS = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
};

const biblioteca = new Biblioteca();

// El OCR es lento y usa mucha CPU: se hace en segundo plano y de a un documento.
const enColaOcr = new Set();
let colaOcr = Promise.resolve();

function encolarOcr(id) {
	if (enColaOcr.has(id)) return;
	enColaOcr.add(id);
	colaOcr = colaOcr.then(async () => {
		try {
			const ficha = await biblioteca.aplicarOcr(id, { alProgresar: (hechas, total) => console.log(`OCR ${id}: página ${hechas} de ${total}`) });
			console.log(`OCR listo: ${id} (${ficha.ocr.conTexto?.length ?? 0} de ${ficha.ocr.paginas.length} páginas con texto)`);
		} catch (error) {
			console.error(`OCR de ${id} falló: ${error.message}`);
		} finally {
			enColaOcr.delete(id);
		}
	});
}

/** Marca el OCR como pendiente y lo encola, salvo que ya esté en la cola o no haga falta. */
async function pedirOcr(id) {
	if (enColaOcr.has(id)) return biblioteca.obtener(id);
	const ficha = await biblioteca.marcarOcrPendiente(id);
	if (ficha.ocr.estado === "pendiente") encolarOcr(id);
	return ficha;
}

async function atender(peticion, respuesta) {
	const url = new URL(peticion.url, "http://localhost");
	try {
		if (url.pathname.startsWith("/api/")) {
			await atenderApi(peticion, respuesta, url);
		} else {
			await servirEstatico(respuesta, url.pathname);
		}
	} catch (error) {
		const estado = error instanceof ErrorBiblioteca ? error.estado : 500;
		if (estado === 500) console.error(error);
		if (!respuesta.headersSent) enviarJson(respuesta, estado, { error: error.message });
		else respuesta.end();
	}
}

async function atenderApi(peticion, respuesta, url) {
	const partes = url.pathname.split("/").filter(Boolean).slice(1); // sin "api"
	const [recurso, id, archivo] = partes.map(decodeURIComponent);
	const metodo = peticion.method;

	if (recurso === "config" && partes.length === 1 && metodo === "GET") {
		return enviarJson(respuesta, 200, { opcionesXml: OPCIONES_XML_POR_DEFECTO, presetCompacto: presetCompactoPdf2json(OPCIONES_XML_POR_DEFECTO.raiz) });
	}
	if (recurso !== "documentos") throw new ErrorBiblioteca("Ruta no encontrada", 404);

	if (partes.length === 1) {
		if (metodo === "GET") return enviarJson(respuesta, 200, await biblioteca.listar(url.searchParams.get("q") ?? ""));
		if (metodo === "POST") {
			const nombre = decodeURIComponent(peticion.headers["x-nombre-archivo"] ?? "documento.pdf");
			const contenido = await leerCuerpo(peticion, MAXIMO_PDF);
			const { ficha, duplicado } = await biblioteca.agregar(contenido, nombre);
			console.log(duplicado ? `Ya estaba en la biblioteca: ${ficha.id}` : `Agregado: ${ficha.id} (${ficha.paginas} págs.)`);
			if (duplicado) return enviarJson(respuesta, 200, { ...ficha, duplicado });
			return enviarJson(respuesta, 201, { ...(await pedirOcr(ficha.id)), duplicado });
		}
	}

	if (partes.length === 2) {
		if (metodo === "GET") {
			const ficha = await biblioteca.obtener(id);
			if (!ficha) throw new ErrorBiblioteca("Documento no encontrado", 404);
			return enviarJson(respuesta, 200, ficha);
		}
		if (metodo === "DELETE") {
			if (!(await biblioteca.eliminar(id))) throw new ErrorBiblioteca("Documento no encontrado", 404);
			console.log(`Eliminado: ${id}`);
			return enviarJson(respuesta, 200, { eliminado: id });
		}
	}

	if (archivo === "paginas" && metodo === "GET") {
		const ficha = await biblioteca.obtener(id);
		if (!ficha) throw new ErrorBiblioteca("Documento no encontrado", 404);
		const base = ficha.nombre.replace(/\.pdf$/i, "");

		if (partes.length === 4 && partes[3] === "zip") {
			const tipo = url.searchParams.get("tipo") ?? "todo";
			if (tipo !== "todo" && !TIPOS_PAGINA[tipo]) throw new ErrorBiblioteca('El tipo debe ser "json", "xml" o "todo"', 400);
			const zip = crearZip(await biblioteca.archivosPaginas(id, tipo === "todo" ? ["json", "xml"] : [tipo]));
			respuesta.writeHead(200, {
				"Content-Type": "application/zip",
				"Content-Length": zip.length,
				"Content-Disposition": disposicion(`${base}-paginas${tipo === "todo" ? "" : `-${tipo}`}.zip`),
			});
			return respuesta.end(zip);
		}
		if (partes.length === 5) {
			const [numero, tipo] = partes.slice(3);
			const ruta = await biblioteca.rutaPagina(id, numero, tipo);
			return servirArchivo(respuesta, url, ruta, TIPOS_PAGINA[tipo], `${base}-${path.basename(ruta)}`);
		}
	}

	if (partes.length === 3 && archivo === "ocr" && metodo === "POST") {
		if (!(await biblioteca.obtener(id))) throw new ErrorBiblioteca("Documento no encontrado", 404);
		return enviarJson(respuesta, 202, await pedirOcr(id));
	}

	if (partes.length === 3 && ARCHIVOS[archivo]) {
		if (metodo === "GET") return servirArchivoDocumento(respuesta, url, id, archivo);
		if (metodo === "PUT" && archivo === "xml") {
			let opciones;
			try {
				opciones = JSON.parse((await leerCuerpo(peticion, 1024 * 1024)).toString("utf8") || "{}");
			} catch {
				throw new ErrorBiblioteca("Las opciones del XML no son un JSON válido", 400);
			}
			const { ficha } = await biblioteca.regenerarXml(id, opciones);
			return enviarJson(respuesta, 200, ficha);
		}
	}

	throw new ErrorBiblioteca("Ruta no encontrada", 404);
}

async function servirArchivoDocumento(respuesta, url, id, archivo) {
	const ficha = await biblioteca.obtener(id);
	if (!ficha) throw new ErrorBiblioteca("Documento no encontrado", 404);
	const base = ficha.nombre.replace(/\.pdf$/i, "");
	return servirArchivo(respuesta, url, biblioteca.ruta(id, archivo), ARCHIVOS[archivo].tipo, `${base}.${ARCHIVOS[archivo].extension}`);
}

// Envía un archivo; con ?limite=N solo sus primeros N bytes y con ?descargar como descarga.
async function servirArchivo(respuesta, url, ruta, tipoContenido, nombreDescarga) {
	if (!existsSync(ruta)) throw new ErrorBiblioteca(`Este documento no tiene ${path.basename(ruta)}`, 404);
	const total = (await stat(ruta)).size;
	const limite = Number(url.searchParams.get("limite")) || 0;
	const parcial = limite > 0 && limite < total;

	const cabeceras = { "Content-Type": tipoContenido, "X-Tamano-Total": String(total), "Cache-Control": "no-store" };
	if (url.searchParams.has("descargar")) cabeceras["Content-Disposition"] = disposicion(nombreDescarga);
	respuesta.writeHead(200, cabeceras);
	createReadStream(ruta, parcial ? { start: 0, end: limite - 1 } : {}).pipe(respuesta);
}

function disposicion(nombre) {
	return `attachment; filename="${nombre.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
}

async function servirEstatico(respuesta, ruta) {
	let archivo;
	if (MODULOS_COMPARTIDOS[ruta]) {
		archivo = path.join(RAIZ_PROYECTO, "src", MODULOS_COMPARTIDOS[ruta]);
	} else {
		archivo = path.join(PUBLICO, ruta === "/" ? "index.html" : path.normalize(decodeURIComponent(ruta)));
		if (!archivo.startsWith(PUBLICO + path.sep)) throw new ErrorBiblioteca("Ruta no válida", 400);
	}
	if (!existsSync(archivo)) throw new ErrorBiblioteca("No encontrado", 404);
	respuesta.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
	createReadStream(archivo).pipe(respuesta);
}

function leerCuerpo(peticion, maximo) {
	return new Promise((resolver, rechazar) => {
		const trozos = [];
		let tamano = 0;
		peticion.on("data", (trozo) => {
			tamano += trozo.length;
			if (tamano > maximo) {
				rechazar(new ErrorBiblioteca(`El archivo supera el máximo de ${Math.round(maximo / 1024 / 1024)} MB`, 413));
				peticion.destroy();
				return;
			}
			trozos.push(trozo);
		});
		peticion.on("end", () => resolver(Buffer.concat(trozos)));
		peticion.on("error", rechazar);
	});
}

function enviarJson(respuesta, estado, datos) {
	respuesta.writeHead(estado, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
	respuesta.end(JSON.stringify(datos));
}

// Retoma el OCR de los documentos que quedaron a medias si el servidor se cerró mientras trabajaba.
for (const ficha of await biblioteca.listar()) {
	if (["pendiente", "procesando"].includes(ficha.ocr?.estado)) encolarOcr(ficha.id);
}

createServer(atender).listen(PUERTO, "127.0.0.1", () => {
	console.log(`Biblioteca PDF lista en http://localhost:${PUERTO}`);
	console.log(`Documentos guardados en ${biblioteca.carpeta}`);
});
// El navegador suele probar primero "localhost" por IPv6 (::1); sin este segundo oyente,
// Windows tarda en rechazar esa conexión antes de pasar a 127.0.0.1.
createServer(atender)
	.listen(PUERTO, "::1")
	.on("error", () => {});
