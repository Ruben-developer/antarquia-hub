# Antarquia — hub

Portada de **https://antarquia.cl**. Enlaza a los proyectos públicos:

- [La Idea](https://laidea.antarquia.cl/) — recopilación
- [Por la Anarquía](https://porlaanarquia.antarquia.cl/) — difusión
- [Marea](https://marea.antarquia.cl/) — edición
- [Punto de Ignición](https://puntodeignicion.antarquia.cl/) — proyección

Utilidades (`utils.antarquia.cl`) queda fuera de la portada por decisión de producto.

Los mapas colectivos (**Cartografía Anarquista** y **Mapeo Cordillera**) siguen
desplegados en `maps/`, con sus dominios propios, pero ya no se enlazan desde la
portada.

## Stack

HTML y CSS estáticos servidos por un Worker de Cloudflare con assets. El apex
`antarquia.cl` se configura como custom domain del Worker.

Los dos mapas viven en `maps/`: un Worker con API sobre Durable Objects
(SQLite), dos custom domains y un sitio estático compartido (Leaflet, límites
comunales y `map-app.js`).

## Desarrollo

```bash
npx wrangler dev
```

Para los mapas:

```bash
cd maps/worker
cp .dev.vars.example .dev.vars   # o crea el tuyo
npm install
npm run dev
```

Abre `http://localhost:8787/cartografia/` o `http://localhost:8787/cordillera/`.

## Deploy

```bash
npx wrangler deploy
```

El workflow `deploy.yml` despliega el hub en cada push a `main`. El workflow
`deploy-maps.yml` despliega los mapas cuando cambia `maps/`. Ambos requieren los
secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en el repo.

Los mapas usan además:

- `CORDILLERA_PASSPHRASE` — frase de acceso del mapa Cordillera
- `SESSION_SECRET` — clave HMAC para firmar la cookie de sesión
- `ADMIN_TOKEN` — token de moderación de ambos mapas

El workflow despliega el Worker con sus Durable Objects y configura los tres
secretos. No hace falta crear ningún namespace por separado.

## DNS

El custom domain del Worker crea el registro proxied del apex. No deben quedar
registros A apuntando a GitHub Pages.
