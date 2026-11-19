# Gastos del mes

PWA minimalista para registrar el **gasto real del dia a dia** frente a tu **plan mensual**. Sin servidor, sin cuentas:
los datos viven solo en el dispositivo (localStorage) y funciona sin conexion una vez cargada.

## Que hace
- **Boton +** con tres pestanas: **Gasto**, **Ingreso extra** (paga extra, regalos...) y **Aportacion** a un objetivo de ahorro (p. ej. "Viaje", tu eliges importe, fecha y objetivo).
- **Resumen**: cuanto te queda del mes, ritmo (dentro / por encima), gasto por dia disponible, barra por categoria con aviso de superado.
- **Ahorro**: ahorro del mes (ingresos incluidos los extra - gastos reales) y **promedio mensual** sobre meses completos (el mes en curso no cuenta; se puede fijar desde que mes contar).
- **Objetivos de ahorro**: total aportado y barra si defines una meta.
- **Grandes pagos** (seguro, ITV, vacaciones...): eliges repartirlos **en 12 meses, en 6 o solo en el mes del pago**, y si se repiten cada anio. La app te dice cuanto apartar al mes.
- **Historial** del mes con gastos, ingresos y aportaciones; editar, borrar y deshacer.
- **Importar tu Excel** (hoja `Gastos`): varios pagos al anio -> media mensual; un pago anual -> gran pago repartido segun tu columna "Prorratear"; "Solo en el anio" -> pago de ese mes.
- **Copias**: exportar CSV / JSON y restaurar.

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
Estructura: `core.js` (logica, probada) · `app.js` (interfaz) · `sw.js` (offline, red primero) · `styles.css` · `index.html`.
Los datos antiguos (v1) se migran solos al abrir la nueva version.

## Limitaciones
- Los datos estan atados a UN dispositivo/navegador: si borras los datos del sitio, se pierden. Haz copia JSON de vez en cuando.
- No sincroniza entre movil y PC.
- Los grandes pagos no son una "hucha" real con saldo: solo reparten el presupuesto mensual.
- Las aportaciones a objetivos no se restan cuando gastas ese dinero (p. ej. el viaje): son un contador de lo apartado.
