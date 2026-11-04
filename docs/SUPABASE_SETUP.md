# Preparación de Supabase

La aplicación utiliza Supabase para cuentas familiares, PostgreSQL y sincronización Realtime. El cliente ya está preparado para leer únicamente estas variables públicas:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Crear y conectar el proyecto

1. Crear un proyecto Supabase en una región de la Unión Europea.
2. Copiar la Project URL y la clave pública anon/publishable desde la configuración de API del proyecto.
3. Crear un archivo local `.env.local` a partir de `.env.example` y rellenar esas dos variables.
4. Aplicar la migración `supabase/migrations/202611040001_households_shopping.sql`.
5. Verificar las políticas RLS con dos usuarios de prueba pertenecientes a hogares distintos antes de activar la sincronización.

La clave pública anon/publishable está diseñada para utilizarse desde el navegador siempre que las tablas estén protegidas por RLS. **No copiar nunca la clave `service_role` al proyecto web, al repositorio ni a `.env.local`.** Esa clave omite las políticas RLS y solo debe existir en un entorno backend privado.

## Estado de esta fase

El cliente Supabase está preparado, pero no se crea una conexión mientras falten las variables. La migración SQL está versionada, pero no se considera aplicada hasta ejecutarla en el proyecto real y comprobar las políticas.

El método de acceso familiar (contraseña o enlace/código por correo) se decidirá antes de construir el flujo de registro e invitaciones. No se habilita un registro público por defecto.
