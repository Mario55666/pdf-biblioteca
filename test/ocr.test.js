import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Biblioteca } from "../src/biblioteca.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const faltan =
	(!existsSync(path.join(RAIZ, "vendor", "pdf2json", "dist", "pdfparser.js")) && "falta ejecutar npm run preparar") ||
	(!existsSync(path.join(RAIZ, "node_modules", "tesseract.js")) && "falta ejecutar npm install");

// PDF mínimo de una página carta cuyo único contenido es una imagen JPEG (como una página escaneada).
function pdfConImagen(jpeg, anchoPx, altoPx) {
	const objetos = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
		[`<< /Type /XObject /Subtype /Image /Width ${anchoPx} /Height ${altoPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"],
		"<< /Length 31 >>\nstream\nq 612 0 0 792 0 0 cm /Im0 Do Q\nendstream",
	];
	const partes = [Buffer.from("%PDF-1.4\n")];
	const posiciones = [];
	let tamano = partes[0].length;
	objetos.forEach((objeto, indice) => {
		posiciones.push(tamano);
		const bloque = Buffer.concat([`${indice + 1} 0 obj\n`, ...[objeto].flat(), "\nendobj\n"].map((parte) => Buffer.from(parte)));
		partes.push(bloque);
		tamano += bloque.length;
	});
	const xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posiciones.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
	partes.push(Buffer.from(`${xref}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${tamano}\n%%EOF\n`));
	return Buffer.concat(partes);
}

test("lee con OCR una página que solo es una imagen y lo guarda en su JSON y XML", { skip: faltan, timeout: 120000 }, async () => {
	const { createCanvas } = await import("@napi-rs/canvas");
	const lienzo = createCanvas(1275, 1650); // carta a 150 ppp
	const ctx = lienzo.getContext("2d");
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, lienzo.width, lienzo.height);
	ctx.fillStyle = "#111111";
	ctx.font = "bold 96px Arial";
	ctx.fillText("BIBLIOTECA PDF", 150, 400);
	ctx.font = "64px Arial";
	ctx.fillText("Prueba de lectura 2026", 150, 560);

	const carpeta = await mkdtemp(path.join(tmpdir(), "biblioteca-ocr-"));
	try {
		const biblioteca = new Biblioteca(carpeta);
		const { ficha } = await biblioteca.agregar(pdfConImagen(lienzo.toBuffer("image/jpeg", 92), lienzo.width, lienzo.height), "escaneado.pdf");
		assert.deepEqual(ficha.paginasSinTexto, [1]);
		assert.equal(ficha.ocr, null);

		const avance = [];
		const conOcr = await biblioteca.aplicarOcr(ficha.id, { alProgresar: (hechas, total) => avance.push(`${hechas}/${total}`) });
		assert.deepEqual(avance, ["1/1"]);
		assert.equal(conOcr.ocr.estado, "listo");
		assert.deepEqual(conOcr.ocr.conTexto, [1]);

		const pagina = JSON.parse(await readFile(await biblioteca.rutaPagina(ficha.id, 1, "json"), "utf8"));
		assert.match(pagina.OCR.texto, /BIBLIOTECA PDF/);
		assert.match(pagina.OCR.texto, /Prueba de lectura 2026/);
		// Coordenadas en unidades de pdf2json, dentro de la página.
		const [titulo] = pagina.OCR.lineas;
		assert.ok(titulo.x > 0 && titulo.x + titulo.w < pagina.Pages[0].Width);
		assert.ok(titulo.y > 0 && titulo.y + titulo.h < pagina.Pages[0].Height);

		assert.match(await readFile(await biblioteca.rutaPagina(ficha.id, 1, "xml"), "utf8"), /<OCR>[\s\S]*BIBLIOTECA PDF/);
		assert.equal((await biblioteca.leerOcr(ficha.id)).paginas[1].lineas.length, pagina.OCR.lineas.length);
		assert.equal((await biblioteca.listar("prueba lectura"))[0]?.id, ficha.id);
	} finally {
		await rm(carpeta, { recursive: true, force: true });
	}
});
