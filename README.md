# Retalhos

Editor de vídeo que roda no navegador, no computador e no celular. Nada é enviado para servidor: abrir, editar, criar legendas e exportar acontece no próprio aparelho.

Site: https://keittydonoso.github.io/retalho/

## O que ele faz

- **Vários vídeos** na mesma linha do tempo, com mover, dividir, duplicar e apagar trechos
- **Formatos**: vertical 9:16, horizontal 16:9, quadrado 1:1, retrato 4:5, com fundo desfocado, barras ou preencher
- **Velocidade** (câmera lenta e rápida) e **volume** por trecho
- **Legendas automáticas** com reconhecimento de fala no navegador (Whisper), em 6 estilos e com a palavra falada em destaque
- **Textos** com estilos (Limpa, Impacto, Manuscrita, Marcador, Neon, Etiqueta) e animações; arraste na prévia para posicionar
- **Cartões de título** com fundos animados do editonny
- **Efeitos**: vinheta, cinema, preto e branco, cores quentes e frias, brilho, desfoque, VHS, tremor, zoom lento, confete, chuva de dinheiro e de emoji
- **Luzes** do editonny por cima do vídeo
- **Marcações**: seta, círculo, certo, errado, sublinhado, caixa, holofote e emoji
- **Transições** nos cortes: escurecer, flash, zoom, falha digital e persiana
- **Música** (23 faixas livres ou do aparelho) e **28 efeitos sonoros**
- **Desfazer/Refazer** e **Exportar** em 1080p ou 720p (MP4 ou WebM, conforme o navegador)

## Como o código está organizado

| Arquivo | O que faz |
|---|---|
| `index.html` | A página |
| `css/app.css` | Visual |
| `js/app.js` | Linha do tempo, reprodução, painéis, exportação |
| `js/render.js` | Desenha cada quadro (efeitos, textos, transições) |
| `js/captions.js` | Legendas automáticas |
| `js/library.js` | Lista de músicas, sons, fundos e efeitos |
| `assets/lib/` | Mídias da biblioteca do editonny |

Não precisa compilar nada: é só abrir o `index.html` por um servidor (por exemplo `python3 -m http.server`).

## Créditos

- Cores, ícones, fundos animados e luzes: [editonny](https://github.com/soumatheusgomes/editonny), de Matheus Gomes (licença MIT).
- Músicas: HoliznaCC0, Rafael Krux (CinematicWaves.com) e Frank Nora, em domínio público (CC0), pela biblioteca do editonny.
- Efeitos sonoros: Freesound, domínio público (CC0). Autores em `assets/lib/sfx/CREDITS.md`.
- Ícones no estilo [Lucide](https://lucide.dev) (licença ISC).
- Reconhecimento de fala: [Transformers.js](https://github.com/huggingface/transformers.js) com o modelo Whisper.
