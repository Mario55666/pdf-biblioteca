# Biblioteca PDF → JSON → XML

Aplicativo local que:

1. **Extrae el JSON de un PDF** con [pdf2json](https://github.com/Mario55666/pdf2json) (tu fork, compilado desde GitHub).
2. **Lo guarda en una biblioteca** local junto con el PDF original, su texto plano y sus campos de formulario.
3. **Convierte ese JSON a XML** con la lógica de `JsonToXml` de [XmlToJson](https://github.com/smart-fun/XmlToJson) (incluidas sus opciones `forceAttribute` y `forceContent`).
4. **Separa el JSON y el XML por páginas**: además del documento completo, guarda un JSON y un XML por cada página.
5. **Lee con OCR las páginas sin texto** (portadas, anuncios o páginas escaneadas que son solo una imagen) con Tesseract, sin conexión, y lo guarda en el JSON y el XML de esas páginas.

Se usa desde el navegador (arrastrar y soltar PDFs, buscar, ver y descargar) o desde la terminal.

## Requisitos

- Node.js 22.23 o superior (probado con Node 24)
- Git

## Instalación

```bash
npm install
```

```bash
npm run preparar
```

`npm install` instala el OCR: [tesseract.js](https://github.com/naptha/tesseract.js) (Tesseract compilado a WebAssembly), los idiomas español e inglés, y [pdf.js](https://github.com/mozilla/pdf.js) con [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) para convertir las páginas en imagen. Después el OCR funciona sin conexión.

`npm run preparar` clona tu fork `Mario55666/pdf2json` en `vendor/pdf2json` y lo compila (el repositorio no trae la carpeta `dist/`). Vuelve a ejecutarlo cuando actualices tu fork. Para usar otro repositorio o rama: `PDF2JSON_REPO=<url> PDF2JSON_RAMA=<rama> npm run preparar`.

## Uso en el navegador

```bash
npm start
```

Abre <http://localhost:8780> (otro puerto: variable `PUERTO`).

- **Biblioteca**: arrastra uno o varios PDF a la zona de carga. Cada uno pasa a la lista con su resumen y las pestañas *JSON*, *XML*, *Texto* y *PDF*. El buscador encuentra documentos por nombre, título, autor o cualquier palabra del texto.
- **Por páginas**: en las pestañas *JSON* y *XML* el selector cambia entre *Documento completo* y cada página (la página elegida es la misma en las dos pestañas). *Descargar* baja lo que estás viendo y *Todas las páginas (.zip)* baja un archivo por página en un ZIP. En *Resumen* hay un ZIP con los JSON y los XML de todas las páginas.
- **Regenerar el XML**: en la pestaña *XML* cambia la etiqueta raíz, la sangría y las rutas `forceAttribute` / `forceContent`; se regeneran el XML completo y el de cada página. El botón *Usar preset compacto pdf2json* convierte coordenadas, medidas y colores en atributos (cada línea, relleno o texto ocupa una sola etiqueta y el XML pesa cerca de un 30 % menos).
- **OCR**: al subir un PDF, las páginas sin texto se leen con OCR en segundo plano; en *Resumen* se ve el avance y el resultado, y el botón *Aplicar OCR* / *Repetir OCR* lo lanza a mano (por ejemplo, en documentos agregados antes de esta función). Las páginas con OCR aparecen como «· con OCR» en el selector de página, y la pestaña *Texto* añade al final lo leído.
- **Conversor JSON → XML**: convierte cualquier JSON pegado o abierto desde un archivo, sin guardarlo en la biblioteca. Corre en el navegador.

## OCR de las páginas sin texto

pdf2json solo extrae el texto que el PDF guarda como texto. Si una página es una imagen (una portada fotografiada, un anuncio, un escaneo), su JSON sale con `Texts: []`. Para esas páginas el aplicativo:

1. dibuja la página como imagen con pdf.js (3200 px de lado mayor),
2. la lee con Tesseract en modo de segmentación automático, que separa titulares, columnas y recuadros,
3. descarta las líneas con menos de 60 % de confianza o sin letras (Tesseract también «lee» texturas de las fotos),
4. guarda el resultado en `ocr.json` y en la clave `OCR` del JSON y el XML de cada página leída.

```json
"OCR": {
  "motor": "tesseract.js 7.0.0",
  "idiomas": "spa+eng",
  "confianza": 84,
  "texto": "BACKWOODS GUIDE\n\nTO SELF RELIANCE\n\n> SURVIVAL SNARES\n…",
  "lineas": [ { "texto": "TO SELF RELIANCE", "confianza": 95, "x": 36.4, "y": 3.6, "w": 10.8, "h": 1.1 } ]
}
```

Las coordenadas de cada línea están en las mismas unidades que pdf2json usa en `Texts`, así se pueden ubicar sobre la página. El OCR no inventa: lo que no puede leer lo deja fuera, y una foto sin texto queda sin líneas. Con letras muy decoradas o texto sobre fotos puede equivocarse en algunas palabras; revisa la confianza de cada línea.

Los idiomas por defecto son español e inglés (`spa+eng`). Para otros, instala su paquete (`npm install @tesseract.js-data/fra`) y usa `--idiomas spa+fra` en la terminal o la variable `OCR_IDIOMAS=spa+fra` al iniciar el servidor.

## Uso en la terminal

```bash
npm run cli -- agregar factura.pdf carpeta-con-pdfs/
npm run cli -- listar
npm run cli -- listar palabra a buscar
npm run cli -- xml <id> --compacto --sangria 2
npm run cli -- paginas <id>
npm run cli -- ocr <id> --idiomas spa+eng
npm run cli -- json2xml datos.json datos.xml --atributo /owner/id --contenido /owner/name
npm run cli -- eliminar <id>
```

`agregar` lee con OCR las páginas sin texto al terminar (añade `--sin-ocr` para omitirlo). `ocr` lo aplica o lo repite; sin id, lo hace en los documentos que aún no lo tienen. `paginas` vuelve a separar por página un documento (o todos, si no indicas id); normalmente no hace falta porque se hace al agregar el PDF, y en los documentos agregados antes de esta función se hace sola la primera vez que se pide una página. `npm run cli -- --ayuda` muestra todas las opciones. En Git Bash escribe las rutas sin la barra inicial (`owner/id`), porque Git Bash convierte `/owner/id` en una ruta de Windows; el aplicativo añade la barra.

## Dónde se guarda todo

```
biblioteca/
  <id>/                  ej. factura-marzo-3fa9c2d1 (nombre + huella del contenido)
    ficha.json           metadatos: título, autor, páginas, tamaños, opciones del XML…
    original.pdf         el PDF tal como se subió
    documento.json       el JSON extraído por pdf2json
    documento.xml        ese JSON convertido a XML
    texto.txt            el texto plano del PDF
    campos.json          los campos de formulario (vacío si no es un formulario)
    ocr.json             el texto leído con OCR en las páginas sin texto
    paginas/
      pagina-001.json    el JSON de la página 1 (con la clave OCR si se leyó con OCR)
      pagina-001.xml     el XML de la página 1
      pagina-002.json    …y así con cada página
```

Cada `pagina-NNN.json` tiene la misma forma que la salida de pdf2json, pero con una sola página en `Pages`, más el número de página y el total:

```json
{ "Transcoder": "…", "Meta": { … }, "Pagina": 2, "TotalPaginas": 4, "Pages": [ { "Width": 38.25, … } ] }
```

Por eso las mismas rutas de `forceAttribute` y `forceContent` (por ejemplo `/PDF/Pages/Texts/x`) sirven para el XML completo y para el de cada página.

Para guardar la biblioteca en otra carpeta (Dropbox, el NAS…), define la variable `BIBLIOTECA_DIR`. Si subes un PDF que ya está (mismo contenido aunque tenga otro nombre), no se duplica.

## Cómo se convierte a XML

El JSON de pdf2json tiene tres claves en la raíz (`Transcoder`, `Meta`, `Pages`) y un XML admite una sola raíz, así que se envuelve en `<PDF>` (configurable). Luego se aplican las reglas de `JsonToXml`:

| JSON | XML |
|---|---|
| `{"owner": {"id": 124, "name": "John Doe"}}` | `<owner><id>124</id><name>John Doe</name></owner>` |
| con `forceAttribute("/owner/id")` | `<owner id="124"><name>John Doe</name></owner>` |
| y además `forceContent("/owner/name")` | `<owner id="124">John Doe</owner>` |
| arreglos: `{"TS": [0, 10]}` | `<TS>0</TS><TS>10</TS>` |

Las rutas usan los nombres de las claves del JSON y atraviesan los arreglos sin índice: `/PDF/Pages/Texts/x` es la `x` de cada texto de cada página.

XmlToJson es una librería de Android (Java), así que no puede ejecutarse en Node. `src/jsonAXml.js` es un port fiel de su clase `JsonToXml`, con la misma API (`new JsonToXml.Builder(json).forceAttribute(…).forceContent(…).build().toFormattedString(3)`) y estos ajustes para que el XML siempre sea válido:

- Los nombres que no son válidos en XML se sanean con `_` (`dc:title` → `dc_title`, `2col` → `_2col`).
- Un `null` de JSON se escribe como elemento vacío en lugar del texto `null`.
- Se eliminan los caracteres prohibidos en XML 1.0.

## Estructura del código

```
scripts/preparar-pdf2json.js   clona y compila el fork de pdf2json
src/pdfAJson.js                PDF → JSON (pdf2json)
src/jsonAXml.js                JSON → XML (port de XmlToJson/JsonToXml)
src/presets.js                 rutas del preset compacto para pdf2json
src/biblioteca.js              guardar, listar, buscar, separar por páginas, regenerar y eliminar documentos
src/zip.js                     crea los ZIP de páginas (sin dependencias)
src/ocr.js                     OCR sin conexión: pdf.js dibuja la página y tesseract.js la lee
src/servidor.js                servidor web local y API REST
src/cli.js                     comandos de terminal
public/                        interfaz web
test/                          pruebas (npm test)
```

## API

El servidor escucha solo en este equipo (127.0.0.1).

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/documentos?q=texto` | Lista y busca documentos |
| `POST` | `/api/documentos` | Agrega un PDF (cuerpo: bytes del PDF; cabecera `X-Nombre-Archivo`) |
| `GET` | `/api/documentos/:id` | Ficha del documento |
| `DELETE` | `/api/documentos/:id` | Elimina el documento |
| `GET` | `/api/documentos/:id/{pdf,json,xml,texto,campos}` | Descarga un archivo (`?descargar=1`) |
| `PUT` | `/api/documentos/:id/xml` | Regenera el XML completo y por página (cuerpo: `{"raiz", "sangria", "atributos", "contenido"}`) |
| `POST` | `/api/documentos/:id/ocr` | Aplica (o repite) el OCR en segundo plano; el avance queda en `ficha.ocr` |
| `GET` | `/api/documentos/:id/ocr` | El resultado del OCR (`ocr.json`) |
| `GET` | `/api/documentos/:id/paginas/:n/{json,xml}` | JSON o XML de la página `n` (`?descargar=1`) |
| `GET` | `/api/documentos/:id/paginas/zip?tipo=json\|xml\|todo` | Todas las páginas en un ZIP |

Ejemplo con curl:

```bash
curl -X POST -H "X-Nombre-Archivo: factura.pdf" --data-binary @factura.pdf http://localhost:8780/api/documentos
```

## Licencias

pdf2json, XmlToJson, tesseract.js (y los datos de idioma de Tesseract) y pdf.js se distribuyen con licencia Apache 2.0; @napi-rs/canvas, con licencia MIT. `src/jsonAXml.js` conserva el aviso de copyright de XmlToJson (Arnaud Guyon).
