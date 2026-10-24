// Escritor mínimo de archivos ZIP (deflate, nombres en UTF-8), sin dependencias.
// Basta para descargar las páginas de un documento; no admite ZIP64 (más de 65 535
// archivos o más de 4 GB).

import { crc32, deflateRawSync } from "node:zlib";

/**
 * @param {Array<{nombre: string, contenido: Buffer}>} archivos
 * @param {Date} [fecha] fecha de modificación de los archivos
 * @returns {Buffer} el ZIP completo
 */
export function crearZip(archivos, fecha = new Date()) {
	const { hora, dia } = fechaDos(fecha);
	const locales = [];
	const central = [];
	let desplazamiento = 0;

	for (const { nombre, contenido } of archivos) {
		const nombreBytes = Buffer.from(nombre, "utf8");
		const comprimido = deflateRawSync(contenido);
		const crc = crc32(contenido);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0); // firma de cabecera local
		local.writeUInt16LE(20, 4); // versión necesaria
		local.writeUInt16LE(0x0800, 6); // nombre en UTF-8
		local.writeUInt16LE(8, 8); // método deflate
		local.writeUInt16LE(hora, 10);
		local.writeUInt16LE(dia, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(comprimido.length, 18);
		local.writeUInt32LE(contenido.length, 22);
		local.writeUInt16LE(nombreBytes.length, 26);
		locales.push(local, nombreBytes, comprimido);

		const entrada = Buffer.alloc(46);
		entrada.writeUInt32LE(0x02014b50, 0); // firma de directorio central
		entrada.writeUInt16LE(20, 4); // versión que lo creó
		entrada.writeUInt16LE(20, 6); // versión necesaria
		entrada.writeUInt16LE(0x0800, 8);
		entrada.writeUInt16LE(8, 10);
		entrada.writeUInt16LE(hora, 12);
		entrada.writeUInt16LE(dia, 14);
		entrada.writeUInt32LE(crc, 16);
		entrada.writeUInt32LE(comprimido.length, 20);
		entrada.writeUInt32LE(contenido.length, 24);
		entrada.writeUInt16LE(nombreBytes.length, 28);
		entrada.writeUInt32LE(desplazamiento, 42); // dónde empieza su cabecera local
		central.push(entrada, nombreBytes);

		desplazamiento += local.length + nombreBytes.length + comprimido.length;
	}

	const tamanoCentral = central.reduce((total, parte) => total + parte.length, 0);
	const fin = Buffer.alloc(22);
	fin.writeUInt32LE(0x06054b50, 0); // firma de fin de directorio central
	fin.writeUInt16LE(archivos.length, 8);
	fin.writeUInt16LE(archivos.length, 10);
	fin.writeUInt32LE(tamanoCentral, 12);
	fin.writeUInt32LE(desplazamiento, 16);
	return Buffer.concat([...locales, ...central, fin]);
}

function fechaDos(fecha) {
	return {
		hora: (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | Math.floor(fecha.getSeconds() / 2),
		dia: ((fecha.getFullYear() - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate(),
	};
}
