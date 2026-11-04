# Mi Compra

Asistente inteligente de compra familiar.

## Estado

Proyecto en fase de configuración inicial. La arquitectura funcional y técnica está definida; la implementación se realizará por fases y con validaciones antes de integrar cambios en `main`.

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
