import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearPerfilAtlas, crearPlan, crearXmlIndesign, DTD_INDESIGN, leerRangoPaginas, PT_POR_UNIDAD } from "../src/indesign.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PDF_EJEMPLO = path.join(RAIZ, "vendor", "pdf2json", "test", "pdf", "fd", "form", "F1040EZ.pdf");
const faltan =
	(!existsSync(path.join(RAIZ, "vendor", "pdf2json", "dist", "pdfparser.js")) && "falta ejecutar npm run preparar") ||
	(!existsSync(path.join(RAIZ, "node_modules", "pdfjs-dist")) && "falta ejecutar npm install");

const JSON_MINIMO = {
	Transcoder: "pdf2json@prueba",
	Meta: { Title: "Prueba" },
	Pages: [
		{
			Width: 38.25,
			Height: 49.5,
			Texts: [{ x: 2, y: 2.573, w: 2.7, clr: 0, sw: 0.3, A: "left", R: [{ T: "Hola & <adiós>", S: -1, TS: [0, 16, 1, 0] }] }],
			Fills: [{ x: 1, y: 1, w: 2, h: 3, oc: "#ecf6ea" }],
			HLines: [{ x: 1, y: 4, w: 1.5, l: 10, oc: "#221f1f" }],
			VLines: [],
			Fields: [],
		},
	],
};

test("el plan pasa las unidades de pdf2json a puntos", () => {
	const plan = crearPlan(JSON_MINIMO, { documento: { id: "prueba", titulo: "Prueba" } });
	const [pagina] = plan.paginas;
	assert.equal(PT_POR_UNIDAD, 16);
	assert.equal(pagina.ancho, 612);
	assert.equal(pagina.alto, 792);
	// Texto: origen x + 0,25 y línea base y + 0,75 unidades; cuerpo TS × 0,75 sin métricas.
	assert.deepEqual(pagina.textos[0], { id: "p1-t1", x: 36, lineaBase: 53.168, cuerpo: 12, estilo: "Arial Bold 12 pt", color: "#000000" });
	assert.deepEqual(pagina.rellenos[0], { id: "p1-r1", x: 16, y: 16, ancho: 32, alto: 48, color: "#ecf6ea" });
	assert.deepEqual(pagina.lineas[0], { id: "p1-l1", x1: 16, y1: 64, x2: 176, y2: 64, grosor: 1, color: "#221f1f" });
	assert.deepEqual(plan.capas, ["Original PDF", "Rellenos", "Líneas", "Campos", "Texto", "OCR"]);
	assert.deepEqual(plan.estilos, [{ nombre: "Arial Bold 12 pt", fuente: "Arial", estilo: "Bold", cuerpo: 12, interlineado: 14.4 }]);
});

test("con métricas de pdf.js se usan el cuerpo y el ancho reales", () => {
	const metricas = new Map([[1, [{ cuerpo: 7.04, ancho: 155.32, fuente: "Helvetica", negrita: false, cursiva: false }]]]);
	const [texto] = crearPlan(JSON_MINIMO, { metricas }).paginas[0].textos;
	assert.equal(texto.cuerpo, 7);
	assert.equal(texto.ancho, 155.32);
	assert.equal(texto.estilo, "Helvetica 7 pt");
});

test("el XML lleva el espacio de nombres aid, los estilos y la sincronización de porky", () => {
	const plan = crearPlan(JSON_MINIMO, { documento: { id: "prueba", titulo: "Prueba" } });
	const xml = crearXmlIndesign(JSON_MINIMO, plan);
	assert.match(xml, /<!DOCTYPE Documento SYSTEM "atlas-indesign\.dtd">/);
	assert.match(xml, /<Documento xmlns:aid="http:\/\/ns\.adobe\.com\/AdobeInDesign\/4\.0\/" id="prueba"/);
	assert.match(xml, /<Original id="p1-original" pagina="1"\/>/);
	assert.match(xml, /<Texto id="p1-t1" aid:pstyle="Arial Bold 12 pt" syncScript="sync\/texto\.jsx" syncIdentifier="p1-t1">Hola &amp; &lt;adiós&gt;<\/Texto>/);
	// Los elementos aparecen en el orden que exige la DTD.
	assert.ok(xml.indexOf("<Relleno") < xml.indexOf("<Linea") && xml.indexOf("<Linea") < xml.indexOf("<Texto"));
	assert.match(DTD_INDESIGN, /<!ELEMENT Pagina \(Original, Relleno\*, Linea\*, Campo\*, Texto\*, OCR\*\)>/);
});

test("las páginas leídas con OCR entran en el plan y en el XML", () => {
	const json = { ...JSON_MINIMO, Pages: [{ ...JSON_MINIMO.Pages[0], Texts: [] }] };
	const ocr = { motor: "tesseract.js", idiomas: "spa", paginas: { 1: { confianza: 90, texto: "PORTADA", lineas: [{ texto: "PORTADA", confianza: 90, x: 3, y: 2, w: 10, h: 1.5 }] } } };
	const plan = crearPlan(json, { ocr });
	assert.deepEqual(plan.paginas[0].ocr, [{ id: "p1-o1", x: 48, y: 32, ancho: 160, alto: 24, cuerpo: 18, confianza: 90 }]);
	assert.ok(plan.estilos.some((estilo) => estilo.nombre === "OCR"));
	assert.match(crearXmlIndesign(json, plan, ocr), /<OCR id="p1-o1" aid:pstyle="OCR" confianza="90" syncScript="sync\/texto\.jsx" syncIdentifier="p1-o1">PORTADA<\/OCR>/);
});

test("lee rangos de páginas", () => {
	assert.equal(leerRangoPaginas("", 10), null);
	assert.deepEqual(leerRangoPaginas("1-3,7,2", 10), [1, 2, 3, 7]);
	assert.throws(() => leerRangoPaginas("9-12", 10), /no válido/);
});

test("plan y perfil del formulario 1040EZ calibrados con pdf.js", { skip: faltan }, async () => {
	const { extraerJson } = await import("../src/pdfAJson.js");
	const { medirTextos } = await import("../src/metricas.js");
	const pdf = await readFile(PDF_EJEMPLO);
	const { json } = await extraerJson(pdf);
	const metricas = await medirTextos(pdf, json, [1, 2]);
	const emparejados = metricas.get(1).filter(Boolean).length;
	assert.ok(emparejados / json.Pages[0].Texts.length > 0.95, `solo ${emparejados} textos emparejados`);

	const plan = crearPlan(json, { metricas });
	const titulo = plan.paginas[0].textos.find((texto) => texto.cuerpo === 14);
	assert.ok(titulo, "el «1040EZ» mide 14 pt en el PDF");
	assert.equal(plan.paginas[0].campos.length, 52);

	const perfil = crearPerfilAtlas(json, { id: "f1040ez", titulo: "", nombre: "F1040EZ.pdf" }, null, metricas);
	assert.equal(perfil.perfil.formato_mm, "216 × 279");
	assert.equal(perfil.perfil.paginas_totales, 2);
	assert.match(perfil.metodo, /calibrados con pdf\.js/);
	assert.ok(perfil.perfil.cuerpo_base_pt >= 6 && perfil.perfil.cuerpo_base_pt <= 10);
});
