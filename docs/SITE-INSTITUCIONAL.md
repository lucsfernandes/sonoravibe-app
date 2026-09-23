# Site institucional — Sonora

Site estático, sem build: HTML, CSS e JavaScript puros, mais as fontes do Google e as fotos
que estão em `img/`. Não passa por React nem pelo bundler do Next.

## Onde ele vive

Em `apps/web/public/`, e é **a raiz de `sonoravibe.com`**. Quem chega pela primeira vez vê a
apresentação do produto; o aplicativo começa em `/inicio`.

```
apps/web/public/
  index.html                    a raiz do domínio
  politica-de-privacidade.html
  404.html
  assets/css/styles.css
  assets/js/main.js
  img/                          fotos reais (Pexels) + ícone
  robots.txt · sitemap.xml · site.webmanifest
```

O que faz `/` servir este HTML em vez do Next é um rewrite `beforeFiles` em
`apps/web/next.config.ts`. Os arquivos ficam na **raiz** de `public/`, e não numa subpasta, porque
os links de dentro do HTML são relativos (`assets/css/styles.css`, `img/fones.jpg`): de `/site/`
eles apontariam para fora.

Editar é editar o arquivo e subir um deploy da web — não há passo de build para o site.

### Por que não virou uma página React

O design foi feito e revisado como HTML estático. Portá-lo para JSX significaria reescrever ~540
linhas de marcação e o CSS junto, com risco de perder detalhe visual, para ganhar o quê? Ele não
consome dados da API nem precisa de estado. O rewrite custa três linhas e preserva o resultado
byte a byte.

## Blog

Mesmo modelo do site: HTML estático em `public/blog/`, com o mesmo `styles.css` e `main.js`.
Dois rewrites em `next.config.ts` dão URL limpa: `/blog` serve `blog/index.html` e
`/blog/<slug>` serve `blog/<slug>.html`. Dentro do blog os links são **absolutos**
(`/assets/css/styles.css`), porque a página é servida de uma subpasta.

Para publicar um post novo:

1. Copie `blog/como-criar-musicas-no-sonora-vibe.html` para `blog/<slug>.html`. O slug usa só
   letras minúsculas, números e hífen: é o que o rewrite aceita.
2. Troque o `<title>`, a descrição, o `canonical`, as tags `og:*` e o JSON-LD.
3. Adicione um `<li class="blog-item">` no **topo** da lista em `blog/index.html`.
4. Inclua a URL no `sitemap.xml`.

Componentes prontos para o texto do post: `.aviso` (caixa de destaque), `.prompt` com
`<pre id>` e um botão `data-copiar="<id>"` (ele copia para a área de transferência), `.ficha`
(configurações em rótulo e valor) e `.tabela`.

O primeiro post descreve o produto como ele é hoje, incluindo limites e o comportamento do
**Estender**. Quando uma dessas coisas mudar no código, atualize o post e
`docs/TEMPLATE-DE-PROMPT.md`.

## O que trocar antes de publicar

Procure por `TROCAR` no `index.html` e na política de privacidade:

| Onde | O que |
|---|---|
| Rodapé e política | Razão social, CNPJ e cidade/UF reais |
| Rodapé | E-mail de suporte e link do Instagram |
| Botão flutuante | Número de WhatsApp (formato `55` + DDD + número) |
| Política | Data da última revisão |
| — | Os links do app (`/entrar`, `/creditos`) já são relativos e funcionam: é o mesmo domínio |

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
