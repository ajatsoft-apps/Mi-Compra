# Mi Compra

Asistente inteligente de compra familiar.

## Estado

El frontend PWA dispone de lista local en IndexedDB, autenticación por correo, sincronización offline-first con Supabase Auth, PostgreSQL y Realtime, hogares compartidos, invitaciones y gestión de miembros. La fase 3 se desarrolla en `fase-3/gestion-familiar`, basada en `fase-5/backend-supabase`; requiere pruebas reales con varias cuentas antes de integrarla en `main`.

## Publicación de pruebas

La PWA se publica mediante GitHub Actions en [GitHub Pages](https://ajatsoft-apps.github.io/Mi-Compra/). El despliegue está vinculado a la rama `fase-5/backend-supabase`; no modifica `main`. Requiere configurar las variables de Actions y activar GitHub Pages con origen **GitHub Actions**. Consulta [la guía de Supabase y despliegue](docs/SUPABASE_SETUP.md).

## Objetivo

Centralizar una lista de compra familiar compartida y, progresivamente, incorporar catálogo de productos, preferencias, precios, promociones y comparación verificable entre supermercados.

## Plataformas

- Aplicación web progresiva (PWA) para navegador, móviles y tablets.
- Primera estrategia de distribución: PWA instalable.

## Stack previsto

- React + TypeScript
- Vite
- Tailwind CSS
- Zustand
- TanStack Query
- Supabase (PostgreSQL, Auth y Realtime)
- IndexedDB para soporte offline

## Principios

- Los precios deben tener fuente, fecha y nivel de confianza.
- La IA puede interpretar y clasificar, pero los cálculos económicos serán deterministas.
- Las preferencias familiares no se modificarán automáticamente por una compra aislada.
- Los secretos del backend nunca se incluirán en el cliente.

## Privacidad

Repositorio privado. La aplicación está concebida inicialmente para uso doméstico familiar.
