# Site institucional — Sonora

Site estático, sem build. Abre com dois cliques no `index.html`: é HTML, CSS e
JavaScript puros, mais as fontes do Google e as fotos que já estão na pasta `img/`.

```
index.html                    página única
politica-de-privacidade.html  LGPD
404.html
assets/css/styles.css
assets/js/main.js
img/                          fotos reais (Pexels) + ícone
robots.txt · sitemap.xml · site.webmanifest
```

## Publicar

**Netlify Drop (mais rápido):** abra [app.netlify.com/drop](https://app.netlify.com/drop) e arraste
a pasta `site-sonora` inteira. Fica no ar em segundos, com HTTPS.

**No seu próprio cluster:** a pasta é estática — serve com qualquer servidor de arquivos. Como
`sonoravibe.com` já está apontado para o app Next.js, decida onde este site vai morar. Três opções:

1. **Este site na raiz e o app em `app.sonoravibe.com`** — o mais comum: quem chega pelo Google vê a
   página de vendas, e quem já é usuário vai direto para o app. Exige mudar o host do `sonora-web`
   nos manifests e o `CORS_ORIGINS` da API.
2. **Este site em `site.sonoravibe.com`** — não mexe em nada do que já está configurado.
3. **Netlify/Cloudflare Pages num domínio à parte** — zero impacto no cluster.

Se escolher a 1, eu ajusto os manifests do k8s e a configuração de CORS.

## O que trocar antes de publicar

Procure por `TROCAR` no `index.html` e na política de privacidade:

| Onde | O que |
|---|---|
| Rodapé e política | Razão social, CNPJ e cidade/UF reais |
| Rodapé | E-mail de suporte e link do Instagram |
| Botão flutuante | Número de WhatsApp (formato `55` + DDD + número) |
| Política | Data da última revisão |
| Cabeçalho e botões | Confirme as URLs do app (`/entrar`, `/creditos`) |

## As fotos

São reais, do [Pexels](https://www.pexels.com/pt-br/) — uso comercial liberado, sem precisar dar
crédito. Mas são temporárias: troque pelas fotos da própria marca quando tiver.

1. Salve a foto nova em `img/` com o mesmo nome do arquivo antigo.
2. Cada bloco já tem o recorte definido por `aspect-ratio`, então a foto nova encaixa sem quebrar
   o layout.

Licença Pexels: não revenda a foto crua e pessoas identificáveis não podem aparecer de forma
ofensiva.

## O que o site NÃO tem, de propósito

Sem depoimentos, sem "mais de X músicas geradas", sem logos de imprensa. Esses números e citações
precisam ser reais — quando você tiver, eu coloco. Um depoimento inventado é o tipo de coisa que
destrói a confiança justamente de quem estava prestes a assinar.

Os números que aparecem (duração por plano, formatos, créditos, preços) são os do produto de verdade.
