# Configuración de Supabase para Mi Compra

El proyecto Supabase está creado en la región UE (París). La aplicación utiliza Auth, PostgreSQL, RLS y Realtime.

## Variables de entorno

Configura estas variables tanto en local como en el proveedor donde publiques la PWA:

- `VITE_SUPABASE_URL`: URL del proyecto.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: clave publicable del proyecto.

Crea `.env.local` a partir de `.env.example`. No subas `.env.local` al repositorio. La clave publishable puede estar en el navegador; nunca uses una clave `service_role` o `secret` en Vite, GitHub o el bundle.

## Publicación en GitHub Pages

La PWA se publica en:

`https://ajatsoft-apps.github.io/Mi-Compra/`

El workflow `.github/workflows/deploy-pages.yml` compila y publica automáticamente cada cambio que llegue a `fase-5/backend-supabase`. Para activarlo una primera vez:

1. En GitHub abre **Settings → Pages** del repositorio.
2. En **Build and deployment → Source**, selecciona **GitHub Actions**.
3. En **Settings → Secrets and variables → Actions → Variables**, crea:
   - `VITE_SUPABASE_URL`: URL del proyecto Supabase.
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: clave publishable (también puede guardarse como Secret).
4. Comprueba la ejecución en **Actions → Deploy PWA to GitHub Pages**. El despliegue se detiene expresamente si falta alguna de las dos variables.

No se debe añadir una clave `service_role` ni una clave secreta de Supabase. La clave publishable está diseñada para utilizarse en el cliente web.

## Configuración de Auth en el Dashboard

1. Abre **Authentication → URL Configuration**.
2. Define **Site URL** como `https://ajatsoft-apps.github.io/Mi-Compra/`.
3. Añade a **Redirect URLs** `https://ajatsoft-apps.github.io/Mi-Compra/**` y los orígenes reales de desarrollo que utilices, por ejemplo `http://localhost:5173/**`. No añadas dominios genéricos que no controles.
4. En **Authentication → Sign In / Providers**, comprueba que Email está habilitado.
5. Mantén activada la confirmación de correo para producción. Supabase puede exigir confirmación antes del primer inicio de sesión; la pantalla de Mi Compra informa de ello.
6. Configura SMTP propio antes de distribuir la aplicación a usuarios reales. El SMTP predeterminado de Supabase tiene límites de entrega y no es un servicio de correo de producción.

El registro redirige a la URL base de la aplicación (`import.meta.env.BASE_URL`), incluyendo `/Mi-Compra/` en GitHub Pages. Esa URL completa debe estar incluida en Redirect URLs para que la confirmación vuelva a la PWA y no a la raíz del dominio. La aplicación no habilita proveedores sociales ni permite invitaciones por correo en esta fase.

## Flujo implementado

- Registro e inicio de sesión con correo y contraseña.
- Recuperación de la sesión persistida por Supabase Auth.
- Al primer inicio de sesión se crea un hogar y una lista si el usuario aún no pertenece a ninguno.
- Si ya pertenece a un hogar, se recupera su lista compartida.
- Los productos locales se fusionan con los remotos. Los registros nuevos reciben UUID.
- Los cambios se guardan primero en IndexedDB y se envían a Supabase cuando hay conexión.
- Los borrados se conservan como marcas `deleted_at`, no como borrados físicos.
- Realtime actualiza la lista cuando otro dispositivo cambia productos.
- Al recuperar la conexión, se reintenta la sincronización.

## Límites conocidos de esta fase

- La interfaz mantiene un hogar activo por dispositivo. Si una cuenta pertenece a varios hogares, se incorpora al hogar del código aceptado más recientemente; todavía no existe selector visual entre hogares.
- La gestión familiar permite crear y aceptar invitaciones, consultar miembros, revocar invitaciones propias (o cualquiera como propietario), retirar miembros como propietario y transferir la propiedad. La transferencia mantiene al propietario anterior como miembro.
- La resolución de conflictos es last-write-wins por marca temporal. No hay historial ni edición colaborativa campo a campo.
- La configuración de URL de producción y SMTP depende del dominio y proveedor de despliegue, que deben definirse en el Dashboard.
- No se debe considerar validado el flujo entre dispositivos hasta probarlo con dos cuentas reales en dos navegadores/dispositivos.

## Gestión familiar

- Los códigos de invitación son aleatorios, se almacenan como hash y caducan a los 7 días; cada código admite hasta 10 incorporaciones.
- La lista de miembros muestra correo, rol y fecha de incorporación, solo a otros miembros del mismo hogar.
- Solo el propietario puede retirar a otros miembros o transferir la propiedad. No puede retirarse a sí mismo desde esa acción; debe usar «Desvincular cuenta».
- Al retirar a un miembro también se revocan sus invitaciones pendientes.
- El propietario puede transferir el rol a un miembro existente. El propietario anterior continúa como miembro.
- Un miembro puede revocar las invitaciones que creó; el propietario puede revocar cualquiera.

## Seguridad

- RLS está habilitado en todas las tablas expuestas.
- Los helpers SECURITY DEFINER están en el esquema no expuesto `private`, con `search_path` vacío y permisos restringidos.
- La RPC pública `create_household` es SECURITY INVOKER y delega en la función privada.
- Los datos de cada hogar se aíslan mediante políticas de pertenencia.


## Catálogo, preferencias y compras

La fase 6 añade estas tablas, todas con RLS y publicación Realtime:

- `household_products`: catálogo privado de cada hogar con nombre, marca, código EAN/GTIN, formato, unidad, categoría y notas. Los productos se archivan para conservar referencias.
- `household_product_preferences`: marca y formato preferidos y aceptación de sustitutos.
- `household_product_equivalences`: relaciones explícitas de mismo producto o sustituto aceptado.
- `purchase_history`: instantáneas de compras realizadas, cantidades, precios pagados y establecimiento.
- `shopping_list_items.catalog_product_id`: referencia opcional al producto del catálogo del mismo hogar.

El rol `anon` y el rol `public` no tienen privilegios sobre estas tablas; las operaciones se reservan a usuarios autenticados y las políticas RLS limitan cada fila a miembros del hogar. Las claves foráneas compuestas impiden enlazar productos de hogares diferentes.

La pantalla Catálogo aparece cuando la cuenta está conectada a un hogar remoto. Permite crear, editar y archivar productos; configurar preferencias y sustitutos; añadir productos a la lista; y registrar compras. La caché local permite consultar los productos ya descargados y añadirlos a la lista sin conexión. Las modificaciones del catálogo y el registro de compras requieren conexión.

El historial registra importes realmente pagados y no representa precios actuales de supermercado. La fase de fuentes de precios y promociones es posterior y debe mantener fuente, fecha y nivel de confianza.
