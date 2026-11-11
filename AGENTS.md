# AGENTS.md — Antarquia Hub

## Qué es

Portada del apex **<https://antarquia.cl/>**. Enlaza a La Idea, Por la
Anarquía, Marea y Punto de Ignición. No hay beta: el hub se publica desde
`main`.

## Stack

HTML y CSS estáticos servidos desde `public/`. No hay build: Workers publica
`public/` tal cual. `wrangler.jsonc` declara el apex como custom domain.

## Comandos

```bash
npx wrangler dev
npx wrangler deploy
```

El workflow `deploy.yml` despliega en cada push a `main`.

## Tarjetas

- Orden: La Idea → Por la Anarquía → Marea → Punto de Ignición.
- Etiquetas del lema: Recopilación, Difusión, Edición, Proyección.
- Logo PNG cuadrado en `public/logos/`, mostrado a 56 px en círculo blanco.
- Rejilla 2×2 en escritorio y una columna en móvil.
- `utils` **no** aparece en el apex por decisión de producto.

Al añadir un proyecto, actualiza también la meta descripción y el `README.md`.

## Mapas

`maps/worker` tiene su propio Worker y su workflow `deploy-maps.yml`. No lo
mezcles con el deploy del hub.

## Reglas

- No metas `utils` ni `dimensiones-anidadas` en la portada.
- No cambies el orden ni las etiquetas sin confirmación.
- Mantén el HTML accesible: enlaces reales, foco visible y texto alternativo
  vacío solo en logos decorativos.
- Si cambias el hosting o el dominio, actualiza `~/Repositorios/antarquia/`.

## Agentes y skills

- Skill `antarquia-sitios`: convenciones del paraguas y verificación.
- `antarquia-qa` para revisar; `antarquia-ops` para desplegar.
