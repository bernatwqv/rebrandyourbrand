# 🎨 rebrandyourbrand.design

Estudio de rebranding y diseño visual especializado en identidad visual, packaging y dirección de arte. 

Este repositorio alberga el código fuente de la landing page oficial, desarrollada con un enfoque minimalista, alta fidelidad visual y una arquitectura de seguridad avanzada en el borde.

---

## 🚀 Arquitectura y Stack Tecnológico

El proyecto combina un diseño frontend limpio con un sistema de IA integrado de forma 100% segura mediante una arquitectura **Zero Trust**:

* **Frontend:** HTML5 semántico, Tailwind CSS (configuración JIT mediante CDN), JavaScript nativo optimizado y soporte completo para modo oscuro/claro.
* **Alojamiento:** GitHub Pages (Despliegue estático automatizado).
* **Seguridad (Borde):** 
  * **Cloudflare Turnstile:** Validación anti-bots interactiva en el cliente y verificación canónica del lado del servidor (`siteverify`).
  * **Content Security Policy (CSP) Endurecida:** Restricción estricta de scripts, estilos y conexiones permitidas.
* **Backend & IA:** 
  * **Cloudflare Workers:** Proxy serverless que actúa como pasarela segura.
  * **OpenRouter API:** Integración con el modelo **Qwen 2.5-72b-instruct** para el asistente interactivo de marca, manteniendo las API keys totalmente ocultas fuera del cliente.

---

## 🛡️ Características de Seguridad
1. **Ocultación de Secretos:** Cero exposición de claves de OpenRouter en el navegador. Toda llamada pasa por el Worker.
2. **Protección Anti-Spam:** El widget de Turnstile bloquea scripts automatizados (`cURL`, bots de scraping o ataques de fuerza bruta) antes de consumir tokens de IA.
3. **Control de Origen:** Cabeceras CORS estrictas vinculadas exclusivamente al dominio de producción (`bernatwqv.github.io`).

---

## 📄 Licencia
&copy; Todos los derechos reservados.