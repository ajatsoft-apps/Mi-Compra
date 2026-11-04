# Configuración de Supabase para Mi Compra

El proyecto Supabase está creado en la región UE (París). La aplicación utiliza Auth, PostgreSQL, RLS y Realtime.

## Variables de entorno

Configura estas variables tanto en local como en el proveedor donde publiques la PWA:

- `VITE_SUPABASE_URL`: URL del proyecto.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: clave publicable del proyecto.

Crea `.env.local` a partir de `.env.example`. No subas `.env.local` al repositorio. La clave publishable puede estar en el navegador; nunca uses una clave `service_role` o `secret` en Vite, GitHub o el bundle.

## Configuración de Auth en el Dashboard

1. Abre **Authentication → URL Configuration**.
2. Define **Site URL** como la URL canónica de la PWA que vayas a publicar.
3. Añade a **Redirect URLs** la URL de producción y los orígenes reales de desarrollo que utilices, por ejemplo `http://localhost:5173/**`. No añadas dominios genéricos que no controles.
4. En **Authentication → Sign In / Providers**, comprueba que Email está habilitado.
5. Mantén activada la confirmación de correo para producción. Supabase puede exigir confirmación antes del primer inicio de sesión; la pantalla de Mi Compra informa de ello.
6. Configura SMTP propio antes de distribuir la aplicación a usuarios reales. El SMTP predeterminado de Supabase tiene límites de entrega y no es un servicio de correo de producción.

El registro usa `emailRedirectTo: window.location.origin`; por eso el origen exacto desde el que se registra debe estar incluido en Redirect URLs. La aplicación no habilita proveedores sociales ni permite invitaciones por correo en esta fase.

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

- El cliente selecciona el primer hogar al que pertenece el usuario; no hay selector de varios hogares.
- Todavía no existe interfaz para invitar miembros. La política RLS impide que un usuario se asigne el rol owner.
- La resolución de conflictos es last-write-wins por marca temporal. No hay historial ni edición colaborativa campo a campo.
- La configuración de URL de producción y SMTP depende del dominio y proveedor de despliegue, que deben definirse en el Dashboard.
- No se debe considerar validado el flujo entre dispositivos hasta probarlo con dos cuentas reales en dos navegadores/dispositivos.

## Seguridad

- RLS está habilitado en todas las tablas expuestas.
- Los helpers SECURITY DEFINER están en el esquema no expuesto `private`, con `search_path` vacío y permisos restringidos.
- La RPC pública `create_household` es SECURITY INVOKER y delega en la función privada.
- Los datos de cada hogar se aíslan mediante políticas de pertenencia.
