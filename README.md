# Ronda

Leitor de feeds e homes de sites de noticias, com busca por URL, extracao de manchetes e enriquecimento progressivo de resumos.

## Acesso pelo browser

```bash
npm start
```

Abra:

```text
http://127.0.0.1:8371
```

Para acessar de outro aparelho na mesma rede:

```bash
HOST=0.0.0.0 npm start
```

Depois abra `http://IP-DO-MAC:8371`.

## GitHub Pages

O GitHub Pages abre a interface como PWA estatico, mas nao executa o backend Node (`/api/fetch`). Nesse modo, a Busca por URL ainda tenta os proxies publicos como fallback. Para a Busca por URL com proxy proprio, publique em um host que rode Node, como Render, Railway, Fly.io ou uma VPS.
