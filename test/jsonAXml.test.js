import { test } from "node:test";
import assert from "node:assert/strict";
import { JsonToXml, jsonAXml, envolverEnRaiz, nombreXml } from "../src/jsonAXml.js";

const DECLARACION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const PROPIETARIO = { owner: { id: 124, name: "John Doe" } };

// Los tres casos siguientes son los ejemplos del README de XmlToJson.
test("ejemplo básico del README", () => {
	const xml = new JsonToXml.Builder(PROPIETARIO).build().toFormattedString(4);
	assert.equal(xml, `${DECLARACION}\n<owner>\n    <id>124</id>\n    <name>John Doe</name>\n</owner>\n`);
});

test("forceAttribute del README", () => {
	const xml = new JsonToXml.Builder(PROPIETARIO).forceAttribute("/owner/id").build().toString();
	assert.equal(xml, `${DECLARACION}<owner id="124"><name>John Doe</name></owner>`);
});

test("forceAttribute + forceContent del README", () => {
	const xml = new JsonToXml.Builder(PROPIETARIO).forceAttribute("/owner/id").forceContent("/owner/name").build().toString();
	assert.equal(xml, `${DECLARACION}<owner id="124">John Doe</owner>`);
});

test("los arreglos repiten la etiqueta y los arreglos anidados se anidan", () => {
	const xml = new JsonToXml.Builder({ r: { TS: [0, 10], m: [[1, 2]] } }).build().toString();
	assert.equal(xml, `${DECLARACION}<r><TS>0</TS><TS>10</TS><m><m>1</m><m>2</m></m></r>`);
});

test("las rutas de forceAttribute atraviesan arreglos como en el original", () => {
	const json = { PDF: { Pages: [{ Texts: [{ x: 2.001, R: [{ T: "Hola" }] }] }] } };
	const xml = new JsonToXml.Builder(json).forceAttribute("/PDF/Pages/Texts/x").forceContent("/PDF/Pages/Texts/R/T").build().toString();
	assert.equal(xml, `${DECLARACION}<PDF><Pages><Texts x="2.001"><R>Hola</R></Texts></Pages></PDF>`);
});

test("números sin notación científica", () => {
	const xml = jsonAXml({ n: { a: 1e21, b: 0.0000001, c: 3.5 } }, { sangria: null });
	assert.equal(xml, `${DECLARACION}<n><a>1000000000000000000000</a><b>0.0000001</b><c>3.5</c></n>`);
});

test("escapa texto y atributos, y quita caracteres inválidos", () => {
	const xml = jsonAXml({ a: { t: 'x < y & "z"\u0001', q: 'di "hola"' } }, { sangria: null, atributos: ["/a/q"] });
	assert.equal(xml, `${DECLARACION}<a q="di &quot;hola&quot;"><t>x &lt; y &amp; "z"</t></a>`);
});

test("null y objetos vacíos producen elementos vacíos", () => {
	const xml = jsonAXml({ a: { b: null, c: {} } }, { sangria: null });
	assert.equal(xml, `${DECLARACION}<a><b/><c/></a>`);
});

test("envuelve en raíz solo cuando hace falta", () => {
	assert.deepEqual(envolverEnRaiz(PROPIETARIO, "PDF"), PROPIETARIO);
	assert.deepEqual(envolverEnRaiz({ Transcoder: "x", Meta: {} }, "PDF"), { PDF: { Transcoder: "x", Meta: {} } });
	assert.deepEqual(envolverEnRaiz([1, 2], "lista"), { lista: { elemento: [1, 2] } });
});

test("sanea nombres XML inválidos", () => {
	assert.equal(nombreXml("dc:title"), "dc_title");
	assert.equal(nombreXml("2 columnas"), "_2_columnas");
	assert.equal(nombreXml("Año"), "Año");
});
