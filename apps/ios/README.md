# ЗЕРНО — приложение для iOS

Плёночная камера: живое превью с наложенной эмульсией, проявка снятого
кадра и плёнка с готовыми снимками. Тракт написан на Metal, интерфейс — на
SwiftUI.

```
ZERNO/
  Render/Shaders.metal      плёночный тракт: цвет, зерно, гало, дефекты
  Render/FilmRenderer.swift обвязка Metal: проходы, текстуры, экспорт
  Render/Compositor.swift   рамки, перфорация, семисегментная дата
  Model/FilmStock.swift     13 эмульсий и ручные поправки
  Camera/CameraModel.swift  AVFoundation: живой поток и снимок
  Views/                    экраны, полоса плёнок, лист настройки
  Design/                   палитра, шрифты, логотип-диафрагма
  Store/FrameStore.swift    отснятая плёнка на диске
```

## Открыть в Xcode

Файл `.xcodeproj` не лежит в репозитории: проект описан в `project.yml`,
а разворачивает описание XcodeGen. Так проект не конфликтует при слияниях.

```bash
cd apps/ios
./make-project.sh          # поставит xcodegen через brew, если его нет
open ZERNO.xcodeproj
```

Дальше в Xcode: выбрать свою команду разработчика в *Signing & Capabilities*
и запустить на устройстве. Симулятор тоже работает, но камеры там нет —
можно только загружать фотографии из галереи.

Требуется: macOS с Xcode 16, iOS 17 и новее на устройстве.

## Выложить в TestFlight

Сборку и выгрузку делает GitHub Actions — `.github/workflows/ios-testflight.yml`.

**Что нужно приготовить один раз**

1. Членство в Apple Developer Program (99 $ в год) — без него TestFlight
   недоступен в принципе.
2. В App Store Connect завести приложение с идентификатором
   `ru.kirmesch.zerno` (или поменять его в `project.yml` на свой).
3. Там же: *Users and Access → Integrations → App Store Connect API* →
   создать ключ с ролью **App Manager**, скачать файл `AuthKey_XXXX.p8`
   (он даётся один раз).
4. В репозитории *Settings → Secrets and variables → Actions* добавить:

   | Секрет | Что положить |
   |---|---|
   | `APPLE_TEAM_ID` | идентификатор команды, 10 знаков (Apple Developer → Membership) |
   | `ASC_KEY_ID` | Key ID созданного ключа |
   | `ASC_ISSUER_ID` | Issuer ID со страницы ключей |
   | `ASC_PRIVATE_KEY` | содержимое файла `.p8` целиком, вместе со строками `-----BEGIN…` |

**Запуск**

*Actions → TestFlight → Run workflow*. Или пуш тега:

```bash
git tag ios-v1.0.0 && git push origin ios-v1.0.0
```

Через 10–20 минут сборка появится в App Store Connect → TestFlight.
Внутренним тестировщикам она доступна сразу после обработки; для внешних
нужна проверка Apple (обычно от нескольких часов до суток).

Ссылка на установку берётся там же: *TestFlight → Внешняя группа →
Public Link*. Это единственный способ получить ссылку вида
`testflight.apple.com/join/…` — сгенерировать её со стороны нельзя,
она выдаётся Apple после загрузки сборки.

## Иконка

Иконка не рисуется руками, а считается: `tools/make_logo.py` строит
диафрагму из шести лепестков и кладёт готовый PNG в каталог ассетов.

```bash
python3 tools/make_logo.py zerno/icons
```

## Что стоит знать про код

- `FilmParams` в Swift и `FilmParams` в `Shaders.metal` обязаны совпадать
  по раскладке: сначала шесть `float3`/`SIMD3<Float>`, потом скаляры.
  Добавляешь поле — правь оба места.
- Гало считается по уменьшенной вчетверо копии кадра: света выделяются
  отдельным проходом, потом размываются `MPSImageGaussianBlur`.
- Живое превью рисует `MTKView` напрямую в drawable, без промежуточных
  копий. Экспорт идёт через отдельную текстуру и `CIContext`.
