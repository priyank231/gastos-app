# Continuar el proyecto desde otro PC

## 1. Requisitos (una vez)
- Git y Node.js 18+ (para `npm test`). Python solo si quieres servir en local.
- Cuenta GitHub `priyank231`. Si pide login, usa el navegador o un token.

## 2. Descargar el proyecto
```
git clone https://github.com/priyank231/gastos-app.git
cd gastos-app
git config user.name "priyank231"
git config user.email "91554199+priyank231@users.noreply.github.com"
```
(El email noreply evita publicar tu Gmail en los commits.)

## 3. Comprobar que todo funciona
```
npm test                      # 63 tests de logica
python -m http.server 8099    # abre http://127.0.0.1:8099
```

## 4. Trabajar y publicar
```
git pull                      # antes de empezar
# ...cambios...
npm test
git add -A && git commit -m "Descripcion"
git push
```
GitHub Pages se actualiza solo en ~1-10 min: https://priyank231.github.io/gastos-app/
En el iPhone: Ajustes -> "Actualizar app" (o cierra y reabre la app).
Si cambias archivos, sube `VERSION` en `sw.js` y `APP_VERSION` en `ui.js`.

## 5. Con Claude Code en el otro PC
Abre la carpeta del repo y dile: "Lee README.md y CONTINUAR.md y sigue el proyecto".
Estado actual: v9 (individual, compartido, OCR de tickets, importar extracto Trade Republic, copia completa, Excel por periodo).

## 6. Pendientes
- Lector de extractos imagin (hace falta un PDF de muestra SIN IBAN ni nombres).
- Probar en iPhone real: camara, OCR, compartir a WhatsApp, Excel.
- PDF de Trade Republic con texto real (solo se probo uno en imagen).

## Importante
- Tus DATOS viven en el movil, no en git. Para cambiar de movil: Ajustes -> Copia completa.
- Nunca subas al repo extractos PDF, tu Excel ni copias de datos (`*.pdf`, `*.xlsx` estan en `.gitignore`).
