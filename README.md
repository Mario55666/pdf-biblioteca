# Biblioteca PDF → JSON → XML

Aplicativo local que:

1. **Extrae el JSON de un PDF** con [pdf2json](https://github.com/Mario55666/pdf2json) (tu fork, compilado desde GitHub).
2. **Lo guarda en una biblioteca** local junto con el PDF original, su texto plano y sus campos de formulario.
3. **Convierte ese JSON a XML** con la lógica de `JsonToXml` de [XmlToJson](https://github.com/smart-fun/XmlToJson) (incluidas sus opciones `forceAttribute` y `forceContent`).

Se usa desde el navegador (arrastrar y soltar PDFs, buscar, ver y descargar) o desde la terminal.

## Requisitos

- Node.js 22.23 o superior (probado con Node 24)
- Git

No necesita `npm install`: el aplicativo no tiene dependencias externas aparte de pdf2json.

## Instalación

```bash
npm run preparar
```

Clona tu fork `Mario55666/pdf2json` en `vendor/pdf2json` y lo compila (el repositorio no trae la carpeta `dist/`). Vuelve a ejecutarlo cuando actualices tu fork. Para usar otro repositorio o rama: `PDF2JSON_REPO=<url> PDF2JSON_RAMA=<rama> npm run preparar`.

## Uso en el navegador

```bash
npm start
```

Abre <http://localhost:8780> (otro puerto: variable `PUERTO`).

- **Biblioteca**: arrastra uno o varios PDF a la zona de carga. Cada uno pasa a la lista con su resumen y las pestañas *JSON*, *XML*, *Texto* y *PDF*. El buscador encuentra documentos por nombre, título, autor o cualquier palabra del texto.
- **Regenerar el XML**: en la pestaña *XML* cambia la etiqueta raíz, la sangría y las rutas `forceAttribute` / `forceContent`. El botón *Usar preset compacto pdf2json* convierte coordenadas, medidas y colores en atributos (cada línea, relleno o texto ocupa una sola etiqueta y el XML pesa cerca de un 30 % menos).
- **Conversor JSON → XML**: convierte cualquier JSON pegado o abierto desde un archivo, sin guardarlo en la biblioteca. Corre en el navegador.

## Uso en la terminal

```bash
npm run cli -- agregar factura.pdf carpeta-con-pdfs/
npm run cli -- listar
npm run cli -- listar palabra a buscar
npm run cli -- xml <id> --compacto --sangria 2
npm run cli -- json2xml datos.json datos.xml --atributo /owner/id --contenido /owner/name
npm run cli -- eliminar <id>
```

`npm run cli -- --ayuda` muestra todas las opciones. En Git Bash escribe las rutas sin la barra inicial (`owner/id`), porque Git Bash convierte `/owner/id` en una ruta de Windows; el aplicativo añade la barra.

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
```

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
src/biblioteca.js              guardar, listar, buscar, regenerar y eliminar documentos
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
| `PUT` | `/api/documentos/:id/xml` | Regenera el XML (cuerpo: `{"raiz", "sangria", "atributos", "contenido"}`) |

Ejemplo con curl:

```bash
curl -X POST -H "X-Nombre-Archivo: factura.pdf" --data-binary @factura.pdf http://localhost:8780/api/documentos
```

## Licencias

pdf2json y XmlToJson se distribuyen con licencia Apache 2.0. `src/jsonAXml.js` conserva el aviso de copyright de XmlToJson (Arnaud Guyon).
