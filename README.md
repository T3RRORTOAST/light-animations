# Light Animations

Eine eigene App für iDrive 7: Lichthupe und benannte Frontleuchten. Sie steht für sich, ohne Ambientebeleuchtung.

Im MGU App Store als GitHub-Quelle laden, Kanal Branch `main`. Der Store baut `apps/light_animations` auf der Headunit mit `kit/tools/build.py`. Das BMW-SDK (`oap-sdk`) liegt nicht in diesem Repo; die Unit legt es selbst daneben.

Mit der App kommen der GPU-Renderer und das Controller-Gate aus `kit/renderd/prebuilt`.

Lokal prüfen:

```sh
node kit/tools/test_light_animations.js
```
