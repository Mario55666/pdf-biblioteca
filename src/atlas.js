// Incorpora la reconstrucción de un documento al Atlas de la diagramación.
//
//   <Atlas>/reconstrucciones/<id>.json       perfil completo (con las medidas de cada página)
//   <Atlas>/diagramacion.json → pdf.reconstrucciones   resumen que el Atlas muestra en el lector PDF
//   node actualizar.mjs                       vuelve a incrustar diagramacion.json en index.html
//
// Las reconstrucciones van en su propia lista y no en pdf.corpus: el corpus guarda revistas
// interpretadas y evaluadas a mano, y estos perfiles son mediciones automáticas.

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { crearPerfilAtlas } from "./indesign.js";

/**
 * @param {import("./biblioteca.js").Biblioteca} biblioteca
 * @param {string} id documento de la biblioteca
 * @param {string} carpetaAtlas carpeta del Atlas (la que tiene index.html y diagramacion.json)
 * @param {object} [opciones]
 * @param {string} [opciones.informe] ruta de salida/informe.json de la reconstrucción en InDesign
 * @returns {Promise<{entrada: object, archivo: string, salidaActualizar: string}>}
 */
export async function incorporarAlAtlas(biblioteca, id, carpetaAtlas, { informe = null } = {}) {
	const rutaDatos = path.join(carpetaAtlas, "diagramacion.json");
	if (!existsSync(rutaDatos) || !existsSync(path.join(carpetaAtlas, "actualizar.mjs"))) {
		throw new Error(`"${carpetaAtlas}" no parece la carpeta del Atlas (faltan diagramacion.json o actualizar.mjs)`);
	}
	const ficha = await biblioteca.obtener(id);
	if (!ficha) throw new Error(`No existe el documento "${id}"`);

	const json = JSON.parse(await readFile(biblioteca.ruta(id, "json"), "utf8"));
	const pdf = await readFile(biblioteca.ruta(id, "pdf"));
	const ocr = await biblioteca.leerOcr(id);
	const metricas = await import("./metricas.js")
		.then(({ medirTextos }) => medirTextos(pdf, json, json.Pages.map((_, indice) => indice + 1)))
		.catch(() => null);
	const perfil = crearPerfilAtlas(json, ficha, ocr, metricas);
	const indesign = informe ? resumirInforme(JSON.parse(await readFile(informe, "utf8"))) : null;
	const completo = { ...perfil, indesign };

	const archivo = `reconstrucciones/${id}.json`;
	await mkdir(path.join(carpetaAtlas, "reconstrucciones"), { recursive: true });
	await writeFile(path.join(carpetaAtlas, archivo), JSON.stringify(completo, null, 1));

	// Copia de seguridad antes de tocar el modelo de datos del Atlas.
	await copyFile(rutaDatos, `${rutaDatos}.bak`);
	const datos = JSON.parse(await readFile(rutaDatos, "utf8"));
	const entrada = { id, titulo: perfil.revista.titulo, archivo_json: archivo, fecha: perfil.fecha, perfil: perfil.perfil, indesign };
	datos.pdf.reconstrucciones = [...(datos.pdf.reconstrucciones ?? []).filter((r) => r.id !== id), entrada];
	await writeFile(rutaDatos, JSON.stringify(datos, null, 2));

	const salidaActualizar = execFileSync(process.execPath, ["actualizar.mjs"], { cwd: carpetaAtlas, encoding: "utf8" });
	return { entrada, archivo: path.join(carpetaAtlas, archivo), salidaActualizar: salidaActualizar.trim() };
}

function resumirInforme(informe) {
	return {
		version: informe.indesign,
		fecha: informe.generado,
		paginas: informe.paginas,
		marcos: informe.marcos,
		estilos: informe.estilos,
		fuentes_faltantes: informe.fuentesFaltantes ?? [],
		desbordes: informe.desbordes,
		validacion_dtd: informe.validacion?.validado ? `${informe.validacion.errores} errores` : "no disponible",
		elementos_xml: informe.elementosXml,
		tiempo_s: informe.tiempoSegundos,
	};
}
