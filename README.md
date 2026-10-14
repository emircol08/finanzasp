# Mesada: control de mi mesada semanal (RD$)

Aplicación web instalable en el celular (PWA) para controlar la mesada semanal, los gastos, el ahorro y el cierre de cada domingo. Funciona sin internet una vez abierta por primera vez.

No usa servidor, base de datos ni dependencias: es HTML, CSS y JavaScript puro.

## Estructura

```
index.html            Página única de la app
css/app.css           Estilos (tema claro/oscuro automático, diseño móvil primero)
js/core.js            Lógica financiera pura: repartos, saldos, semanas, alertas, cierre, informe
js/store.js           Guardado en el dispositivo, exportar/importar copias
js/charts.js          Gráficos SVG sencillos
js/app.js             Pantallas e interacción
sw.js                 Service worker (funcionamiento sin conexión)
manifest.webmanifest  Datos para instalar la app (nombre, iconos)
tests/                Pruebas de los cálculos
```

## Probarla en la laptop

```bash
cd ~/emir && python3 -m http.server 8000
```

Abre http://localhost:8000.

## Instalarla en el celular

Para que el celular la instale como app, tiene que estar publicada en una dirección **https**. La opción gratuita más sencilla es GitHub Pages:

1. Crea una cuenta en github.com y un repositorio nuevo, por ejemplo `mesada`. Puede ser público; tus datos **no** se suben, solo el código.
2. Sube el contenido de esta carpeta al repositorio. Puedes arrastrar los archivos en “Add file → Upload files” o usar git.
3. En el repositorio, ve a **Settings → Pages → Build and deployment**, elige “Deploy from a branch”, rama `main` y carpeta `/ (root)`. Guarda.
4. En uno o dos minutos tendrás una dirección del tipo `https://TU-USUARIO.github.io/mesada/`.
5. En el **iPhone**, abre esa dirección en Safari y toca Compartir → **Añadir a pantalla de inicio**.
   En **Android**, ábrela en Chrome y toca ⋮ → **Instalar aplicación**.

Cuando cambies algo del código, sube el valor de `VERSION` en `sw.js` (por ejemplo `mesada-v2`) para que el celular descargue la versión nueva.

## Dónde se guardan los datos

- En el almacenamiento local (`localStorage`) del navegador **del dispositivo donde usas la app**, con la clave `mesada.data.v1`. Se guarda además una copia del estado anterior en `mesada.data.v1.prev`.
- Los datos nunca salen del teléfono. Los datos del celular y los de la laptop son independientes.
- La app pide al navegador almacenamiento persistente. Instalada en la pantalla de inicio, el sistema la trata como una app y no borra sus datos por inactividad.
- Se pierden si borras los datos de Safari/Chrome o desinstalas la app. Por eso conviene hacer una copia cada semana.

### Copia de seguridad

**Más → Copia de seguridad → Descargar copia (.json)**. En el celular se abre el menú de compartir: guárdala en Archivos/iCloud/Google Drive o envíatela por correo.
Para restaurarla o pasarla a otro dispositivo: **Más → Copia de seguridad → Elegir archivo de copia**. Antes de reemplazar nada, la app comprueba que el archivo sea válido y te pide confirmación.

## Pruebas

```bash
./tests/run.sh
```

Usa el motor JavaScriptCore que ya trae macOS, así que no hace falta instalar Node.js. También puedes abrir http://localhost:8000/tests/ con el servidor local en marcha.

## Cómo calcula

- Todo se guarda en centavos enteros, así que no hay errores de redondeo. Las fechas usan la hora local, con semanas de lunes 00:00 a domingo 23:59.
- Los saldos no se guardan: se recalculan cada vez a partir del historial de movimientos. Por eso, editar o borrar un gasto actualiza todas las semanas, saldos y estadísticas.
- **Cuentas:** tres presupuestos para gastar (Salidas, Personal y Reserva) y cuatro fondos separados (Ahorro líquido, Fondo para salidas, Objetivos personales e Inversiones). El “Disponible para gastar” solo suma los tres presupuestos.
- **Mesada:** al registrarla, el ahorro se separa en ese momento. Si es mayor que la habitual, el presupuesto no sube: el extra se reparte (70 % ahorro / 30 % objetivos, editable antes de confirmar). Si es menor, el plan de esa semana se reduce proporcionalmente (también editable). Las semanas anteriores no cambian.
- **Sobrantes:** lo que no gastas pasa a la semana siguiente en la misma categoría. Si una categoría queda en negativo, ese déficit también pasa y se descuenta la semana siguiente.
- **Cierre del domingo:** puedes mover el sobrante de la reserva al ahorro y el de salidas al fondo para salidas. Esto se registra como transferencias internas, no como gastos. Se puede reabrir la semana.
- **Transferencias entre fondos:** no cuentan como gasto ni como ingreso. Si sacas dinero del ahorro, cuenta como retiro.
