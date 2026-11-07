# Antarquia — hub

Portada de **https://antarquia.cl**. Enlaza a los cuatro proyectos públicos:

- [La Idea](https://laidea.antarquia.cl/) — recopilación
- [Por la Anarquía](https://porlaanarquia.antarquia.cl/) — difusión
- [Marea](https://marea.antarquia.cl/) — edición
- [Punto de Ignición](https://puntodeignicion.antarquia.cl/) — proyección

Utilidades (`utils.antarquia.cl`) queda fuera de la portada por decisión de producto.

## Stack

HTML y CSS estáticos servidos por un Worker de Cloudflare con assets. El apex
`antarquia.cl` se configura como custom domain del Worker.

## Desarrollo

```bash
npx wrangler dev
```

## Deploy

```bash
npx wrangler deploy
```

El workflow `deploy.yml` despliega en cada push a `main`. Requiere los secretos
`CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en el repo.

## DNS

El custom domain del Worker crea el registro proxied del apex. No deben quedar
registros A apuntando a GitHub Pages.
