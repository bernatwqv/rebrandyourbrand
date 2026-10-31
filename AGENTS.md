# AGENTS.md — rebrandyourbrand

Reglas para agentes de código (Antigravity, Claude, Gemini…). Léelas antes de tocar nada.
**La fuente de verdad es el código real de `index.html`.** Si algo de este archivo lo contradice, avisa al usuario en lugar de "corregir" el sitio.

---

## 1. Proyecto

- **Qué es:** rebrandyourbrand.es, estudio de rebranding y web para negocios. Promesa: *"tu negocio es mejor de lo que parece"*. Servicios sueltos, precio cerrado, pago único, sin cuotas mensuales.
- **Cliente:** exclusivamente B2B (empresas y autónomos). Sin derecho de desistimiento de consumidor. Ley española; tribunales de Barcelona.
- **Servicios y precios actuales:** logotipo 400 € (incluye paleta de empresa de regalo), paleta de empresa 100 € (0 € si se contrata el logotipo), web 400 €. Rondas de revisión o cambios extra: 100 € fijos por ronda.
- **Equipo:** Gael Domènech (dirección de arte y diseño visual) y Bernat Domènech (web).
- **Idiomas:** español (principal), catalán, inglés y euskera.
- **Voz de marca:** cercana y directa, tutea, frases cortas, beneficio claro, cero jerga técnica. Titulares en minúscula (clase `lowercase`). Nunca prometas lo que el servicio no incluye.

## 2. Reglas de edición (obligatorias)

- **NUNCA reescribas un archivo entero.** Aplica cambios mínimos (diffs). `index.html` es grande: localiza por `id`, `data-i18n` o comentario.
- **NUNCA borres comentarios de configuración** (p. ej. `<!-- EDITA: ... -->`) ni omitas código con `// resto del código igual`.
- **Pide confirmación antes de cambiar:** precios, textos legales o de términos, la CSP, el dominio de la API, o la lógica de verificación y pagos.
- **Un cambio por tarea.** No refactorices "de paso".
- **Sin dependencias nuevas** ni scripts externos sin permiso: la CSP los bloquearía.
- **Si falta un dato** (NIF, dirección, textos o imágenes reales), deja el placeholder y avísalo. No lo inventes.
- Al terminar, resume qué archivos y secciones has tocado.

## 3. Arquitectura real

```
index.html     Landing completa: HTML + CSS + JS en un solo archivo, sin build.
worker.js      Cloudflare Worker (API en https://api.rebrandyourbrand.es). Si no está en este repo, no inventes su contenido.
/casos/*.webp  Imágenes antes/después (formato 4:3, .webp, con width y height).
```

- **Stack:** HTML5 semántico + CSS propio + JavaScript vainilla (un IIFE con `'use strict'`). Sin frameworks, sin npm, sin bundlers.
- **Despliegue:** GitHub Pages (front) + Cloudflare Workers (API).
- **Orden de secciones:** hero (`#top`) → casos → problema → proceso → planes → sobre nosotros → testimonios → términos → legal → footer. El asistente Brandi (panel lateral) y el modal de verificación van al final del `<body>`.
- **Testimonios:** la sección está `hidden` y solo aparece si el Worker devuelve reseñas aprobadas de clientes verificados.

### Tailwind estático (importante)

El sitio **NO usa Tailwind por CDN ni compilador**. Hay un bloque `<style id="tailwind-static">` con el preflight y **solo las utilidades usadas, escritas a mano**.

- Una clase nueva **no funciona hasta que la añadas a ese bloque**, con la misma sintaxis. Variantes responsive escapadas: `.md\:flex`. Puntos de corte: `sm` 40rem, `md` 48rem, `lg` 64rem.
- Reutiliza las clases existentes antes de crear otras.
- Los estilos propios de componentes van en el segundo bloque `<style>` y usan `var(--color-*)`.
- No introduzcas `cdn.tailwindcss.com` ni un paso de compilación.

## 4. Sistema visual

Los colores son variables con triplete RGB (`rgb(var(--color-x))`). **No pongas hex sueltos en componentes** (única excepción: `#0A0A0C` para texto sobre botones `brand`/`ai`).

| Token | Oscuro | Claro | Uso |
|---|---|---|---|
| `--color-bg` | `#0A0A0C` | `#FFFFFF` | Fondo |
| `--color-panel` | `#1E1E22` | `#EDE6D6` | Tarjetas, paneles |
| `--color-line` | `#232226` | `#E4DED0` | Bordes |
| `--color-text` | `#F5F2EA` | `#17171A` | Texto principal |
| `--color-muted` | `#9C9BA3` | `#58575E` | Texto secundario |
| `--color-brand` | `#8CA3C4` | `#8CA3C4` | Identidad, CTAs, enlaces |
| `--color-brand-soft` | `#B7C6DC` | `#5F7A9E` | Hover de brand |
| `--color-ai` | `#E8A33D` | `#E8A33D` | Brandi (IA), foco, numeración |
| `--color-ai-soft` | `#F0BE82` | `#AD7626` | Hover de ai |

- **Tema claro por defecto.** El oscuro es opcional y se activa con el botón (clase `html.light` y clave `rybb-theme`). **Todo lo nuevo debe verse bien en los dos temas.**
- En modo claro, para texto pequeño usa `--color-brand-text` (`#3D5A85`) y `--color-ai-text` (`#825008`) por contraste.
- **Clases semánticas:** `bg-ink`, `bg-panel`, `bg-line`, `bg-brand`, `bg-ai`, `text-paper`, `text-muted`, `text-brand`, `text-ai`, `border-line`, `border-brand`.
- **Acentos con moderación:** `brand` (azul acero) = identidad y CTAs primarios; `ai` (ámbar) = Brandi, estados interactivos y foco.
- **Tipografía:** Fraunces (títulos, `.font-display`) e Inter (cuerpo). Cargadas con `preload` + `onload` y `<noscript>`. Titulares con tracking negativo (`-.035em` a `-.045em`).
- **Secciones:** `px-6 md:px-10 py-24 md:py-32 border-b border-line`, contenedor `max-w-6xl mx-auto`. Cabecera tipo: eyebrow mono (`text-xs tracking-widest text-brand font-mono`) + `h2` `font-display text-3xl md:text-4xl`.
- **Tarjetas:** radio 1rem–1.25rem, gradiente de `panel`, borde `line`; hover con `translateY(-3px/-4px)` y anillo (`--ring-brand`).
- **Botones:** `.btn .btn-primary` y `.btn-ghost`, dentro de `.cta-row` (a ancho completo en móvil).
- **Movimiento:** easing `--ease-editorial` (`cubic-bezier(.16,1,.3,1)`), 250–600 ms. Entradas con `.reveal` (IntersectionObserver) y `.hero-fade`. Respeta `prefers-reduced-motion`; `.no-js` debe mostrar todo. Nada de animaciones bruscas.
- **Safe areas:** `viewport-fit=cover` y `env(safe-area-inset-*)` ya están aplicados. Mantenlos en elementos fijos.

## 5. Idiomas (es / ca / en / eu)

- Todo texto visible lleva `data-i18n="clave"`. Atributos: `data-i18n-placeholder` y `data-i18n-aria`.
- **El español se lee del propio HTML.** Los textos en `en`, `ca` y `eu` viven en el objeto `translations`.
- Al añadir o cambiar un texto: actualiza el HTML en español **y las claves en `en`, `ca` y `eu`**. Nunca dejes un idioma sin traducir.
- Textos creados por JS: claves en `translations`, nunca literales en el código.
- Una sección nueva necesita: entrada en `slugMap` (es/en/ca/eu), en `sectionIds`, enlace con `data-section-target` y `<title>`/SEO si procede.
- Idioma guardado en `rybb-lang`. Los `hreflang` del `<head>` deben reflejar cómo se sirven realmente los idiomas.

## 6. Servicios y precios (dos sitios a sincronizar)

- La lista `SERVICES` está en `index.html` **y** en `worker.js`. Cambiar un precio exige cambiarlo en ambos, más los textos legales y de términos si lo mencionan.
- Para añadir un servicio: una entrada en cada `SERVICES`, y los textos `svc-<id>` y `svc-<id>-desc` en los cuatro idiomas.

## 7. Backend y seguridad

- **Contrato con el Worker** (`POST` a `WORKER_URL`): `action: 'session'` (canje de Turnstile), `action: 'pending'` con `op` `status|resend|restart`, y el chat de Brandi (mensajes, servicios, sesión, idioma, confirmación). `GET` devuelve los testimonios aprobados.
- **Secretos** (Groq, Stripe, Resend, clave secreta de Turnstile): solo como secrets de Cloudflare. **Nunca en el repo ni en el front.** La site key de Turnstile sí es pública.
- **CORS:** restringido a `https://rebrandyourbrand.es`. Nunca `*`.
- **Entradas:** valida y sanea todo JSON recibido; límites de tamaño y de frecuencia.
- **Códigos de error:** si añades uno en el Worker, añádelo al mapa `ERR` del front y a las traducciones `err-*`.
- **CSP** (`<meta http-equiv="Content-Security-Policy">`): cualquier dominio nuevo (scripts, fuentes, API, iframes) debe añadirse allí a propósito. No la relajes para "hacer que funcione" sin consultarlo.
- **Turnstile** solo se carga al abrir el chat. Mantén esa carga diferida.

## 8. Accesibilidad

- Enlace `skip-link` al contenido, `lang` actualizado, jerarquía de títulos coherente.
- Paneles y modales: `role="dialog"`, `aria-modal`, `inert` cuando están cerrados, trampa de foco, `Escape` para cerrar y devolver el foco.
- Foco visible (`:focus-visible` en ámbar). Contraste mínimo WCAG AA en ambos temas.
- Todo control táctil usable con teclado; botones icónicos con `aria-label`.

## 9. Rendimiento (objetivo: Lighthouse 100)

- Cero dependencias pesadas. Imágenes `.webp`, `loading="lazy"` y `width`/`height` explícitos.
- Los scripts de cabecera inline existentes (tema e idioma) son intencionados: evitan el parpadeo. No añadas más scripts bloqueantes.
- Fuentes de Google con carga no bloqueante (ya implementada). No la rompas.
- No añadas librerías, librerías de animación ni vídeos pesados.

## 10. Legal y privacidad

- **El aviso legal contiene placeholders** (`[NOMBRE O RAZÓN SOCIAL]`, `[NIF]`, `[DIRECCIÓN COMPLETA]`). No los rellenes tú: avisa al usuario de que deben completarse antes de publicar.
- **Términos B2B:** 2 rondas de revisión por fase, aprobación tácita a los 20 días, garantía de 14 días, 100 € fijos por ronda extra, sin reembolsos tras iniciar. No los modifiques sin orden expresa.
- **Datos locales actuales:** `localStorage` (`rybb-lang`, `rybb-theme`, `rrb_verified_session`) y `sessionStorage` (`rybb-session`). No hay analítica ni cookies publicitarias.
- Si añades analítica, cookies, formularios o un servicio de terceros, actualiza **en los tres idiomas** la política de privacidad y cookies, y la CSP.

## 11. SEO

- Mantén al día `title`, `description`, `canonical`, `hreflang`, Open Graph (`og-image.png` 1200×630) y el JSON-LD `ProfessionalService` cuando cambie la oferta.

## 12. Checklist antes de dar una tarea por terminada

1. Revisado en el navegador integrado a **390 px** y **1440 px**.
2. Probado en **tema claro y oscuro**.
3. Probado en **español, catalán, inglés y euskera**.
4. **Sin errores en consola** ni bloqueos de la CSP.
5. Navegación con **teclado** correcta (Tab, Escape en paneles y modales).
6. Animaciones OK con `prefers-reduced-motion`.
7. Si has añadido clases, **existen en `tailwind-static`**.
8. Lighthouse móvil sin regresiones.

## 13. Prohibido

- React, Vue, jQuery, bundlers, Tailwind por CDN o pasos de build.
- Colores hex sueltos en componentes o clases de color que no sean los tokens.
- Reescribir archivos completos, `// resto del código igual`, o borrar comentarios de configuración.
- Inventar datos legales, precios, reseñas o casos de clientes.
- Dejar claves o secretos en el código.