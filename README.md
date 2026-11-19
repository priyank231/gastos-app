# Gastos del mes

PWA minimalista para registrar el **gasto real del dia a dia** frente a tu **plan mensual**. Sin servidor, sin cuentas:
los datos viven solo en el dispositivo (localStorage) y funciona sin conexion una vez cargada.

## Importar extracto del banco (modo individual)
Botón *Importar extracto del banco (PDF)* en Historial y en Ajustes. La app lee el PDF **en tu móvil**, clasifica cada movimiento y tú revisas y
corriges antes de importar:
| Tipo | Efecto |
|---|---|
| Gasto | A tus gastos, con categoría |
| Gasto compartido (pagaste tú) | Se crea en *Compartido* (pagó tu, 50/50). En tus gastos solo cuenta **tu parte** |
| Pago de/a pareja | Un Bizum o transferencia de tu pareja **no es ingreso**: es un *pago entre vosotros* y baja lo que te debe |
| Ingreso | A tus ingresos (nómina, dividendos...) |
| Inversión | Se anota aparte (*Invertido este mes*); invertir **no** es gastar ni resta del ahorro |
| Ignorar | Traspasos entre tus cuentas, etc. |
- **Lectura**: usa el texto del PDF si lo tiene; si es una imagen (p. ej. un PDF tachado o impreso), lo lee con OCR y **detecta solo si la página está girada**.
- **Comprobación de saldos**: cada fila se valida con la columna *Balance* del extracto (saldo anterior + importe = saldo). Lo que el OCR lee mal se recupera con esa cadena o se marca en naranja para revisar.
- **Aprende**: recuerda tus cambios por comercio (solo si todas las filas de ese comercio del extracto quedan igual). Revolut empieza como *Inversión* y se puede cambiar a *Gasto* por línea.
- **No duplica**: guarda una huella de cada movimiento y avisa si ya lo importaste o ya hay uno igual ese día.
- **Neto**: en Resumen, "Compartido (mi parte)" se suma a tus gastos (se puede apagar en Ajustes).
- **Soporte actual**: extractos de **Trade Republic** (probado con un extracto real leído por OCR: 44 movimientos, todos cuadran con los saldos). Otros bancos (imagin...) necesitan un PDF de muestra para añadir su lector.
- Los PDF **no se suben a ningún sitio** y `*.pdf` está en `.gitignore` (los extractos llevan IBAN y nombres).

## Lectura de tickets (en los dos modos)
Haz una foto al ticket y la app **intenta leer importe, fecha, local y categoría** y rellena el formulario. Lo leído se marca (borde azul) y
siempre lo revisas antes de guardar; si no se puede leer, lo rellenas a mano.
- **Individual**: botón *Escanear ticket* (la foto solo se usa para leer, no se guarda).
- **Compartido**: la foto se guarda con el gasto, se lee sola al añadirla (se puede desactivar en Ajustes) y hay botón *Leer el ticket* para repetirlo.
- Se lee **en el móvil** (Tesseract.js + idioma español): la foto no se envía a ningún sitio. La primera vez descarga el lector (~7 MB, necesita conexión) y después queda en caché.
- Es una ayuda, no magia: con fotos movidas, arrugadas o con poca luz se equivoca. Prueba hecha con un ticket sintético limpio (importe, fecha, local y categoría correctos); las fotos reales rinden peor.

## Dos modos (se pregunta al abrir)
- **Individual**: tus gastos, privados, solo en tu movil (lo de abajo).
- **Compartido** (tipo Splitwise para dos): gastos con **lugar/local, quien pago, reparto (mitad, todo para el otro u otro %), fecha, nota y foto del ticket**;
  saldo total ("te debe X" / "le debes X"), totales por **semana, mes o todo**, y **pagos entre vosotros** para liquidar.
  Sin servidor: cada uno guarda su copia y os pasais un archivo (WhatsApp, Archivos...) que se **fusiona sin duplicar** (gana la edicion mas reciente; los borrados tambien viajan).
  Exporta tambien CSV con fechas y local para Excel. Las fotos se guardan comprimidas en cada movil y van dentro del archivo si lo eliges.

### Como empezar el modo compartido
1. **Tu**: Compartido -> pon vuestros nombres -> Crear grupo -> Saldo -> *Enviar para fusionar* y mandaselo.
2. **Tu pareja**: Compartido -> *Unirte con su archivo* (NO crea otro grupo). Desde ahi, "yo" es ella automaticamente.
3. Cada cierto tiempo (fin de semana o mes): cada uno exporta y el otro importa (Ajustes -> *Recibir de tu pareja*). Reimportar el mismo archivo no duplica nada.
4. Si no se pueden abrir archivos (por ejemplo, llegan por WhatsApp): **Copiar texto** (sin fotos) y **pegarlo** en Ajustes -> *Recibir*. Acepta el texto aunque venga con frases alrededor.

## Que hace (modo individual)
- **Boton +** con tres pestanas: **Gasto**, **Ingreso extra** (paga extra, regalos...) y **Aportacion** a un objetivo de ahorro (p. ej. "Viaje", tu eliges importe, fecha y objetivo).
- **Resumen**: cuanto te queda del mes, ritmo (dentro / por encima), gasto por dia disponible, barra por categoria con aviso de superado.
- **Ahorro**: ahorro del mes (ingresos incluidos los extra - gastos reales) y **promedio mensual** sobre meses completos (el mes en curso no cuenta; se puede fijar desde que mes contar).
- **Objetivos de ahorro**: total aportado y barra si defines una meta.
- **Grandes pagos** (seguro, ITV, vacaciones...): eliges repartirlos **en 12 meses, en 6 o solo en el mes del pago**, y si se repiten cada anio. La app te dice cuanto apartar al mes.
- **Historial** del mes con gastos, ingresos y aportaciones; editar, borrar y deshacer.
- **Importar tu Excel** (hoja `Gastos`): varios pagos al anio -> media mensual; un pago anual -> gran pago repartido segun tu columna "Prorratear"; "Solo en el anio" -> pago de ese mes.
- **Categorías editables**: en Ajustes renombras una categoría (se actualiza en todos sus gastos, grandes pagos y reglas) o la borras eligiendo a cuál se mueven sus gastos (con *Deshacer*). El presupuesto mensual de cada una se guarda al escribir.

## Cambio de móvil y copias
- **Copia completa** (Ajustes): UN archivo con todo — modo individual, modo compartido (grupo, quién eres tú, movimientos), fotos de tickets y ajustes. En el móvil nuevo: Ajustes -> *Restaurar copia completa*. También restaura las copias antiguas del modo individual.
- **CSV (Excel)**: tus movimientos (gastos, ingresos, aportaciones, inversiones) con columnas en español (`Fecha;Mes;Tipo;Categoría u objetivo;Concepto;Importe (€)`), separador `;` y coma decimal para que Excel en español lo abra bien. Los gastos, aportaciones e inversiones llevan el importe en negativo. La app también puede **importar ese mismo CSV** (no duplica lo ya existente), pero no lleva presupuestos ni grandes pagos: para eso usa la copia completa.
- El modo Compartido tiene su propio CSV (`Fecha;Local;Categoría;Pagado por;Importe (€);...`) y su archivo para fusionar con tu pareja.
- La app avisa si llevas más de 30 días sin copia completa.

## Como se calcula
- Presupuesto del mes = media mensual por categoria + parte que toca apartar de cada gran pago.
- Ahorro del mes = sueldo + ingresos extra - gastos reales. Las aportaciones a objetivos no restan (es dinero ahorrado).
- "Libre tras plan e inversion" = ingresos - presupuesto - inversion mensual (campo opcional en Ajustes).

## Privacidad
- Ningun dato sale del dispositivo. Este repo NO contiene datos personales ni tu Excel (`*.xlsx` esta en `.gitignore`).
- La importacion de Excel carga SheetJS 0.18.5 desde cdnjs solo cuando pulsas importar. Esa version tiene una vulnerabilidad
  conocida con archivos Excel maliciosos: importa **solo archivos tuyos**.

## Uso en el movil (iPhone)
1. En **Safari** abre la URL publicada -> **Compartir** -> **Anadir a pantalla de inicio**.
2. Abre la app desde el icono y configura todo DENTRO de ella (los datos de Safari y los de la app instalada son independientes).

## Desarrollo
```
npm test                     # logica pura (core.js) con node --test
python -m http.server 8099   # y abre http://127.0.0.1:8099
```
Estructura: `core.js`, `shared.js`, `ticket.js` y `statement.js` (lógica, probadas) · `app.js` (individual) · `shared-ui.js` (compartido) · `ui.js` · `ocr.js` (lector de tickets) · `pdfread.js` (PDF/OCR) · `import-ui.js` (extractos) · `photos.js` (IndexedDB) · `sw.js` (offline, red primero) · `styles.css` · `index.html`.
Los datos antiguos (v1) se migran solos al abrir la nueva version.

## Limitaciones
- **Compartido no es en tiempo real**: hay que intercambiar archivos. Si los dos editan el MISMO gasto antes de fusionar, gana la edicion mas reciente segun el reloj de cada movil.
- La lectura de tickets y de PDF necesita conexión la primera vez (lector ~7 MB + visor de PDF) y es aproximada.
- Extractos: solo Trade Republic por ahora; un PDF con texto real de Trade Republic no se ha probado (solo uno en imagen).
- Las categorias del modo compartido son fijas (Super, Comida fuera, Casa, Ocio, Viajes, Otros).
- Los datos estan atados a UN dispositivo/navegador: si borras los datos del sitio, se pierden. Haz una copia completa de vez en cuando.
- No sincroniza entre movil y PC.
- Los grandes pagos no son una "hucha" real con saldo: solo reparten el presupuesto mensual.
- Las aportaciones a objetivos no se restan cuando gastas ese dinero (p. ej. el viaje): son un contador de lo apartado.
