/*
    Port a JavaScript de JsonToXml (y su clase auxiliar Node) de la librería XmlToJson:
    https://github.com/smart-fun/XmlToJson

    Copyright 2016 Arnaud Guyon (código Java original)
    Licensed under the Apache License, Version 2.0
    http://www.apache.org/licenses/LICENSE-2.0

    Se conserva la API del original (Builder, forceAttribute, forceContent, toString,
    toFormattedString) y su recorrido del JSON. Diferencias con la versión Java, que
    corre solo en Android:
    - Los nombres de etiqueta y atributo que no son nombres XML válidos (espacios,
      dos puntos, inicio con número...) se sanean con "_" para que el XML sea válido.
    - Un null de JSON se escribe como elemento vacío en lugar del texto "null".
    - Los caracteres prohibidos en XML 1.0 se eliminan del texto.
    - toFormattedString sangra directamente, sin pasar por javax.xml.transform.
    Además, jsonAXml() envuelve el JSON en una etiqueta raíz cuando hace falta, porque
    un documento XML admite una sola raíz (pdf2json entrega Transcoder, Meta y Pages).
*/

const SANGRIA_POR_DEFECTO = 3;
const DECLARACION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Equivalente de Node.java: guarda los datos mientras se convierte de JSON a XML. */
class Nodo {
	constructor(nombre, ruta) {
		this.nombre = nombre;
		this.ruta = ruta;
		this.contenido = null;
		this.atributos = [];
		this.hijos = [];
	}

	agregarAtributo(clave, valor) {
		this.atributos.push({ clave, valor });
	}

	agregarHijo(hijo) {
		this.hijos.push(hijo);
	}
}

export class JsonToXml {
	static Builder = class {
		/**
		 * @param {object|string} json objeto JSON o texto JSON
		 */
		constructor(json) {
			this.json = typeof json === "string" ? JSON.parse(json) : json;
			this.atributosForzados = new Set();
			this.contenidoForzado = new Set();
		}

		/**
		 * Convierte una etiqueta en atributo de su etiqueta padre.
		 * @param {string} ruta con formato "/etiquetaPadre/etiquetaHija/atributo"
		 */
		forceAttribute(ruta) {
			this.atributosForzados.add(ruta);
			return this;
		}

		/**
		 * Convierte una etiqueta en el contenido de su etiqueta padre.
		 * @param {string} ruta con formato "/etiquetaPadre/etiquetaContenido"
		 */
		forceContent(ruta) {
			this.contenidoForzado.add(ruta);
			return this;
		}

		build() {
			return new JsonToXml(this.json, this.atributosForzados, this.contenidoForzado);
		}
	};

	constructor(json, atributosForzados, contenidoForzado) {
		this.json = json;
		this.atributosForzados = atributosForzados;
		this.contenidoForzado = contenidoForzado;
	}

	/** @returns {string} el XML en una sola línea */
	toString() {
		return this.#generar(null);
	}

	/**
	 * @param {number} sangria número de espacios por nivel (3 por defecto, como el original)
	 * @returns {string} el XML con saltos de línea y sangría
	 */
	toFormattedString(sangria = SANGRIA_POR_DEFECTO) {
		return this.#generar(" ".repeat(Math.max(0, sangria)));
	}

	#generar(sangria) {
		const raiz = new Nodo(null, "");
		this.#prepararObjeto(raiz, this.json);
		const partes = [DECLARACION];
		if (sangria !== null) partes.push("\n");
		for (const hijo of raiz.hijos) escribirNodo(hijo, partes, sangria, 0);
		return partes.join("");
	}

	#prepararObjeto(nodo, json) {
		for (const [clave, valor] of Object.entries(json)) {
			if (valor === undefined) continue;
			if (esObjeto(valor)) {
				const subNodo = new Nodo(clave, `${nodo.ruta}/${clave}`);
				nodo.agregarHijo(subNodo);
				this.#prepararObjeto(subNodo, valor);
			} else if (Array.isArray(valor)) {
				this.#prepararArreglo(nodo, clave, valor);
			} else {
				const ruta = `${nodo.ruta}/${clave}`;
				const texto = valorATexto(valor);
				if (this.atributosForzados.has(ruta)) {
					nodo.agregarAtributo(clave, texto ?? "");
				} else if (this.contenidoForzado.has(ruta)) {
					nodo.contenido = texto;
				} else {
					const subNodo = new Nodo(clave, nodo.ruta);
					subNodo.contenido = texto;
					nodo.agregarHijo(subNodo);
				}
			}
		}
	}

	#prepararArreglo(nodo, clave, arreglo) {
		const ruta = `${nodo.ruta}/${clave}`;
		for (const elemento of arreglo) {
			const subNodo = new Nodo(clave, ruta);
			if (esObjeto(elemento)) {
				this.#prepararObjeto(subNodo, elemento);
			} else if (Array.isArray(elemento)) {
				this.#prepararArreglo(subNodo, clave, elemento);
			} else {
				subNodo.contenido = elemento === null ? null : String(elemento);
			}
			nodo.agregarHijo(subNodo);
		}
	}
}

/**
 * Atajo para convertir un JSON a XML con opciones.
 * @param {object|string} json
 * @param {object} [opciones]
 * @param {string} [opciones.raiz="documento"] etiqueta raíz si el JSON no tiene una sola
 * @param {number|null} [opciones.sangria=3] espacios de sangría; null para una sola línea
 * @param {string[]} [opciones.atributos] rutas para forceAttribute
 * @param {string[]} [opciones.contenido] rutas para forceContent
 */
export function jsonAXml(json, opciones = {}) {
	const { raiz = "documento", sangria = SANGRIA_POR_DEFECTO, atributos = [], contenido = [] } = opciones;
	const datos = typeof json === "string" ? JSON.parse(json) : json;
	const constructor = new JsonToXml.Builder(envolverEnRaiz(datos, raiz));
	for (const ruta of atributos) constructor.forceAttribute(ruta);
	for (const ruta of contenido) constructor.forceContent(ruta);
	const conversor = constructor.build();
	return sangria === null ? conversor.toString() : conversor.toFormattedString(sangria);
}

/** Devuelve el JSON con una sola clave raíz que contiene un objeto; si no la tiene, lo envuelve. */
export function envolverEnRaiz(json, raiz = "documento") {
	if (Array.isArray(json)) return { [raiz]: { elemento: json } };
	if (!esObjeto(json)) return { [raiz]: json };
	const claves = Object.keys(json);
	if (claves.length === 1 && esObjeto(json[claves[0]])) return json;
	return { [raiz]: json };
}

function esObjeto(valor) {
	return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

// Como el original: los enteros sin notación científica y los decimales con hasta 20 cifras.
function valorATexto(valor) {
	if (valor === null) return null;
	if (typeof valor === "number") {
		if (Number.isInteger(valor)) return Number.isSafeInteger(valor) ? String(valor) : BigInt(valor).toString();
		if (!Number.isFinite(valor)) return String(valor);
		return valor.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
	}
	return String(valor);
}

function escribirNodo(nodo, partes, sangria, nivel) {
	const nombre = nombreXml(nodo.nombre);
	const margen = sangria === null ? "" : sangria.repeat(nivel);
	const salto = sangria === null ? "" : "\n";
	let apertura = `${margen}<${nombre}`;
	for (const { clave, valor } of nodo.atributos) apertura += ` ${nombreXml(clave)}="${escaparAtributo(valor)}"`;

	const tieneContenido = nodo.contenido !== null && nodo.contenido !== "";
	if (!tieneContenido && nodo.hijos.length === 0) {
		partes.push(`${apertura}/>${salto}`);
		return;
	}
	partes.push(`${apertura}>`);
	if (tieneContenido) partes.push(escaparTexto(nodo.contenido));
	if (nodo.hijos.length > 0) {
		partes.push(salto);
		for (const hijo of nodo.hijos) escribirNodo(hijo, partes, sangria, nivel + 1);
		partes.push(margen);
	}
	partes.push(`</${nombre}>${salto}`);
}

const CARACTERES_INVALIDOS = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;

function escaparTexto(texto) {
	return texto.replace(CARACTERES_INVALIDOS, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escaparAtributo(texto) {
	return escaparTexto(texto).replace(/"/g, "&quot;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");
}

/** Sanea un nombre para que sea un nombre XML válido (sin espacio de nombres). */
export function nombreXml(nombre) {
	let limpio = String(nombre).replace(/[^\p{L}\p{N}_.-]/gu, "_");
	if (!/^[\p{L}_]/u.test(limpio)) limpio = `_${limpio}`;
	return limpio;
}
