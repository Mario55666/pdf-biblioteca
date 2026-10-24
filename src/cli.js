// Uso desde la terminal. Ejemplos:
//   node src/cli.js agregar factura.pdf carpeta-con-pdfs/
//   node src/cli.js listar [búsqueda]
//   node src/cli.js xml <id> --compacto --sangria 2
//   node src/cli.js paginas <id>
//   node src/cli.js json2xml datos.json datos.xml --raiz datos --atributo /datos/id
//   node src/cli.js eliminar <id>

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { Biblioteca, normalizarOpcionesXml, OPCIONES_XML_POR_DEFECTO } from "./biblioteca.js";
import { jsonAXml } from "./jsonAXml.js";
import { presetCompactoPdf2json } from "./presets.js";

const AYUDA = `Biblioteca PDF → JSON → XML

Comandos:
  agregar <pdf|carpeta>...   Extrae el JSON de cada PDF y lo guarda en la biblioteca
  listar [búsqueda]          Muestra los documentos (busca en nombre, título y texto)
  xml <id>                   Vuelve a generar el XML de un documento (completo y por página) con otras opciones
  paginas <id>...            Vuelve a separar el JSON y el XML por página (todos los documentos si no indicas id)
  json2xml <entrada.json> [salida.xml]
                             Convierte cualquier JSON a XML (sin usar la biblioteca)
  eliminar <id>              Borra un documento de la biblioteca

Opciones del XML (agregar, xml, json2xml):
  --raiz <nombre>            Etiqueta raíz (por defecto "${OPCIONES_XML_POR_DEFECTO.raiz}"; en json2xml, "documento")
  --sangria <n>              Espacios de sangría, 0 a 8 (por defecto ${OPCIONES_XML_POR_DEFECTO.sangria})
  --una-linea                XML sin saltos de línea
  --atributo <ruta>          forceAttribute de XmlToJson; se puede repetir. Ej.: /PDF/Pages/Texts/x
  --contenido <ruta>         forceContent de XmlToJson; se puede repetir
  --compacto                 Añade el preset de atributos para la salida de pdf2json`;

const { values: opciones, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		raiz: { type: "string" },
		sangria: { type: "string" },
		"una-linea": { type: "boolean" },
		atributo: { type: "string", multiple: true },
		contenido: { type: "string", multiple: true },
		compacto: { type: "boolean" },
		ayuda: { type: "boolean", short: "h" },
	},
});

const [comando, ...argumentos] = positionals;
const biblioteca = new Biblioteca();

function opcionesXml(raizPorDefecto) {
	const raiz = opciones.raiz ?? raizPorDefecto;
	const atributos = [...(opciones.atributo ?? [])];
	const contenido = [...(opciones.contenido ?? [])];
	if (opciones.compacto) atributos.push(...presetCompactoPdf2json(raiz).atributos);
	const sangria = opciones["una-linea"] ? null : (opciones.sangria ?? OPCIONES_XML_POR_DEFECTO.sangria);
	return normalizarOpcionesXml({ raiz, sangria, atributos, contenido });
}

async function pdfsEn(rutas) {
	const encontrados = [];
	for (const ruta of rutas) {
		if ((await stat(ruta)).isDirectory()) {
			for (const nombre of await readdir(ruta)) {
				if (nombre.toLowerCase().endsWith(".pdf")) encontrados.push(path.join(ruta, nombre));
			}
		} else {
			encontrados.push(ruta);
		}
	}
	return encontrados;
}

function kb(bytes) {
	return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
	if (opciones.ayuda || !comando) return console.log(AYUDA);

	switch (comando) {
		case "agregar": {
			if (!argumentos.length) throw new Error("Indica uno o más PDF o carpetas");
			const xml = opcionesXml(OPCIONES_XML_POR_DEFECTO.raiz);
			let fallos = 0;
			for (const archivo of await pdfsEn(argumentos)) {
				try {
					const { ficha, duplicado } = await biblioteca.agregar(await readFile(archivo), path.basename(archivo), xml);
					console.log(`${duplicado ? "= ya estaba" : "+ agregado "}  ${ficha.id}  (${ficha.paginas} págs., JSON ${kb(ficha.bytes.json)}, XML ${kb(ficha.bytes.xml)})`);
				} catch (error) {
					fallos++;
					console.error(`x ${archivo}: ${error.message}`);
				}
			}
			console.log(`\nBiblioteca: ${biblioteca.carpeta}`);
			if (fallos) process.exitCode = 1;
			break;
		}
		case "listar": {
			const fichas = await biblioteca.listar(argumentos.join(" "));
			if (!fichas.length) return console.log("No hay documentos.");
			for (const f of fichas) {
				console.log(`${f.id}\n   ${f.titulo || f.nombre} · ${f.paginas} págs. · ${new Date(f.agregado).toLocaleDateString("es-PE")}${f.fragmento ? `\n   «${f.fragmento}»` : ""}`);
			}
			break;
		}
		case "xml": {
			const [id] = argumentos;
			const ficha = await biblioteca.obtener(id ?? "");
			if (!ficha) throw new Error(`No existe el documento "${id}"`);
			const { ficha: nueva } = await biblioteca.regenerarXml(id, opcionesXml(ficha.opcionesXml.raiz));
			console.log(`XML regenerado (${kb(nueva.bytes.xml)}): ${biblioteca.ruta(id, "xml")}`);
			console.log(`y sus ${nueva.paginas} páginas en ${path.join(path.dirname(biblioteca.ruta(id, "xml")), "paginas")}`);
			break;
		}
		case "paginas": {
			const ids = argumentos.length ? argumentos : (await biblioteca.listar()).map((ficha) => ficha.id);
			for (const id of ids) {
				const ficha = await biblioteca.obtener(id);
				if (!ficha) throw new Error(`No existe el documento "${id}"`);
				console.log(`${id}: ${ficha.paginas} JSON y ${ficha.paginas} XML en ${await biblioteca.separarPaginas(id)}`);
			}
			break;
		}
		case "json2xml": {
			const [entrada, salida] = argumentos;
			if (!entrada) throw new Error("Indica el archivo JSON de entrada");
			const xml = jsonAXml(await readFile(entrada, "utf8"), opcionesXml("documento"));
			if (salida) {
				await writeFile(salida, xml);
				console.log(`XML guardado en ${salida}`);
			} else {
				process.stdout.write(xml);
			}
			break;
		}
		case "eliminar": {
			const [id] = argumentos;
			console.log((await biblioteca.eliminar(id ?? "")) ? `Eliminado ${id}` : `No existe el documento "${id}"`);
			break;
		}
		default:
			console.log(AYUDA);
			process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(`Error: ${error.message}`);
	process.exitCode = 1;
});
