import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, inflateRawSync } from "node:zlib";
import { crearZip } from "../src/zip.js";

// Lee el ZIP desde su directorio central, como lo haría un descompresor.
function leerZip(zip) {
	const fin = zip.length - 22;
	assert.equal(zip.readUInt32LE(fin), 0x06054b50);
	const total = zip.readUInt16LE(fin + 10);
	let posicion = zip.readUInt32LE(fin + 16);
	const archivos = [];
	for (let i = 0; i < total; i++) {
		assert.equal(zip.readUInt32LE(posicion), 0x02014b50);
		const crc = zip.readUInt32LE(posicion + 16);
		const largoNombre = zip.readUInt16LE(posicion + 28);
		const local = zip.readUInt32LE(posicion + 42);
		const nombre = zip.subarray(posicion + 46, posicion + 46 + largoNombre).toString("utf8");
		assert.equal(zip.readUInt32LE(local), 0x04034b50);
		const comprimido = zip.readUInt32LE(local + 18);
		const inicioDatos = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
		const contenido = inflateRawSync(zip.subarray(inicioDatos, inicioDatos + comprimido));
		assert.equal(crc32(contenido), crc);
		archivos.push({ nombre, contenido: contenido.toString("utf8") });
		posicion += 46 + largoNombre;
	}
	return archivos;
}

test("el ZIP contiene los archivos con su nombre y contenido", () => {
	const entrada = [
		{ nombre: "pagina-001.json", contenido: Buffer.from('{"Pagina": 1}') },
		{ nombre: "página-002.xml", contenido: Buffer.from("<PDF><Pagina>2</Pagina></PDF>".repeat(50)) },
	];
	assert.deepEqual(leerZip(crearZip(entrada)), entrada.map(({ nombre, contenido }) => ({ nombre, contenido: contenido.toString("utf8") })));
});

test("un ZIP sin archivos es válido", () => {
	assert.deepEqual(leerZip(crearZip([])), []);
});
