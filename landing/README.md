# Nexus landing

Static Cloudflare Workers site for `nexus.kushalsm.com`.

## Local development

```sh
wrangler dev --local --port 8789
```

## Deploy

```sh
wrangler deploy
```

The Worker serves files from `public/` and is configured with a custom-domain route for `nexus.kushalsm.com`.
