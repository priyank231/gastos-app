# Gastos del mes

PWA minimalista para registrar el **gasto real del dia a dia** frente a tu **plan mensual**. Sin servidor, sin cuentas:
los datos viven solo en el dispositivo (localStorage) y funciona sin conexion una vez cargada.

## Que hace
- **Resumen**: cuanto te queda del mes, ritmo (dentro / por encima), gasto por dia disponible, y barra por categoria con aviso de superado.
- **Anadir gasto** en 3 toques (importe, categoria, guardar). Editar, borrar y **deshacer**.
- **Historial** del mes agrupado por dia.
- **Plan**: presupuesto mensual por categoria, ingreso e inversion. Gastos puntuales (p. ej. un viaje) cuentan solo en su mes.
- **Importar tu Excel** (hoja `Gastos`): media mensual = importe x pagos / 12; filas con "Solo en el anio" son puntuales.
- **Copias**: exportar CSV / JSON y restaurar.

## Privacidad
- Ningun dato sale del dispositivo. Este repo NO contiene datos personales ni tu Excel (`*.xlsx` esta en `.gitignore`).
- La importacion de Excel carga SheetJS 0.18.5 desde cdnjs solo cuando pulsas importar. Esa version tiene una vulnerabilidad
  conocida con archivos Excel maliciosos: importa **solo archivos tuyos**.

## Uso en el movil
1. Publica la carpeta (GitHub Pages o cualquier hosting estatico con HTTPS) o sirvela en tu red local.
2. Abre la URL en el movil -> menu del navegador -> **Instalar app / Anadir a pantalla de inicio**.
3. Ajustes -> importa tu Excel o escribe los presupuestos.

## Desarrollo
```
npm test            # logica pura (core.js) con node --test
python -m http.server 8099   # y abre http://127.0.0.1:8099
```
Estructura: `core.js` (logica, probada) · `app.js` (interfaz) · `sw.js` (offline, red primero) · `styles.css` · `index.html`.

## Limitaciones
- Los datos estan atados a UN navegador/dispositivo: si borras los datos del sitio, se pierden. Haz copia JSON de vez en cuando.
- No sincroniza entre movil y PC.
- Presupuesto por categoria = media mensual; no reproduce la "hucha" ni la proyeccion de inversion del Excel.
