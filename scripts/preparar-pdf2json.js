// Descarga (o actualiza) el fork de pdf2json en vendor/pdf2json y lo compila.
// pdf2json no publica la carpeta dist/ en el repositorio, por eso hay que compilarla.
//
// Uso: npm run preparar
// Para usar otro fork o rama: PDF2JSON_REPO=<url> PDF2JSON_RAMA=<rama> npm run preparar

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = path.join(RAIZ, "vendor", "pdf2json");
const REPO = process.env.PDF2JSON_REPO || "https://github.com/Mario55666/pdf2json.git";
const RAMA = process.env.PDF2JSON_RAMA || "master";

function ejecutar(comando, cwd = RAIZ) {
	console.log(`> ${comando}`);
	execSync(comando, { cwd, stdio: "inherit" });
}

if (existsSync(path.join(DESTINO, ".git"))) {
	ejecutar(`git fetch --depth 1 origin ${RAMA}`, DESTINO);
	ejecutar(`git reset --hard FETCH_HEAD`, DESTINO);
} else {
	ejecutar(`git clone --depth 1 --branch ${RAMA} ${REPO} "${DESTINO}"`);
}

// npm ci instala solo las herramientas de compilación (rollup, typescript); pdf2json no tiene dependencias en tiempo de ejecución.
ejecutar("npm ci --no-audit --no-fund", DESTINO);
ejecutar("npm run build", DESTINO);

const dist = path.join(DESTINO, "dist", "pdfparser.js");
if (!existsSync(dist)) {
	console.error(`No se generó ${dist}. Revisa los mensajes de compilación.`);
	process.exit(1);
}
console.log(`\npdf2json listo en ${path.relative(RAIZ, dist)}`);
