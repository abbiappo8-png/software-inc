# Desplegar la versión web (Vercel + Supabase)

La versión web es la misma app, corriendo en el navegador, con los datos en **tu**
proyecto de Supabase (Postgres + almacenamiento de fotos/archivos). Se entra con el
**PIN** (que por debajo es la contraseña de un usuario de Supabase: seguridad real).

> **Importante antes de empezar**: al usar la versión web, los datos del negocio
> (clientes, pasaportes, emails, transacciones) vivirán en la nube de Supabase, en
> TU proyecto privado protegido por login. Es tu decisión de negocio. La app de
> escritorio sigue guardando todo localmente y **no comparte datos** con la web.

Necesitas: una cuenta gratis en [supabase.com](https://supabase.com) y otra en
[vercel.com](https://vercel.com) (entra con tu GitHub para poder importar el repo).

---

## 1. Crear el proyecto en Supabase (~5 min)

1. En [supabase.com](https://supabase.com) → **New project** (plan Free).
   - Nombre: `kite-addict` (o el que quieras). Región: `South America (São Paulo)`.
   - Guarda la contraseña de la base de datos donde quieras (no la usará la app).
2. Cuando el proyecto termine de crearse, ve a **SQL Editor** (menú izquierdo).
3. Abre el archivo [`supabase/schema.sql`](supabase/schema.sql) de este repo, copia
   TODO su contenido, pégalo en el editor y pulsa **RUN**.
   - Debe terminar en "Success". Esto crea todas las tablas, la seguridad (RLS) y
     los buckets `fotos` y `archivos`.

## 2. Crear el usuario del PIN

1. En Supabase → **Authentication → Users → Add user → Create new user**.
2. Email: el del negocio (ej. `kiteaddictcolombia@gmail.com`).
3. Password: **este será el PIN que se teclea para entrar a la web**.
   - Mínimo 6 caracteres. Recomendado: 8+ y no solo números (es una web en internet).
4. Marca **Auto Confirm User** (para no tener que verificar el email).

## 3. Conseguir las 3 claves para Vercel

En Supabase → **Settings → API**:

| Variable | Dónde está |
|---|---|
| `VITE_SUPABASE_URL` | "Project URL" (ej. `https://abcd1234.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | "Project API keys" → **anon public** |
| `VITE_SUPABASE_EMAIL` | El email del usuario que creaste en el paso 2 |

> La clave **anon** es pública por diseño (va en la página web); los datos los
> protege el login + RLS. La clave **service_role** es OTRA distinta: esa es
> secreta, solo se usa para el seed (paso 5) y **JAMÁS se sube al repo ni se
> comparte**.

## 4. Desplegar en Vercel (~5 min)

1. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el repo
   `abbiappo8-png/software-inc`.
2. Framework Preset: **Other**. Root Directory: la raíz del repo (déjala como está;
   `vercel.json` ya define build y salida).
3. En **Environment Variables** añade las 3 variables del paso 3.
4. **Deploy**. Al terminar te da la URL (ej. `https://software-inc.vercel.app`).
5. Abre la URL: debe salir la pantalla del PIN. Entra con el password del paso 2.
   La app estará vacía: los datos se cargan en el paso 5.

## 5. Cargar los datos del Excel (seed) — se hace UNA vez, desde este Mac

El script lee el Excel real (que está FUERA del repo) y sube todo a tu Supabase.
También sube `Archivos KITE ADDICT.xlsx` y `Precios_Kite Addict Colombia 2025.xlsx`
al bucket `archivos` (pestaña **Archivos** de la web).

1. Consigue la clave **service_role**: Supabase → Settings → API → "Project API
   keys" → `service_role` (pulsa "Reveal"). **No la compartas con nadie.**
2. Prueba primero SIN subir nada (dry-run, solo cuenta filas):

   ```bash
   cd "/Users/samuelcifuentesgutierrez/Desktop/software inc/software-inc-app"
   DRY_RUN=1 EXCEL="/Users/samuelcifuentesgutierrez/Desktop/software inc/software inc.xlsx" \
     ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
     scripts/seed-supabase-run.cjs
   ```

   Debe reportar ~708 personas, ~1.513 transacciones, ~546 gastos, etc.
3. Carga real (escribe el comando con un **espacio al inicio** para que la clave no
   quede en el historial de la terminal):

   ```bash
    cd "/Users/samuelcifuentesgutierrez/Desktop/software inc/software-inc-app" && \
    SUPABASE_URL="https://TU-PROYECTO.supabase.co" \
    SUPABASE_SERVICE_ROLE="PEGA_AQUI_LA_SERVICE_ROLE" \
    EXCEL="/Users/samuelcifuentesgutierrez/Desktop/software inc/software inc.xlsx" \
    ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
    scripts/seed-supabase-run.cjs
   ```

4. Al final el script imprime unas sentencias `select setval(...)`: cópialas y
   ejecútalas en el **SQL Editor** de Supabase (ajustan los contadores de ids).
5. Recarga la web: deben aparecer todos los clientes, transacciones, precios, el
   bar, los gastos y los dos Excel en la pestaña Archivos.

## 6. Entregar al cliente

- Pásale la **URL de Vercel** y el **PIN**. Nada que instalar; funciona en
  computador, tablet y celular.
- La cámara para fotos de clientes funciona (la web va por HTTPS).
- Para conectar el Google Forms de reservas: igual que en escritorio, en
  **Ajustes → Formularios de Google** (la web usa un proxy propio `/api/fetch-csv`).

## Qué NO hace la versión web (y sí el escritorio)

| Función | Web |
|---|---|
| PDF de factura/liquidación | Abre el diálogo de imprimir → "Guardar como PDF" |
| Envío de facturas por correo (SMTP) | No (usa la app de escritorio) |
| Importar el Excel desde la interfaz | No (se hace con el seed del paso 5) |
| Copias de seguridad manuales | No hacen falta (Supabase respalda su base) |

## Problemas comunes

- **"PIN incorrecto"** → el PIN es la contraseña del usuario de Supabase (paso 2).
  Se cambia en Authentication → Users → (usuario) → Reset password, o desde la
  propia app en Ajustes → Cambiar PIN.
- **Página en blanco** → faltan las 3 variables de entorno en Vercel (paso 4.3);
  añádelas y haz "Redeploy".
- **Entra pero no salen datos** → ¿corriste `schema.sql` (paso 1.3) y el seed
  (paso 5)? ¿La URL/anon key son del proyecto correcto?
- **Reservas Web no sincroniza** → la hoja debe estar "Publicada en la web" como
  CSV (Archivo → Compartir → Publicar en la web) y la URL debe ser de
  `docs.google.com`.
