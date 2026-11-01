# rebrandyourbrand

Sitio web en producción: [https://rebrandyourbrand.es](https://rebrandyourbrand.es)

Estudio de identidad visual y desarrollo web edge a precio cerrado y sin cuotas mensuales de diseño. El proyecto ofrece servicios modulares para empresas y autónomos, garantizando control total del alcance, arquitectura técnica serverless de alto rendimiento y transparencia operativa.

---

## Arquitectura y Stack Tecnológico

| Capa | Componente | Descripción técnica |
|---|---|---|
| **Frontend** | `index.html` | HTML5 semántico, CSS editorial a medida con tipografías Fraunces e Inter, Vanilla JS sin dependencias externas ni pasos de compilación. Navegación en cápsula flotante (*floating island*) con transición reactiva de isotipo (*logo morphing on scroll* de `rebrandyourbrand` a `re`), configurador de precios interactivo con tarjetas estilo tiquet troquelado y código de barras algorítmico reactivo. |
| **Edge Backend** | `src/` -> `worker.js` | Cloudflare Workers (`rebrandyourbrand-proxy`) ejecutado en red global edge. Almacenamiento clave-valor de alta disponibilidad con Cloudflare KV (`LEADS_KV`) y limitación de tasa (*rate limiting*) nativa para mitigación de abusos. |
| **Asistente IA** | Brandi (`src/ai.js`, `src/chat.js`) | Dirección de arte interactiva con Groq (modelo Llama 3.3 70B Versatile), deducción automática de servicios requeridos, validación obligatoria de dominio para proyectos que incluyan web, verificación humana no intrusiva con Cloudflare Turnstile diferido y resúmenes de propuesta protegidos mediante firma criptográfica HMAC SHA-256 (`crypto.subtle`). |
| **Pagos y Facturación** | `src/payments.js` | Pasarela Stripe Checkout B2B con gestión de eventos y webhooks idempotentes. Precios cerrados: Logotipo (400 €, incluye paleta de empresa bonificada a 0 €), Paleta suelta (100 €), Web (400 € de desarrollo llave en mano + 100 €/año de infraestructura técnica gestionada). Desbloqueo y cobro automático de rondas de revisión extra a 100 € fijos por ronda. |
| **Ciclo de Vida y EmailOps** | `src/handlers.js`, `src/cron.js` | Comunicación transaccional con Resend. Subida directa de materiales y referencias de hasta 25 MB servidos por enlaces firmados temporales (`GET /file`), registro acumulativo (*append-only*) de entregas con barra flotante de deshacer con cuenta atrás de 15 segundos, cierre de proyecto con emisión automática de enlaces para reseñas verificadas y automatización cron diaria (recordatorio amistoso a los 15 días, preaviso formal de abandono a los 30 días, rescisión a los 37 días según cláusula 3.2 y alertas internas de renovación anual vencida). |
| **Internacionalización** | `src/i18n.js` | Localización integral en 4 idiomas sincronizados: español (`es`), catalán (`ca`), euskera (`eu`) e inglés (`en`), tanto en la interfaz pública como en el backend y los correos transaccionales. |

---

## Estructura del Repositorio

```text
rebrandyourbrand/
├── index.html            Landing page completa: HTML semántico, CSS y JavaScript vainilla
├── worker.js             Bundle compilado para Cloudflare Workers (despliegue edge)
├── build.mjs             Script de empaquetado y concatenación modular hacia worker.js
├── verify_all.mjs        Auditoría estricta: sintaxis, JSON-LD, claves i18n y estilo
├── AGENTS.md             Reglas de gobernanza para agentes de desarrollo
├── DESIGN.md             Especificación del sistema de diseño y tokens visuales
├── CNAME                 Configuración de dominio propio para GitHub Pages
├── robots.txt            Directivas para motores de búsqueda y rastreadores
├── sitemap.xml           Mapa del sitio web para indexación
├── logo.svg              Logotipo vectorial oficial de rebrandyourbrand
├── favicon.svg           Isotipo condensado oficial para navegadores
├── og-image.png          Imagen Open Graph optimizada para redes sociales
└── src/                  Módulos fuente del Cloudflare Worker:
    ├── index.js          Punto de entrada: enrutado HTTP y eventos programados (cron)
    ├── config.js         Constantes del sistema, límites y catálogo de servicios
    ├── handlers.js       Controladores de rutas: verificación, entregas y archivos
    ├── payments.js       Integración de Stripe Checkout, fases y webhooks
    ├── ai.js             Lógica de Brandi, llamadas a Groq y validación de respuesta
    ├── chat.js           Gestión de sesiones de chat, Turnstile y propuesta
    ├── leads.js          Flujo de verificación de correo y alta de proyectos
    ├── pages.js          Vistas HTML dinámicas del worker y panel del cliente
    ├── i18n.js           Diccionarios multilingües (es, ca, eu, en) y plantillas
    ├── cron.js           Tareas programadas: recordatorios, preavisos y abandono
    ├── email.js          Renderizado de plantillas de correo y envíos con Resend
    ├── security.js       Firmas HMAC, validación de tokens y protección Turnstile
    ├── http.js           Constructores de respuesta HTTP, cabeceras seguras y CSP
    └── utils.js          Utilidades de formateo, sanitización y fechas ISO
```

---

## Desarrollo y Verificación

El proyecto prioriza la ligereza técnica y prescinde de herramientas de compilación pesadas o dependencias npm. Para construir y auditar el backend:

### 1. Compilación del Worker
Concatena los módulos de `src/` en el archivo final `worker.js` verificando que no existan caracteres prohibidos por las directrices de estilo:

```bash
node build.mjs
```

### 2. Auditoría Integral del Código
Ejecuta la suite de comprobaciones automáticas del repositorio:
- Integridad sintáctica de todos los bloques `<script>` de `index.html`.
- Validación del esquema estructurado JSON-LD `ProfessionalService`.
- Comprobación de paridad de claves multilingües en los 4 idiomas (`es`, `ca`, `eu`, `en`).
- Auditoría de estilo en `worker.js` (0 puntos medios, 0 viñetas y 0 ampersands).
- Verificación de importación ESM de los handlers `fetch` y `scheduled`.

```bash
node verify_all.mjs
```

---

## Equipo

- **Gael Domènech Sevillano** — Dirección de arte y diseño visual.
- **Bernat Domènech Sevillano** — Desarrollo web e ingeniería edge.
