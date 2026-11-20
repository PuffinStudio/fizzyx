---
"@puffinstudio/fizzyx": minor
---

Comments and card descriptions can now carry images and highlights. `![caption](shot.png)` in `flow comment` (new or `--edit`), `flow create --desc` and `flow edit --desc` uploads the local image to Fizzy and embeds it with its caption; `flow comment --attach <file>` appends images without editing the Markdown. `==text==` highlights text in yellow, `==text=={green}` in another colour, and `==text=={text:red}` colours the text, using the same markup as Fizzy's editor so it stays editable there. Images must sit inside the Markdown file's directory (or the current directory for stdin), be real PNG/JPEG/GIF/WebP files and at most 20 MB; `--allow-image-paths-outside` lifts the directory rule. A missing or refused file stops the command before anything is uploaded or posted. `flow comment --no-prefix` posts the body without the `note:` prefix.
