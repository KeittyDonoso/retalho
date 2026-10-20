# Junta o editor com o vídeo de exemplo e gera retalho.html (para o Claude) e index.html (para o site).
import base64, pathlib
here = pathlib.Path(__file__).parent
body = (here / "src/editor.html").read_text()
b64 = base64.b64encode((here / "src/exemplo.mp4").read_bytes()).decode()
body = body.replace("__SAMPLE_B64__", b64)
(here / "retalho.html").write_text(body)
head = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
(here / "index.html").write_text(head + body + "</body></html>")
