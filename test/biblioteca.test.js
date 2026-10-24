import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Biblioteca, dividirEnPaginas } from "../src/biblioteca.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PDF_EJEMPLO = path.join(RAIZ, "vendor", "pdf2json", "test", "pdf", "fd", "form", "F1040EZ.pdf");
const sinPdf2json = !existsSync(path.join(RAIZ, "vendor", "pdf2json", "dist", "pdfparser.js"));

test("agrega un PDF, lo busca, regenera el XML y lo elimina", { skip: sinPdf2json && "falta ejecutar npm run preparar" }, async () => {
	const carpeta = await mkdtemp(path.join(tmpdir(), "biblioteca-"));
	try {
		const biblioteca = new Biblioteca(carpeta);
		const contenido = await readFile(PDF_EJEMPLO);

		const { ficha, duplicado } = await biblioteca.agregar(contenido, "Formulario 1040EZ.pdf");
		assert.equal(duplicado, false);
		assert.match(ficha.id, /^formulario-1040ez-[0-9a-f]{8}$/);
		assert.equal(ficha.paginas, 2);
		assert.equal(ficha.esFormulario, true);
		assert.ok(ficha.campos > 0);

		const json = JSON.parse(await readFile(biblioteca.ruta(ficha.id, "json"), "utf8"));
		assert.equal(json.Pages.length, 2);
		const xml = await readFile(biblioteca.ruta(ficha.id, "xml"), "utf8");
		assert.match(xml, /^<\?xml [^>]+\?>\n<PDF>\n {3}<Transcoder>pdf2json@/);
		assert.equal(xml.match(/<Pages>/g).length, 2);

		assert.equal((await biblioteca.agregar(contenido, "copia.pdf")).duplicado, true);
		assert.equal((await biblioteca.listar("privacy disclosure"))[0].id, ficha.id);
		assert.equal((await biblioteca.listar("palabra-que-no-existe")).length, 0);

		// Un JSON y un XML por página, con la misma forma que el documento completo.
		const pagina2 = JSON.parse(await readFile(await biblioteca.rutaPagina(ficha.id, 2, "json"), "utf8"));
		assert.deepEqual(Object.keys(pagina2), ["Transcoder", "Meta", "Pagina", "TotalPaginas", "Pages"]);
		assert.equal(pagina2.Pagina, 2);
		assert.deepEqual(pagina2.Pages, [json.Pages[1]]);
		const xmlPagina2 = await readFile(await biblioteca.rutaPagina(ficha.id, 2, "xml"), "utf8");
		assert.match(xmlPagina2, /<Pagina>2<\/Pagina>\n {3}<TotalPaginas>2<\/TotalPaginas>/);
		assert.equal(xmlPagina2.match(/<Pages>/g).length, 1);
		await assert.rejects(biblioteca.rutaPagina(ficha.id, 3, "json"), /La página 3 no existe/);
		await assert.rejects(biblioteca.rutaPagina(ficha.id, 1, "pdf"), /solo están en JSON o XML/);

		const { ficha: nueva, xml: compacto } = await biblioteca.regenerarXml(ficha.id, { raiz: "Formulario", sangria: null, atributos: ["/Formulario/Pages/Width"] });
		assert.match(compacto, /<Formulario><Transcoder>/);
		assert.match(compacto, /<Pages Width="[\d.]+">/);
		assert.ok(nueva.bytes.xml < ficha.bytes.xml);
		// Las mismas opciones se aplican al XML de cada página.
		assert.match(await readFile(await biblioteca.rutaPagina(ficha.id, 1, "xml"), "utf8"), /<Formulario><Transcoder>.*<Pagina>1<\/Pagina>.*<Pages Width="[\d.]+">/);

		// Si falta la carpeta de páginas (documentos agregados antes), se vuelve a generar.
		await rm(path.join(carpeta, ficha.id, "paginas"), { recursive: true });
		const archivos = await biblioteca.archivosPaginas(ficha.id);
		assert.deepEqual(archivos.map((a) => a.nombre), ["pagina-001.json", "pagina-001.xml", "pagina-002.json", "pagina-002.xml"]);

		assert.equal(await biblioteca.eliminar(ficha.id), true);
		assert.deepEqual(await biblioteca.listar(), []);
	} finally {
		await rm(carpeta, { recursive: true, force: true });
	}
});

test("divide en páginas conservando Transcoder y Meta", () => {
	const paginas = dividirEnPaginas({ Transcoder: "t", Meta: { Title: "x" }, Pages: [{ Width: 1 }, { Width: 2 }] });
	assert.deepEqual(paginas[1], { Transcoder: "t", Meta: { Title: "x" }, Pagina: 2, TotalPaginas: 2, Pages: [{ Width: 2 }] });
	assert.deepEqual(dividirEnPaginas({ Transcoder: "t", Meta: {} }), []);
});

test("rechaza archivos que no son PDF", async () => {
	const biblioteca = new Biblioteca(path.join(tmpdir(), "biblioteca-inexistente"));
	await assert.rejects(biblioteca.agregar(Buffer.from("hola"), "falso.pdf"), /no parece un PDF/);
});
