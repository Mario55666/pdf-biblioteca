// Servidor web local: interfaz en public/ y API REST de la biblioteca.
// Solo escucha en 127.0.0.1, así que no es accesible desde otros equipos.
//
//   GET    /api/documentos?q=texto          lista (y busca) documentos
//   POST   /api/documentos                  cuerpo = bytes del PDF, cabecera X-Nombre-Archivo
//   GET    /api/documentos/:id              ficha del documento
//   DELETE /api/documentos/:id              elimina el documento
//   GET    /api/documentos/:id/:archivo     archivo pdf | json | xml | texto | campos
//                                          ?descargar=1 para descargarlo, ?limite=N para los primeros N bytes
//   PUT    /api/documentos/:id/xml          cuerpo = opciones del XML; vuelve a generar el XML

import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHIVOS, Biblioteca, ErrorBiblioteca, OPCIONES_XML_POR_DEFECTO } from "./biblioteca.js";
import { presetCompactoPdf2json } from "./presets.js";

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
			return enviarJson(respuesta, duplicado ? 200 : 201, { ...ficha, duplicado });
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
	const ruta = biblioteca.ruta(id, archivo);
	const total = await biblioteca.tamano(id, archivo);
	const limite = Number(url.searchParams.get("limite")) || 0;
	const parcial = limite > 0 && limite < total;

	const cabeceras = { "Content-Type": ARCHIVOS[archivo].tipo, "X-Tamano-Total": String(total), "Cache-Control": "no-store" };
	if (url.searchParams.has("descargar")) {
		const base = ficha.nombre.replace(/\.pdf$/i, "");
		const nombre = `${base}.${ARCHIVOS[archivo].extension}`;
		cabeceras["Content-Disposition"] = `attachment; filename="${nombre.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
	}
	respuesta.writeHead(200, cabeceras);
	createReadStream(ruta, parcial ? { start: 0, end: limite - 1 } : {}).pipe(respuesta);
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

createServer(atender).listen(PUERTO, "127.0.0.1", () => {
	console.log(`Biblioteca PDF lista en http://localhost:${PUERTO}`);
	console.log(`Documentos guardados en ${biblioteca.carpeta}`);
});
// El navegador suele probar primero "localhost" por IPv6 (::1); sin este segundo oyente,
// Windows tarda en rechazar esa conexión antes de pasar a 127.0.0.1.
createServer(atender)
	.listen(PUERTO, "::1")
	.on("error", () => {});
